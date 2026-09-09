import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BoundedCache, MediaError, required } from "./core.ts";

const sessions = new BoundedCache<boolean>(256, 8 * 60 * 60_000);
const rates = new BoundedCache<{ start: number; count: number }>(1024, 60_000);
let inFlight = 0;
export function rate(key: string, limit: number) {
  const item = rates.get(key) ?? rates.set(key, { start: Date.now(), count: 0 });
  if (++item.count > limit) throw new MediaError("rate_limit", "Too many requests. Wait a minute and retry.", 429);
}
export async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= 8) throw new MediaError("busy", "Media services are busy. Retry shortly.", 429);
  inFlight++;
  try { return await work(); } finally { inFlight--; }
}
function secret() {
  const value = required("MEDIA_SESSION_SECRET");
  if (value.length < 32) throw new MediaError("setup", "MEDIA_SESSION_SECRET must have at least 32 random characters.", 503);
  return value;
}
function signature(id: string) { return createHmac("sha256", secret()).update(id).digest("hex"); }
export function boundary(request: Request, mutation = false) {
  if (process.env.MEDIA_TRUSTED_NETWORK !== "true") throw new MediaError("setup", "TV setup required: restrict access to your LAN/tailnet, then configure MEDIA_TRUSTED_NETWORK, MEDIA_ALLOWED_ORIGINS and MEDIA_SESSION_SECRET in backend/.env. See docs/tv-media.md.", 503);
  const origins = required("MEDIA_ALLOWED_ORIGINS").split(",").map(s => s.trim());
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const allowed = origins.filter(origin => {
    try { const url = new URL(origin); return ["http:", "https:"].includes(url.protocol) && url.origin === origin && url.host === host; } catch { return false; }
  });
  if (!allowed.length) throw new MediaError("origin", "Dashboard origin is not allowed. Check MEDIA_ALLOWED_ORIGINS.", 403);
  const origin = request.headers.get("origin");
  if ((origin && !allowed.includes(origin)) || request.headers.get("sec-fetch-site") === "cross-site") throw new MediaError("origin", "Cross-origin media requests are not allowed.", 403);
  if (mutation && (!origin || !allowed.includes(origin) || request.headers.get("x-media-request") !== "1" || !request.headers.get("content-type")?.startsWith("application/json"))) throw new MediaError("csrf", "Use the dashboard to make this request.", 403);
  secret();
}
export function session(request: Request): string | undefined {
  const cookie = request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith("homelab_media="))?.slice(14);
  if (!cookie || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(cookie)) return;
  const [id, signed] = cookie.split(".");
  if (!timingSafeEqual(Buffer.from(signed, "hex"), Buffer.from(signature(id), "hex")) || !sessions.get(id)) return;
  return id;
}
export function requireSession(request: Request) {
  const id = session(request);
  if (!id) throw new MediaError("session", "Media session expired. Reload TV & Movies.", 401);
  return id;
}
export function startSession(request: Request) {
  const current = session(request);
  const id = current ?? randomBytes(32).toString("hex");
  sessions.set(id, true);
  const secure = (request.headers.get("origin") ?? process.env.MEDIA_ALLOWED_ORIGINS?.split(",").find(o => {
    try { return new URL(o.trim()).host === (request.headers.get("host") ?? new URL(request.url).host); } catch { return false; }
  }) ?? request.url).startsWith("https:");
  return { id, cookie: `homelab_media=${id}.${signature(id)}; HttpOnly; SameSite=Strict; Path=/api/media; Max-Age=28800${secure ? "; Secure" : ""}` };
}
