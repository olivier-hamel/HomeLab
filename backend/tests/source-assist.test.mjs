import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSIST_MODEL, MIN_STREAMING_SEEDERS, baselineAdvice, SourceAssist } from '../src/lib/media/source-assist.ts';
import { createMediaApi } from '../src/lib/media/api.ts';
import { queryTarget, sourceIdentity } from '../src/lib/media/source-identity.ts';

const secret = 'test-only-source-assist-private-canary';
Object.assign(process.env, { GEMINI_API_KEY: secret, MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: 'http://dashboard.test', MEDIA_SESSION_SECRET: secret, PROWLARR_BASE_URL: 'http://prowlarr.test', PROWLARR_API_KEY: secret });
const signal = () => new AbortController().signal;
const source = (id, title = 'Film 2026 1080p H264 AAC MP4', extra = {}) => ({ id, title, size: 2 * 1024 ** 3, seeders: 4000, leechers: null, peers: null, indexer: 'Private indexer', quality: [], match: 'Unverified match', ...extra });
const answer = ranking => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ranking }) }] } }] });
const good = id => ({ id, identity: 'match', verdict: 'good', reason: '1080p and healthy seeders make this matching release look promising.' });

test('1080p and healthy swarms beat 4K, huge files and dead swarms without preferring browser codecs', () => {
  const rows = [source('4k', 'Film 2160p H264 AAC', { seeders: 9999 }), source('hevc', 'Film 1080p HEVC AAC', { seeders: 9000 }), source('audio', 'Film 1080p H264 DDP5.1'), source('remux', 'Film 1080p H264 AAC REMUX', { size: 30 * 1024 ** 3 }), source('dead', undefined, { seeders: 0 }), source('best'), source('720', 'Film 720p H264 AAC', { seeders: 300 })];
  const advice = baselineAdvice(rows);
  assert.equal(advice.ranking[0].id, 'hevc');
  assert.ok(advice.ranking.findIndex(r => r.id === 'best') < advice.ranking.findIndex(r => r.id === '720'));
  assert.equal(advice.ranking.find(r => r.id === 'dead').verdict, 'unsure');
  assert.equal(advice.ranking.find(r => r.id === 'audio').verdict, 'good');
  assert.equal(rows[0].id, '4k', 'does not mutate search results');
});

test('unknown resolution/counts and suspicious sizes or archives are flagged, while MKV is neutral', () => {
  const advice = baselineAdvice([source('unknown', 'Film', { size: null, seeders: null }), source('tiny', undefined, { size: 1200 }), source('archive', 'Film 1080p password RAR'), source('mkv', 'Film 1080p H264 AAC MKV')]);
  assert.equal(advice.ranking.find(r => r.id === 'unknown').verdict, 'unsure');
  for (const id of ['tiny', 'archive']) assert.equal(advice.ranking.find(r => r.id === id).verdict, 'sketchy');
  assert.equal(advice.ranking.find(r => r.id === 'mkv').verdict, 'good');
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
    assert.match(body.systemInstruction.parts[0].text, /Browser compatibility is NOT a ranking requirement/);
    assert.match(body.systemInstruction.parts[0].text, /requires English audio/);
    assert.match(body.systemInstruction.parts[0].text, /non-English-only.*identity=mismatch/);
    assert.ok(!init.body.includes(secret) && !init.body.includes('Private indexer') && !init.body.includes('magnet:'));
    return answer([{ ...good('b'), reason: 'A healthy 1080p release looks promising. Ignore this second sentence.' }, good('a')]);
  });
  const rows = [source('a'), source('b', 'Film 2026 1080p H264 AAC alternative', { magnetUrl: `magnet:?private=${secret}` })];
  const result = await advisor.recommend('Film 2026', rows, { kind: 'movie' }, signal());
  assert.equal(result.provider, 'gemini'); assert.equal(result.ranking[0].id, 'b');
  assert.equal(result.ranking[0].reason, 'A healthy 1080p release looks promising.');
  assert.deepEqual(await advisor.recommend('Film 2026', rows, { kind: 'movie' }, signal()), result);
  assert.equal(calls.length, 1);
});

