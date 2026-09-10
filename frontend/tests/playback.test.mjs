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
