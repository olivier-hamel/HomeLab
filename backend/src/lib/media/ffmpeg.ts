import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BoundedCache, envNumber, MediaError } from "./core.ts";
import { conversionArguments, inputArguments, parseProbe, type MediaProbe, type PlaybackOption } from "./playback-plan.ts";
import { type TorrentFile, TorrServer } from "./torrserver.ts";

type Input = { url: string; header: () => Buffer; close: () => void };
type Job = { child: ChildProcessWithoutNullStreams; ended: Promise<void>; stop: () => void };
let probes = 0, conversions = 0;

// A seekable, file-scoped loopback input keeps upstream credentials out of process
// arguments. FFmpeg can request the tail of an MP4 without downloading the film.
async function openInput(torrents: TorrServer, hash: string, file: TorrentFile, signal: AbortSignal): Promise<Input> {
  const token = randomBytes(32).toString("hex");
  const controller = new AbortController();
  let header = Buffer.alloc(0);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const server = createServer(async (req, res) => {
    if (req.url !== `/${token}` || !["GET", "HEAD"].includes(req.method ?? "")) { res.writeHead(404).end(); return; }
    const disconnected = new AbortController();
    res.on("close", () => disconnected.abort());
    const requestSignal = AbortSignal.any([controller.signal, disconnected.signal]);
    try {
      const headers = new Headers();
      if (req.headers.range) headers.set("Range", req.headers.range);
      const response = await torrents.stream(hash, file, new Request("http://localhost/input", { method: req.method, headers, signal: requestSignal }));
      if (requestSignal.aborted) { await response.body?.cancel(); res.destroy(); return; }
      const output: Record<string, string> = {};
      for (const name of ["content-length", "content-range", "accept-ranges"]) { const value = response.headers.get(name); if (value) output[name] = value; }
      res.writeHead(response.status, output);
      if (!response.body) { res.end(); return; }
      const capture = !req.headers.range || /^bytes=0-/.test(req.headers.range);
      let captured = 0;
      const sniff = new Transform({ transform(chunk: Buffer, _encoding, done) {
        if (capture && captured < 4096) {
          const take = chunk.subarray(0, 4096 - captured);
          if (captured === 0) header = Buffer.from(take); else header = Buffer.concat([header, take]);
          captured += take.length;
        }
        done(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), sniff, res, { signal: requestSignal });
    } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  });
  const close = () => { controller.abort(); signal.removeEventListener("abort", abort); server.closeAllConnections(); server.close(); };
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    if (controller.signal.aborted) throw new MediaError("cancelled", "Playback preparation cancelled.", 499);
    server.unref();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No input port");
    return { url: `http://127.0.0.1:${address.port}/${token}`, header: () => header, close };
  } catch (error) { close(); throw error; }
}

function startJob(binary: string, args: string[], input: Input, signal: AbortSignal, release: () => void): Job {
  const child = spawn(binary, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end();
  // Drain diagnostics without logging private input URLs or untrusted media metadata.
  child.stderr.resume();
  const stop = () => { input.close(); child.kill("SIGKILL"); };
  const abort = () => { stop(); child.stdout.destroy(new MediaError("cancelled", "Media request cancelled.", 499)); };
  let failed = false;
  const ended = new Promise<void>((resolve, reject) => {
    child.once("error", () => { failed = true; reject(new MediaError("setup", "FFmpeg/ffprobe could not start. Install FFmpeg on the backend or check FFMPEG_PATH and FFPROBE_PATH.", 503)); });
    child.once("close", code => {
      signal.removeEventListener("abort", abort); input.close(); release();
      if (failed) return;
      if (signal.aborted) reject(new MediaError("cancelled", "Media request cancelled.", 499));
      else if (code !== 0) reject(new MediaError("conversion", "The media could not be processed. Retry, choose another file, or use an external player.", 422));
      else resolve();
    });
  });
  void ended.catch(() => {});
  // Install an error listener before a caller starts reading (including pre-abort).
  child.stdout.on("error", () => {});
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return { child, ended, stop };
}

export class FFmpeg {
  private torrents: TorrServer;
  private cache = new BoundedCache<MediaProbe>(128, 30 * 60_000);
  constructor(torrents: TorrServer) { this.torrents = torrents; }

  async probe(hash: string, file: TorrentFile, signal: AbortSignal): Promise<MediaProbe> {
    const key = `${hash}:${file.id}:${file.size}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (probes >= 2) throw new MediaError("busy", "Media inspection is busy. Retry shortly.", 429);
    probes++;
    let job: Job | undefined;
    let input: Input | undefined;
    const deadline = AbortSignal.timeout(envNumber("MEDIA_PROBE_TIMEOUT_MS", 90_000, 1000, 180_000));
    const combined = AbortSignal.any([signal, deadline]);
    try {
      input = await openInput(this.torrents, hash, file, combined);
      job = startJob(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", ...inputArguments(input.url), "-show_entries", "format=format_name,duration:format_tags=major_brand:stream=index,codec_name,codec_type,codec_tag_string,profile,level,pix_fmt,bits_per_raw_sample,extradata,width,height,avg_frame_rate:stream_disposition=default,attached_pic", "-show_data", "-of", "json"], input, combined, () => probes--);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of job.child.stdout) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new MediaError("probe", "Media track metadata is too large.", 422);
        chunks.push(chunk);
      }
      await job.ended;
      return this.cache.set(key, parseProbe(JSON.parse(Buffer.concat(chunks).toString("utf8")), input.header()));
    } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new MediaError("timeout", "Inspecting the video timed out while waiting for torrent data. Retry or choose another source.", 504);
      if (error instanceof MediaError) throw error;
      throw new MediaError("probe", "The video format could not be inspected. Retry or use an external player.", 422);
    } finally { if (job) { job.stop(); await job.ended.catch(() => {}); } else { input?.close(); probes--; } }
  }

  async stream(hash: string, file: TorrentFile, probe: MediaProbe, option: PlaybackOption, request: Request, start: number): Promise<Response> {
    const headers = new Headers({ "Content-Type": option.mime, "Cache-Control": "private, no-store", "Accept-Ranges": "none", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox; default-src 'none'" });
    if (request.method === "HEAD") return new Response(null, { headers });
    // Byte offsets in the original file have no relation to converted bytes. A
    // range request receives a fresh 200 stream; time seeking uses ?start=seconds.
    if (conversions >= envNumber("MEDIA_MAX_CONVERSIONS", 2, 1, 8)) throw new MediaError("busy", "The converter is busy. Stop another converted stream and retry.", 429);
    conversions++;
    let job: Job | undefined;
    let input: Input | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); timer.unref(); };
    const close = () => { clearTimeout(timer); job?.stop(); };
    try {
      input = await openInput(this.torrents, hash, file, signal);
      job = startJob(process.env.FFMPEG_PATH || "ffmpeg", conversionArguments(input.url, probe, option, start), input, signal, () => { conversions--; clearTimeout(timer); });
      const running = job;
      const iterator = running.child.stdout[Symbol.asyncIterator]();
      arm(envNumber("MEDIA_STREAM_HEADER_TIMEOUT_MS", 90_000, 1000, 180_000));
      // Wait for actual output so missing binaries / invalid inputs produce a
      // useful HTTP error, instead of committing an empty successful response.
      const first = await iterator.next(); clearTimeout(timer);
      if (first.done) { await running.ended; throw new MediaError("conversion", "The converter produced no playable video.", 422); }
      let pending: Buffer | undefined = first.value;
      return new Response(new ReadableStream<Uint8Array>({
        async pull(destination) {
          try {
            if (pending) { destination.enqueue(pending); pending = undefined; return; }
            arm(envNumber("MEDIA_STREAM_IDLE_TIMEOUT_MS", 45_000, 1000, 180_000));
            const next = await iterator.next(); clearTimeout(timer);
            if (next.done) { await running.ended; close(); destination.close(); }
            else destination.enqueue(next.value);
          } catch { close(); destination.error(new Error("Converted media stream interrupted")); }
        },
        async cancel() { controller.abort(); close(); await running.ended.catch(() => {}); },
      }, { highWaterMark: 0 }), { headers });
    } catch (error) {
      close();
      if (job) await job.ended.catch(() => {}); else { input?.close(); conversions--; }
      if (controller.signal.aborted && !request.signal.aborted) throw new MediaError("timeout", "The converter timed out waiting for playable data. Retry or choose another source.", 504);
      if (error instanceof MediaError) throw error;
      throw new MediaError("conversion", "The converted stream could not start. Check FFmpeg and retry.", 502);
    }
  }
}