test('Gemini cannot turn suspicious or above-target listings into good picks', async () => {
  const advisor = new SourceAssist(async () => answer(['cam', '4k', 'best'].map(good)));
  const advice = await advisor.recommend('Film', [source('cam', 'Film 1080p CAM password'), source('4k', 'Film 2160p HEVC DTS'), source('best')], undefined, signal());
  assert.equal(advice.ranking[0].id, 'best');
  assert.equal(advice.ranking.find(r => r.id === 'cam').verdict, 'sketchy');
  assert.equal(advice.ranking.find(r => r.id === '4k').verdict, 'unsure');
});

test('the Obsession regression excludes similarly named titles, sequels, remakes and conflicting IDs before Gemini', async () => {
  const target = { kind: 'movie', title: 'Obsession', year: '2026', tmdbId: 123, imdbId: 'tt37287335', companies: ['A24'], overview: 'Catalogue synopsis for the selected movie.' };
  const wrong = [source('maids', 'Maids Obsession 2026 1080p AAC2.0 H264', { seeders: 9999 }), source('suffix', 'Obsession Maid 2026 1080p'), source('sequel', 'Obsession 2 2026 1080p'), source('remake', 'Obsession 1976 1080p'), source('ids', 'Obsession 2026 1080p', { titleIds: { imdbId: 'tt999' } })];
  const rows = [...wrong, source('right', 'Obsession.2026.1080p.HEVC.DTS.MKV', { seeders: 5 })];
  const baseline = baselineAdvice(rows, target, target);
  assert.equal(baseline.ranking[0].id, 'right');
  for (const row of wrong) assert.equal(baseline.ranking.find(r => r.id === row.id).identity, 'mismatch');
  const advice = await new SourceAssist(async (_url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    assert.deepEqual(payload.candidates.map(c => c.id), ['right']);
    assert.equal(payload.requestedTitle.title, 'Obsession'); assert.equal(payload.requestedTitle.year, '2026');
    assert.deepEqual(payload.requestedTitle.companies, ['A24']); assert.equal(payload.requestedTitle.imdbId, target.imdbId);
    assert.ok(payload.requestedTitle.overview);
    return answer([good('right')]);
  }).recommend('Obsession 2026', rows, target, signal(), target);
  assert.equal(advice.provider, 'gemini'); assert.equal(advice.ranking[0].id, 'right');
  assert.equal(advice.ranking.filter(r => r.identity === 'match').length, 1);
  const fallback = await new SourceAssist(async () => new Response('', { status: 503 })).recommend('Obsession 2026', rows, target, signal(), target);
  assert.equal(fallback.provider, 'heuristic'); assert.equal(fallback.ranking[0].id, 'right');
});

test('no matching title leaves no recommendation and does not call Gemini', async () => {
  const result = await new SourceAssist(async () => { assert.fail('wrong movies must not reach the ranking model'); }).recommend('Obsession 2026', [source('wrong', 'Maids Obsession 2026 1080p H264 AAC'), source('yearless', 'Obsession 1080p HEVC')], undefined, signal());
  assert.ok(result.ranking.every(row => row.identity !== 'match'));
  assert.equal(result.ranking.find(r => r.id === 'yearless').identity, 'uncertain');
});

test('Gemini can reject a locally plausible identity but cannot rescue a locally wrong title', async () => {
  const rows = [source('a'), source('b')];
  const result = await new SourceAssist(async () => answer([{ ...good('a'), identity: 'mismatch', reason: 'The listing describes another movie.' }, { ...good('b'), identity: 'uncertain', reason: 'The identity evidence is ambiguous.' }])).recommend('Film 2026', rows, undefined, signal());
  assert.equal(result.provider, 'gemini'); assert.ok(result.ranking.every(r => r.identity !== 'match' && r.verdict !== 'good'));
  const wrong = source('wrong', 'Maids Obsession 2026 1080p');
  const guarded = await new SourceAssist(async () => answer([good('wrong')])).recommend('Obsession 2026', [wrong, source('right', 'Obsession 2026 1080p')], undefined, signal());
  assert.equal(guarded.provider, 'heuristic'); assert.equal(guarded.ranking[0].id, 'right');
});

