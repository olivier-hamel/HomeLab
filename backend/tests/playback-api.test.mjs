import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMediaApi } from '../src/lib/media/api.ts';
import { parseProbe } from '../src/lib/media/playback-plan.ts';

const hash = 'd'.repeat(40), secret = 'playback-test-only-private-canary-secret';
Object.assign(process.env, { MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: 'http://playback.test', MEDIA_SESSION_SECRET: secret, TORRSERVER_BASE_URL: 'http://torrents.test' });
const status = { hash, stat: 3, file_stats: [{ id: 1, path: 'Not inferred from filename.mp4', length: 1000 }] };
function fixture(audio = 'aac', container = 'mov,mp4') {
  const converted = [], streamed = []; let probes = 0;
  const converter = {
    async probe() { probes++; return parseProbe({ format: { format_name: container, duration: '120' }, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 41 }, { index: 1, codec_type: 'audio', codec_name: audio, profile: 'LC' }] }, Buffer.alloc(0)); },
    async stream(...args) { converted.push(args); return new Response(args[4].method === 'HEAD' ? null : 'converted', { headers: { 'Content-Type': 'video/mp4' } }); },
  };
  const api = createMediaApi(async (url, init) => {
    if (new URL(url).pathname === '/torrents') return Response.json(status);
    streamed.push({ url, init }); return new Response('original');
  }, converter);
  const client = async () => {
    const cookie = (await api(new Request('http://playback.test/api/media/status'))).headers.get('set-cookie').split(';')[0];
    return (path, body, extra = {}) => api(new Request(`http://playback.test/api/media/${path}`, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), ...extra, headers: { cookie, Origin: 'http://playback.test', ...(body ? { 'Content-Type': 'application/json', 'X-Media-Request': '1' } : {}), ...extra.headers } }));
  };
  return { client, api, converted, streamed, probes: () => probes };
}
async function selected(f) {
  const call = await f.client();
  const added = await (await call('playback', { magnet: `magnet:?xt=urn:btih:${hash}` })).json();
  const selection = await (await call('select', { id: added.id, fileId: 1 })).json();
  return { call, selection };
}
test('select does not read video; inspected compatible MP4 remains the original ranged stream', async () => {
  const f = fixture(); const { call, selection } = await selected(f);
  assert.equal(f.probes(), 0); assert.equal(f.streamed.length, 0);
  assert.equal((await call('prepare', { id: selection.id, supported: [] })).status, 400);
  const inspection = await (await call('inspect', { id: selection.id })).json();
  const prepared = await (await call('prepare', { id: selection.id, supported: inspection.options.map(o => o.id).reverse() })).json();
  assert.equal(prepared.mode, 'direct'); assert.equal(prepared.stream, selection.stream);
  const response = await call(prepared.stream.replace('/api/media/', ''), undefined, { headers: { Range: 'bytes=0-3' } });
  assert.equal(await response.text(), 'original'); assert.equal(f.converted.length, 0);
  assert.equal(new Headers(f.streamed[0].init.headers).get('range'), 'bytes=0-3');
});
test('conversion handles are opaque and owner-scoped; seek time is validated and external links stay original', async () => {
  const f = fixture('dts', 'matroska,webm'); const { call, selection } = await selected(f);
  const foreign = await f.client();
  assert.equal((await foreign('inspect', { id: selection.id })).status, 410);
  const inspection = await (await call('inspect', { id: selection.id })).json();
  const supported = inspection.options.filter(o => o.mime.startsWith('video/mp4') && o.mime.includes('mp4a.40.2')).map(o => o.id);
  const prepared = await (await call('prepare', { id: selection.id, supported })).json();
  assert.equal(prepared.video, 'copy'); assert.equal(prepared.audio, 'aac'); assert.equal(prepared.mode, 'transcode');
  assert.ok(!JSON.stringify(prepared).includes(hash) && !JSON.stringify(prepared).includes(secret));
  const path = prepared.stream.replace('/api/media/', '');
  assert.equal((await foreign(path)).status, 410);
  for (const start of ['-1', 'NaN', '120', 'Infinity', '1e2', '1;bad']) assert.equal((await call(`${path}?start=${start}`)).status, 400);
  assert.equal((await call(`${path}?start=30.5`, undefined, { method: 'HEAD' })).status, 200);
  assert.equal(f.converted.at(-1)[5], 30.5);
  // HTMLMediaElement.currentTime and persisted MongoDB positions retain sub-ms precision.
  assert.equal((await call(`${path}?start=30.123456789`)).status, 200);
  assert.equal(f.converted.at(-1)[5], 30.123456789);
  assert.equal((await call('prepare', { id: selection.id, supported: ['file:///private'] })).status, 422);
  const share = await (await call('share', { id: selection.id })).json();
  const external = await f.api(new Request(`http://playback.test${share.path}`));
  assert.equal(await external.text(), 'original'); assert.equal(f.converted.length, 2);
});
