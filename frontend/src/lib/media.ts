export type Kind = "movie" | "tv";
export type Title = { id: number; kind: Kind; title: string; year: string; overview: string; poster: string | null };
export type Details = Title & { imdbId: string | null; tvdbId: number | null; seasons: { number: number; name: string; episodes: number | null }[] };
export type SearchContext = { kind: Kind; imdbId?: string; tvdbId?: number; tmdbId?: number; season?: number; episode?: number };
export type SearchIntent = { query: string; context?: SearchContext; label?: string };
export type Source = { id: string; title: string; size: number | null; seeders: number | null; leechers: number | null; peers: number | null; indexer: string; quality: string[]; match: string };
export type Assessment = { id: string; verdict: "good" | "unsure" | "sketchy"; reason: string; method: "gemini" | "heuristic" };
export type SourceAdvice = { provider: "gemini" | "heuristic"; model: string | null; warning: string | null; reviewed: number; ranking: Assessment[] };
export type SearchResults = { searchId: string; advice: SourceAdvice; results: Source[]; reports: { indexer: string; query: string; strategy: string; error: string | null }[]; more: boolean; batch: number; warning: string | null };
export type TorrentFile = { id: number; path: string; size: number | null; kind: "video" | "subtitle" | "other"; sample: boolean };
export type TorrentStatus = { id: string; title: string; state: string; files: TorrentFile[]; downloadSpeed: number | null; connectedPeers: number | null; downloadedBytes: number | null; completedBytes: number | null; preloadBytes: number | null; preloadTarget: number | null };
export type Selection = { id: string; stream: string; file: TorrentFile };

export async function mediaApi<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/media/${path}`, { signal, credentials: "same-origin", cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Media-Request": "1" }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => { throw new Error("The media API returned an unreadable response. Check the dashboard proxy."); });
  if (!response.ok) throw new Error(data.error || `Media request failed (HTTP ${response.status}).`);
  return data as T;
}
export function sourceIntent(title: Details, season?: number, episode?: number): SearchIntent {
  const suffix = season === undefined ? title.kind === "movie" ? title.year : "" : `S${String(season).padStart(2, "0")}${episode === undefined ? "" : `E${String(episode).padStart(2, "0")}`}`;
  return { query: `${title.title} ${suffix}`.trim(), label: `${title.title} ${suffix}`.trim(), context: { kind: title.kind, tmdbId: title.id, ...(title.imdbId ? { imdbId: title.imdbId } : {}), ...(title.tvdbId ? { tvdbId: title.tvdbId } : {}), ...(season === undefined ? {} : { season }), ...(episode === undefined ? {} : { episode }) } };
}
export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  if (value === 0) return "0 B";
  const unit = Math.max(0, Math.min(4, Math.floor(Math.log(value) / Math.log(1024))));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}
export function sortSources(results: Source[], sort: string): Source[] {
  return [...results].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    const av = sort === "size" ? a.size : a.seeders;
    const bv = sort === "size" ? b.size : b.seeders;
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return bv - av;
  });
}

// Stable across refreshed searches, whose opaque source IDs may change.
export function sourceFingerprint(source: Source): string {
  return JSON.stringify([source.title.trim().toLowerCase(), source.size]);
}
export function recommendedSources(results: Source[], advice: SourceAdvice | null, dismissed: Set<string>, sort: string): Source[] {
  const visible = results.filter(source => !dismissed.has(sourceFingerprint(source)));
  const ranks = new Map(advice?.ranking.map((item, index) => [item.id, index]));
  const ranked = [...visible].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  if (sort === "recommended" || !ranked.length || !ranks.has(ranked[0].id)) return ranked;
  // Keep the recommendation visible on page one even with a manual sort.
  return [ranked[0], ...sortSources(visible.filter(source => source.id !== ranked[0].id), sort)];
}
const dismissedKey = "homelab:failed-media-sources:v1";
export function loadDismissedSources(): Set<string> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(dismissedKey) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length <= 1100).slice(-200) : []);
  } catch { return new Set(); }
}
export function saveDismissedSources(dismissed: Set<string>): void {
  try { sessionStorage.setItem(dismissedKey, JSON.stringify([...dismissed].slice(-200))); } catch { /* In-memory dismissal works when browser storage is unavailable. */ }
}
