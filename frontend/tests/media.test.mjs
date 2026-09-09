import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceIntent, sourceSearchIntent, sortSources, bytes, sourceFingerprint, recommendedSources, loadDismissedSources, saveDismissedSources } from '../src/lib/media.ts';

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

test('rejecting a recommendation hides duplicate releases and promotes the next choice under every sort', () => {
  const rows = [{ id: 'a', title: 'Best', size: 1000, seeders: 10 }, { id: 'duplicate', title: 'Best', size: 1000, seeders: 15 }, { id: 'b', title: 'Next', size: 2000, seeders: 20 }, { id: 'c', title: '4K', size: 3000, seeders: 999 }];
  const advice = { ranking: ['a', 'duplicate', 'b', 'c'].map(id => ({ id, identity: 'match' })) };
  const dismissed = new Set([sourceFingerprint(rows[0])]);
  for (const sort of ['recommended', 'seeders', 'size', 'title']) {
    assert.deepEqual(recommendedSources(rows, advice, dismissed, sort).map(r => r.id), ['b', 'c']);
  }
  assert.equal(rows.length, 4);
  assert.deepEqual(recommendedSources(rows, advice, new Set(rows.map(sourceFingerprint)), 'recommended'), []);
});

test('catalogue identity survives disabling indexer IDs but resets when the query changes', () => {
  const intent = sourceIntent({ id: 123, title: 'Obsession', kind: 'movie', year: '2026', imdbId: 'tt37287335' });
  assert.deepEqual(sourceSearchIntent(intent, intent.query, false).target, { kind: 'movie', tmdbId: 123 });
  assert.equal(sourceSearchIntent(intent, intent.query, false).context, undefined);
  assert.equal(sourceSearchIntent(intent, 'Different film 2026', true).target, undefined);
});

test('a wrong movie is never pinned over a matching release under manual sorts or after dismissal', () => {
  const rows = [{ id: 'wrong', title: 'Maids Obsession', size: 1000, seeders: 9999 }, { id: 'right', title: 'Obsession', size: 2000, seeders: 5 }];
  const advice = { ranking: [{ id: 'right', identity: 'match' }, { id: 'wrong', identity: 'mismatch' }] };
  for (const sort of ['recommended', 'seeders', 'size', 'title']) assert.equal(recommendedSources(rows, advice, new Set(), sort)[0].id, 'right');
  const remaining = recommendedSources(rows, advice, new Set([sourceFingerprint(rows[1])]), 'recommended');
  assert.equal(remaining.length, 1); assert.equal(advice.ranking.find(r => r.id === remaining[0].id).identity, 'mismatch');
});

test('dismissal survives fresh source IDs and a late AI review cannot restore hidden rows', () => {
  const row = { id: 'old-id', title: ' Film 1080p ', size: 1000 };
  const refreshed = { ...row, id: 'fresh-id', title: 'film 1080p' };
  assert.equal(sourceFingerprint(row), sourceFingerprint(refreshed));
  const hidden = new Set([sourceFingerprint(row)]);
  assert.equal(recommendedSources([refreshed], { ranking: [{ id: 'fresh-id' }] }, hidden, 'recommended').length, 0);
  assert.equal(recommendedSources([refreshed], null, new Set(), 'recommended').length, 1);
});

test('tab storage persists dismissals, bounds stored history and tolerates blocked or corrupt storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  let stored;
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } });
  try {
    saveDismissedSources(new Set(['release'])); assert.deepEqual([...loadDismissedSources()], ['release']);
    saveDismissedSources(new Set(Array.from({ length: 250 }, (_, i) => String(i)))); assert.equal(loadDismissedSources().size, 200);
    stored = 'broken JSON'; assert.equal(loadDismissedSources().size, 0);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    assert.doesNotThrow(() => saveDismissedSources(new Set())); assert.equal(loadDismissedSources().size, 0);
  } finally { if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else delete globalThis.sessionStorage; }
});
