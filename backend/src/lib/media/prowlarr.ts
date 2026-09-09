import { randomUUID } from "node:crypto";
import { BoundedCache, count, envNumber, integer, list, magnet, MediaError, record, required, serviceUrl, string, type Fetcher, type Kind } from "./core.ts";
import { bounded, jsonRequest, readLimited } from "./http.ts";

export type SearchContext = { kind: Kind; imdbId?: string; tvdbId?: number; tmdbId?: number; season?: number; episode?: number };
export type Source = { id: string; title: string; size: number | null; seeders: number | null; leechers: number | null; peers: number | null; indexer: string; quality: string[]; match: string };
type Download = { link: string; indexerId: number };
type Indexer = { id: number; name: string; capabilities: Record<string, unknown>; paginates: boolean };

export function normalizeSource(value: unknown, indexer: string, context?: SearchContext): Source {
  const row = record(value);
  const title = string(row.title);
  const idMatch = context && ((context.imdbId && Number(context.imdbId.slice(2)) === row.imdbId) || (context.tvdbId && context.tvdbId === row.tvdbId) || (context.tmdbId && context.tmdbId === row.tmdbId));
  return { id: randomUUID(), title, size: count(row.size), seeders: count(row.seeders), leechers: count(row.leechers), peers: count(row.peers), indexer,
    quality: [...new Set(title.match(/\b(2160p|1080p|720p|480p|4k|HEVC|H[. ]?26[45]|x26[45]|AAC|DTS|WEB[- .]?DL|BluRay|REMUX)\b/gi) ?? [])],
    match: idMatch ? "Indexer reports a matching title ID; verify edition and episode." : "Unverified match — check title, year and episode." };
}

export function indexerQuery(indexer: Indexer, fallback: string, context?: SearchContext) {
  if (!context) return { query: fallback, type: "search", strategy: "text" };
  const caps = list(indexer.capabilities[context.kind === "movie" ? "movieSearchParams" : "tvSearchParams"]).map(v => string(v).toLowerCase());
  const id = context.imdbId && caps.includes("imdbid") ? `imdbid:${context.imdbId}` : context.tvdbId && caps.includes("tvdbid") ? `tvdbid:${context.tvdbId}` : context.tmdbId && caps.includes("tmdbid") ? `tmdbid:${context.tmdbId}` : null;
  // An episode ID search requires both season/episode support; otherwise use SxxExx text.
  if (!id || (context.season !== undefined && !caps.includes("season")) || (context.episode !== undefined && !caps.includes("ep"))) return { query: fallback, type: "search", strategy: "text" };
  return { query: `{${id}}${context.season === undefined ? "" : `{season:${context.season}}`}${context.episode === undefined ? "" : `{episode:${context.episode}}`}`, type: context.kind === "movie" ? "movie" : "tvsearch", strategy: "external ID" };
}