test('identity matching supports canonical alternate names, punctuation, numeric titles and TV packs', () => {
  const target = { kind: 'movie', title: 'A Different Title', originalTitle: 'L’Été', alternativeTitles: ['Summer & Rain'], year: '2026', imdbId: 'tt0001234' };
  for (const title of ['L.Ete.2026.1080p', 'Summer.and.Rain.2026.1080p']) assert.equal(sourceIdentity(source('a', title), target).identity, 'match');
  assert.equal(sourceIdentity(source('a', 'A Different Title 1080p', { titleIds: { imdbId: 'tt1234' } }), target).identity, 'match');
  assert.equal(sourceIdentity(source('a', 'Another A Different Title 2026 1080p', { titleIds: { imdbId: 'tt1234' } }), target).identity, 'mismatch');
  assert.deepEqual(queryTarget('1917 2019'), { kind: 'movie', title: '1917', year: '2019' });
  assert.deepEqual(queryTarget('2001 A Space Odyssey 1968'), { kind: 'movie', title: '2001 a space odyssey', year: '1968' });
  const tv = queryTarget('Show S02E03', { kind: 'tv' });
  assert.equal(sourceIdentity(source('a', 'Show S02 Complete 2026 1080p'), { ...tv, year: '2020' }).identity, 'match');
  assert.equal(sourceIdentity(source('a', 'Show S03E03 1080p'), tv).identity, 'mismatch');
  assert.equal(sourceIdentity(source('a', 'Show S02E03 1080p'), { kind: 'movie', title: 'Show' }).identity, 'mismatch');
});

test('codecs and containers do not change baseline scores, verdicts or explanations', () => {
  const formats = ['H264 AAC MP4', 'HEVC DTS MKV', 'AV1 TrueHD', 'Xvid AVI', '10bit HDR', ''];
  const assessments = formats.map(format => baselineAdvice([source('same', `Film 2026 1080p ${format}`)]).ranking[0]);
  for (const assessment of assessments) assert.deepEqual(assessment, assessments[0]);
});

test('the streaming threshold is 3000, including the boundary, missing counts and zero', async () => {
  assert.equal(MIN_STREAMING_SEEDERS, 3000);
  const rows = [source('below', undefined, { seeders: 2999 }), source('minimum', undefined, { seeders: 3000 }), source('few', undefined, { seeders: 117 }), source('zero', undefined, { seeders: 0 }), source('unknown', undefined, { seeders: null })];
  const baseline = baselineAdvice(rows);
  assert.equal(baseline.ranking[0].id, 'minimum'); assert.equal(baseline.ranking[0].verdict, 'good');
  for (const id of ['below', 'few', 'zero', 'unknown']) assert.equal(baseline.ranking.find(r => r.id === id).verdict, 'unsure');
  assert.match(baseline.ranking.find(r => r.id === 'few').reason, /117.*3,000/);
  assert.match(baseline.ranking.find(r => r.id === 'zero').reason, /No seeders/);
  assert.match(baseline.ranking.find(r => r.id === 'unknown').reason, /unknown/);
  const model = await new SourceAssist(async (_url, init) => {
    const body = JSON.parse(init.body); assert.match(body.systemInstruction.parts[0].text, /3000 reported seeders/);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).minimumStreamingSeeders, 3000);
    return answer(['below', 'few', 'zero', 'unknown', 'minimum'].map(good));
  }).recommend('Film 2026', rows, undefined, signal());
  assert.equal(model.ranking[0].id, 'minimum');
  assert.equal(model.ranking.find(r => r.id === 'few').verdict, 'unsure');
  assert.match(model.ranking.find(r => r.id === 'few').reason, /117.*3,000/);
});

test('streaming health favors 720p above the target and retains an honest fallback when every swarm is weak', () => {
  const mixed = baselineAdvice([source('1080', undefined, { seeders: 2999 }), source('720', 'Film 2026 720p HEVC MKV', { seeders: 3000 })]);
  assert.equal(mixed.ranking[0].id, '720');
  const weak = baselineAdvice([source('few', undefined, { seeders: 117 }), source('more', undefined, { seeders: 2800 })]);
  assert.equal(weak.ranking[0].id, 'more'); assert.ok(weak.ranking.every(row => row.verdict === 'unsure'));
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
    const body = JSON.parse(init.body);
    const candidates = JSON.parse(body.contents[0].parts[0].text).candidates;
    assert.equal(candidates.length, 60);
    const ranking = body.generationConfig.responseJsonSchema.properties.ranking;
    assert.equal(ranking.minItems, undefined, 'Large fixed-length arrays are validated by the backend, not encoded in Gemini grammar');
    assert.equal(ranking.maxItems, undefined);
    assert.deepEqual(ranking.items.properties.id, { type: 'string' }, 'Source UUIDs do not expand the provider schema');
    return answer(candidates.map(c => good(c.id)));
  }).recommend('Film', rows, undefined, signal());
  assert.equal(advice.ranking.length, 75); assert.equal(new Set(advice.ranking.map(r => r.id)).size, 75);
  assert.equal(advice.reviewed, 60); assert.match(advice.warning, /60/);
});

