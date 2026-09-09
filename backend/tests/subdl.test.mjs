import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Subdl } from '../src/lib/media/subdl.ts';
import { createMediaApi } from '../src/lib/media/api.ts';
import { subtitleArchive, SUBTITLE_LIMIT, ARCHIVE_LIMIT } from '../src/lib/media/subtitle-archive.ts';
import { subtitleFixture, subtitleZip } from '../../scripts/subtitle-test-fixture.mjs';

const secret = 'subdl-private-fixture-key-do-not-leak';
Object.assign(process.env, { SUBDL_API_KEY: secret, MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: 'http://dashboard.test', MEDIA_SESSION_SECRET: secret, TORRSERVER_BASE_URL: 'http://torrserver.test', TORRSERVER_USERNAME: '', TORRSERVER_PASSWORD: '' });
const signal = () => new AbortController().signal;
const reply = {
  status: true, results: [{ name: 'Fixture Show', year: 2024 }],
  subtitles: [
    { name: 'Fixture Show.zip', release_name: 'Fixture Show S02E03', url: '/subtitle/123-456.zip', lang: 'english', fps: '23.976', hi: true },
    { name: 'Season pack.zip', url: '/subtitle/789-123.zip', unpack_files: [
      { name: 'Fixture.Show.S02E03.srt', release_name: 'Episode 3', url: '/subtitle/pack/file3', season: 2, episode: 3, language: 'EN' },
      { name: 'Fixture.Show.S02E04.srt', url: '/subtitle/pack/file4', season: 2, episode: 4, language: 'EN' },
    ] },
    { name: 'Unsafe.zip', url: 'https://evil.test/subtitle/1-2.zip' },
  ],
};
function fixture(data = reply, authenticated = false) {
  const requests = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(input); requests.push({ url, init });
    if (url.hostname === 'api.subdl.com') { assert.equal(url.searchParams.get('api_key'), secret); return Response.json(data); }
    if (url.hostname === 'dl.subdl.com') {
      assert.equal(new Headers(init.headers).has('authorization'), false);
      assert.equal(new Headers(init.headers).get('x-api-key'), authenticated ? secret : null);
      assert.equal(url.search, '');
      return new Response(url.pathname.endsWith('.zip') ? subtitleZip() : subtitleFixture);
    }
    if (url.hostname === 'torrserver.test') return Response.json({ hash: 'a'.repeat(40), title: 'Fixture', stat: 3, file_stats: [{ id: 1, path: 'Fixture.Show.S02E03.mp4', length: 100 }] });
    throw new Error(`Unexpected host ${url.hostname}`);
  };
  return { fetcher, requests, api: createMediaApi(fetcher) };
}
async function client(api) {
  const response = await api(new Request('http://dashboard.test/api/media/status'));
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return (path, body, headers = {}) => api(new Request(`http://dashboard.test/api/media/${path}`, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { cookie, Origin: 'http://dashboard.test', 'Content-Type': 'application/json', 'X-Media-Request': '1', ...headers } }));
}

test('SubDL uses documented ID/language/episode filters, expands packs and caches searches', async () => {
  const f = fixture(); const provider = new Subdl(f.fetcher);
  const context = { kind: 'tv', imdbId: 'tt12345', season: 2, episode: 3 };
  const result = await provider.search('Fixture Show', 'EN', context, signal());
  const params = f.requests[0].url.searchParams;
  assert.equal(params.get('imdb_id'), 'tt12345'); assert.equal(params.get('film_name'), null);
  assert.equal(params.get('type'), 'tv'); assert.equal(params.get('season_number'), '2'); assert.equal(params.get('episode_number'), '3');
  assert.equal(params.get('unpack'), '1'); assert.equal(params.get('languages'), 'EN');
  assert.equal(result.files.length, 2); assert.equal(result.files[0].hearingImpaired, true); assert.equal(result.files[1].episode, 3);
  await provider.search('Fixture Show', 'EN', context, signal()); assert.equal(f.requests.length, 1);
  await provider.search('Movie', 'FR', { kind: 'movie', tmdbId: 300 }, signal());
  assert.equal(f.requests[1].url.searchParams.get('tmdb_id'), '300'); assert.equal(f.requests[1].url.searchParams.get('type'), 'movie');
  await provider.search('Manual title', 'FR', undefined, signal()); assert.equal(f.requests[2].url.searchParams.get('film_name'), 'Manual title');
});

