import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cameraHost, type CameraConfig } from "./config.ts";
import { MediaError } from "../media/core.ts";

export type Quality = "hd" | "sd";
export function rtspInput(config: CameraConfig, quality: Quality) {
  return `rtsp://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${cameraHost()}:554/${quality === "hd" ? "stream1" : "stream2"}`;
}
export function streamArguments(input: string, directory: string) {
  // The C200 can send backward audio timestamps. Arrival times and asynchronous
  // resampling keep AAC monotonic, including in the first short segment.
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-fflags", "+nobuffer+discardcorrupt", "-flags", "low_delay",
    "-analyzeduration", "200000", "-probesize", "32768", "-rtsp_transport", "tcp", "-reorder_queue_size", "0", "-use_wallclock_as_timestamps", "1", "-timeout", "10000000", "-i", input,
    // Copying H.264 keeps the camera's roughly two-second keyframe interval.
    // A shared, bounded encoder produces independently decodable 600 ms chunks.
    "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-threads", "2",
    "-vf", "fps=20", "-fps_mode", "passthrough", "-g", "12", "-keyint_min", "12", "-sc_threshold", "0", "-bf", "0", "-flags", "+cgop", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-af", "aresample=async=1000:first_pts=0", "-ar", "16000", "-b:a", "48k", "-max_interleave_delta", "100000", "-max_delay", "0", "-flush_packets", "1",
    "-f", "hls", "-hls_time", "0.6", "-hls_list_size", "6", "-hls_delete_threshold", "2", "-hls_flags", "delete_segments+omit_endlist+temp_file+independent_segments+program_date_time",
    "-hls_segment_filename", join(directory, "segment-%09d.ts"), join(directory, "index.m3u8")];
}
type Job = { directory: string; child: ChildProcess; touched: number; failed: boolean; expired: boolean; timer: ReturnType<typeof setInterval> };
export interface CameraStreams { asset(config: CameraConfig, quality: Quality, file: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>; reset(): void }
export class TapoStreams implements CameraStreams {
  private jobs = new Map<Quality, Promise<Job>>();
  private launch: typeof spawn;
  constructor(launch = spawn) { this.launch = launch; }
  private dispose(job: Job) {
    if (job.expired) return;
    job.expired = true; clearInterval(job.timer); job.child.kill("SIGKILL");
    job.child.once("close", () => { void rm(job.directory, { recursive: true, force: true }); });
    if (job.child.exitCode !== null) void rm(job.directory, { recursive: true, force: true });
  }
  reset() {
    for (const job of this.jobs.values()) void job.then(value => this.dispose(value), () => {});
    this.jobs.clear();
  }
  private async start(config: CameraConfig, quality: Quality): Promise<Job> {
    if (!config.username || !config.password) throw new MediaError("camera_setup", "Ajoute le compte caméra dans les paramètres.", 409);
    const directory = await mkdtemp(join(tmpdir(), "homelab-camera-"));
    const child = this.launch(process.env.FFMPEG_PATH || "ffmpeg", streamArguments(rtspInput(config, quality), directory), { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const job = { directory, child, touched: Date.now(), failed: false, expired: false, timer: undefined as unknown as Job["timer"] };
    // Diagnostics can contain credentials, so drain them without logging.
    child.stderr?.resume();
    child.once("error", () => { job.failed = true; });
    child.once("close", () => { job.failed = true; });
    job.timer = setInterval(() => {
      if (Date.now() - job.touched > 45_000) {
        this.dispose(job);
        void this.jobs.get(quality)?.then(current => { if (current === job) this.jobs.delete(quality); });
      }
    }, 10_000);
    job.timer.unref();
    return job;
  }
  async asset(config: CameraConfig, quality: Quality, file: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    if (!/^(index\.m3u8|segment-\d{9}\.ts)$/.test(file)) throw new MediaError("not_found", "Ce fragment vidéo est indisponible.", 404);
    let pending = this.jobs.get(quality);
    if (pending) {
      const existing = await pending;
      if (existing.failed || existing.expired) {
        this.dispose(existing);
        // Another viewer may already have replaced this failed process.
        if (this.jobs.get(quality) !== pending) return this.asset(config, quality, file, signal);
        this.jobs.delete(quality); pending = undefined;
      }
    }
    if (!pending) {
      pending = this.start(config, quality); this.jobs.set(quality, pending);
      void pending.catch(() => { if (this.jobs.get(quality) === pending) this.jobs.delete(quality); });
    }
    const job = await pending;
    job.touched = Date.now();
    const deadline = Date.now() + (file === "index.m3u8" ? 20_000 : 1000);
    while (!signal.aborted) {
      if (job.failed || job.expired) throw new MediaError("camera_stream", "Le flux est indisponible. Vérifie les identifiants, le mode Confidentialité et FFmpeg sur le serveur.", 503);
      try {
        const bytes = await readFile(join(job.directory, file));
        // Wait for enough segments to make browser playback reliable.
        if (file !== "index.m3u8" || (bytes.toString().match(/#EXTINF/g)?.length || 0) >= 2) return new Uint8Array(bytes);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (Date.now() >= deadline) throw new MediaError("camera_stream", "Le flux tarde à arriver. Vérifie le réseau et réessaie.", 503);
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 150); signal.addEventListener("abort", done, { once: true });
      });
    }
    throw new MediaError("cancelled", "Connexion vidéo interrompue.", 499);
  }
}
export const cameraStreams = new TapoStreams();
