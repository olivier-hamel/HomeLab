import { BoundedCache, count, list, MediaError, record, required, string, type Fetcher } from "./core.ts";
import { bounded, readLimited } from "./http.ts";
import { type SearchContext } from "./prowlarr.ts";
import { ARCHIVE_LIMIT, SUBTITLE_LIMIT, subtitleArchive, supportedSubtitle } from "./subtitle-archive.ts";

export type SubdlFile = { path: string; authenticated?: boolean; name: string; release: string; language: string; fps: string; hearingImpaired: boolean; season: number | null; episode: number | null; archive: boolean };

function downloadTarget(value: unknown): { url: URL; authenticated: boolean } {
  const path = string(value, 2000);
  const url = new URL(path, "https://dl.subdl.com");
  if (url.origin !== "https://dl.subdl.com" || url.username || url.password || url.hash || !/^\/subtitle\/[a-zA-Z0-9_-]+(?:\.zip|\/[a-zA-Z0-9_-]+)$/.test(url.pathname)) throw new MediaError("subtitle_url", "SubDL returned an unsupported download link. Choose another release.", 502);
  const keys = [...url.searchParams.keys()];
  const authenticated = keys.length === 1 && keys[0] === "api_key" && url.searchParams.get("api_key") === required("SUBDL_API_KEY");
  if (keys.length && !authenticated) throw new MediaError("subtitle_url", "SubDL returned an unsupported download link. Choose another release.", 502);
  // SubDL can append our API key to both ZIP and individual-file links. Store
  // only the path and send authentication as a header on the trusted download host.
  url.search = "";
  return { url, authenticated };
}

export class Subdl {
  private fetcher: Fetcher;
  private cache = new BoundedCache<{ title: string; year: number | null; files: SubdlFile[] }>(50, 5 * 60_000);
  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher; }

  async search(query: string, language: string, context: SearchContext | undefined, signal: AbortSignal) {
    if (!/^[A-Z]{2,3}(?:-[A-Z]{2,3})?$/.test(language)) throw new MediaError("input", "Choose a subtitle language.", 400);
    const url = new URL("https://api.subdl.com/api/v1/subtitles");
    url.searchParams.set("api_key", required("SUBDL_API_KEY"));
    url.searchParams.set("languages", language);
    url.searchParams.set("subs_per_page", "30");
    url.searchParams.set("unpack", "1");
    url.searchParams.set("hi", "1");
    url.searchParams.set("client", "custom_integration");
    if (context) url.searchParams.set("type", context.kind);
    if (context?.imdbId) url.searchParams.set("imdb_id", context.imdbId);
    else if (context?.tmdbId) url.searchParams.set("tmdb_id", String(context.tmdbId));
    else url.searchParams.set("film_name", query);
    if (context?.kind === "tv") {
      if (context.season !== undefined) url.searchParams.set("season_number", String(context.season));
      if (context.episode !== undefined) url.searchParams.set("episode_number", String(context.episode));
    }
    const cacheKey = url.search;
    const cached = this.cache.get(cacheKey); if (cached) return cached;
    return bounded("SubDL search", 15_000, signal, async s => {
      const response = await this.fetcher(url, { signal: s, headers: { Accept: "application/json" }, redirect: "manual", cache: "no-store" });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new MediaError("quota", "SubDL's request limit was reached. Try again later or check your SubDL account allowance.", 429);
        if (response.status === 402) throw new MediaError("plan", "SubDL requires a different API plan for this request. Check your SubDL account.", 503);
        if ([401, 403].includes(response.status)) throw new MediaError("setup", "SubDL rejected the API key. Check SUBDL_API_KEY in backend/.env.", 503);
        throw new MediaError("upstream", `SubDL returned HTTP ${response.status}. Try again later.`, 502);
      }
      const data = record(JSON.parse(new TextDecoder().decode(await readLimited(response, ARCHIVE_LIMIT))));
      // Provider error text can echo its credential-bearing request URL.
      if (data.status !== true) throw new MediaError("subdl", "SubDL could not complete the search. Check your API key and account limits, or try another title.", 502);
      if (!Array.isArray(data.subtitles) || !Array.isArray(data.results)) throw new MediaError("subdl", "SubDL returned an unreadable search response. Try again later.", 502);
      const matched = record(data.results[0]);
      const files: SubdlFile[] = [];
      const seen = new Set<string>();
      let unreadableLinks = 0;
      for (const value of list(data.subtitles).slice(0, 30)) {
        const sub = record(value);
        const unpacked = list(sub.unpack_files).slice(0, 100).map(record).filter(file => supportedSubtitle(string(file.name)) || /^(srt|vtt)$/i.test(string(file.format)));
        for (const file of unpacked.length ? unpacked : [sub]) {
          let target: ReturnType<typeof downloadTarget>;
          try { target = downloadTarget(file.url); } catch { unreadableLinks++; continue; }
          const link = target.url;
          if (seen.has(link.pathname)) continue;
          const archive = link.pathname.endsWith(".zip");
          let name = string(file.name, 250) || "subtitle";
          if (!archive && !supportedSubtitle(name)) name += `.${string(file.format).toLowerCase()}`;
          if (!archive && !supportedSubtitle(name)) continue;
          const season = count(file.season ?? sub.season);
          const episode = count(file.episode ?? sub.episode);
          // A full-season response can contain unrelated episodes; don't offer known mismatches.
          if (!archive && context?.kind === "tv" && ((context.season !== undefined && season !== null && season !== context.season) || (context.episode !== undefined && episode !== null && episode !== context.episode))) continue;
          seen.add(link.pathname);
          files.push({ path: link.pathname, authenticated: target.authenticated, name, release: string(file.release_name || sub.release_name || sub.name), language: string(file.language || sub.language || sub.lang, 60) || language, fps: string(sub.fps, 20), hearingImpaired: file.hi === true || sub.hi === true, season, episode, archive });
          if (files.length >= 100) break;
        }
        if (files.length >= 100) break;
      }
      if (!files.length && unreadableLinks) throw new MediaError("subtitle_url", "SubDL found subtitles, but HomeLab could not read their download links. Retry or report this provider response.", 502);
      return this.cache.set(cacheKey, { title: string(matched.name), year: count(matched.year), files });
    });
  }

  async download(file: SubdlFile, signal: AbortSignal) {
    return bounded("SubDL download", 25_000, signal, async s => {
      const target = downloadTarget(file.path);
      const headers = file.authenticated || target.authenticated ? { "x-api-key": required("SUBDL_API_KEY") } : undefined;
      const response = await this.fetcher(target.url, { signal: s, headers, redirect: "manual", cache: "no-store" });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) throw new MediaError("quota", "SubDL's download limit was reached. Try again later.", 429);
        throw new MediaError("upstream", `SubDL download returned HTTP ${response.status}. Choose another release or retry.`, 502);
      }
      const content = await readLimited(response, file.archive ? ARCHIVE_LIMIT : SUBTITLE_LIMIT);
      if (file.archive) return { files: await subtitleArchive(content, s) };
      if (!supportedSubtitle(file.name)) throw new MediaError("subtitle_format", "Choose an SRT or VTT subtitle.", 422);
      return { files: [{ name: file.name, content: Buffer.from(content).toString("base64") }] };
    });
  }
}
