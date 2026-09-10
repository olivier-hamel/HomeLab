import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Omdb } from '../src/lib/media/omdb.ts';

const signal = () => new AbortController().signal;

test('loads and caches a bounded IMDb rating from OMDb', async () => {
  const previous = process.env.OMDB_API_KEY;
  process.env.OMDB_API_KEY = 'test-only-omdb-key';
  let calls = 0;
  try {
    const omdb = new Omdb(async url => {
      calls++;
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://www.omdbapi.com');
      assert.equal(parsed.searchParams.get('apikey'), process.env.OMDB_API_KEY);
      assert.equal(parsed.searchParams.get('i'), 'tt1234567');
      return Response.json({ Response: 'True', imdbRating: '7.8' });
    });
    assert.equal(await omdb.rating('tt1234567', signal()), 7.8);
    assert.equal(await omdb.rating('tt1234567', signal()), 7.8);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.OMDB_API_KEY;
    else process.env.OMDB_API_KEY = previous;
  }
});

test('skips missing configuration and rejects unusable rating values', async () => {
  const previous = process.env.OMDB_API_KEY;
  delete process.env.OMDB_API_KEY;
  let calls = 0;
  try {
    const omdb = new Omdb(async () => { calls++; return Response.json({ imdbRating: 'N/A' }); });
    assert.equal(await omdb.rating('tt1234567', signal()), null);
    assert.equal(calls, 0);
    process.env.OMDB_API_KEY = 'test-only-omdb-key';
    assert.equal(await omdb.rating('tt7654321', signal()), null);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.OMDB_API_KEY;
    else process.env.OMDB_API_KEY = previous;
  }
});
