import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Library } from "./model.ts";
import type { BlobStore } from "./store.ts";

// A dedicated durable volume keeps large originals independent of MongoDB and
// its document-size limit. SQLite's compare-and-swap serializes folder changes
// and sync leases across workers; WAL allows readers while writes commit.
let db: DatabaseSync | undefined;
function root() { return process.env.LIBRARY_STORAGE_PATH || join(process.cwd(), ".local-data", "library"); }
function storage() {
  if (!db) {
    mkdirSync(/* turbopackIgnore: true */ join(root(), "files"), { recursive: true, mode: 0o700 });
    db = new DatabaseSync(join(root(), "library.sqlite"));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS libraries (username TEXT PRIMARY KEY, version INTEGER NOT NULL, snapshot TEXT NOT NULL)");
  }
  return db;
}
export const libraryRows = {
  async usernames(): Promise<string[]> { return storage().prepare("SELECT username FROM libraries").all().map(row => String(row.username)); },
  async findOne(filter: { username: string }): Promise<Library | null> {
    const row = storage().prepare("SELECT snapshot FROM libraries WHERE username = ?").get(filter.username);
    return row ? JSON.parse(String(row.snapshot)) as Library : null;
  },
  async insertOne(library: Library) {
    const result = storage().prepare("INSERT OR IGNORE INTO libraries (username, version, snapshot) VALUES (?, ?, ?)").run(library.username, library.version, JSON.stringify(library));
    if (!result.changes) throw Object.assign(new Error("Duplicate library"), { code: 11000 });
  },
  async updateOne(filter: { username: string; version: number }, update: { $set: Omit<Library, "username"> }) {
    const value = { username: filter.username, ...update.$set };
    const result = storage().prepare("UPDATE libraries SET version = ?, snapshot = ? WHERE username = ? AND version = ?").run(value.version, JSON.stringify(value), filter.username, filter.version);
    return { modifiedCount: Number(result.changes) };
  },
};
function blobPath(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid stored file identifier");
  return join(root(), "files", id);
}
export const libraryBlobs: BlobStore = {
  async put(bytes) { storage(); const id = randomUUID(); await writeFile(blobPath(id), bytes, { flag: "wx", mode: 0o600 }); return id; },
  async get(id) { return new Uint8Array(await readFile(/* turbopackIgnore: true */ blobPath(id))); },
  async remove(id) { await unlink(blobPath(id)).catch(error => { if (error.code !== "ENOENT") throw error; }); },
};
