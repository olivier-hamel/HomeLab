import { BoundedCache, envNumber, record, required, string, type Fetcher } from "./core.ts";
import { jsonRequest } from "./http.ts";

export class Omdb {
  private fetcher: Fetcher;
  private cache = new BoundedCache<number | null>(500, 24 * 60 * 60_000);
  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher; }

  async rating(imdbId: string | null, signal: AbortSignal): Promise<number | null> {
    if (!imdbId || !process.env.OMDB_API_KEY) return null;
    const cached = this.cache.get(imdbId);
    if (cached !== undefined) return cached;
    const url = new URL("https://www.omdbapi.com/");
    url.searchParams.set("apikey", required("OMDB_API_KEY"));
    url.searchParams.set("i", imdbId);
    const data = record(await jsonRequest(this.fetcher, "OMDb", url, {}, envNumber("MEDIA_METADATA_TIMEOUT_MS", 10_000, 1000, 60_000), signal));
    const value = string(data.imdbRating);
    const rating = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
    return this.cache.set(imdbId, rating !== null && rating >= 0 && rating <= 10 ? rating : null);
  }
}
