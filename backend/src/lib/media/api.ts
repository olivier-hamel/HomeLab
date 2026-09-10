import { randomBytes, randomUUID } from "node:crypto";
import { BoundedCache, integer, kind, magnet, MediaError, query, record, string, type Fetcher } from "./core.ts";
import { readLimited } from "./http.ts";
import { Prowlarr, type SearchContext, type Source } from "./prowlarr.ts";
import { baselineAdvice, SourceAssist } from "./source-assist.ts";
import { Welcome } from "./welcome.ts";
import { queryTarget, type SourceTarget } from "./source-identity.ts";
import { boundary, limited, rate, requireSession, startSession } from "./security.ts";
import { Tmdb } from "./tmdb.ts";
import { CatalogueSearch } from "./catalogue-search.ts";
import { TorrServer, type TorrentFile } from "./torrserver.ts";
import { Subdl, type SubdlFile } from "./subdl.ts";
import { FFmpeg } from "./ffmpeg.ts";
import { choosePlayback, inspectPlayback, type MediaProbe, type PlaybackOption } from "./playback-plan.ts";
import { ProgressStore, WatchHistoryStore, type ContinueWatchingRecord, type WatchHistoryRecord } from "./progress-store.ts";

type Playback = { owner: string; hash: string; file?: TorrentFile; files: TorrentFile[]; probe?: MediaProbe };
type Share = { owner: string; playback: string; hash: string; file: TorrentFile; expires: number; controller: AbortController };
function context(value: unknown): SearchContext | undefined {
  if (!value) return;
  const c = record(value);
  return { kind: kind(c.kind), ...(typeof c.imdbId === "string" && /^tt\d{1,10}$/.test(c.imdbId) ? { imdbId: c.imdbId } : {}),
    ...(c.tmdbId ? { tmdbId: integer(c.tmdbId, 1, 100_000_000) } : {}), ...(c.tvdbId ? { tvdbId: integer(c.tvdbId, 1, 100_000_000) } : {}),
    ...(c.season !== undefined ? { season: integer(c.season, 0, 1000) } : {}), ...(c.episode !== undefined ? { episode: integer(c.episode, 1, 10000) } : {}) };
}
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...headers } });
}
function mediaProfile(request: Request): string | undefined {
  const profile = request.headers.get("X-Media-Profile");
  if (!profile || profile === "default") return undefined;
  if (profile === "oli" || profile === "max") return profile;
  throw new MediaError("input", "Choose a valid media account.", 400);
}
export function createMediaApi(fetcher: Fetcher = fetch, converter?: Pick<FFmpeg, "probe" | "stream">) {
  const tmdb = new Tmdb(fetcher);
  const catalogue = new CatalogueSearch(fetcher, tmdb);
  const prowlarr = new Prowlarr(fetcher);
  const torrents = new TorrServer(fetcher);
  const ffmpeg = converter ?? new FFmpeg(torrents);
  const subdl = new Subdl(fetcher);
  const assist = new SourceAssist(fetcher);
  const welcome = new Welcome(fetcher);
  const progress = new ProgressStore();
  const history = new WatchHistoryStore();
  const sourceSearches = new BoundedCache<{ owner: string; query: string; context?: SearchContext; target: SourceTarget; sources: Source[] }>(40, 2 * 60_000);
  const subtitleChoices = new BoundedCache<{ owner: string; playback: string; file: SubdlFile }>(2000, 10 * 60_000);
  const playbacks = new BoundedCache<Playback>(128, 8 * 60 * 60_000);
  const shares = new BoundedCache<Share>(256, 15 * 60_000);
  const activeStreams = new Map<string, number>();
  const conversions = new BoundedCache<{ owner: string; hash: string; file: TorrentFile; probe: MediaProbe; option: PlaybackOption }>(128, 8 * 60 * 60_000);
  function playback(id: string, owner: string) {
    const entry = playbacks.get(id);
    if (!entry || entry.owner !== owner) throw new MediaError("expired", "Playback session expired. Choose the source again.", 410);
    return entry;
  }
  async function stream(hash: string, file: TorrentFile, request: Request, owner: string) {
    if ((activeStreams.get(owner) ?? 0) >= 8 || [...activeStreams.values()].reduce((a, b) => a + b, 0) >= 32) throw new MediaError("busy", "Too many active streams. Stop a player and retry.", 429);
    activeStreams.set(owner, (activeStreams.get(owner) ?? 0) + 1);
    let released = false;
    const release = () => {
      if (released) return; released = true;
      request.signal.removeEventListener("abort", release);
      const left = (activeStreams.get(owner) ?? 1) - 1;
      if (left) activeStreams.set(owner, left); else activeStreams.delete(owner);
    };
    request.signal.addEventListener("abort", release, { once: true });
    try {
      const response = await torrents.stream(hash, file, request);
      if (!response.body) { release(); return response; }
      const reader = response.body.getReader();
      return new Response(new ReadableStream({
        async pull(controller) { try { const next = await reader.read(); if (next.done) { release(); controller.close(); } else controller.enqueue(next.value); } catch { release(); controller.error(new Error("Media stream interrupted")); } },
        async cancel() { release(); await reader.cancel(); },
      }, { highWaterMark: 0 }), { status: response.status, headers: response.headers });
    } catch (error) { release(); throw error; }
  }
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/media\//, "").split("/");
      const mutation = request.method === "POST";
      if (!["GET", "HEAD", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
      boundary(request, mutation);
      rate("global", 600);
      if (path[0] === "status" && request.method === "GET") {
        rate("session-start", 60);
        const { cookie } = startSession(request);
        // Configuration states are independent; connectivity is checked explicitly below.
        return json({ tmdb: !!process.env.TMDB_READ_ACCESS_TOKEN, prowlarr: !!(process.env.PROWLARR_BASE_URL && process.env.PROWLARR_API_KEY), torrserver: !!process.env.TORRSERVER_BASE_URL, continueWatching: ProgressStore.configured(), trust: "LAN / tailnet only" }, 200, { "Set-Cookie": cookie });
      }
      if (path[0] === "external" && ["GET", "HEAD"].includes(request.method)) {
        const share = shares.get(path[1]);
        if (!share) throw new MediaError("expired", "Stream link expired or revoked.", 410);
        const signal = AbortSignal.any([request.signal, share.controller.signal, AbortSignal.timeout(Math.max(1, share.expires - Date.now()))]);
        return await stream(share.hash, share.file, new Request(request, { signal }), share.owner);
      }
      const owner = requireSession(request);
      const profile = mediaProfile(request);
      rate(`all:${owner}`, 180);
      if (path[0] === "converted" && path.length === 2 && ["GET", "HEAD"].includes(request.method)) {
        const entry = conversions.get(path[1]);
        if (!entry || entry.owner !== owner) throw new MediaError("expired", "Playback session expired. Choose the source again.", 410);
        const raw = url.searchParams.get("start") ?? "0";
        const start = Number(raw);
        // Browser currentTime and saved progress can retain sub-millisecond precision.
        // Validate the numeric range without rejecting those valid resume positions.
        if (raw.length > 64 || !/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(start) || start < 0 || start > 604800 || (entry.probe.duration !== null && start >= entry.probe.duration)) throw new MediaError("input", "Choose a time within this video.", 400);
        return await ffmpeg.stream(entry.hash, entry.file, entry.probe, entry.option, request, start);
      }
      if (path[0] === "stream" && ["GET", "HEAD"].includes(request.method)) {
        const entry = playback(path[1], owner);
        if (!entry.file) throw new MediaError("input", "Choose a video file first.", 400);
        return await stream(entry.hash, entry.file, request, owner);
      }
      if (request.method === "HEAD") return json({ error: "HEAD is supported only for streams." }, 405);
      return await limited(async () => {
        if (request.method === "GET") {
          if (path[0] === "continue-watching" && path.length === 1) {
            rate(`progress-list:${owner}`, 30);
            return json({ movies: await progress.list(profile) });
          }
          if (path[0] === "welcome" && path.length === 1) return json(await welcome.get(request.signal));
          if (path[0] === "subtitles" && path[1] === "provider" && path.length === 2) return json({ configured: !!process.env.SUBDL_API_KEY });
          if (path[0] === "subtitles" && path.length === 3) {
            rate(`subtitles:${owner}`, 30);
            const entry = playback(path[1], owner);
            if (!entry.file) throw new MediaError("input", "Choose a video file first.", 400);
            const file = entry.files.find(f => f.id === integer(path[2]));
            if (!file) throw new MediaError("input", "Choose a subtitle from this torrent's file list.", 400);
            const content = await torrents.subtitle(entry.hash, file, request.signal);
            return new Response(content, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox; default-src 'none'" } });
          }
          if (path[0] === "check") {
            rate(`check:${owner}`, 4);
            const check = async (work: () => Promise<unknown>) => { try { return await work(); } catch (e) { return { state: "unavailable", error: e instanceof MediaError ? e.message : "Service unavailable." }; } };
            const [prowlarrStatus, torrserverStatus] = await Promise.all([check(() => prowlarr.health(request.signal)), check(() => torrents.health(request.signal))]);
            return json({ prowlarr: prowlarrStatus, torrserver: torrserverStatus });
          }
          if (path[0] === "suggestions") {
            const q = query(url.searchParams.get("q") ?? "", true);
            if (q.length < 2) return json({ titles: [] });
            const result = await tmdb.browse(kind(url.searchParams.get("kind")), q, 1, request.signal);
            return json({ titles: result.titles.slice(0, 6) });
          }
          if (path[0] === "catalogue") return json(await catalogue.browse(kind(url.searchParams.get("kind")), query(url.searchParams.get("q") ?? "", true), integer(url.searchParams.get("page") ?? "1", 1, 500), request.signal));
          if (path[0] === "details") return json(await tmdb.details(kind(path[1]), integer(path[2]), request.signal));
          if (path[0] === "season") return json(await tmdb.season(integer(path[1]), integer(path[2], 0, 1000), request.signal));
          if (path[0] === "playback") {
            rate(`poll:${owner}`, 45);
            const entry = playback(path[1], owner);
            const status = await torrents.status(entry.hash, request.signal);
            entry.files = status.files;
            return json({ ...status, hash: undefined, id: path[1] });
          }
        }
        if (mutation) {
          const body = record(JSON.parse(new TextDecoder().decode(await readLimited(request, 16_384))));
          if (path[0] === "history" && path.length === 1) {
            rate(`history-add:${owner}`, 30);
            const id = string(body.id, 64);
            const entry = playback(id, owner);
            if (!entry.file) throw new MediaError("input", "Choose a video file before recording watch history.", 400);
            const media = record(body.media);
            const mediaKind = kind(media.kind);
            const tmdbId = integer(media.id, 1, 100_000_000);
            const searchContext = context(body.context ?? body.target);
            if (!searchContext || searchContext.kind !== mediaKind || searchContext.tmdbId !== tmdbId) throw new MediaError("input", "Watch history requires matching title metadata.", 400);
            const posterValue = string(media.poster, 500);
            const historyRecord: WatchHistoryRecord = {
              playbackId: id,
              kind: mediaKind,
              tmdbId,
              title: string(media.title, 300).trim(),
              year: string(media.year, 4),
              poster: /^https:\/\/image\.tmdb\.org\/t\/p\/[a-zA-Z0-9._/-]+$/.test(posterValue) ? posterValue : null,
              query: query(body.query),
              filePath: string(entry.file.path, 2000),
              ...(searchContext.imdbId ? { imdbId: searchContext.imdbId } : {}),
              ...(searchContext.tvdbId ? { tvdbId: searchContext.tvdbId } : {}),
              ...(mediaKind === "tv" && searchContext.season !== undefined ? { season: searchContext.season } : {}),
              ...(mediaKind === "tv" && searchContext.episode !== undefined ? { episode: searchContext.episode } : {}),
            };
            if (!historyRecord.title) throw new MediaError("input", "Watch history requires a title.", 400);
            return json(await history.add(historyRecord, profile));
          }
          if (path[0] === "progress" && path.length === 1) {
            rate(`progress-save:${owner}`, 60);
            const movie = record(body.movie);
            const intent = record(body.intent);
            const movieId = integer(movie.id, 1, 100_000_000);
            const searchContext = context(intent.context ?? intent.target);
            if (searchContext?.kind !== "movie" || searchContext.tmdbId !== movieId) throw new MediaError("input", "Playback progress requires matching movie metadata.", 400);
            const position = Number(body.playbackPositionSeconds);
            const duration = Number(body.durationSeconds);
            if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration <= 0 || duration > 604800) throw new MediaError("input", "Playback progress is outside the video duration.", 400);
            const posterValue = string(movie.poster, 500);
            const progressRecord: Omit<ContinueWatchingRecord, "updatedAt"> = {
              movieId,
              title: string(movie.title, 300).trim(),
              year: string(movie.year, 4),
              poster: /^https:\/\/image\.tmdb\.org\/t\/p\/[a-zA-Z0-9._/-]+$/.test(posterValue) ? posterValue : null,
              query: query(intent.query),
              context: { kind: "movie", tmdbId: movieId, ...(searchContext.imdbId ? { imdbId: searchContext.imdbId } : {}) },
              playbackPositionSeconds: Math.min(position, duration),
              durationSeconds: duration,
            };
            if (!progressRecord.title) throw new MediaError("input", "Playback progress requires a movie title.", 400);
            return json(await progress.save(progressRecord, profile));
          }
          if (path[0] === "continue-watching" && path[1] === "remove" && path.length === 2) {
            rate(`progress-remove:${owner}`, 30);
            return json(await progress.remove(integer(body.movieId, 1, 100_000_000), profile));
          }
          if (["inspect", "prepare"].includes(path[0]) && path.length === 1) {
            rate(`prepare:${owner}`, 20);
            const id = string(body.id, 64);
            const entry = playback(id, owner);
            if (!entry.file) throw new MediaError("input", "Choose a video file first.", 400);
            if (path[0] === "inspect") {
              entry.probe = await ffmpeg.probe(entry.hash, entry.file, request.signal);
              return json(inspectPlayback(entry.probe));
            }
            if (!entry.probe) throw new MediaError("input", "Inspect the video before preparing playback.", 400);
            const option = choosePlayback(inspectPlayback(entry.probe), body.supported);
            let stream = `/api/media/stream/${id}`;
            if (option.mode !== "direct") {
              const convertedId = randomUUID();
              conversions.set(convertedId, { owner, hash: entry.hash, file: entry.file, probe: entry.probe, option });
              stream = `/api/media/converted/${convertedId}`;
            }
            return json({ ...option, stream, duration: entry.probe.duration });
          }
          if (path[0] === "subtitles" && path[1] === "search" && path.length === 2) {
            rate(`subtitle-search:${owner}`, 12);
            const id = string(body.id, 64);
            if (!playback(id, owner).file) throw new MediaError("input", "Choose a video file first.", 400);
            const result = await subdl.search(query(body.query), string(body.language, 12).toUpperCase(), context(body.context), request.signal);
            return json({ title: result.title, year: result.year, results: result.files.map(file => {
              const choice = randomUUID(); subtitleChoices.set(choice, { owner, playback: id, file });
              return { ...file, path: undefined, authenticated: undefined, id: choice };
            }) });
          }
          if (path[0] === "subtitles" && path[1] === "download" && path.length === 2) {
            rate(`subtitle-download:${owner}`, 20);
            const id = string(body.id, 64);
            playback(id, owner);
            const choice = subtitleChoices.get(string(body.choice, 64));
            if (!choice || choice.owner !== owner || choice.playback !== id) throw new MediaError("expired", "Subtitle result expired. Search again and choose a release.", 410);
            return json(await subdl.download(choice.file, request.signal));
          }
          if (path[0] === "search") {
            rate(`search:${owner}`, 8);
            const q = query(body.query);
            const searchContext = context(body.context);
            const selected = context(body.target);
            const resolveTarget = async (): Promise<SourceTarget> => {
              if (!selected?.tmdbId) return queryTarget(q, searchContext);
              try {
                const details = await tmdb.details(selected.kind, selected.tmdbId, request.signal);
                return { ...selected, title: details.title, year: details.year, originalTitle: details.originalTitle, alternativeTitles: details.alternativeTitles, overview: details.overview.slice(0, 2000), companies: details.companies, ...(details.imdbId ? { imdbId: details.imdbId } : {}), ...(details.tvdbId ? { tvdbId: details.tvdbId } : {}) };
              } catch (error) {
                if (request.signal.aborted) throw error;
                return queryTarget(q, selected);
              }
            };
            const [result, target] = await Promise.all([prowlarr.search(q, integer(body.batch ?? 1, 1, 20), searchContext, request.signal), resolveTarget()]);
            const searchId = randomUUID();
            sourceSearches.set(searchId, { owner, query: q, context: searchContext, target, sources: result.results });
            return json({ ...result, searchId, advice: baselineAdvice(result.results, target, target) });
          }
          if (path[0] === "recommend" && path.length === 1) {
            rate(`recommend:${owner}`, 12);
            rate("recommend:global", 60);
            const found = sourceSearches.get(string(body.searchId, 64));
            if (!found || found.owner !== owner) throw new MediaError("expired", "Source recommendations expired. Search again.", 410);
            return json(await assist.recommend(found.query, found.sources, found.target, request.signal, found.target));
          }
          if (path[0] === "playback" && path.length === 1) {
            rate(`add:${owner}`, 10);
            if (!!body.sourceId === !!body.magnet) throw new MediaError("input", "Choose one source or submit one magnet.", 400);
            const input = body.sourceId ? await prowlarr.resolve(string(body.sourceId, 64), request.signal) : magnet(body.magnet);
            const status = await torrents.add(input, request.signal);
            const id = randomUUID();
            playbacks.set(id, { owner, hash: status.hash, files: status.files });
            return json({ ...status, hash: undefined, id });
          }
          if (path[0] === "select") {
            const entry = playback(string(body.id, 64), owner);
            const current = await torrents.status(entry.hash, request.signal);
            const file = current.files.find(f => f.id === integer(body.fileId));
            if (!file || file.kind !== "video") throw new MediaError("input", "Choose a video from this torrent's file list.", 400);
            // Separate playback handle per file keeps existing viewers and external links stable.
            const id = randomUUID();
            playbacks.set(id, { ...entry, files: current.files, file });
            return json({ id, stream: `/api/media/stream/${id}`, file });
          }
          if (path[0] === "share") {
            rate(`share:${owner}`, 12);
            const id = string(body.id, 64);
            const entry = playback(id, owner);
            if (!entry.file) throw new MediaError("input", "Choose a video first.", 400);
            const token = randomBytes(32).toString("hex");
            shares.set(token, { owner, playback: id, hash: entry.hash, file: entry.file, expires: Date.now() + 15 * 60_000, controller: new AbortController() });
            return json({ token, path: `/api/media/external/${token}`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
          }
          if (path[0] === "revoke") {
            const token = string(body.token, 64);
            const share = shares.get(token);
            if (share && share.owner === owner) { share.controller.abort(); shares.delete(token); }
            return json({ revoked: true });
          }
        }
        return json({ error: "Unknown media endpoint." }, 404);
      });
    } catch (error) {
      if (error instanceof MediaError) return json({ error: error.message, code: error.code }, error.status);
      return json({ error: "Invalid request or unexpected media response. Retry or check service configuration.", code: "failed" }, 400);
    }
  };
}
