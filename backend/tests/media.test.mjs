import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMediaApi } from '../src/lib/media/api.ts';
import { query, magnet, BoundedCache, MediaError } from '../src/lib/media/core.ts';
import { bounded, readLimited } from '../src/lib/media/http.ts';
import { indexerQuery, normalizeSource, Prowlarr } from '../src/lib/media/prowlarr.ts';
import { normalizeTorrent, TorrServer } from '../src/lib/media/torrserver.ts';
import { CatalogueSearch, closeTitleMatch } from '../src/lib/media/catalogue-search.ts';
import { Tmdb } from '../src/lib/media/tmdb.ts';

const secret = 'test-only-private-canary-DO-NOT-USE-IN-PRODUCTION';
Object.assign(process.env, { MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: 'http://dashboard.test', MEDIA_SESSION_SECRET: secret, TMDB_READ_ACCESS_TOKEN: secret, PROWLARR_BASE_URL: 'http://prowlarr.test:9696', PROWLARR_API_KEY: secret, TORRSERVER_BASE_URL: 'http://torrserver.test:8090', TORRSERVER_USERNAME: 'fixture-user', TORRSERVER_PASSWORD: secret });
const hash = 'a'.repeat(40);
const authorizedMagnet = `magnet:?xt=urn:btih:${hash}&dn=Authorized+fixture`;
const files = [{ id: 1, path: 'sample.mp4', length: 3 }, { id: 2, path: 'Authorized film.mp4', length: 1000 }, { id: 3, path: 'English.srt', length: 40 }, { id: 4, path: 'Unsupported.avi', length: 200 }];
const status = { hash, title: 'Authorized fixture', stat: 3, file_stats: files, active_peers: 2, download_speed: 128, preload_size: 500, preloaded_bytes: 25 };
const json = v => Response.json(v);

function fixture(options = {}) {
  const requests = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(input); requests.push({ url, init });
    if (url.hostname === 'api.themoviedb.org') {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${secret}`);
      return json({ results: [{ id: 1234567, title: 'Authorized film', release_date: '2008-01-01', overview: 'Fixture', poster_path: '/poster.jpg' }], total_pages: 2 });
    }
    if (url.hostname === 'prowlarr.test') {
      assert.equal(new Headers(init.headers).get('x-api-key'), secret);
      if (url.pathname === '/api/v1/indexer') return json([1, 2].map(id => ({ id, name: `Indexer ${id}`, enable: true, protocol: 'torrent', supportsSearch: true, supportsPagination: true, fields: [{ value: secret }], capabilities: { movieSearchParams: ['q', 'imdbId'] } })));
      if (url.pathname === '/api/v1/indexerstatus') return json([]);
      if (url.pathname === '/api/v1/search') return url.searchParams.get('indexerIds') === '2' ? new Response(`secret=${secret}`, { status: 503 }) : json([{ title: '<script>never execute</script> Authorized film 1080p', size: 1000, seeders: null, leechers: 7, magnetUrl: options.link ?? `http://prowlarr.test:9696/1/download?apikey=${secret}&link=opaque` }]);
      if (url.pathname === '/1/download') {
        assert.equal(url.searchParams.has('apikey'), false);
        if (options.torrent) return new Response('d4:infod4:name7:fixtureee');
        return new Response(null, { status: 302, headers: { Location: options.redirect ?? authorizedMagnet } });
      }
    }
    if (url.hostname === 'torrserver.test') {
      assert.equal(new Headers(init.headers).get('authorization'), `Basic ${Buffer.from(`fixture-user:${secret}`).toString('base64')}`);
      if (url.pathname === '/torrents') {
        const body = JSON.parse(init.body);
        assert.ok(['get', 'add', 'list'].includes(body.action), 'no removal or configuration mutations');
        if (body.action === 'add') { assert.equal(body.link, authorizedMagnet); assert.equal(body.save_to_db, false); }
        return json(status);
      }
      if (url.pathname === '/torrent/upload') { assert.equal(init.body.has('save'), false); assert.equal(init.body.get('file').name, 'source.torrent'); return json([status]); }
      if (url.pathname === '/stream') {
        if (url.searchParams.get('index') === '3') {
          assert.equal(new Headers(init.headers).get('range'), null);
          assert.equal(new Headers(init.headers).get('if-range'), null);
          return new Response(options.subtitle ?? '1\n00:00:00,000 --> 00:00:05,000\nHello from the torrent\n', { headers: options.subtitleHeaders });
        }
        assert.equal(url.searchParams.get('link'), hash); assert.equal(url.searchParams.get('index'), '2');
        const range = new Headers(init.headers).get('range');
        if (range === 'bytes=9000-') return new Response('private upstream error', { status: 416, headers: { 'Content-Range': 'bytes */1000', 'Content-Length': '22' } });
        const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: '"fixture"', 'Content-Length': range ? '3' : '6', ...(range ? { 'Content-Range': 'bytes 1-3/6' } : {}) };
        return new Response(init.method === 'HEAD' ? null : range ? 'bcd' : 'abcdef', { status: range ? 206 : 200, headers });
      }
    }
    throw new Error(`Unexpected fixture URL: ${url.origin}${url.pathname}`);
  };
  return { requests, fetcher, api: createMediaApi(fetcher) };
}
async function client(api) {
  const response = await api(new Request('http://dashboard.test/api/media/status'));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return (path, body, extra = {}) => api(new Request(`http://dashboard.test/api/media/${path}`, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), ...extra, headers: { cookie, Origin: 'http://dashboard.test', ...(body ? { 'Content-Type': 'application/json', 'X-Media-Request': '1' } : {}), ...extra.headers } }));
}
async function selected(f) {
  const call = await client(f.api);
  const found = await (await call('search', { query: 'Authorized film' })).json();
  const added = await (await call('playback', { sourceId: found.results[0].id })).json();
  const select = await (await call('select', { id: added.id, fileId: 2 })).json();
  assert.ok(select.id, JSON.stringify(select));
  return { call, found, added, select };
}

