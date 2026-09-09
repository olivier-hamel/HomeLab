import { count, envNumber, hash, integer, list, magnet, MediaError, record, serviceUrl, string, type Fetcher } from "./core.ts";
import { bounded, jsonRequest, readLimited } from "./http.ts";

export type TorrentFile = { id: number; path: string; size: number | null; kind: "video" | "subtitle" | "other"; sample: boolean };
export function normalizeTorrent(value: unknown) {
  const data = record(value);
  const files: TorrentFile[] = list(data.file_stats).slice(0, 5000).map(value => {
    const f = record(value);
    const path = string(f.path, 2000);
    return { id: integer(f.id), path, size: count(f.length), kind: /\.(mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mpg|mpeg|ogv)$/i.test(path) ? "video" : /\.(srt|vtt|ass|ssa|sub|idx)$/i.test(path) ? "subtitle" : "other", sample: /(^|[/\\ ._-])sample([/\\ ._-]|$)/i.test(path) };
  });
  return { hash: hash(data.hash), title: string(data.title || data.name), files,
    state: data.stat === 4 || data.stat === 5 ? "unavailable" : data.stat === 2 ? "buffering" : files.length ? "ready" : "fetching metadata",
    downloadSpeed: count(data.download_speed), connectedPeers: count(data.active_peers), downloadedBytes: count(data.bytes_read_data), completedBytes: count(data.loaded_size), preloadBytes: count(data.preloaded_bytes), preloadTarget: count(data.preload_size) };
}