test('SubDL preserves empty results and sanitizes provider errors, key rejection and quotas', async () => {
  const empty = await new Subdl(fixture({ status: true, results: [], subtitles: [] }).fetcher).search('Missing', 'EN', undefined, signal());
  assert.equal(empty.files.length, 0);
  for (const status of [401, 402, 403, 429, 500]) {
    const provider = new Subdl(async () => new Response(secret, { status }));
    await assert.rejects(provider.search('Movie', 'EN', undefined, signal()), error => !error.message.includes(secret) && (status !== 402 || /plan/.test(error.message)) && (status !== 429 || error.status === 429));
  }
  await assert.rejects(new Subdl(fixture({ status: false, error: secret }).fetcher).search('Movie', 'EN', undefined, signal()), error => !error.message.includes(secret));
  delete process.env.SUBDL_API_KEY;
  try { await assert.rejects(new Subdl().search('Movie', 'EN', undefined, signal()), /SUBDL_API_KEY/); }
  finally { process.env.SUBDL_API_KEY = secret; }
});

test('SubDL downloads raw files and ZIPs; foreign URLs, redirects and huge responses fail', async () => {
  const f = fixture(); const provider = new Subdl(f.fetcher);
  const result = await provider.search('Fixture', 'EN', { kind: 'tv', season: 2, episode: 3 }, signal());
  for (const file of result.files) {
    const download = await provider.download(file, signal());
    assert.equal(Buffer.from(download.files[0].content, 'base64').toString(), subtitleFixture);
  }
  for (const path of ['https://evil.test/subtitle/1-2.zip', '//evil.test/subtitle/1-2.zip', '/subtitle/1-2.zip?api_key=secret', '/subtitle/../../admin', '/subtitle/1-2.zip#hash']) {
    const count = f.requests.length;
    await assert.rejects(provider.download({ path, name: 'test.zip', archive: true }, signal())); assert.equal(f.requests.length, count);
  }
  await assert.rejects(new Subdl(async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } })).download(result.files[0], signal()), /302/);
  await assert.rejects(new Subdl(async () => new Response('x'.repeat(SUBTITLE_LIMIT + 1))).download(result.files[1], signal()), error => error.status === 413);
});

test('credential-bearing SubDL links retain results and use header authentication for raw and ZIP downloads', async () => {
  const keyed = structuredClone(reply);
  for (const subtitle of keyed.subtitles) {
    subtitle.url += `?api_key=${secret}`;
    for (const file of subtitle.unpack_files ?? []) file.url += `?api_key=${secret}`;
  }
  const f = fixture(keyed, true); const provider = new Subdl(f.fetcher);
  const result = await provider.search('Obsession 2026', 'EN', { kind: 'movie', imdbId: 'tt37287335' }, signal());
  assert.equal(result.files.length, 3);
  for (const file of result.files) {
    assert.equal(file.authenticated, true); assert.ok(!file.path.includes('?') && !file.path.includes(secret));
    const download = await provider.download(file, signal());
    assert.equal(Buffer.from(download.files[0].content, 'base64').toString(), subtitleFixture);
  }
  const call = await client(f.api);
  const added = await (await call('playback', { magnet: `magnet:?xt=urn:btih:${'a'.repeat(40)}` })).json();
  const selected = await (await call('select', { id: added.id, fileId: 1 })).json();
  const response = await call('subtitles/search', { id: selected.id, query: 'Obsession 2026', language: 'EN' });
  const text = await response.text(); const search = JSON.parse(text);
  assert.equal(search.results.length, 3); assert.ok(!text.includes(secret) && !text.includes('api_key') && !text.includes('authenticated'));
  const downloaded = await call('subtitles/download', { id: selected.id, choice: search.results[0].id });
  assert.equal(downloaded.status, 200); assert.ok(!(await downloaded.text()).includes(secret));
});

