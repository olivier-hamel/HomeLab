import { BoundedCache, count, envNumber, integer, list, record, required, string, type Fetcher, type Kind } from "./core.ts";
import { jsonRequest } from "./http.ts";

export type Title = { id: number; kind: Kind; title: string; year: string; overview: string; poster: string | null };
function normalize(value: unknown, kind: Kind): Title {
  const row = record(value);
  const poster = string(row.poster_path);
  return { id: integer(row.id), kind, title: string(row.title || row.name), year: string(row.release_date || row.first_air_date).slice(0, 4), overview: string(row.overview, 6000), poster: /^\/[a-zA-Z0-9._-]+$/.test(poster) ? `https://image.tmdb.org/t/p/w342${poster}` : null };
}

export class Tmdb {
  private fetcher: Fetcher;
  private cache = new BoundedCache<unknown>(200, 10 * 60_000);
  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher; }
  private async get(path: string, params: Record<string, string>, signal: AbortSignal) {
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const cached = this.cache.get(url.href);
    if (cached) return record(cached);
    const data = await jsonRequest(this.fetcher, "TMDB", url, { headers: { Authorization: `Bearer ${required("TMDB_READ_ACCESS_TOKEN")}` } }, envNumber("MEDIA_METADATA_TIMEOUT_MS", 10_000, 1000, 60_000), signal);
    this.cache.set(url.href, data);
    return record(data);
  }
  async browse(kind: Kind, query: string, page: number, signal: AbortSignal) {
    const data = await this.get(query ? `search/${kind}` : `${kind}/popular`, { page: String(page), language: "en-US", include_adult: "false", ...(query ? { query } : {}) }, signal);
    return { provider: "TMDB", availability: "metadata-only", page, pages: Math.min(count(data.total_pages) ?? 1, 500), titles: list(data.results).slice(0, 20).map(v => normalize(v, kind)) };
  }
  async details(kind: Kind, id: number, signal: AbortSignal) {
    const data = await this.get(`${kind}/${id}`, { append_to_response: "external_ids", language: "en-US" }, signal);
    const ids = record(data.external_ids);
    return { ...normalize(data, kind), availability: "metadata-only", imdbId: /^tt\d+$/.test(string(ids.imdb_id || data.imdb_id)) ? string(ids.imdb_id || data.imdb_id) : null, tvdbId: count(ids.tvdb_id), seasons: list(data.seasons).slice(0, 200).map(v => { const s = record(v); return { number: integer(s.season_number, 0, 1000), name: string(s.name), episodes: count(s.episode_count) }; }) };
  }
  async season(id: number, season: number, signal: AbortSignal) {
    const data = await this.get(`tv/${id}/season/${season}`, { language: "en-US" }, signal);
    return { episodes: list(data.episodes).slice(0, 1000).map(v => { const e = record(v); return { number: integer(e.episode_number), name: string(e.name), overview: string(e.overview, 6000), airDate: string(e.air_date) }; }) };
  }
}
