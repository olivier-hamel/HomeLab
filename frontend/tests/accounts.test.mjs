import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeMediaProfile, configureMediaAccount, loadMediaProfile, mediaProfilesFor, saveMediaProfile } from '../src/lib/media.ts';

test('cinema profiles come from Mémo accounts and default to the connected HomeLab account', () => {
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const accounts = [{ username: 'oli', display_name: 'Oli' }, { username: 'max', display_name: 'Max' }, { username: 'alex', display_name: 'Alex' }];
  try {
    assert.deepEqual(mediaProfilesFor(accounts).map(profile => profile.id), ['oli', 'max', 'alex']);
    configureMediaAccount('oli', accounts);
    assert.equal(activeMediaProfile(), 'oli');
    saveMediaProfile('max');
    assert.equal(activeMediaProfile(), 'max');
    assert.equal(values.get('homelab:media-profile:oli'), 'max');
    saveMediaProfile('unknown');
    assert.equal(activeMediaProfile(), 'max');
    configureMediaAccount('alex', accounts);
    assert.equal(activeMediaProfile(), 'alex');
    configureMediaAccount('oli', accounts);
    assert.equal(activeMediaProfile(), 'max');
    configureMediaAccount('oli', accounts.filter(account => account.username !== 'max'));
    assert.equal(activeMediaProfile(), 'oli');
    configureMediaAccount(null, []);
    assert.equal(loadMediaProfile(), null);
    assert.throws(activeMediaProfile, /Connecte-toi/);
  } finally { configureMediaAccount(null, []); globalThis.localStorage = previous; }
});

test('cinema switching still works when browser storage is unavailable', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try {
    configureMediaAccount('oli', [{ username: 'oli', display_name: 'Oli' }, { username: 'max', display_name: 'Max' }]);
    assert.equal(activeMediaProfile(), 'oli');
    saveMediaProfile('max');
    assert.equal(activeMediaProfile(), 'max');
  } finally { configureMediaAccount(null, []); globalThis.localStorage = previous; }
});