export class Prowlarr {
  private fetcher: Fetcher;
  private downloads = new BoundedCache<Download>(4000, 10 * 60_000);
  private searches = new BoundedCache<Awaited<ReturnType<Prowlarr["runSearch"]>>>(20, 2 * 60_000);
  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher; }
  private get(path: string, signal: AbortSignal) {
    return jsonRequest(this.fetcher, "Prowlarr", new URL(path, serviceUrl("PROWLARR_BASE_URL")), { headers: { "X-Api-Key": required("PROWLARR_API_KEY") } }, envNumber("MEDIA_SEARCH_TIMEOUT_MS", 20_000, 1000, 60_000), signal);
  }
  async health(signal: AbortSignal) {
    const data = record(await this.get("api/v1/system/status", signal));
    return { state: "reachable", version: string(data.version, 60) };
  }
  async search(q: string, batch: number, context: SearchContext | undefined, signal: AbortSignal) {
    const key = JSON.stringify([q, batch, context]);
    const cached = this.searches.get(key);
    if (cached && cached.results.every(source => this.downloads.get(source.id))) return cached;
    const result = await this.runSearch(q, batch, context, signal);
    if (!signal.aborted) this.searches.set(key, result);
    return result;
  }
  private async runSearch(q: string, batch: number, context: SearchContext | undefined, signal: AbortSignal) {
    const raw = await this.get("api/v1/indexer", signal);
    if (!Array.isArray(raw)) throw new MediaError("schema", "Prowlarr returned an incompatible indexer list.");
    const data = raw;
    // Indexer configuration contains secrets. Only the following fields may leave this method.
    const all = data.map(record).filter(v => v.enable === true && v.protocol === "torrent" && v.supportsSearch !== false);
    const indexers = all.slice(0, 20).map(v => ({ id: integer(v.id), name: string(v.name), capabilities: record(v.capabilities), paginates: v.supportsPagination === true }));
    const results: Source[] = [];
    const reports: { indexer: string; query: string; strategy: string; error: string | null }[] = [];
    let more = false;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, indexers.length) }, async () => {
      while (next < indexers.length && !signal.aborted) {
        const indexer = indexers[next++];
        if (batch > 1 && !indexer.paginates) continue;
        const selected = indexerQuery(indexer, q, context);
        try {
          const params = new URLSearchParams({ query: selected.query, type: selected.type, indexerIds: String(indexer.id), limit: "50", offset: String((batch - 1) * 50) });
          const response = await this.get(`api/v1/search?${params}`, signal);
          if (!Array.isArray(response)) throw new MediaError("schema", "Prowlarr returned an incompatible search response.");
          const rows = response;
          if (rows.length >= 50 && indexer.paginates) more = true;
          for (const value of rows.slice(0, 50)) {
            const row = record(value);
            const source = normalizeSource(row, indexer.name, context);
            const link = string(row.magnetUrl || row.downloadUrl, 16_384);
            if (link) { this.downloads.set(source.id, { link, indexerId: indexer.id }); results.push(source); }
          }
          reports.push({ indexer: indexer.name, query: selected.query, strategy: selected.strategy, error: null });
        } catch (error) {
          reports.push({ indexer: indexer.name, query: selected.query, strategy: selected.strategy, error: error instanceof MediaError ? error.message : "Search failed." });
        }
      }
    }));
    // Some Prowlarr versions swallow a provider exception and return []. Check status as well.
    try {
      const statuses = list(await this.get("api/v1/indexerstatus", signal));
      for (const value of statuses) {
        const s = record(value);
        if (typeof s.disabledTill !== "string" || Date.parse(s.disabledTill) <= Date.now()) continue;
        const report = reports.find(r => r.indexer === indexers.find(i => i.id === s.indexerId)?.name);
        if (report && !report.error) report.error = "Indexer is temporarily disabled after an upstream failure. Check Prowlarr.";
      }
    } catch { reports.push({ indexer: "Prowlarr status", query: "", strategy: "status", error: "Could not check indexer health; an empty result may also indicate an upstream error." }); }
    return { results, reports, more, batch, warning: all.length > 20 ? "Only the first 20 enabled torrent indexers were searched." : indexers.length === 0 ? "No enabled searchable torrent indexers." : null };
  }
  private downloadUrl(link: string, indexerId: number): URL {
    const base = serviceUrl("PROWLARR_BASE_URL");
    let url: URL;
    try { url = new URL(link, base); } catch { throw new MediaError("target", "Invalid Prowlarr download target.", 400); }
    if (url.origin !== base.origin || url.username || url.password || url.hash || url.pathname !== `${base.pathname}${indexerId}/download`) throw new MediaError("target", "This source does not use the configured Prowlarr download proxy. Use an authorized magnet instead.", 400);
    url.searchParams.delete("apikey");
    return url;
  }
  async resolve(id: string, signal: AbortSignal): Promise<string | Uint8Array<ArrayBuffer>> {
    const download = this.downloads.get(id);
    if (!download) throw new MediaError("expired", "Source expired. Search again.", 410);
    if (download.link.startsWith("magnet:")) return magnet(download.link);
    return bounded("Prowlarr download", 30_000, signal, async s => {
      let url = this.downloadUrl(download.link, download.indexerId);
      for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await this.fetcher(url, { headers: { "X-Api-Key": required("PROWLARR_API_KEY"), Accept: "application/x-bittorrent", "Accept-Encoding": "identity" }, signal: s, cache: "no-store", redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location") || "";
          await response.body?.cancel();
          if (location.startsWith("magnet:")) return magnet(location);
          url = this.downloadUrl(new URL(location, url).href, download.indexerId);
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new MediaError("download", `Prowlarr download returned HTTP ${response.status}.`, 502); }
        const bytes = await readLimited(response, 4 * 1024 * 1024);
        if (bytes[0] !== 100 || bytes.at(-1) !== 101) throw new MediaError("download", "Prowlarr did not return a torrent file. Try another source.", 502);
        return bytes;
      }
      throw new MediaError("redirect", "Too many Prowlarr redirects.", 502);
    });
  }
}
