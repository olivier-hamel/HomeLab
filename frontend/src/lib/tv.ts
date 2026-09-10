import { createContext, useContext } from "react";

export const TvModeContext = createContext(false);
export const useTvMode = () => useContext(TvModeContext);

export function resolveTvMode(search: string, userAgent: string, saved: string | null = null): boolean {
  const override = new URLSearchParams(search).get("tv");
  if (override === "1" || override === "0") return override === "1";
  if (saved === "1" || saved === "0") return saved === "1";
  // Silk also runs on tablets: do not identify every Silk/Android browser as a TV.
  return /\bAFT[A-Z0-9]+\b|\bFire[ _-]?TV\b/i.test(userAgent);
}

export function readTvMode(): boolean {
  let saved = null;
  try {
    saved = localStorage.getItem("homelab:tv-mode");
    const override = new URLSearchParams(location.search).get("tv");
    if (override === "1" || override === "0") localStorage.setItem("homelab:tv-mode", override);
  } catch { /* The URL override and detection also work with storage disabled. */ }
  return resolveTvMode(location.search, navigator.userAgent, saved);
}

export type Direction = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

// Prefer controls in the same row/column, including ones below the scroll viewport.
export function nearestControl<T extends { bounds: Bounds }>(origin: Bounds, candidates: T[], direction: Direction): T | undefined {
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  const sign = direction === "ArrowLeft" || direction === "ArrowUp" ? -1 : 1;
  const main = (b: Bounds) => horizontal ? (b.left + b.right) / 2 : (b.top + b.bottom) / 2;
  const cross = (b: Bounds) => horizontal ? (b.top + b.bottom) / 2 : (b.left + b.right) / 2;
  let best: T | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const b = candidate.bounds;
    const forward = (main(b) - main(origin)) * sign;
    if (forward <= 1) continue;
    const overlap = horizontal
      ? Math.min(origin.bottom, b.bottom) - Math.max(origin.top, b.top)
      : Math.min(origin.right, b.right) - Math.max(origin.left, b.left);
    const score = forward + Math.abs(cross(b) - cross(origin)) * 2 + (overlap > 0 ? 0 : 10_000);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}
