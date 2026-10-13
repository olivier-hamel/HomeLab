import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraLiveSeekPosition } from '../src/lib/camera-live.ts';

test('a viewer twenty seconds behind catches up to the current live position', () => {
  assert.equal(cameraLiveSeekPosition(10, 30), 30);
  assert.equal(cameraLiveSeekPosition(28, 30), 30);
});
test('normal playback is stable; returning to live can close a smaller gap without rewinding', () => {
  assert.equal(cameraLiveSeekPosition(29, 30), null);
  assert.equal(cameraLiveSeekPosition(29, 30, true), 30);
  assert.equal(cameraLiveSeekPosition(30.2, 30, true), null);
});
test('an unavailable or invalid live timeline never causes a seek', () => {
  for (const target of [null, NaN, Infinity, -1]) assert.equal(cameraLiveSeekPosition(10, target, true), null);
  assert.equal(cameraLiveSeekPosition(NaN, 30, true), null);
});
