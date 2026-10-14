import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureMediaAccount, downloadResumePosition, loadSubtitleOffset, saveMediaProfile, saveSubtitleOffset } from '../src/lib/media.ts';

test('download resume restores partial progress and starts completed or invalid entries from the beginning', () => {
  const state = { playbackPositionSeconds: 125.25, durationSeconds: 2400, completed: false };
  assert.equal(downloadResumePosition(state), 125.25);
  for (const invalid of [undefined, { ...state, completed: true }, { ...state, playbackPositionSeconds: Infinity }, { ...state, playbackPositionSeconds: -1 }, { ...state, playbackPositionSeconds: 2400 }]) assert.equal(downloadResumePosition(invalid), 0);
});

test('subtitle timing survives reopening by file, with separate episodes, releases and profiles', () => {
  const previous = globalThis.localStorage, values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  configureMediaAccount('oli', [{ username: 'oli', display_name: 'Oli' }, { username: 'max', display_name: 'Max' }]);
  const file = { path: 'Show.S01E02.mkv', size: 1000 };
  try {
    saveSubtitleOffset(file, -1.5);
    assert.equal(loadSubtitleOffset({ ...file }), -1.5);
    assert.equal(loadSubtitleOffset({ ...file, path: 'Show.S01E03.mkv' }), 0);
    assert.equal(loadSubtitleOffset({ ...file, size: 2000 }), 0);
    saveMediaProfile('max'); assert.equal(loadSubtitleOffset(file), 0);
    saveSubtitleOffset(file, 2); saveMediaProfile('oli');
    assert.equal(loadSubtitleOffset(file), -1.5);
    saveSubtitleOffset(file, 601); saveSubtitleOffset(file, NaN);
    assert.equal(loadSubtitleOffset(file), -1.5);
    saveSubtitleOffset(file, 0); assert.equal(loadSubtitleOffset(file), 0);
    for (const key of values.keys()) if (key.includes('subtitle-timing')) values.set(key, 'Infinity');
    assert.equal(loadSubtitleOffset(file), 0);
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(loadSubtitleOffset(file), 0); assert.doesNotThrow(() => saveSubtitleOffset(file, 2));
  } finally { configureMediaAccount(null, []); globalThis.localStorage = previous; }
});
