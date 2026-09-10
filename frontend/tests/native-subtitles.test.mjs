import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeSubtitleSession } from '../src/lib/native-subtitles.ts';

const srt = '1\n00:00:01,000 --> 00:00:05,000\nCaption fixture\n';
const file = { id: 7, path: 'Movie.en.srt', kind: 'subtitle' };
const intent = { query: 'Movie 2026', context: { kind: 'movie', tmdbId: 42, imdbId: 'tt42' } };

test('automatic subtitles prefer torrent captions and reuse the match after toggling', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    assert.equal(init.credentials, 'same-origin');
    return new Response(srt);
  };
  try {
    const handle = nativeSubtitleSession('playback', 'Movie.mkv', [file], intent);
    const signal = new AbortController().signal;
    const result = await handle({ action: 'subtitleAuto' }, signal);
    assert.equal(result.subtitle.name, 'Movie.en.srt');
    assert.match(result.subtitle.content, /WEBVTT[\s\S]*Caption fixture/);
    assert.deepEqual(await handle({ action: 'subtitleAuto' }, signal), result);
    assert.deepEqual(calls, ['/api/media/subtitles/playback/7']);
  } finally { globalThis.fetch = original; }
});

for (const bundled of [[], [file]]) {
  test(`automatic subtitles fall back to the API with ${bundled.length ? 'unreadable' : 'no'} torrent captions`, async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(url);
      if (url.endsWith('/7')) return new Response('invalid subtitles');
      if (url.endsWith('/search')) {
        assert.deepEqual(JSON.parse(init.body), { id: 'playback', query: 'Movie 2026', context: intent.context, language: 'EN' });
        return Response.json({ results: [{ id: 'english', name: 'Movie.zip', release: 'Movie', language: 'EN', season: null, episode: null }] });
      }
      assert.equal(JSON.parse(init.body).choice, 'english');
      return Response.json({ files: [
        { name: 'Movie.fr.srt', content: Buffer.from(srt.replace('Caption fixture', 'French fixture')).toString('base64') },
        { name: 'Movie.en.srt', content: Buffer.from(srt).toString('base64') },
      ] });
    };
    try {
      const result = await nativeSubtitleSession('playback', 'Movie.mkv', bundled, intent)({ action: 'subtitleAuto' }, new AbortController().signal);
      assert.equal(result.subtitle.name, 'Movie.en.srt');
      assert.deepEqual(calls, [...(bundled.length ? ['/api/media/subtitles/playback/7'] : []), '/api/media/subtitles/search', '/api/media/subtitles/download']);
    } finally { globalThis.fetch = original; }
  });
}

test('cancelling automatic captions stops before API fallback and does not cache a late result', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; controller.abort(); return new Response(srt); };
  try {
    const handle = nativeSubtitleSession('playback', 'Movie.mkv', [file], intent);
    await assert.rejects(handle({ action: 'subtitleAuto' }, controller.signal), { name: 'AbortError' });
    globalThis.fetch = async () => { calls++; return new Response(srt); };
    await handle({ action: 'subtitleAuto' }, new AbortController().signal);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('fullscreen subtitle search and archive selection use the existing authenticated SubDL endpoints', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const signal = new AbortController().signal;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.signal, signal);
    return Response.json(url.endsWith('/search') ? {
      results: [{ id: 'scoped-subdl-id', name: 'Movie.zip', release: 'Movie 2026 French' }],
    } : { files: ['Movie.fr.srt', 'Movie.fr.sdh.srt'].map(name => ({ name, content: Buffer.from(srt).toString('base64') })) });
  };
  try {
    const handle = nativeSubtitleSession('playback', 'Movie.mkv', [file], intent);
    const result = await handle({ action: 'subtitleSearch', query: 'Movie 2026', language: 'FR' }, signal);
    const archive = await handle({ action: 'subtitleChoice', choice: result.choices[0].id }, signal);
    assert.equal(archive.choices.length, 2, 'French files must not be filtered out by English auto-selection');
    const selected = await handle({ action: 'subtitleChoice', choice: archive.choices[1].id }, signal);
    assert.equal(selected.subtitle.name, 'Movie.fr.sdh.srt');
    assert.match(selected.subtitle.content, /^WEBVTT\n\n00:00:01\.000 --> 00:00:05\.000/);
    assert.deepEqual(calls, [
      { url: '/api/media/subtitles/search', body: { id: 'playback', query: 'Movie 2026', context: intent.context, language: 'FR' } },
      { url: '/api/media/subtitles/download', body: { id: 'playback', choice: 'scoped-subdl-id' } },
    ]);
  } finally { globalThis.fetch = original; }
});

test('included subtitles use only listed torrent files and reject stale choices', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(url, '/api/media/subtitles/playback/7');
    assert.equal(init.credentials, 'same-origin');
    return new Response(srt);
  };
  try {
    const handle = nativeSubtitleSession('playback', 'Movie.mkv', [file, { id: 9, path: 'Movie.mkv', kind: 'video' }]);
    const signal = new AbortController().signal;
    const listed = await handle({ action: 'subtitleFiles' }, signal);
    assert.equal(listed.choices.length, 1);
    const selected = await handle({ action: 'subtitleChoice', choice: listed.choices[0].id }, signal);
    assert.match(selected.subtitle.content, /Caption fixture/);
    await handle({ action: 'subtitleFiles' }, signal);
    await assert.rejects(handle({ action: 'subtitleChoice', choice: listed.choices[0].id }, signal), /expired/);
    await assert.rejects(handle({ action: 'subtitleChoice', choice: '../../secret' }, signal), /expired/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test('editing the search title clears catalogue IDs and provider failures stay visible', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.context, { kind: 'movie' });
    assert.equal(body.query, 'Another title');
    return Response.json({ error: 'SubDL is temporarily unavailable.' }, { status: 503 });
  };
  try {
    const handle = nativeSubtitleSession('playback', 'Movie.mkv', [], intent);
    await assert.rejects(handle({ action: 'subtitleSearch', query: 'Another title' }, new AbortController().signal), /SubDL is temporarily unavailable/);
  } finally { globalThis.fetch = original; }
});