test('search normalization and magnets reject URLs, controls, HTTP metadata sources', () => {
  assert.equal(query('  A   title  '), 'A title');
  for (const value of ['x\ny', 'a'.repeat(251), '']) assert.throws(() => query(value));
  for (const value of ['http://127.0.0.1/private', 'magnet:?xt=garbage', `${authorizedMagnet}&xs=http://private`]) assert.throws(() => magnet(value));
  assert.equal(magnet(authorizedMagnet), authorizedMagnet);
});
test('counts preserve unknown vs zero and title similarity never establishes a match', () => {
  const source = normalizeSource({ title: 'Same title 1080p HEVC', seeders: 0, peers: 8 }, 'Fixture');
  assert.equal(source.seeders, 0); assert.equal(source.leechers, null); assert.equal(source.peers, 8); assert.match(source.match, /Unverified/); assert.deepEqual(source.quality, ['1080p', 'HEVC']);
});
test('external IDs require advertised capabilities; episode searches retain season/episode', () => {
  const indexer = { id: 1, name: 'Fixture', capabilities: { movieSearchParams: ['imdbId'], tvSearchParams: ['tvdbId', 'season', 'ep'] }, paginates: true };
  assert.equal(indexerQuery(indexer, 'Title 2008', { kind: 'movie', imdbId: 'tt123' }).query, '{imdbid:tt123}');
  assert.equal(indexerQuery(indexer, 'Title S01E02', { kind: 'tv', tvdbId: 2, season: 1, episode: 2 }).query, '{tvdbid:2}{season:1}{episode:2}');
  assert.equal(indexerQuery({ ...indexer, capabilities: {} }, 'Title S01E02', { kind: 'tv', tvdbId: 2, season: 1, episode: 2 }).type, 'search');
});
test('metadata browsing has no torrent side effects or availability claim; cache is bounded', async () => {
  const f = fixture(); const call = await client(f.api);
  const result = await (await call('catalogue?kind=movie&page=1')).json();
  assert.equal(result.availability, 'metadata-only');
  assert.equal(result.titles[0].id, 1234567, 'modern TMDB IDs are not capped at one million');
  await call('catalogue?kind=movie&page=1');
  assert.equal(f.requests.length, 1);
  const suggestions = await (await call('suggestions?kind=movie&q=Auth')).json();
  assert.equal(suggestions.titles[0].title, 'Authorized film');
  assert.equal(f.requests.some(request => request.url.hostname === 'generativelanguage.googleapis.com'), false, 'autocomplete stays TMDB-only');
  const cache = new BoundedCache(1, 1000); cache.set('a', 1); cache.set('b', 2); assert.equal(cache.get('a'), undefined);
});
test('mixed catalogue keeps movies and TV shows while excluding people', async () => {
  const requests = [];
  const tmdb = new Tmdb(async input => {
    const url = new URL(input); requests.push(url);
    return json({ total_pages: 3, results: [
      { id: 1, media_type: 'movie', title: 'Fixture movie', release_date: '2024-01-01' },
      { id: 2, media_type: 'person', name: 'Fixture person' },
      { id: 3, media_type: 'tv', name: 'Fixture show', first_air_date: '2025-01-01' },
    ] });
  });
  const popular = await tmdb.browse('all', '', 1, AbortSignal.timeout(1000));
  assert.equal(requests[0].pathname, '/3/trending/all/day');
  assert.deepEqual(popular.titles.map(title => [title.kind, title.title]), [['movie', 'Fixture movie'], ['tv', 'Fixture show']]);
  await tmdb.browse('all', 'Fixture', 1, AbortSignal.timeout(1000));
  assert.equal(requests[1].pathname, '/3/search/multi');
});
test('catalogue matching tolerates spacing and small typos without accepting unrelated containing titles', () => {
  assert.equal(closeTitleMatch('lalaland', 'La La Land'), true);
  assert.equal(closeTitleMatch('interstelar', 'Interstellar'), true);
  assert.equal(closeTitleMatch('matrix', 'The Matrix'), true);
  assert.equal(closeTitleMatch('lalaland', 'Lollos 6: Lalaland!'), false);
});
test('weak TMDB results use a validated Gemini correction and retain original results', async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = secret;
  const queries = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.themoviedb.org') {
      const q = url.searchParams.get('query'); queries.push(q);
      return json({ results: q === 'La La Land'
        ? [{ id: 313369, title: 'La La Land', release_date: '2016-11-29' }]
        : [{ id: 999, title: 'Lollos 6: Lalaland!', release_date: '2014-01-01' }], total_pages: 1 });
    }
    if (url.hostname === 'generativelanguage.googleapis.com') {
      assert.equal(new Headers(init.headers).get('x-goog-api-key'), secret);
      return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ query: 'La La Land' }) }] } }] });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
  try {
    const search = new CatalogueSearch(fetcher, new Tmdb(fetcher));
    const result = await search.browse('movie', 'Lalaland', 1, new AbortController().signal);
    assert.equal(result.correctedQuery, 'La La Land');
    assert.equal(result.correctionProvider, 'gemini');
    assert.deepEqual(result.titles.map(title => title.id), [313369, 999]);
    assert.deepEqual(queries, ['Lalaland', 'La La Land']);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
  }
});
test('partial indexer errors retain successful results and private credentials never enter responses', async () => {
  const f = fixture(); const call = await client(f.api);
  const response = await call('search', { query: 'Authorized film' });
  const text = await response.text(); assert.ok(!text.includes(secret)); assert.ok(!text.includes('download?'));
  const data = JSON.parse(text); assert.equal(data.results.length, 1); assert.equal(data.reports.filter(r => r.error).length, 1);
  assert.equal(f.requests.filter(r => r.url.hostname === 'torrserver.test').length, 0);
});
test('multi-file selection rejects subtitles, unknown IDs and foreign sessions', async () => {
  const f = fixture(); const { call, added, select } = await selected(f);
  assert.equal(added.files.length, 4); assert.equal(added.files[0].sample, true);
  assert.equal(select.file.path, 'Authorized film.mp4');
  for (const fileId of [3, 999]) assert.equal((await call('select', { id: added.id, fileId })).status, 400);
  const other = await client(f.api); assert.equal((await other(`stream/${select.id}`)).status, 410);
  assert.equal(f.requests.filter(r => r.url.pathname === '/stream').length, 0);
});
test('authenticated Prowlarr torrent downloads upload bytes, omit save, and never forward API keys', async () => {
  const f = fixture({ torrent: true }); await selected(f);
  const upload = f.requests.find(r => r.url.pathname === '/torrent/upload'); assert.ok(upload);
  assert.equal(new Headers(upload.init.headers).has('x-api-key'), false);
});
test('arbitrary download URLs and off-origin redirects are rejected before making that request', async () => {
  for (const options of [{ link: 'http://127.0.0.1:2375/containers/json' }, { redirect: 'https://evil.test/steal' }, { redirect: 'http://prowlarr.test:9696/api/v1/config' }]) {
    const f = fixture(options); const call = await client(f.api);
    const result = await (await call('search', { query: 'Authorized film' })).json();
    assert.equal((await call('playback', { sourceId: result.results[0].id })).status, 400);
    assert.ok(!f.requests.some(r => ['127.0.0.1', 'evil.test'].includes(r.url.hostname)));
  }
});
test('stream proxy preserves GET/HEAD, Range, If-Range and 200/206/416', async () => {
  const f = fixture(); const { call, select } = await selected(f);
  const full = await call(`stream/${select.id}`); assert.equal(full.status, 200); assert.equal(await full.text(), 'abcdef');
  const partial = await call(`stream/${select.id}`, null, { headers: { Range: 'bytes=1-3', 'If-Range': '"fixture"' } });
  assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), 'bytes 1-3/6'); assert.equal(await partial.text(), 'bcd');
  const head = await call(`stream/${select.id}`, null, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), '6'); assert.equal(await head.text(), '');
  const invalid = await call(`stream/${select.id}`, null, { headers: { Range: 'bytes=9000-' } }); assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */1000'); assert.equal(await invalid.text(), '');
  assert.equal(new Headers(f.requests.find(r => new Headers(r.init.headers).get('range') === 'bytes=1-3').init.headers).get('if-range'), '"fixture"');
});
test('disconnect cancels the upstream body and stream uses downstream backpressure', async () => {
  let reads = 0; let cancelled = false; let signal;
  const ts = new TorrServer(async (_url, init) => { signal = init.signal; return new Response(new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 })); });
  const response = await ts.stream(hash, { id: 2 }, new Request('http://dashboard.test/stream'));
  assert.equal(reads, 0); const reader = response.body.getReader(); await reader.read(); assert.equal(reads, 1); await reader.cancel(); assert.equal(signal.aborted, true); assert.equal(cancelled, true);
});
test('request abort is linked to upstream after headers', async () => {
  let upstream;
  const ts = new TorrServer(async (_url, init) => { upstream = init.signal; return new Response(new ReadableStream()); });
  const controller = new AbortController();
  const response = await ts.stream(hash, { id: 2 }, new Request('http://dashboard.test/stream', { signal: controller.signal }));
  controller.abort(); assert.equal(upstream.aborted, true); await response.body.cancel();
});
test('metadata timeout cancels work without returning private upstream errors; body sizes are bounded', async () => {
  await assert.rejects(bounded('Fixture', 15, new AbortController().signal, signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error(secret))))), e => e instanceof MediaError && e.status === 504 && !e.message.includes(secret));
  await assert.rejects(readLimited(new Response('12345'), 3), /allowed size/);
});
test('mutations require session, exact origin and custom CSRF header; host rebinding fails', async () => {
  const f = fixture(); const call = await client(f.api);
  assert.equal((await call('playback', { magnet: authorizedMagnet }, { headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await call('playback', { magnet: authorizedMagnet }, { headers: { 'X-Media-Request': '' } })).status, 403);
  assert.equal((await f.api(new Request('http://evil.test/api/media/status'))).status, 403);
  assert.equal((await f.api(new Request('http://dashboard.test/api/media/search', { method: 'POST', headers: { Origin: 'http://dashboard.test', 'Content-Type': 'application/json', 'X-Media-Request': '1' }, body: '{}' }))).status, 401);
});
test('external links work without cookies, remain file-scoped, and are revocable', async () => {
  const f = fixture(); const { call, select } = await selected(f);
  const share = await (await call('share', { id: select.id })).json();
  assert.ok(Date.parse(share.expiresAt) - Date.now() <= 15 * 60_000);
  const external = await f.api(new Request(`http://dashboard.test${share.path}`)); assert.equal(external.status, 200); await external.body.cancel();
  await call('revoke', { token: share.token });
  assert.equal((await f.api(new Request(`http://dashboard.test${share.path}`))).status, 410);
});
test('missing statistics remain unknown; completed bytes never become configured cache capacity', () => {
  const normalized = normalizeTorrent({ ...status, loaded_size: 90, active_peers: undefined, download_speed: undefined });
  assert.equal(normalized.connectedPeers, null); assert.equal(normalized.downloadSpeed, null); assert.equal(normalized.completedBytes, 90); assert.equal(normalized.downloadedBytes, null); assert.equal(normalized.cacheCapacity, undefined);
});
test('service errors and redirect responses cannot leak private response text', async () => {
  const p = new Prowlarr(async () => new Response(secret, { status: 401 }));
  await assert.rejects(p.health(new AbortController().signal), e => !e.message.includes(secret) && /401/.test(e.message));
});
test('missing TMDB credentials do not block source search or disclose private configuration', async () => {
  const original = process.env.TMDB_READ_ACCESS_TOKEN;
  delete process.env.TMDB_READ_ACCESS_TOKEN;
  try {
    const f = fixture(); const call = await client(f.api);
    assert.equal((await call('catalogue?kind=movie')).status, 503);
    assert.equal((await call('search', { query: 'Authorized film' })).status, 200);
  } finally { process.env.TMDB_READ_ACCESS_TOKEN = original; }
});
test('disabled media returns actionable setup and no upstream calls', async () => {
  process.env.MEDIA_TRUSTED_NETWORK = 'false';
  try {
    const f = fixture(); const response = await f.api(new Request('http://dashboard.test/api/media/status'));
    assert.equal(response.status, 503); assert.match(await response.text(), /docs\/tv-media/); assert.equal(f.requests.length, 0);
  } finally { process.env.MEDIA_TRUSTED_NETWORK = 'true'; }
});
test('HTML disguised as a video cannot execute when its stream URL is opened directly', async () => {
  const ts = new TorrServer(async () => new Response('<script>unsafe()</script>', { headers: { 'Content-Type': 'text/html' } }));
  const response = await ts.stream(hash, { id: 2 }, new Request('http://dashboard.test/stream'));
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('content-disposition'), 'attachment');
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  await response.body.cancel();
});

test('torrent subtitles require a selected video and the owning session, and reject other files', async () => {
  const f = fixture(); const { call, added, select } = await selected(f);
  assert.equal((await call(`subtitles/${added.id}/3`)).status, 400);
  for (const id of [2, 999, 'bad']) assert.equal((await call(`subtitles/${select.id}/${id}`)).status, 400);
  const other = await client(f.api);
  assert.equal((await other(`subtitles/${select.id}/3`)).status, 410);
  assert.equal((await f.api(new Request(`http://dashboard.test/api/media/subtitles/${select.id}/3`))).status, 401);
  assert.equal(f.requests.filter(r => r.url.pathname === '/stream').length, 0);
  const response = await call(`subtitles/${select.id}/3`, null, { headers: { Range: 'bytes=1-3', 'If-Range': 'fixture' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  const text = await response.text(); assert.match(text, /Hello from the torrent/); assert.ok(!text.includes(secret));
  const video = await call(`stream/${select.id}`); assert.equal(await video.text(), 'abcdef', 'subtitle choice does not change the selected video');
});

test('subtitle downloads reject oversized metadata and bodies, including unknown content length', async () => {
  let fetched = false;
  const ts = new TorrServer(async () => { fetched = true; return new Response('unread'); });
  const file = { id: 3, path: 'English.srt', kind: 'subtitle', size: 2 * 1024 * 1024 + 1 };
  await assert.rejects(ts.subtitle(hash, file, new AbortController().signal), e => e.status === 413);
  await assert.rejects(ts.subtitle(hash, { ...file, path: 'English.ass', size: 10 }, new AbortController().signal), e => e.status === 400);
  assert.equal(fetched, false);
  const f = fixture({ subtitle: 'x'.repeat(2 * 1024 * 1024 + 1) }); const { call, select } = await selected(f);
  const response = await call(`subtitles/${select.id}/3`);
  assert.equal(response.status, 413); assert.ok(!(await response.text()).includes(secret));
});

test('subtitle downloads retain VTT bytes and cancel partial upstream responses', async () => {
  const content = 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n';
  const ts = new TorrServer(async () => new Response(content, { headers: { 'Content-Type': 'text/vtt' } }));
  const file = { id: 3, path: 'English.vtt', kind: 'subtitle', size: null };
  assert.equal(new TextDecoder().decode(await ts.subtitle(hash, file, new AbortController().signal)), content);
  let cancelled = false;
  const partial = new TorrServer(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 206 }));
  await assert.rejects(partial.subtitle(hash, file, new AbortController().signal), e => e.status === 502);
  assert.equal(cancelled, true);
});
