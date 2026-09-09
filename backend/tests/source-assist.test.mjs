import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSIST_MODEL, baselineAdvice, SourceAssist } from '../src/lib/media/source-assist.ts';
import { createMediaApi } from '../src/lib/media/api.ts';

const secret = 'test-only-source-assist-private-canary';
Object.assign(process.env, { GEMINI_API_KEY: secret, MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: 'http://dashboard.test', MEDIA_SESSION_SECRET: secret, PROWLARR_BASE_URL: 'http://prowlarr.test', PROWLARR_API_KEY: secret });
const signal = () => new AbortController().signal;
const source = (id, title = 'Film 2026 1080p H264 AAC MP4', extra = {}) => ({ id, title, size: 2 * 1024 ** 3, seeders: 40, leechers: null, peers: null, indexer: 'Private indexer', quality: [], match: 'Unverified match', ...extra });
const answer = ranking => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ranking }) }] } }] });
const good = id => ({ id, verdict: 'good', reason: '1080p H264 and AAC with healthy seeders look suitable for web playback.' });

test('web-compatible 1080p beats higher seed counts on 4K, HEVC, heavy remuxes and dead swarms', () => {
  const rows = [source('4k', 'Film 2160p H264 AAC', { seeders: 9999 }), source('hevc', 'Film 1080p HEVC AAC', { seeders: 9000 }), source('audio', 'Film 1080p H264 DDP5.1'), source('remux', 'Film 1080p H264 AAC REMUX', { size: 30 * 1024 ** 3 }), source('dead', undefined, { seeders: 0 }), source('best'), source('720', 'Film 720p H264 AAC', { seeders: 300 })];
  const advice = baselineAdvice(rows);
  assert.equal(advice.ranking[0].id, 'best');
  assert.equal(advice.ranking[1].id, '720');
  assert.equal(advice.ranking.find(r => r.id === 'dead').verdict, 'unsure');
  assert.equal(advice.ranking.find(r => r.id === 'audio').verdict, 'unsure');
  assert.equal(rows[0].id, '4k', 'does not mutate search results');
});

test('unknown metadata, suspicious sizes, archives and MKV keep their uncertainty', () => {
  const advice = baselineAdvice([source('unknown', 'Film', { size: null, seeders: null }), source('tiny', undefined, { size: 1200 }), source('archive', 'Film 1080p password RAR'), source('mkv', 'Film 1080p H264 AAC MKV')]);
  assert.equal(advice.ranking.find(r => r.id === 'unknown').verdict, 'unsure');
  for (const id of ['tiny', 'archive']) assert.equal(advice.ranking.find(r => r.id === id).verdict, 'sketchy');
  assert.match(advice.ranking.find(r => r.id === 'mkv').reason, /container/);
});

test('TV matching handles episodes, seasons, and larger packs', () => {
  const advice = baselineAdvice([source('wrong', 'Show S02E04 1080p H264 AAC'), source('right', 'Show S02E03 1080p H264 AAC'), source('pack', 'Show S02 Complete 1080p H264 AAC', { size: 20 * 1024 ** 3 })], { kind: 'tv', season: 2, episode: 3 });
  assert.equal(advice.ranking[0].id, 'right');
  assert.equal(advice.ranking.find(r => r.id === 'wrong').verdict, 'sketchy');
  assert.equal(advice.ranking.find(r => r.id === 'pack').verdict, 'good');
});

