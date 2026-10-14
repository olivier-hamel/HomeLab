import { randomUUID } from "node:crypto";
import { mkdirSync, createReadStream } from "node:fs";
import { open, rename, rm, stat, statfs, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { envNumber, hash, integer, kind, MediaError, query, record, string } from "./core.ts";
import { TorrServer, type TorrentFile } from "./torrserver.ts";

export type DownloadIntent = {
  query: string; label?: string;
  context?: { kind: "movie" | "tv"; tmdbId: number; imdbId?: string; tvdbId?: number; season?: number; episode?: number };
  media?: { id: number; kind: "movie" | "tv"; title: string; year: string; poster: string | null };
  movie?: { id: number; title: string; year: string; poster: string | null };
};
export type MediaDownload = { id: string; title: string; file: TorrentFile; intent: DownloadIntent; state: "queued" | "downloading" | "ready" | "error" | "deleting"; downloadedBytes: number; totalBytes: number; error: string; createdAt: string; updatedAt: string };
type Stored = MediaDownload & { username: string; hash: string; token: string; lease: number };
function identifier(value: string) {
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new MediaError("input", "Téléchargement invalide.", 400);
  return value;
}
export function downloadIntent(value: unknown, fallback: string): DownloadIntent {
  const input = record(value), media = record(input.media ?? input.movie), context = record(input.context ?? input.target);
  const result: DownloadIntent = { query: input.query ? query(input.query) : string(fallback, 250), label: string(input.label || fallback, 300) };
  if (media.id && context.tmdbId) {
    const mediaKind = kind(media.kind ?? "movie"), id = integer(media.id, 1, 100_000_000);
    if (kind(context.kind) !== mediaKind || integer(context.tmdbId, 1, 100_000_000) !== id) throw new MediaError("input", "Les informations du titre ne correspondent pas.", 400);
    const poster = string(media.poster, 500);
    result.media = { id, kind: mediaKind, title: string(media.title, 300), year: string(media.year, 4), poster: /^https:\/\/image\.tmdb\.org\/t\/p\/[a-zA-Z0-9._/-]+$/.test(poster) ? poster : null };
    result.context = { kind: mediaKind, tmdbId: id,
      ...(/^tt\d{1,10}$/.test(string(context.imdbId)) ? { imdbId: string(context.imdbId) } : {}),
      ...(context.tvdbId ? { tvdbId: integer(context.tvdbId, 1, 100_000_000) } : {}),
      ...(mediaKind === "tv" && context.season !== undefined ? { season: integer(context.season, 0, 1000) } : {}),
      ...(mediaKind === "tv" && context.episode !== undefined ? { episode: integer(context.episode, 1, 10000) } : {}) };
    // A manually selected episode from a season pack must remain discoverable
    // by its exact episode, even when the original search targeted the season.
    if (mediaKind === "tv") {
      const episode = /\bS(\d{1,3})E(\d{1,4})\b/i.exec(fallback.replaceAll("_", ".")) ?? /\b(\d{1,3})x(\d{1,4})\b/i.exec(fallback);
      if (episode && Number(episode[2]) > 0) {
        result.context.season = Number(episode[1]); result.context.episode = Number(episode[2]);
        result.label = `${result.media.title} S${episode[1].padStart(2, "0")}E${episode[2].padStart(2, "0")}`;
      }
    }
    if (mediaKind === "movie") result.movie = result.media;
  }
  return result;
}
function publicDownload(row: Stored): MediaDownload {
  const { id, title, file, intent, state, downloadedBytes, totalBytes, error, createdAt, updatedAt } = row;
  return { id, title, file, intent, state, downloadedBytes, totalBytes, error, createdAt, updatedAt };
}
function downloadFailure(error: unknown): MediaError {
  if (error instanceof MediaError) return error;
  const code = record(error).code;
  if (code === "ENOSPC" || code === "EDQUOT") return new MediaError("storage", "Espace disque ou quota insuffisant dans le volume des téléchargements. Libère de l’espace puis réessaie.", 507);
  if (["EACCES", "EPERM", "EROFS"].includes(String(code))) return new MediaError("storage", "Impossible d’écrire dans le volume des téléchargements. Vérifie ses permissions.", 507);
  return new MediaError("storage", "Impossible d’enregistrer le fichier dans le volume des téléchargements. Vérifie les journaux du backend.", 500);
}

// Only metadata enters SQLite. Video bytes are streamed to a private durable volume.
// A database lease prevents separate Next.js workers from writing the same file.
export class MediaDownloads {
  private db?: DatabaseSync;
  private timer?: ReturnType<typeof setInterval>;
  private running?: { id: string; controller: AbortController; done: Promise<void> };
  private stopping = false;
  private torrents: Pick<TorrServer, "stream">;
  private root: string;
  constructor(torrents: Pick<TorrServer, "stream"> = new TorrServer(), root = process.env.MEDIA_DOWNLOAD_STORAGE_PATH || join(process.cwd(), ".local-data", "media-downloads")) {
    this.torrents = torrents; this.root = root;
  }
  private storage() {
    if (!this.db) {
      mkdirSync(/* turbopackIgnore: true */ join(this.root, "files"), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(join(this.root, "downloads.sqlite"));
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS downloads (id TEXT PRIMARY KEY, username TEXT NOT NULL, hash TEXT NOT NULL, file_id INTEGER NOT NULL, state TEXT NOT NULL, lease INTEGER NOT NULL DEFAULT 0, token TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL, UNIQUE(username, hash, file_id))");
    }
    return this.db;
  }
  private path(id: string, partial = false) { return join(this.root, "files", `${identifier(id)}${partial ? ".part" : ""}`); }
  private read(id: string): Stored | undefined {
    const row = this.storage().prepare("SELECT snapshot, state, lease, token FROM downloads WHERE id = ?").get(identifier(id));
    return row ? { ...JSON.parse(String(row.snapshot)), state: row.state, lease: Number(row.lease), token: String(row.token) } as Stored : undefined;
  }
  get(username: string, id: string): Stored {
    const row = this.read(id);
    if (!row || row.username !== username || row.state === "deleting") throw new MediaError("not_found", "Ce téléchargement n’est plus disponible.", 404);
    return row;
  }
  list(username: string): MediaDownload[] {
    return this.storage().prepare("SELECT id FROM downloads WHERE username = ? AND state != 'deleting' ORDER BY rowid DESC").all(username).map(row => publicDownload(this.get(username, String(row.id))));
  }
  start() {
    if (this.timer) return;
    this.stopping = false;
    this.storage();
    this.timer = setInterval(() => { void this.pump().catch(() => {}); }, 5000);
    this.timer.unref();
    void this.pump().catch(() => {});
  }
  async enqueue(username: string, torrentHash: string, file: TorrentFile, intent: DownloadIntent) {
    if (file.kind !== "video" || !Number.isSafeInteger(file.size) || !file.size || file.size < 0) throw new MediaError("input", "Choisis une vidéo dont la taille est connue.", 400);
    const db = this.storage();
    const existing = db.prepare("SELECT id FROM downloads WHERE username = ? AND hash = ? AND file_id = ?").get(username, hash(torrentHash), file.id);
    if (existing) {
      const found = this.read(String(existing.id))!;
      if (found.state === "deleting") throw new MediaError("busy", "La suppression de ce fichier est en cours.", 409);
      return publicDownload(found);
    }
    if (db.prepare("SELECT id FROM downloads WHERE username = ? AND state IN ('queued', 'downloading') LIMIT 20").all(username).length >= 20) throw new MediaError("busy", "La file contient déjà 20 téléchargements. Patiente ou supprime une entrée.", 429);
    const now = new Date().toISOString();
    const row: Stored = { id: randomUUID(), username, hash: hash(torrentHash), title: intent.label || file.path, file, intent, state: "queued", downloadedBytes: 0, totalBytes: file.size, error: "", createdAt: now, updatedAt: now, token: "", lease: 0 };
    const inserted = db.prepare("INSERT OR IGNORE INTO downloads (id, username, hash, file_id, state, snapshot) VALUES (?, ?, ?, ?, ?, ?)").run(row.id, username, row.hash, file.id, row.state, JSON.stringify(row));
    if (!inserted.changes) {
      const duplicate = db.prepare("SELECT id FROM downloads WHERE username = ? AND hash = ? AND file_id = ?").get(username, row.hash, file.id);
      return publicDownload(this.get(username, String(duplicate!.id)));
    }
    this.start();
    void this.pump().catch(() => {});
    return publicDownload(row);
  }
  retry(username: string, id: string) {
    const row = this.get(username, id);
    if (row.state === "error") {
      row.error = ""; row.state = "queued";
      this.storage().prepare("UPDATE downloads SET state = 'queued', snapshot = ?, lease = 0, token = '' WHERE id = ? AND state = 'error'").run(JSON.stringify(row), id);
    }
    this.start(); void this.pump().catch(() => {});
    return publicDownload(this.get(username, id));
  }
  async remove(username: string, id: string) {
    const row = this.get(username, id);
    this.storage().prepare("UPDATE downloads SET state = 'deleting' WHERE id = ? AND username = ?").run(id, username);
    if (this.running?.id === id) { this.running.controller.abort(); await this.running.done; }
    else if (row.lease <= Date.now()) await this.erase(id);
    this.start();
  }
  private async erase(id: string) {
    await Promise.all([rm(this.path(id), { force: true }), rm(this.path(id, true), { force: true })]);
    this.storage().prepare("DELETE FROM downloads WHERE id = ? AND state = 'deleting'").run(id);
  }
  private async pump() {
    if (this.running || this.stopping) return;
    const db = this.storage();
    // Reap interrupted deletions once a previous worker's lease has expired.
    for (const row of db.prepare("SELECT id FROM downloads WHERE state = 'deleting' AND lease < ?").all(Date.now())) await this.erase(String(row.id));
    if (this.running || this.stopping) return;
    const token = randomUUID();
    db.exec("BEGIN IMMEDIATE");
    let id: string | undefined;
    try {
      if (!db.prepare("SELECT id FROM downloads WHERE state = 'downloading' AND lease > ? LIMIT 1").get(Date.now())) {
        const candidate = db.prepare("SELECT id FROM downloads WHERE state = 'queued' OR (state = 'downloading' AND lease < ?) ORDER BY rowid LIMIT 1").get(Date.now());
        if (candidate) {
          id = String(candidate.id);
          db.prepare("UPDATE downloads SET state = 'downloading', token = ?, lease = ? WHERE id = ?").run(token, Date.now() + 60_000, id);
        }
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    if (!id) return;
    const controller = new AbortController();
    const done = this.download(this.read(id)!, token, controller);
    this.running = { id, controller, done };
    try { await done; } finally { this.running = undefined; }
    if (!this.stopping) void this.pump().catch(() => {});
  }
  private async download(row: Stored, token: string, controller: AbortController) {
    const signal = controller.signal;
    const update = () => {
      row.updatedAt = new Date().toISOString();
      return this.storage().prepare("UPDATE downloads SET state = ?, snapshot = ?, lease = ? WHERE id = ? AND token = ? AND state = 'downloading'").run(row.state, JSON.stringify(row), row.state === "downloading" ? Date.now() + 60_000 : 0, row.id, token).changes;
    };
    const heartbeat = setInterval(() => { if (!update()) controller.abort(); }, 1000);
    heartbeat.unref();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      // A rename may have completed just before a worker died. Recover that file.
      const completed = await stat(this.path(row.id)).catch(() => null);
      if (completed?.size === row.totalBytes) { row.downloadedBytes = row.totalBytes; row.state = "ready"; update(); return; }
      handle = await open(this.path(row.id, true), "a+", 0o600);
      const retries = envNumber("MEDIA_DOWNLOAD_RETRIES", 3, 0, 10);
      for (let attempt = 0; ; attempt++) {
        signal.throwIfAborted();
        try { await this.transfer(row, handle, signal); break; }
        catch (error) {
          signal.throwIfAborted();
          const failure = downloadFailure(error);
          if (attempt >= retries || !["stream_unavailable", "stream_timeout", "stream_interrupted"].includes(failure.code)) throw error;
          row.error = `${failure.message} Reprise automatique ${attempt + 1}/${retries}…`;
          if (!update()) { controller.abort(); signal.throwIfAborted(); }
          await delay(envNumber("MEDIA_DOWNLOAD_RETRY_DELAY_MS", 10_000, 0, 60_000), undefined, { signal });
          row.error = "";
        }
      }
      await handle.sync(); await handle.close(); handle = undefined;
      signal.throwIfAborted();
      if (this.read(row.id)?.state !== "downloading" || this.read(row.id)?.token !== token) return;
      await rename(this.path(row.id, true), this.path(row.id));
      row.state = "ready"; row.error = ""; update();
    } catch (error) {
      const failure = downloadFailure(error);
      row.state = this.stopping ? "queued" : "error";
      row.error = this.stopping ? "" : failure.message;
      const systemCode = record(error).code;
      if (!signal.aborted) console.warn("media.download.failed", { id: row.id, code: failure.code, ...(typeof systemCode === "string" && /^E[A-Z0-9_]{1,39}$/.test(systemCode) ? { systemCode } : {}), downloadedBytes: row.downloadedBytes, totalBytes: row.totalBytes });
      update();
    } finally {
      clearInterval(heartbeat);
      await handle?.close();
      if (this.read(row.id)?.state === "deleting") await this.erase(row.id);
    }
  }
  private async transfer(row: Stored, handle: FileHandle, signal: AbortSignal) {
    row.downloadedBytes = (await handle.stat()).size;
    if (row.downloadedBytes > row.totalBytes) { await handle.truncate(0); row.downloadedBytes = 0; }
    const capacity = await statfs(this.root);
    const reserve = envNumber("MEDIA_DOWNLOAD_RESERVE_MIB", 512, 0, 1_048_576) * 1024 * 1024;
    if (capacity.bavail * capacity.bsize < row.totalBytes - row.downloadedBytes + reserve) throw new MediaError("storage", "Espace disque insuffisant. Supprime des téléchargements puis réessaie.", 507);
    if (row.downloadedBytes === row.totalBytes) return;
    const headers = row.downloadedBytes ? { Range: `bytes=${row.downloadedBytes}-` } : undefined;
    let response;
    try {
      response = await this.torrents.stream(row.hash, row.file, new Request("http://localhost/download", { headers, signal }), { idleTimeoutMs: envNumber("MEDIA_DOWNLOAD_IDLE_TIMEOUT_MS", 180_000, 1000, 600_000) });
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError("stream_unavailable", "La connexion avec TorrServer est indisponible. Vérifie le service puis réessaie.", 504);
    }
    const reader = response.body?.getReader();
    try {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
      if (!reader || ![200, 206].includes(response.status) || (response.status === 206 && (!range || Number(range[1]) !== row.downloadedBytes || Number(range[2]) !== row.totalBytes - 1 || Number(range[3]) !== row.totalBytes))) throw new MediaError("download", "Le serveur a retourné un fichier incomplet. Réessaie le téléchargement.", 502);
      if (response.status === 200 && row.downloadedBytes) {
        await handle.truncate(0); row.downloadedBytes = 0;
      }
      while (true) {
        signal.throwIfAborted();
        let next;
        try { next = await reader.read(); }
        catch (error) {
          if (error instanceof MediaError) throw error;
          throw new MediaError("stream_interrupted", "La connexion avec TorrServer a été interrompue. Réessaie pour reprendre le fichier.");
        }
        if (next.done) break;
        if (row.downloadedBytes + next.value.length > row.totalBytes) throw new MediaError("download", "La taille reçue ne correspond pas au fichier choisi.", 502);
        let offset = 0;
        while (offset < next.value.length) {
          const written = await handle.write(next.value, offset, next.value.length - offset);
          if (!written.bytesWritten) throw new Error("Empty write");
          offset += written.bytesWritten; row.downloadedBytes += written.bytesWritten;
        }
      }
      if (row.downloadedBytes !== row.totalBytes) throw new MediaError("stream_interrupted", "TorrServer a fermé la connexion avant la fin du fichier. Réessaie pour reprendre le téléchargement.", 502);
    } finally { await reader?.cancel().catch(() => {}); }
  }
  status(username: string, id: string) {
    const row = this.get(username, id);
    if (row.state !== "ready") throw new MediaError("pending", "Ce téléchargement n’est pas encore prêt.", 409);
    return { hash: `local:${username}:${row.id}`, title: row.title, state: "ready", files: [row.file], downloaded: true, downloadSpeed: null, connectedPeers: null, downloadedBytes: row.totalBytes, completedBytes: row.totalBytes, preloadBytes: row.totalBytes, preloadTarget: row.totalBytes };
  }
  async stream(source: string, file: TorrentFile, request: Request): Promise<Response> {
    const match = /^local:([^:]+):([0-9a-f-]{36})$/.exec(source);
    if (!match) throw new MediaError("input", "Fichier local invalide.", 400);
    const row = this.get(match[1], match[2]);
    if (row.state !== "ready" || row.file.id !== file.id) throw new MediaError("pending", "Ce téléchargement n’est pas encore prêt.", 409);
    let info;
    try { info = await stat(this.path(row.id)); } catch { throw new MediaError("not_found", "Le fichier téléchargé est absent du serveur.", 404); }
    if (info.size !== row.totalBytes) throw new MediaError("download", "Le fichier conservé est incomplet.", 409);
    const size = info.size, etag = `"${row.id}"`;
    const extension = /\.([a-z0-9]+)$/i.exec(file.path)?.[1].toLowerCase();
    const mime: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime", avi: "video/x-msvideo", ts: "video/mp2t" };
    const headers = new Headers({ "Content-Type": mime[extension ?? ""] || "application/octet-stream", "Accept-Ranges": "bytes", "Content-Length": String(size), ETag: etag, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Content-Security-Policy": "sandbox; default-src 'none'" });
    let start = 0, end = size - 1, status = 200;
    const rangeHeader = request.headers.get("range"), ifRange = request.headers.get("if-range");
    if (rangeHeader && (!ifRange || ifRange === etag)) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (range && (range[1] || range[2])) {
        if (!range[1]) { start = Math.max(0, size - Number(range[2])); }
        else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      } else start = size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start || (range?.[1] === "" && Number(range[2]) === 0)) {
        headers.set("Content-Range", `bytes */${size}`); headers.set("Content-Length", "0");
        return new Response(null, { status: 416, headers });
      }
      status = 206; headers.set("Content-Range", `bytes ${start}-${end}/${size}`); headers.set("Content-Length", String(end - start + 1));
    }
    if (request.method === "HEAD") return new Response(null, { status, headers });
    const input = createReadStream(/* turbopackIgnore: true */ this.path(row.id), { start, end, signal: request.signal });
    return new Response(Readable.toWeb(input) as ReadableStream<Uint8Array>, { status, headers });
  }
  async close() {
    this.stopping = true; clearInterval(this.timer); this.timer = undefined;
    this.running?.controller.abort(); await this.running?.done;
    this.db?.close(); this.db = undefined;
  }
}

export const mediaDownloads = new MediaDownloads();