export class TorrServer {
  private fetcher: Fetcher;
  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher; }
  private headers(): Headers {
    const headers = new Headers();
    const user = process.env.TORRSERVER_USERNAME;
    const password = process.env.TORRSERVER_PASSWORD;
    if (!!user !== !!password) throw new MediaError("setup", "Set both TorrServer username and password, or leave both blank.", 503);
    if (user && password) headers.set("Authorization", `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`);
    return headers;
  }
  async health(signal: AbortSignal) {
    return bounded("TorrServer", envNumber("MEDIA_METADATA_TIMEOUT_MS", 10_000, 1000, 60_000), signal, async s => {
      const response = await this.fetcher(new URL("echo", serviceUrl("TORRSERVER_BASE_URL")), { signal: s, headers: this.headers(), redirect: "manual", cache: "no-store" });
      if (!response.ok) { await response.body?.cancel(); throw new MediaError("upstream", `TorrServer returned HTTP ${response.status}.`, 502); }
      const version = new TextDecoder().decode(await readLimited(response, 200));
      // /echo may be public even with auth enabled; list verifies the configured credentials.
      await this.request("torrents", { action: "list" }, s);
      return { state: "reachable", version: /^[\w. +:-]{1,100}$/.test(version.trim()) ? version.trim() : "Unrecognized version" };
    });
  }
  private request(path: string, body: unknown, signal: AbortSignal) {
    const headers = this.headers(); headers.set("Content-Type", "application/json");
    return jsonRequest(this.fetcher, "TorrServer", new URL(path, serviceUrl("TORRSERVER_BASE_URL")), { method: "POST", headers, body: JSON.stringify(body) }, envNumber("MEDIA_METADATA_TIMEOUT_MS", 10_000, 1000, 60_000), signal);
  }
  async add(input: string | Uint8Array<ArrayBuffer>, signal: AbortSignal) {
    if (typeof input === "string") return normalizeTorrent(await this.request("torrents", { action: "add", link: magnet(input), save_to_db: false }, signal));
    const form = new FormData();
    form.set("file", new Blob([input], { type: "application/x-bittorrent" }), "source.torrent");
    // Omit save entirely: upstream treats any supplied value (even "false") as true.
    const result = await jsonRequest(this.fetcher, "TorrServer", new URL("torrent/upload", serviceUrl("TORRSERVER_BASE_URL")), { method: "POST", headers: this.headers(), body: form }, envNumber("MEDIA_METADATA_TIMEOUT_MS", 10_000, 1000, 60_000), signal);
    return normalizeTorrent(Array.isArray(result) ? result[0] : result);
  }
  async status(id: string, signal: AbortSignal) { return normalizeTorrent(await this.request("torrents", { action: "get", hash: hash(id) }, signal)); }
  async subtitle(id: string, file: TorrentFile, signal: AbortSignal) {
    const max = 2 * 1024 * 1024;
    if (file.kind !== "subtitle" || !/\.(srt|vtt)$/i.test(file.path)) throw new MediaError("input", "Choose an SRT or VTT subtitle from this torrent.", 400);
    if (file.size !== null && file.size > max) throw new MediaError("too_large", "Subtitle files must be 2 MiB or smaller.", 413);
    return bounded("Subtitle download", 30_000, signal, async s => {
      // Reuse authenticated streaming and cancellation without forwarding video ranges.
      const response = await this.stream(id, file, new Request("http://localhost/subtitle", { signal: s }));
      if (response.status !== 200) { await response.body?.cancel(); throw new MediaError("subtitle", "The subtitle file could not be loaded. Retry or load a local file.", 502); }
      return readLimited(response, max);
    });
  }
  async stream(id: string, file: TorrentFile, request: Request): Promise<Response> {
    const url = new URL("stream", serviceUrl("TORRSERVER_BASE_URL"));
    url.search = new URLSearchParams({ link: hash(id), index: String(integer(file.id)), play: "" }).toString();
    const headers = this.headers();
    headers.set("Accept-Encoding", "identity");
    for (const name of ["range", "if-range"]) {
      const value = request.headers.get(name);
      if (value && value.length > 512) throw new MediaError("input", "Range header is too long.", 400);
      if (value) headers.set(name, value);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    let timer = setTimeout(abort, envNumber("MEDIA_STREAM_HEADER_TIMEOUT_MS", 90_000, 1000, 180_000));
    const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); };
    try {
      const upstream = await this.fetcher(url, { method: request.method === "HEAD" ? "HEAD" : "GET", headers, signal: controller.signal, redirect: "manual", cache: "no-store" });
      clearTimeout(timer);
      if (![200, 206, 416].includes(upstream.status)) { await upstream.body?.cancel(); throw new MediaError("stream", `TorrServer stream returned HTTP ${upstream.status}. Retry or use an external player.`, 502); }
      if (upstream.headers.has("content-encoding") && upstream.headers.get("content-encoding") !== "identity") { await upstream.body?.cancel(); throw new MediaError("stream", "TorrServer returned an encoded stream; byte-range forwarding requires identity encoding."); }
      const output = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Disposition": "inline", "Content-Security-Policy": "sandbox; default-src 'none'" });
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
        const value = upstream.headers.get(name); if (value) output.set(name, value);
      }
      // A torrent named .mp4 can contain HTML. Directly opening its same-origin
      // URL must never execute it, even if upstream advertises an active MIME type.
      const contentType = output.get("content-type")?.split(";")[0].trim() ?? "";
      if (!/^(video\/[-+.\w]+|audio\/[-+.\w]+|multipart\/byteranges|application\/(octet-stream|x-matroska))$/i.test(contentType)) {
        output.set("Content-Type", "application/octet-stream");
        output.set("Content-Disposition", "attachment");
      }
      if (request.method === "HEAD" || upstream.status === 416) {
        await upstream.body?.cancel(); cleanup();
        // Never forward an upstream error body which could contain private details.
        if (upstream.status === 416) output.set("Content-Length", "0");
        return new Response(null, { status: upstream.status, headers: output });
      }
      const reader = upstream.body?.getReader();
      if (!reader) throw new MediaError("stream", "TorrServer returned an empty stream.");
      const idle = envNumber("MEDIA_STREAM_IDLE_TIMEOUT_MS", 45_000, 1000, 180_000);
      // One read per downstream pull preserves backpressure; no whole-file buffering.
      const body = new ReadableStream<Uint8Array>({
        async pull(destination) {
          timer = setTimeout(abort, idle);
          try {
            const { done, value } = await reader.read(); clearTimeout(timer);
            if (done) { cleanup(); destination.close(); } else destination.enqueue(value);
          } catch { cleanup(); controller.abort(); destination.error(new Error("Media stream interrupted")); }
        },
        async cancel() { cleanup(); controller.abort(); await reader.cancel().catch(() => {}); },
      }, { highWaterMark: 0 });
      return new Response(body, { status: upstream.status, headers: output });
    } catch (error) {
      cleanup(); controller.abort();
      if (error instanceof MediaError) throw error;
      throw new MediaError("stream", "Stream unavailable or timed out. Check TorrServer and retry.", 504);
    }
  }
}