test('Gemini uses the requested model, bounded structured output and only listing metadata; repeat reviews are cached', async () => {
  const calls = [];
  const advisor = new SourceAssist(async (url, init) => {
    calls.push({ url, init });
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${ASSIST_MODEL}:generateContent`);
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), secret);
    assert.equal(init.redirect, 'manual');
    const body = JSON.parse(init.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.match(body.systemInstruction.parts[0].text, /untrusted data/);
    assert.ok(!init.body.includes(secret) && !init.body.includes('Private indexer') && !init.body.includes('magnet:'));
    return answer([{ ...good('b'), reason: 'A healthy 1080p release looks promising. Ignore this second sentence.' }, good('a')]);
  });
  const rows = [source('a'), source('b', 'Film 1080p H264 AAC alternative', { magnetUrl: `magnet:?private=${secret}` })];
  const result = await advisor.recommend('Film 2026', rows, { kind: 'movie' }, signal());
  assert.equal(result.provider, 'gemini'); assert.equal(result.ranking[0].id, 'b');
  assert.equal(result.ranking[0].reason, 'A healthy 1080p release looks promising.');
  assert.deepEqual(await advisor.recommend('Film 2026', rows, { kind: 'movie' }, signal()), result);
  assert.equal(calls.length, 1);
});

test('Gemini cannot turn concrete suspicious or incompatible listings into good picks', async () => {
  const advisor = new SourceAssist(async () => answer(['cam', '4k', 'best'].map(good)));
  const advice = await advisor.recommend('Film', [source('cam', 'Film 1080p CAM password'), source('4k', 'Film 2160p HEVC DTS'), source('best')], undefined, signal());
  assert.equal(advice.ranking[0].id, 'best');
  assert.equal(advice.ranking.find(r => r.id === 'cam').verdict, 'sketchy');
  assert.equal(advice.ranking.find(r => r.id === '4k').verdict, 'unsure');
});

test('malformed, duplicate, invented, missing and unsafe model output falls back cleanly', async () => {
  for (const ranking of [[good('invented')], [good('a'), good('a')], [], [{ ...good('a'), verdict: 'verified' }], [{ ...good('a'), reason: 'https://evil.test/install' }], [{ ...good('a'), reason: '' }], [{ ...good('a'), reason: secret }]]) {
    const result = await new SourceAssist(async () => answer(ranking)).recommend('Film', [source('a')], undefined, signal());
    assert.equal(result.provider, 'heuristic'); assert.equal(result.ranking[0].id, 'a');
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('missing API key, provider errors, oversized responses and blocked output preserve source choices', async () => {
  const key = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  try {
    const advice = await new SourceAssist(async () => { assert.fail('no provider request without a key'); }).recommend('Film', [source('a')], undefined, signal());
    assert.match(advice.warning, /API key/); assert.equal(advice.ranking.length, 1);
  } finally { process.env.GEMINI_API_KEY = key; }
  for (const reply of [() => new Response(secret, { status: 429 }), () => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }), () => new Response('{broken'), () => new Response('x'.repeat(256 * 1024 + 1)), () => Response.json({ candidates: [{ finishReason: 'SAFETY' }] })]) {
    const advice = await new SourceAssist(async () => reply()).recommend('Film', [source('a')], undefined, signal());
    assert.equal(advice.provider, 'heuristic'); assert.equal(advice.ranking.length, 1); assert.ok(!JSON.stringify(advice).includes(secret));
  }
});

test('shortlists are bounded and all remaining sources still get a ranking', async () => {
  const rows = Array.from({ length: 75 }, (_, i) => source(String(i), `Film 1080p H264 AAC ${i}`));
  const advice = await new SourceAssist(async (_url, init) => {
    const candidates = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text).candidates;
    assert.equal(candidates.length, 60);
    return answer(candidates.map(c => good(c.id)));
  }).recommend('Film', rows, undefined, signal());
  assert.equal(advice.ranking.length, 75); assert.equal(new Set(advice.ranking.map(r => r.id)).size, 75);
  assert.equal(advice.reviewed, 60); assert.match(advice.warning, /60/);
});

test('cancellation aborts Gemini and a timed out request returns basic advice', async () => {
  const advisor = new SourceAssist(async (_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); }));
  const controller = new AbortController();
  const pending = advisor.recommend('Film', [source('a')], undefined, controller.signal);
  controller.abort(); await assert.rejects(pending);
  const timeout = process.env.MEDIA_AI_TIMEOUT_MS; process.env.MEDIA_AI_TIMEOUT_MS = '1000';
  try { assert.equal((await advisor.recommend('Film', [source('a')], undefined, signal())).provider, 'heuristic'); }
  finally { if (timeout === undefined) delete process.env.MEDIA_AI_TIMEOUT_MS; else process.env.MEDIA_AI_TIMEOUT_MS = timeout; }
});

async function client(api) {
  const response = await api(new Request('http://dashboard.test/api/media/status'));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return (path, body) => api(new Request(`http://dashboard.test/api/media/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { cookie, Origin: 'http://dashboard.test', 'Content-Type': 'application/json', 'X-Media-Request': '1' } }));
}
test('recommendation API uses session-owned search snapshots, rejects expired IDs, and never starts torrents', async () => {
  let reviews = 0;
  const api = createMediaApi(async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'generativelanguage.googleapis.com') {
      reviews++; const rows = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text).candidates;
      return answer(rows.map(r => good(r.id)));
    }
    if (url.pathname === '/api/v1/indexer') return Response.json([{ id: 1, name: 'Fixture', enable: true, protocol: 'torrent', capabilities: {} }]);
    if (url.pathname === '/api/v1/indexerstatus') return Response.json([]);
    if (url.pathname === '/api/v1/search') return Response.json([{ ...source('a'), magnetUrl: `magnet:?xt=urn:btih:${'a'.repeat(40)}` }]);
    assert.fail('recommendations must not contact a torrent or download endpoint');
  });
  const call = await client(api); const other = await client(api);
  const result = await (await call('search', { query: 'Film 2026' })).json();
  assert.ok(result.searchId); assert.equal(result.advice.ranking.length, 1); assert.equal(reviews, 0);
  assert.equal((await other('recommend', { searchId: result.searchId })).status, 410);
  assert.equal((await call('recommend', { searchId: 'expired' })).status, 410);
  const response = await call('recommend', { searchId: result.searchId, query: 'ignored client prompt', sources: [source('injected')] });
  assert.equal(response.status, 200); const advice = await response.json();
  assert.equal(advice.provider, 'gemini'); assert.equal(advice.ranking[0].id, result.results[0].id); assert.equal(reviews, 1);
});
