// Absolute time limits keep latency bounded when segment duration varies.
export const cameraLiveConfig = {
  lowLatencyMode: true,
  liveSyncDuration: 1.2,
  liveMaxLatencyDuration: 3,
  liveSyncOnStallIncrease: 0,
  maxLiveSyncPlaybackRate: 1.1,
  maxBufferLength: 3,
  maxMaxBufferLength: 4,
  backBufferLength: 0,
};

export function cameraLiveSeekPosition(currentTime: number, liveSyncPosition: number | null, force = false): number | null {
  if (!Number.isFinite(currentTime) || liveSyncPosition === null || !Number.isFinite(liveSyncPosition) || liveSyncPosition < 0) return null;
  // Never rewind a viewer who is already closer to the live edge.
  return liveSyncPosition - currentTime > (force ? 0.1 : 1.5) ? liveSyncPosition : null;
}
