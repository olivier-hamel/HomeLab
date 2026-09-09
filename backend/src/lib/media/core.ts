export class MediaError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type Fetcher = typeof fetch;
export type Kind = "movie" | "tv";
export const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export const count = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export const string = (v: unknown, max = 500): string => typeof v === "string" ? v.slice(0, max) : "";
export function integer(v: unknown, min = 1, max = 2_147_483_647): number {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) throw new MediaError("input", "Invalid number.", 400);
  return n;
}
export function query(v: unknown, empty = false): string {
  if (typeof v !== "string" || v.length > 250 || [...v].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new MediaError("input", "Enter a search of at most 250 characters.", 400);
  const value = v.trim().replace(/\s+/g, " ");
  if (!value && !empty) throw new MediaError("input", "Enter a search query.", 400);
  return value;
}
export function kind(v: unknown): Kind {
  if (v !== "movie" && v !== "tv") throw new MediaError("input", "Choose Movies or TV.", 400);
  return v;
}
export function hash(v: unknown): string {
  if (typeof v !== "string" || !/^[a-f0-9]{40}$/i.test(v)) throw new MediaError("input", "Invalid torrent identifier.", 400);
  return v.toLowerCase();
}
export function magnet(v: unknown): string {
  if (typeof v !== "string" || v.length > 8192 || !v.startsWith("magnet:?")) throw new MediaError("input", "Use a valid BitTorrent v1 magnet link.", 400);
  const url = new URL(v);
  if (!url.searchParams.getAll("xt").some(x => /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.test(x))) throw new MediaError("input", "The magnet needs a valid BitTorrent v1 info hash.", 400);
  // Do not allow HTTP metadata/web-seed fetches through user-controlled magnet parameters.
  for (const key of url.searchParams.keys()) if (!["xt", "dn", "tr"].includes(key)) throw new MediaError("input", "Only xt, dn and tr magnet parameters are supported.", 400);
  for (const tracker of url.searchParams.getAll("tr")) {
    let parsed: URL;
    try { parsed = new URL(tracker); } catch { throw new MediaError("input", "Invalid tracker.", 400); }
    if (!["http:", "https:", "udp:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new MediaError("input", "Unsupported tracker URL.", 400);
  }
  return url.toString();
}

// Process-local, bounded TTL storage. Restarting expires searches, sessions and links.
export class BoundedCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();
  private max: number;
  private ttl: number;
  constructor(max: number, ttl: number) { this.max = max; this.ttl = ttl; }
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item || item.expires <= Date.now()) { this.entries.delete(key); return undefined; }
    return item.value;
  }
  set(key: string, value: T): T {
    for (const [k, item] of this.entries) if (item.expires <= Date.now()) this.entries.delete(k);
    this.entries.delete(key);
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expires: Date.now() + this.ttl });
    return value;
  }
  delete(key: string) { this.entries.delete(key); }
}

export function envNumber(name: string, fallback: number, min: number, max: number): number {
  return process.env[name] ? integer(process.env[name], min, max) : fallback;
}
export function serviceUrl(name: string): URL {
  const value = process.env[name];
  if (!value) throw new MediaError("setup", `Set ${name} in backend/.env.`, 503);
  let url: URL;
  try { url = new URL(value); } catch { throw new MediaError("setup", `Check ${name} in backend/.env.`, 503); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new MediaError("setup", `Use a plain HTTP(S) base URL in ${name}, without credentials or a query.`, 503);
  url.pathname = url.pathname.replace(/\/$/, "") + "/";
  return url;
}
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new MediaError("setup", `Set ${name} in backend/.env.`, 503);
  return value;
}
