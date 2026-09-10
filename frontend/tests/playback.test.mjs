import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparePlayback, supportedPlayback } from '../src/lib/media.ts';

test('browser checks exact codec MIME strings without claiming unsupported formats', () => {
  const options = [{ id: 'direct', mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' }, { id: 'hevc', mime: 'video/mp4; codecs="hvc1.2.4.L153.B0, mp4a.40.2"' }, { id: 'remux', mime: 'video/webm; codecs="vp9, opus"' }];
  const seen = [];
  assert.deepEqual(supportedPlayback(options, mime => { seen.push(mime); return mime.includes('hvc1') ? '' : mime.includes('webm') ? 'maybe' : 'probably'; }), ['direct', 'remux']);
  assert.deepEqual(seen, options.map(o => o.mime));
});
test('Android TV uses a conservative H.264/AAC MP4 stream despite optimistic WebView codec claims', () => {
  const options = [
    { id: 'direct-hevc', container: 'mp4', video: 'copy', audio: 'aac', mime: 'video/mp4; codecs="hvc1.2.4.L153.B0, mp4a.40.2"' },
    { id: 'copy-h264', container: 'mp4', video: 'copy', audio: 'aac', mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
    { id: 'safe', container: 'mp4', video: 'h264', audio: 'aac', mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
    { id: 'safe-silent', container: 'mp4', video: 'h264', audio: 'none', mime: 'video/mp4; codecs="avc1.640028"' },
    { id: 'webm', container: 'webm', video: 'vp9', audio: 'opus', mime: 'video/webm; codecs="vp9, opus"' },
  ];
  assert.deepEqual(supportedPlayback(options, () => 'probably', 'android-tv'), ['safe', 'safe-silent']);
});
test('playback preparation probes first, then posts only supported option IDs with the session and cancellation', async () => {
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.signal, signal); assert.equal(init.credentials, 'same-origin');
    return Response.json(url.endsWith('inspect') ? { options: [{ id: 'direct-copy-copy', mime: 'video/mp4' }, { id: 'webm-copy-copy', mime: 'video/webm' }] } : { mode: 'direct', stream: '/api/media/stream/selected' });
  };
  try {
    const result = await preparePlayback('selected', signal, mime => mime === 'video/mp4' ? 'probably' : '');
    assert.equal(result.mode, 'direct');
    assert.deepEqual(calls.map(c => [c.url, JSON.parse(c.init.body)]), [['/api/media/inspect', { id: 'selected' }], ['/api/media/prepare', { id: 'selected', supported: ['direct-copy-copy'] }]]);
  } finally { globalThis.fetch = original; }
});

test('native decoder capabilities preserve direct video even when WebView rejects its MIME', async () => {
  const original = globalThis.fetch;
  const inspection = { width: 1920, height: 1080, frameRate: 24, options: [
    { id: 'direct-copy-copy', container: 'matroska', video: 'copy', audio: 'copy', mime: 'video/x-matroska; codecs="avc1.640028, mp4a.40.2"' },
    { id: 'mp4-h264-aac', container: 'mp4', video: 'h264', audio: 'aac', mime: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' },
  ] };
  let submitted;
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('inspect')) return Response.json(inspection);
    submitted = JSON.parse(init.body).supported;
    return Response.json({ mode: 'direct' });
  };
  try {
    const result = await preparePlayback('selected', new AbortController().signal,
      () => { throw new Error('Native playback must not ask WebView'); }, 'android-tv', async source => {
        assert.deepEqual(source, inspection);
        return ['direct-copy-copy', 'mp4-h264-aac', 'untrusted-option'];
      });
    assert.equal(result.mode, 'direct');
    assert.deepEqual(submitted, ['direct-copy-copy', 'mp4-h264-aac']);
  } finally { globalThis.fetch = original; }
});

test('old APKs retain compatibility conversion but an empty native capability list stays empty', async () => {
  const original = globalThis.fetch;
  const supported = [];
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('inspect')) return Response.json({ options: [
      { id: 'direct', container: 'mp4', video: 'copy', audio: 'copy', mime: 'video/mp4' },
      { id: 'safe', container: 'mp4', video: 'h264', audio: 'aac', mime: 'video/mp4' },
    ] });
    supported.push(JSON.parse(init.body).supported);
    return Response.json({});
  };
  try {
    await preparePlayback('selected', new AbortController().signal, () => 'probably', 'android-tv', async () => null);
    await preparePlayback('selected', new AbortController().signal, () => 'probably', 'android-tv', async () => []);
    assert.deepEqual(supported, [['safe'], []]);
  } finally { globalThis.fetch = original; }
});

test('cancelling a native capability query prevents preparing a stream', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ options: [] }); };
  try {
    await assert.rejects(preparePlayback('selected', controller.signal, () => '', 'android-tv', async () => {
      controller.abort();
      return [];
    }), { name: 'AbortError' });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});
