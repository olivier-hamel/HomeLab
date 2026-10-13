// Absolute time limits keep latency bounded when segment duration varies.
export const cameraLiveConfig = {
  lowLatencyMode: true,
  liveSyncDuration: 1,
  liveMaxLatencyDuration: 3,
  liveSyncMode: "buffered" as const,
  liveSyncOnStallIncrease: 0,
  maxLiveSyncPlaybackRate: 1.05,
  maxBufferLength: 3,
  maxMaxBufferLength: 4,
  backBufferLength: 3,
};

export function cameraLiveSeekPosition(currentTime: number, liveSyncPosition: number | null, buffered: Pick<TimeRanges, "length" | "start" | "end">, force = false): number | null {
  if (!Number.isFinite(currentTime) || liveSyncPosition === null || !Number.isFinite(liveSyncPosition) || liveSyncPosition < 0) return null;
  // The estimated live edge can run ahead of downloaded media. Seeking there
  // empties the buffer and repeats the stall on every playlist update. Leave
  // enough downloaded video after the target to actually resume playback.
  for (let index = buffered.length - 1; index >= 0; index--) {
    const target = Math.min(liveSyncPosition, buffered.end(index) - 0.4);
    if (target >= buffered.start(index) && target - currentTime > (force ? 0.1 : 1.5)) return target;
  }
  return null;
}
