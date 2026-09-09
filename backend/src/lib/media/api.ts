import { randomBytes, randomUUID } from "node:crypto";
import { BoundedCache, integer, kind, magnet, MediaError, query, record, string, type Fetcher } from "./core.ts";
import { readLimited } from "./http.ts";
import { Prowlarr, type SearchContext } from "./prowlarr.ts";
import { boundary, limited, rate, requireSession, startSession } from "./security.ts";
import { Tmdb } from "./tmdb.ts";
import { TorrServer, type TorrentFile } from "./torrserver.ts";

type Playback = { owner: string; hash: string; file?: TorrentFile; files: TorrentFile[] };
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
export function createMediaApi(fetcher: Fetcher = fetch) {
  const tmdb = new Tmdb(fetcher);
  const prowlarr = new Prowlarr(fetcher);
  const torrents = new TorrServer(fetcher);
  const playbacks = new BoundedCache<Playback>(128, 8 * 60 * 60_000);
  const shares = new BoundedCache<Share>(256, 15 * 60_000);
  const activeStreams = new Map<string, number>();
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
        return json({ tmdb: !!process.env.TMDB_READ_ACCESS_TOKEN, prowlarr: !!(process.env.PROWLARR_BASE_URL && process.env.PROWLARR_API_KEY), torrserver: !!process.env.TORRSERVER_BASE_URL, trust: "LAN / tailnet only" }, 200, { "Set-Cookie": cookie });
      }
      if (path[0] === "external" && ["GET", "HEAD"].includes(request.method)) {
        const share = shares.get(path[1]);
        if (!share) throw new MediaError("expired", "Stream link expired or revoked.", 410);
        const signal = AbortSignal.any([request.signal, share.controller.signal, AbortSignal.timeout(Math.max(1, share.expires - Date.now()))]);
        return await stream(share.hash, share.file, new Request(request, { signal }), share.owner);
      }
      const owner = requireSession(request);
      rate(`all:${owner}`, 180);
      if (path[0] === "stream" && ["GET", "HEAD"].includes(request.method)) {
        const entry = playback(path[1], owner);
        if (!entry.file) throw new MediaError("input", "Choose a video file first.", 400);
        return await stream(entry.hash, entry.file, request, owner);
      }
      if (request.method === "HEAD") return json({ error: "HEAD is supported only for streams." }, 405);
      return await limited(async () => {
        if (request.method === "GET") {
          if (path[0] === "check") {
            rate(`check:${owner}`, 4);
            const check = async (work: () => Promise<unknown>) => { try { return await work(); } catch (e) { return { state: "unavailable", error: e instanceof MediaError ? e.message : "Service unavailable." }; } };
            const [prowlarrStatus, torrserverStatus] = await Promise.all([check(() => prowlarr.health(request.signal)), check(() => torrents.health(request.signal))]);
            return json({ prowlarr: prowlarrStatus, torrserver: torrserverStatus });
          }
          if (path[0] === "catalogue") return json(await tmdb.browse(kind(url.searchParams.get("kind")), query(url.searchParams.get("q") ?? "", true), integer(url.searchParams.get("page") ?? "1", 1, 500), request.signal));
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
          if (path[0] === "search") {
            rate(`search:${owner}`, 8);
            return json(await prowlarr.search(query(body.query), integer(body.batch ?? 1, 1, 20), context(body.context), request.signal));
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
