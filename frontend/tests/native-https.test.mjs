import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Capacitor } from '@capacitor/core';
import { prepareNativeApp, saveNativeServer } from '../src/native.ts';

test('the native HTTPS transition saves the new server before navigating and never returns to HTTP', async () => {
  const previous = { window: globalThis.window, location: globalThis.location, native: Capacitor.isNativePlatform };
  const values = new Map([['CapacitorStorage.homelab-server-url', 'http://192.168.1.50:3000']]);
  const redirects = [];
  globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  globalThis.location = { replace: value => redirects.push(value) };
  try {
    await saveNativeServer('https://192.168.1.50:3443/?tv=1');
    assert.equal(values.get('CapacitorStorage.homelab-server-url'), 'https://192.168.1.50:3443');
    assert.deepEqual(redirects, ['https://192.168.1.50:3443/?tv=1']);
    globalThis.location = { origin: 'https://192.168.1.50:3443', hostname: '192.168.1.50', pathname: '/', search: '?tv=1', replace: value => redirects.push(value) };
    Capacitor.isNativePlatform = () => true;
    assert.equal(await prepareNativeApp(), 'ready');
    assert.equal(redirects.length, 1);
  } finally {
    globalThis.window = previous.window; globalThis.location = previous.location; Capacitor.isNativePlatform = previous.native;
  }
});
