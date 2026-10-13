import { createAccountVerifier, type AccountVerifier } from "../accounts.ts";
import { BoundedCache, MediaError } from "../media/core.ts";
import { readLimited } from "../media/http.ts";
import { withMoodle, type MoodleConnector } from "./client.ts";

const rates = new BoundedCache<number>(1024, 60_000);
function boundary(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new MediaError("origin", "Utilise HomeLab pour accéder à Moodle.", 403);
  const origin = request.headers.get("origin");
  if (origin) {
    let allowed = false;
    try {
      const url = new URL(origin);
      const host = request.headers.get("host") || new URL(request.url).host;
      const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(request.url).protocol.slice(0, -1);
      allowed = url.host === host && url.protocol === `${protocol}:`;
    } catch { /* Invalid origin. */ }
    if (!allowed) throw new MediaError("origin", "Cette origine n’est pas autorisée.", 403);
  }
  if (request.method !== "GET" && (!origin || request.headers.get("x-moodle-request") !== "1" || request.headers.get("content-type")?.split(";")[0] !== "application/json")) {
    throw new MediaError("csrf", "Utilise HomeLab pour consulter les fichiers Moodle.", 403);
  }
}
function authorize(username: string) {
  const users = (process.env.MOODLE_ALLOWED_USERS || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!users.includes(username)) throw new MediaError("moodle_access", "Ton compte HomeLab n’a pas accès à cette connexion Moodle personnelle.", 403);
}
function courseId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new MediaError("input", "Choisis un cours Moodle valide.", 400);
  return Number(value);
}

export function createMoodleApi(authenticate: AccountVerifier = createAccountVerifier(), connect: MoodleConnector = withMoodle) {
  return async (request: Request) => {
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    try {
      boundary(request);
      const { user } = await authenticate(request);
      authorize(user.username); // Never use a browser-selected account/profile.
      const path = new URL(request.url).pathname.replace(/^\/api\/moodle\/?/, "");
      if (!(["status", "courses"].includes(path) && request.method === "GET") && !(["files", "read"].includes(path) && request.method === "POST")) {
        throw new MediaError("not_found", "Cette action Moodle n’est pas disponible.", 404);
      }
      let body: Record<string, unknown> = {};
      if (request.method === "POST") {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(await readLimited(request, 8 * 1024)));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MediaError("input", "La demande est invalide.", 400);
        body = parsed as Record<string, unknown>;
      }
      const id = request.method === "POST" ? courseId(body.course_id) : undefined;
      if (path === "read" && (typeof body.file_id !== "string" || !body.file_id || body.file_id.length > 2048)) throw new MediaError("input", "Choisis un fichier Moodle valide.", 400);
      const key = `moodle:${user.username}`;
      const count = rates.get(key) ?? 0;
      if (count >= 30) throw new MediaError("rate_limit", "Patiente une minute avant de refaire une demande Moodle.", 429);
      rates.set(key, count + 1);
      return await connect(request.signal, async session => {
        if (path === "status") return json({ available: true, tools: session.tools, personalAccount: true });
        const courses = await session.courses();
        if (path === "courses") return json({ courses });
        if (!courses.some(course => course.id === id)) throw new MediaError("moodle_course", "Ce cours n’est pas disponible dans cette connexion Moodle.", 404);
        const files = await session.files(id!);
        if (path === "files") return json({ course_id: id, files });
        const file = files.find(file => file.id === body.file_id);
        if (!file) throw new MediaError("moodle_file", "Ce fichier n’est pas disponible dans le cours sélectionné.", 404);
        if (file.filesize > 25 * 1024 * 1024) throw new MediaError("too_large", "Les fichiers Moodle sont limités à 25 Mo.", 413);
        return json({ file: await session.read(id!, file.id) });
      });
    } catch (error) {
      if (error instanceof MediaError) return json({ error: error.message, code: error.code }, error.status);
      if (error instanceof SyntaxError) return json({ error: "La demande est invalide.", code: "input" }, 400);
      // Never return or log MCP errors, credentials, document text or transport URLs.
      return json({ error: "Moodle est momentanément indisponible. Réessaie dans un instant.", code: "moodle_unavailable" }, 503);
    }
  };
}
