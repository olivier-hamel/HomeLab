import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraLiveSeekPosition } from '../src/lib/camera-live.ts';
const ranges = (...values) => ({ length: values.length, start: index => values[index][0], end: index => values[index][1] });

test('a viewer twenty seconds behind catches up to the current live position', () => {
  assert.equal(cameraLiveSeekPosition(10, 30, ranges([25, 32])), 30);
  assert.equal(cameraLiveSeekPosition(28, 30, ranges([25, 32])), 30);
});
test('normal playback is stable; returning to live can close a smaller gap without rewinding', () => {
  assert.equal(cameraLiveSeekPosition(29, 30, ranges([25, 32])), null);
  assert.equal(cameraLiveSeekPosition(29, 30, ranges([25, 32]), true), 30);
  assert.equal(cameraLiveSeekPosition(30.2, 30, ranges([25, 32]), true), null);
});
test('an estimated live position ahead of downloads cannot seek into missing video', () => {
  assert.equal(cameraLiveSeekPosition(10, 30, ranges()), null);
  assert.equal(cameraLiveSeekPosition(28, 30, ranges([25, 29])), null);
  assert.equal(cameraLiveSeekPosition(28, 30, ranges([25, 29]), true), 28.6);
  assert.equal(cameraLiveSeekPosition(10, 30, ranges([25, 29])), 28.6);
});
test('catching up leaves playable video and skips gaps only when the newer range is buffered', () => {
  assert.equal(cameraLiveSeekPosition(11, 30, ranges([9, 12], [29.8, 30])), null);
  assert.equal(cameraLiveSeekPosition(10, 30, ranges([9, 12], [28, 30])), 29.6);
  assert.equal(cameraLiveSeekPosition(29.55, 30, ranges([28, 30]), true), null);
});
test('an unavailable or invalid live timeline never causes a seek', () => {
  for (const target of [null, NaN, Infinity, -1]) assert.equal(cameraLiveSeekPosition(10, target, ranges([25, 32]), true), null);
  assert.equal(cameraLiveSeekPosition(NaN, 30, ranges([25, 32]), true), null);
});
