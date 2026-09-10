import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearestControl, resolveTvMode } from '../src/lib/tv.ts';
import { installAbortSignalFallbacks } from '../src/lib/browser-compat.ts';
import { normalizedServerUrl } from '../src/native.ts';
import { Capacitor } from '@capacitor/core';
import { isNativeApp, hasNativeVideoPlayer } from '../src/native.ts';

test('native server addresses are normalized and reject unsafe URL forms', () => {
  assert.equal(normalizedServerUrl(' http://192.168.1.50:3000/ '), 'http://192.168.1.50:3000');
  assert.equal(normalizedServerUrl('192.168.0.46:3000'), 'http://192.168.0.46:3000');
  assert.equal(normalizedServerUrl('https://home.example.test/dashboard/?old=1#section'), 'https://home.example.test/dashboard');
  assert.throws(() => normalizedServerUrl('ftp://192.168.1.50'), /HTTP or HTTPS/);
  assert.throws(() => normalizedServerUrl('http://user:password@192.168.1.50'), /username or password/);
});

test('native detection tolerates missing and throwing bridge methods', () => {
  const platform = Capacitor.isNativePlatform;
  const plugin = Capacitor.isPluginAvailable;
  try {
    Capacitor.isNativePlatform = undefined;
    assert.equal(isNativeApp(), false);
    assert.equal(hasNativeVideoPlayer(), false);
    Capacitor.isNativePlatform = () => { throw new Error('Broken bridge'); };
    assert.equal(isNativeApp(), false);
    Capacitor.isNativePlatform = () => true;
    Capacitor.isPluginAvailable = undefined;
    assert.equal(hasNativeVideoPlayer(), false);
    Capacitor.isPluginAvailable = () => { throw new Error('Missing headers'); };
    assert.equal(hasNativeVideoPlayer(), false);
    Capacitor.isPluginAvailable = name => name === 'NativeVideoPlayer';
    assert.equal(hasNativeVideoPlayer(), true);
  } finally {
    Capacitor.isNativePlatform = platform;
    Capacitor.isPluginAvailable = plugin;
  }
});

test('Fire TV detection keeps desktop, Android phones and Silk tablets on the original UI', () => {
  const fire = 'Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit/537.36 Silk/120.1 Chrome/120.0 Safari/537.36';
  for (const ua of [fire, 'Mozilla/5.0 Fire TV', 'Mozilla/5.0 (Linux; Android 7; AFTT Build/NS)']) assert.equal(resolveTvMode('', ua), true);
  for (const ua of ['Mozilla/5.0 (Windows NT 10.0) Chrome/140.0', 'Mozilla/5.0 (Android 12; Pixel 6)', 'Mozilla/5.0 (Linux; Android 9; KFMAWI) Silk/120.1', 'Mozilla/5.0 (iPhone) Safari/605.1']) assert.equal(resolveTvMode('', ua), false);
  assert.equal(resolveTvMode('?tv=0', fire, '1'), false);
  assert.equal(resolveTvMode('?tv=1', 'Desktop', '0'), true);
  assert.equal(resolveTvMode('', fire, '0'), false);
  assert.equal(resolveTvMode('', 'Desktop', '1'), true);
  assert.equal(resolveTvMode('?tv=invalid', 'Desktop', 'invalid'), false);
});

const rect = (left, top, width = 100, height = 100) => ({ left, top, width, height, right: left + width, bottom: top + height });
test('remote navigation follows poster rows and columns and can scroll to offscreen results', () => {
  const origin = rect(120, 120);
  const candidates = [
    { id: 'diagonal', bounds: rect(230, 0) },
    { id: 'right', bounds: rect(240, 120) },
    { id: 'left', bounds: rect(0, 120) },
    { id: 'up', bounds: rect(120, 0) },
    { id: 'down', bounds: rect(120, 240) },
  ];
  for (const [key, expected] of [['ArrowRight', 'right'], ['ArrowLeft', 'left'], ['ArrowUp', 'up'], ['ArrowDown', 'down']]) assert.equal(nearestControl(origin, candidates, key)?.id, expected);
  assert.equal(nearestControl(origin, [{ id: 'offscreen', bounds: rect(120, 1600) }], 'ArrowDown')?.id, 'offscreen');
  assert.equal(nearestControl(origin, [{ bounds: origin }], 'ArrowDown'), undefined);
  assert.equal(nearestControl(origin, [], 'ArrowLeft'), undefined);
});

test('older-browser cancellation fallbacks handle timeout, early abort, duplicates and listener cleanup', async () => {
  const originalAny = AbortSignal.any;
  const originalTimeout = AbortSignal.timeout;
  try {
    AbortSignal.any = undefined;
    AbortSignal.timeout = undefined;
    installAbortSignalFallbacks();
    const first = new AbortController();
    const second = new AbortController();
    let removed = 0;
    const remove = second.signal.removeEventListener.bind(second.signal);
    second.signal.removeEventListener = (...args) => { removed++; remove(...args); };
    const combined = AbortSignal.any([first.signal, second.signal, second.signal]);
    first.abort('cancelled');
    assert.equal(combined.aborted, true);
    assert.equal(combined.reason, 'cancelled');
    assert.equal(removed, 1);
    assert.equal(AbortSignal.any([first.signal]).aborted, true);
    assert.equal(AbortSignal.any([]).aborted, false);
    const timeout = AbortSignal.timeout(5);
    await new Promise(resolve => timeout.addEventListener('abort', resolve, { once: true }));
    assert.equal(timeout.reason.name, 'TimeoutError');
  } finally { AbortSignal.any = originalAny; AbortSignal.timeout = originalTimeout; }
  installAbortSignalFallbacks();
  assert.equal(AbortSignal.any, originalAny);
  assert.equal(AbortSignal.timeout, originalTimeout);
});
