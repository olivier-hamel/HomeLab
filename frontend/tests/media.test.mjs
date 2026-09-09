import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceIntent, sortSources, bytes } from '../src/lib/media.ts';

test('catalogue details create editable title/year or SxxExx queries without implying a source', () => {
  const title = { id: 4, title: 'Authorized title', year: '2008', kind: 'movie', imdbId: 'tt123', tvdbId: null };
  assert.equal(sourceIntent(title).query, 'Authorized title 2008');
  const episode = sourceIntent({ ...title, kind: 'tv', tvdbId: 50 }, 2, 3);
  assert.equal(episode.query, 'Authorized title S02E03'); assert.equal(episode.context.episode, 3); assert.equal(episode.sourceId, undefined);
  assert.equal(sourceIntent({ ...title, kind: 'tv' }, 0).query, 'Authorized title S00');
});
test('sort puts unknown counts after measured zero and never mutates API results', () => {
  const sources = [{ title: 'Unknown', seeders: null, size: null }, { title: 'Zero', seeders: 0, size: 0 }, { title: 'Active', seeders: 20, size: 1024 }];
  assert.deepEqual(sortSources(sources, 'seeders').map(r => r.title), ['Active', 'Zero', 'Unknown']);
  assert.equal(sources[0].title, 'Unknown'); assert.equal(bytes(null), 'Unknown'); assert.equal(bytes(0), '0 B');
});
