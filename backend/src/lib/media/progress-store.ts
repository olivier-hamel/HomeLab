import { MongoClient, type Collection } from "mongodb";
import { MediaError } from "./core.ts";

export type ContinueWatchingRecord = {
  movieId: number;
  title: string;
  year: string;
  poster: string | null;
  query: string;
  context: { kind: "movie"; tmdbId: number; imdbId?: string };
  playbackPositionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
};

export type WatchHistoryRecord = {
  playbackId: string;
  kind: "movie" | "tv";
  tmdbId: number;
  imdbId?: string;
  tvdbId?: number;
  title: string;
  year: string;
  poster: string | null;
  season?: number;
  episode?: number;
  query: string;
  filePath: string;
};

type StoredProgress = Omit<ContinueWatchingRecord, "updatedAt"> & {
  userId: string;
  profileId: string;
  updatedAt: Date;
};

type StoredWatchHistory = WatchHistoryRecord & {
  userId: string;
  profileId: string;
  watchedAt: Date;
};

let connection: Promise<MongoClient> | null = null;

function identity(name: "MEDIA_USER_ID" | "MEDIA_PROFILE_ID", fallback: string) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(value)) throw new MediaError("setup", `${name} must use 1-64 letters, numbers, dots, dashes or underscores.`, 503);
  return value;
}

export function mongoUri() {
  const template = process.env.MONGODB_URI?.trim();
  if (!template) throw new MediaError("setup", "Set MONGODB_URI in backend/.env to enable Continue Watching and watch history.", 503);
  const username = encodeURIComponent(process.env.MONGODB_USERNAME ?? "");
  const password = encodeURIComponent(process.env.MONGODB_PASSWORD ?? "");
  const uri = template.replaceAll("<db_username>", username).replaceAll("<db_password>", password);
  if (/[<>]/.test(uri)) throw new MediaError("setup", "Replace the MongoDB username and password placeholders, or set MONGODB_USERNAME and MONGODB_PASSWORD.", 503);
  return uri;
}

export function completedPlayback(position: number, duration: number) {
  return position / duration >= 0.95 || duration - position <= 120;
}

async function database() {
  try {
    connection ??= new MongoClient(mongoUri(), { serverSelectionTimeoutMS: 7_500 }).connect().catch(error => { connection = null; throw error; });
    const client = await connection;
    return client.db(process.env.MONGODB_DATABASE?.trim() || "homelab");
  } catch {
    throw new MediaError("database", "Playback storage is unavailable. Check the MongoDB configuration and network access.", 503);
  }
}

async function progressCollection(): Promise<Collection<StoredProgress>> {
  try {
    const records = (await database()).collection<StoredProgress>("playback_progress");
    await records.createIndex({ userId: 1, profileId: 1, movieId: 1 }, { unique: true });
    await records.createIndex({ userId: 1, profileId: 1, updatedAt: -1 });
    return records;
  } catch {
    throw new MediaError("database", "Continue Watching storage is unavailable. Check the MongoDB configuration and network access.", 503);
  }
}

async function historyCollection(): Promise<Collection<StoredWatchHistory>> {
  try {
    const records = (await database()).collection<StoredWatchHistory>("watch_history");
    await records.createIndex({ userId: 1, profileId: 1, playbackId: 1 }, { unique: true });
    await records.createIndex({ userId: 1, profileId: 1, watchedAt: -1 });
    await records.createIndex({ userId: 1, profileId: 1, kind: 1, tmdbId: 1, watchedAt: -1 });
    return records;
  } catch {
    throw new MediaError("database", "Watch history storage is unavailable. Check the MongoDB configuration and network access.", 503);
  }
}

function owner(profileId?: string) {
  return { userId: identity("MEDIA_USER_ID", "home"), profileId: profileId || identity("MEDIA_PROFILE_ID", "default") };
}

export class ProgressStore {
  static configured() { return !!process.env.MONGODB_URI?.trim(); }

  async list(profileId?: string): Promise<ContinueWatchingRecord[]> {
    const rows = await (await progressCollection()).find(owner(profileId), { projection: { _id: 0, userId: 0, profileId: 0 } }).sort({ updatedAt: -1 }).limit(30).toArray();
    return rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  }

  async save(record: Omit<ContinueWatchingRecord, "updatedAt">, profileId?: string) {
    const records = await progressCollection();
    const key = { ...owner(profileId), movieId: record.movieId };
    // Credits count as complete. Two minutes also covers very short end-credit rolls.
    if (completedPlayback(record.playbackPositionSeconds, record.durationSeconds)) {
      await records.deleteOne(key);
      return { saved: false, completed: true };
    }
    await records.updateOne(key, { $set: { ...key, ...record, updatedAt: new Date() } }, { upsert: true });
    return { saved: true, completed: false };
  }

  async remove(movieId: number, profileId?: string) {
    await (await progressCollection()).deleteOne({ ...owner(profileId), movieId });
    return { removed: true };
  }
}

export class WatchHistoryStore {
  async list(profileId?: string, limit = 25): Promise<WatchHistoryRecord[]> {
    const rows = await (await historyCollection()).find(owner(profileId), { projection: { _id: 0, userId: 0, profileId: 0, watchedAt: 0 } }).sort({ watchedAt: -1 }).limit(limit).toArray();
    return rows;
  }

  async add(record: WatchHistoryRecord, profileId?: string) {
    const key = { ...owner(profileId), playbackId: record.playbackId };
    const result = await (await historyCollection()).updateOne(key, { $setOnInsert: { ...key, ...record, watchedAt: new Date() } }, { upsert: true });
    return { added: result.upsertedCount === 1 };
  }
}
