export type Kind = "movie" | "tv";
export type Title = { id: number; kind: Kind; title: string; year: string; overview: string; poster: string | null };
export type Details = Title & { imdbId: string | null; tvdbId: number | null; seasons: { number: number; name: string; episodes: number | null }[] };
export type SearchContext = { kind: Kind; imdbId?: string; tvdbId?: number; tmdbId?: number; season?: number; episode?: number };
export type MovieSnapshot = { id: number; title: string; year: string; poster: string | null };
export type MediaSnapshot = MovieSnapshot & { kind: Kind };
export type SearchIntent = { query: string; context?: SearchContext; target?: Pick<SearchContext, "kind" | "tmdbId" | "season" | "episode">; label?: string; movie?: MovieSnapshot; media?: MediaSnapshot };
export type ContinueWatchingMovie = { movieId: number; title: string; year: string; poster: string | null; query: string; context: SearchContext & { kind: "movie"; tmdbId: number }; playbackPositionSeconds: number; durationSeconds: number; updatedAt: string };
export type Source = { id: string; title: string; size: number | null; seeders: number | null; leechers: number | null; peers: number | null; indexer: string; quality: string[]; match: string };
export type Assessment = { id: string; identity: "match" | "uncertain" | "mismatch"; verdict: "good" | "unsure" | "sketchy"; reason: string; method: "gemini" | "heuristic" };
export type SourceAdvice = { provider: "gemini" | "heuristic"; model: string | null; warning: string | null; reviewed: number; ranking: Assessment[] };
export type SearchResults = { searchId: string; advice: SourceAdvice; results: Source[]; reports: { indexer: string; query: string; strategy: string; error: string | null }[]; more: boolean; batch: number; warning: string | null };
export type TorrentFile = { id: number; path: string; size: number | null; kind: "video" | "subtitle" | "other"; sample: boolean };
export type TorrentStatus = { id: string; title: string; state: string; files: TorrentFile[]; downloadSpeed: number | null; connectedPeers: number | null; downloadedBytes: number | null; completedBytes: number | null; preloadBytes: number | null; preloadTarget: number | null };
export type Selection = { id: string; stream: string; file: TorrentFile };
export type PlaybackOption = { id: string; mode: "direct" | "remux" | "transcode"; mime: string; container: string; video: "copy" | "h264" | "vp9"; audio: "copy" | "aac" | "opus" | "none" };
export type PlaybackInspection = { duration: number | null; video: string; audio: string | null; options: PlaybackOption[] };
export type PreparedPlayback = PlaybackOption & { stream: string; duration: number | null };

export function supportedPlayback(options: PlaybackOption[], canPlayType: (mime: string) => string): string[] {
  return options.filter(option => canPlayType(option.mime) !== "").map(option => option.id);
}
export async function preparePlayback(id: string, signal: AbortSignal, canPlayType: (mime: string) => string): Promise<PreparedPlayback> {
  const inspection = await mediaApi<PlaybackInspection>("inspect", signal, { id });
  return mediaApi<PreparedPlayback>("prepare", signal, { id, supported: supportedPlayback(inspection.options, canPlayType) });
}

export async function mediaApi<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/media/${path}`, { signal, credentials: "same-origin", cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Media-Request": "1" }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => { throw new Error("The media API returned an unreadable response. Check the dashboard proxy."); });
  if (!response.ok) throw new Error(data.error || `Media request failed (HTTP ${response.status}).`);
  return data as T;
}
export async function savePlaybackProgress(intent: SearchIntent, playbackPositionSeconds: number, durationSeconds: number): Promise<void> {
  if (!intent.movie || !Number.isFinite(playbackPositionSeconds) || !Number.isFinite(durationSeconds) || playbackPositionSeconds < 5 || durationSeconds <= 0) return;
  const response = await fetch("/api/media/progress", { method: "POST", credentials: "same-origin", cache: "no-store", keepalive: true, headers: { "Content-Type": "application/json", "X-Media-Request": "1" }, body: JSON.stringify({ movie: intent.movie, intent, playbackPositionSeconds, durationSeconds }) });
  if (!response.ok) throw new Error("Playback progress could not be saved.");
  window.dispatchEvent(new CustomEvent("homelab:continue-watching-changed"));
}
export async function recordWatchHistory(playbackId: string, intent: SearchIntent): Promise<void> {
  if (!intent.media) return;
  await mediaApi("history", AbortSignal.timeout(15_000), { id: playbackId, media: intent.media, query: intent.query, context: intent.context, target: intent.target });
}
export function sourceIntent(title: Details, season?: number, episode?: number): SearchIntent {
  const suffix = season === undefined ? title.kind === "movie" ? title.year : "" : `S${String(season).padStart(2, "0")}${episode === undefined ? "" : `E${String(episode).padStart(2, "0")}`}`;
  const target = { kind: title.kind, tmdbId: title.id, ...(season === undefined ? {} : { season }), ...(episode === undefined ? {} : { episode }) };
  const media = { id: title.id, kind: title.kind, title: title.title, year: title.year, poster: title.poster };
  return { query: `${title.title} ${suffix}`.trim(), label: `${title.title} ${suffix}`.trim(), target, context: { ...target, ...(title.imdbId ? { imdbId: title.imdbId } : {}), ...(title.tvdbId ? { tvdbId: title.tvdbId } : {}) }, media, ...(title.kind === "movie" ? { movie: media } : {}) };
}
export function sourceSearchIntent(intent: SearchIntent, query: string, useIds: boolean): SearchIntent {
  return { query, ...(query === intent.query ? { target: intent.target, movie: intent.movie, media: intent.media, ...(useIds ? { context: intent.context } : {}) } : {}) };
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
  const matches = new Set(advice?.ranking.filter(item => item.identity === "match").map(item => item.id));
  const ranked = [...visible].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  if (sort === "recommended") return ranked;
  const best = ranked.find(source => matches.has(source.id));
  if (!best) return sortSources(visible, sort);
  // Keep the recommendation visible on page one even with a manual sort.
  return [best, ...sortSources(visible.filter(source => source.id !== best.id), sort)];
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

export function automaticSources(results: Source[], advice: SourceAdvice, dismissed: Set<string>): Source[] {
  const matches = new Set(advice.ranking.filter(item => item.identity === "match").map(item => item.id));
  const seen = new Set<string>();
  return recommendedSources(results, advice, dismissed, "recommended").filter(source => {
    const fingerprint = sourceFingerprint(source);
    if (!matches.has(source.id) || seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

export function episodeInFilename(path: string): { season: number; episode: number } | null {
  const match = /\bS(\d{1,3})E(\d{1,4})\b/i.exec(path.replaceAll("_", ".")) ?? /\b(\d{1,3})x(\d{1,4})\b/i.exec(path);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
}

export function mainVideo(files: TorrentFile[], intent?: SearchIntent): TorrentFile | null {
  const target = intent?.target ?? intent?.context;
  const videos = files.filter(file => {
    if (file.kind !== "video" || file.sample || /(?:^|[/\\ ._-])(?:sample|trailer|featurette|extras?)(?:[/\\ ._-]|$)/i.test(file.path)) return false;
    if (target?.kind === "tv" && target.episode !== undefined) {
      const episode = episodeInFilename(file.path);
      return episode?.episode === target.episode && (target.season === undefined || episode.season === target.season);
    }
    return true;
  });
  return videos.sort((a, b) => (b.size ?? -1) - (a.size ?? -1))[0] ?? null;
}
