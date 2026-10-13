import { createAccountVerifier, type AccountVerifier } from "../accounts.ts";
import { BoundedCache, MediaError } from "../media/core.ts";
import { readLimited } from "../media/http.ts";
import { fileMime, MAX_FILE_BYTES, moodleAuthorized, publicLibrary } from "./model.ts";
import { libraryStore, type LibraryStore } from "./store.ts";
import { moodleSync, type MoodleSync } from "./sync.ts";
import { powerpointPreview } from "./preview.ts";
import { TempoScans } from "./scans.ts";
import { geminiApiKey } from "../ai/gemini.ts";
import { importMemoArchive } from "./imports.ts";

const rates = new BoundedCache<number>(1024, 60_000);
function boundary(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new MediaError("origin", "Ouvre la bibliothèque depuis HomeLab.", 403);
  const origin = request.headers.get("origin");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(request.url).protocol.slice(0, -1);
  if (origin && origin !== `${protocol}://${request.headers.get("host") || new URL(request.url).host}`) throw new MediaError("origin", "Cette origine n’est pas autorisée.", 403);
  if (request.method !== "GET" && (!origin || request.headers.get("x-library-request") !== "1")) throw new MediaError("csrf", "Utilise les commandes de la bibliothèque.", 403);
}
async function body(request: Request, limit = 8 * 1024) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new MediaError("input", "La demande est invalide.", 400);
  const value: unknown = JSON.parse(new TextDecoder().decode(await readLimited(request, limit)));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MediaError("input", "La demande est invalide.", 400);
  return value as Record<string, unknown>;
}
function parent(value: unknown): string | null { if (value === null) return null; if (typeof value !== "string") throw new MediaError("input", "Choisis un dossier valide.", 400); return value; }
export function createLibraryApi(authenticate: AccountVerifier = createAccountVerifier(), store: LibraryStore = libraryStore, sync: Pick<MoodleSync, "start"> = moodleSync, convert = powerpointPreview, scans = new TempoScans(store, undefined, convert)) {
  return async (request: Request) => {
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    try {
      boundary(request); const { user } = await authenticate(request); const username = user.username;
      const allowed = moodleAuthorized(username);
      const path = new URL(request.url).pathname.replace(/^\/api\/library\/?/, "").split("/").filter(Boolean);
      if (!path.length && request.method === "GET") return json({ ...publicLibrary(await store.snapshot(username), allowed), aiAvailable: !!geminiApiKey() });
      if (path.length === 1 && path[0] === "notifications" && request.method === "GET") return json(await scans.notifications(username));
      if (path.join("/") === "import/memo" && request.method === "POST") {
        const data = await body(request); await importMemoArchive(request, username, data.id, store); return json({ imported: true });
      }
      if (path[0] === "sync" && path.length === 1 && request.method === "POST") {
        if (!allowed) throw new MediaError("moodle_access", "Ton compte n’a pas accès à cette connexion Moodle.", 403);
        await body(request);
        const key = `sync:${username}`, count = rates.get(key) || 0;
        if (count >= 3) throw new MediaError("rate_limit", "Patiente une minute avant de relancer Moodle.", 429);
        rates.set(key, count + 1);
        const started = await sync.start(username, true); return json({ started }, 202);
      }
      if (path[0] === "folders") {
        const data = await body(request);
        if (path.length === 1 && request.method === "POST") return json({ folder: await store.createFolder(username, { id: data.id, name: data.name, parentId: parent(data.parentId) }) }, 201);
        if (path.length === 2 && request.method === "PATCH") return json({ folder: await store.updateFolder(username, path[1], { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.parentId !== undefined ? { parentId: parent(data.parentId) } : {}) }) });
        if (path.length === 2 && request.method === "DELETE") { await store.removeFolder(username, path[1]); return json({ removed: true }); }
      }
      if (path[0] === "files") {
        if (path.length === 1 && request.method === "POST") {
          const folderId = request.headers.get("x-file-folder") || null;
          const name = decodeURIComponent(request.headers.get("x-file-name") || "");
          const id = request.headers.get("x-file-id") || "";
          const bytes = await readLimited(request, MAX_FILE_BYTES);
          const file = await store.upload(username, id, name, folderId, bytes);
          return json({ file: publicLibrary({ ...(await store.snapshot(username)), files: [file] }, allowed).files[0] }, 201);
        }
        if (path.length >= 2) {
          const file = await store.get(username, path[1]);
          if (file.source && !allowed) throw new MediaError("moodle_access", "Ton compte n’a plus accès aux fichiers Moodle.", 403);
          if (path.length === 3 && request.method === "POST" && path[2] === "scan") {
            await body(request);
            const key = `scan:${username}`, count = rates.get(key) || 0;
            if (count >= 6) throw new MediaError("rate_limit", "Patiente une minute avant de demander un autre scan.", 429);
            rates.set(key, count + 1);
            await scans.request(username, file.id); return json({ queued: true }, 202);
          }
          if (path.length === 3 && request.method === "POST" && path[2] === "events") {
            const data = await body(request, 768 * 1024); return json(await scans.decide(username, file.id, data.scanId, data.events, data.ignored ?? []), 201);
          }
          if (path.length === 2 && request.method === "PATCH") {
            const data = await body(request);
            await store.updateFile(username, file.id, { ...(data.name !== undefined ? { name: data.name } : {}), ...(data.folderId !== undefined ? { folderId: parent(data.folderId) } : {}) });
            return json({ updated: true });
          }
          if (path.length === 2 && request.method === "DELETE") { await body(request); await store.removeFile(username, file.id); return json({ removed: true }); }
          if (path.length === 3 && ["original", "preview"].includes(path[2]) && request.method === "GET") {
            if (!file.blobId) throw new MediaError("pending", "Ce fichier est en attente de téléchargement depuis Moodle.", 409);
            let bytes: Uint8Array<ArrayBuffer>; let mime = fileMime(file);
            const download = path[2] === "original";
            if (!download && file.kind === "powerpoint") {
              const preview = file.previewId || await store.savePreview(username, file, await convert(file.name, await store.blobs.get(file.blobId)));
              bytes = await store.blobs.get(preview); mime = "application/pdf";
            } else bytes = await store.blobs.get(file.blobId);
            return new Response(bytes, { headers: { "Content-Type": mime, "Content-Length": String(bytes.length),
              "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name.replace(/\.(pptx?)$/i, !download ? ".pdf" : ".$1"))}`,
              "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'" } });
          }
        }
      }
      throw new MediaError("not_found", "Cette action n’est pas disponible.", 404);
    } catch (error) {
      if (error instanceof MediaError) return json({ error: error.message, code: error.code }, error.status);
      if (error instanceof SyntaxError || error instanceof URIError) return json({ error: "La demande est invalide.", code: "input" }, 400);
      return json({ error: "La bibliothèque est momentanément indisponible. Réessaie dans un instant.", code: "library_unavailable" }, 503);
    }
  };
}