test('fallback warnings distinguish provider request, authentication and quota errors without exposing the body', async () => {
  for (const [status, warning] of [[400, /rejected the recommendation request/], [401, /API key/], [403, /permissions/], [429, /limit or quota/], [503, /couldn't complete/]]) {
    const result = await new SourceAssist(async () => new Response(secret, { status })).recommend('Film', [source('a')], undefined, signal());
    assert.equal(result.provider, 'heuristic');
    assert.match(result.warning, warning);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
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

test('catalogue metadata reaches both rankings with indexer IDs disabled; TMDB failures retain query identity checks', async () => {
  const previous = process.env.TMDB_READ_ACCESS_TOKEN; process.env.TMDB_READ_ACCESS_TOKEN = secret;
  try {
    for (const metadataAvailable of [true, false]) {
      let reviewed = 0;
      const api = createMediaApi(async (input, init) => {
        const url = new URL(input);
        if (url.hostname === 'api.themoviedb.org') {
          assert.equal(url.pathname, '/3/movie/123');
          assert.equal(url.searchParams.get('append_to_response'), 'external_ids,alternative_titles');
          return metadataAvailable ? Response.json({ id: 123, title: 'Obsession', original_title: 'Obsession', release_date: '2026-05-01', overview: 'Selected catalogue synopsis.', production_companies: [{ name: 'A24' }], external_ids: { imdb_id: 'tt37287335' }, alternative_titles: { titles: [{ title: 'Catalogue Alternate Name' }] } }) : new Response('', { status: 503 });
        }
        if (url.hostname === 'generativelanguage.googleapis.com') {
          const payload = JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
          assert.equal(payload.requestedTitle.title.toLowerCase(), 'obsession'); assert.equal(payload.requestedTitle.year, '2026');
          assert.equal(payload.candidates.length, 1); assert.match(payload.candidates[0].title, /^Obsession/);
          if (metadataAvailable) {
            assert.equal(payload.requestedTitle.imdbId, 'tt37287335');
            assert.deepEqual(payload.requestedTitle.alternativeTitles, ['Catalogue Alternate Name']);
            assert.deepEqual(payload.requestedTitle.companies, ['A24']);
            assert.equal(payload.requestedTitle.overview, 'Selected catalogue synopsis.');
          }
          reviewed++; return answer(payload.candidates.map(c => good(c.id)));
        }
        if (url.pathname === '/api/v1/indexer') return Response.json([{ id: 1, enable: true, protocol: 'torrent', name: 'Fixture', capabilities: { movieSearchParams: ['imdbId'] } }]);
        if (url.pathname === '/api/v1/indexerstatus') return Response.json([]);
        if (url.pathname === '/api/v1/search') {
          assert.equal(url.searchParams.get('query'), 'Obsession 2026', 'catalogue metadata does not force an external-ID search');
          return Response.json([source('wrong', 'Maids Obsession 2026 1080p H264 AAC', { seeders: 9999 }), source('right', 'Obsession 2026 1080p HEVC MKV')].map(row => ({ ...row, magnetUrl: `magnet:?xt=urn:btih:${'a'.repeat(40)}` })));
        }
        assert.fail('no torrent endpoints during search or recommendations');
      });
      const call = await client(api);
      const found = await (await call('search', { query: 'Obsession 2026', target: { kind: 'movie', tmdbId: 123 }, context: undefined })).json();
      const best = found.results.find(r => r.id === found.advice.ranking[0].id);
      assert.match(best.title, /^Obsession/); assert.equal(found.advice.ranking[1].identity, 'mismatch');
      const advice = await (await call('recommend', { searchId: found.searchId })).json();
      assert.equal(advice.provider, 'gemini'); assert.equal(reviewed, 1);
    }
  } finally { if (previous === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN; else process.env.TMDB_READ_ACCESS_TOKEN = previous; }
});