test('unreadable download links report an integration error instead of false empty results', async () => {
  for (const url of [
    'https://evil.test/subtitle/1-2.zip',
    `/subtitle/1-2.zip?api_key=${secret}&redirect=https://evil.test`,
    `/subtitle/1-2.zip?api_key=${secret}&api_key=${secret}`,
    '/subtitle/1-2.zip?api_key=someone-elses-key',
  ]) {
    const f = fixture({ ...reply, subtitles: [{ name: 'Release.zip', url }] });
    await assert.rejects(new Subdl(f.fetcher).search('Movie', 'EN', undefined, signal()), error => error.code === 'subtitle_url' && /found subtitles/.test(error.message) && !error.message.includes(secret));
    assert.equal(f.requests.length, 1, 'rejected links never trigger downloads');
  }
});

test('ZIP reader handles stored/deflated multi-file subtitles without writing paths', async () => {
  for (const method of [0, 8]) {
    const result = await subtitleArchive(subtitleZip([{ name: '../English.srt', text: subtitleFixture }, { name: 'Folder/French.vtt', text: 'WEBVTT\n\n00:00.000 --> 00:01.000\nBonjour' }, { name: 'readme.txt', text: 'Ignore this' }], method), signal());
    assert.deepEqual(result.map(file => file.name), ['English.srt', 'French.vtt']);
    assert.equal(Buffer.from(result[0].content, 'base64').toString(), subtitleFixture);
  }
});

test('ZIP reader rejects corrupt CRC, oversize expansion, unsupported archives and cancellation', async () => {
  for (const bad of [Buffer.alloc(0), Buffer.from('not a zip'), subtitleZip([{ name: 'readme.txt', text: 'No subtitle' }]), subtitleZip().subarray(0, 40), Buffer.alloc(ARCHIVE_LIMIT + 1)]) await assert.rejects(subtitleArchive(bad, signal()));
  const badCrc = subtitleZip(); const directory = badCrc.readUInt32LE(badCrc.length - 6); badCrc.writeUInt32LE(0, directory + 16);
  await assert.rejects(subtitleArchive(badCrc, signal()), /damaged/);
  const bomb = subtitleZip([{ name: 'big.srt', text: 'x'.repeat(SUBTITLE_LIMIT + 1) }]);
  await assert.rejects(subtitleArchive(bomb, signal()), error => error.status === 413);
  // A lying size must still hit the inflater's independent output limit.
  bomb.writeUInt32LE(1, bomb.readUInt32LE(bomb.length - 6) + 24);
  await assert.rejects(subtitleArchive(bomb, signal()), /damaged/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(subtitleArchive(subtitleZip(), controller.signal), /abort/i);
});

test('online subtitle API requires session, playback ownership and explicit CSRF-protected download', async () => {
  const f = fixture(); const call = await client(f.api);
  assert.equal((await (await call('subtitles/provider')).json()).configured, true);
  const added = await (await call('playback', { magnet: `magnet:?xt=urn:btih:${'a'.repeat(40)}` })).json();
  assert.equal((await call('subtitles/search', { id: added.id, query: 'Fixture', language: 'EN' })).status, 400);
  const selected = await (await call('select', { id: added.id, fileId: 1 })).json();
  const response = await call('subtitles/search', { id: selected.id, query: 'Fixture', language: 'EN', context: { kind: 'tv', season: 2, episode: 3 } });
  const text = await response.text(); assert.ok(!text.includes(secret) && !text.includes('/subtitle/') && !text.includes('api_key'));
  const result = JSON.parse(text); const choice = result.results[0].id;
  assert.equal(f.requests.filter(request => request.url.hostname === 'dl.subdl.com').length, 0, 'search does not download');
  const other = await client(f.api);
  assert.equal((await other('subtitles/download', { id: selected.id, choice })).status, 410);
  assert.equal((await call('subtitles/download', { id: selected.id, choice }, { 'X-Media-Request': '' })).status, 403);
  assert.equal((await call('subtitles/download', { id: selected.id, choice: 'arbitrary' })).status, 410);
  assert.equal((await call('subtitles/download', { id: added.id, choice })).status, 410);
  const download = await (await call('subtitles/download', { id: selected.id, choice })).json();
  assert.equal(Buffer.from(download.files[0].content, 'base64').toString(), subtitleFixture);
  assert.equal((await f.api(new Request('http://dashboard.test/api/media/subtitles/provider'))).status, 401);
});
