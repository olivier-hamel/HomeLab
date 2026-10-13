import { createAccountVerifier, type AccountVerifier } from "../accounts.ts";
import { BoundedCache, MediaError } from "../media/core.ts";
import { readLimited } from "../media/http.ts";
import { cameraSettings, publicCamera, type CameraSettings } from "./config.ts";
import { tapoControl, type CameraControl } from "./control.ts";
import { cameraStreams, type CameraStreams, type Quality } from "./stream.ts";

function boundary(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.slice(0, -1);
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== `${protocol}://${request.headers.get("host") || url.host}`)) throw new MediaError("origin", "Ouvre la caméra depuis HomeLab.", 403);
  if (request.method !== "GET" && (!origin || request.headers.get("x-camera-request") !== "1")) throw new MediaError("csrf", "Utilise les commandes de la caméra.", 403);
}
async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new MediaError("input", "La demande est invalide.", 400);
  const data: unknown = JSON.parse(new TextDecoder().decode(await readLimited(request, 4096)));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new MediaError("input", "La demande est invalide.", 400);
  return data as Record<string, unknown>;
}
export function createCameraApi(authenticate: AccountVerifier = createAccountVerifier(), settings: CameraSettings = cameraSettings, control: CameraControl = tapoControl, streams: CameraStreams = cameraStreams) {
  const rates = new BoundedCache<number>(256, 60_000);
  return async (request: Request) => {
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    try {
      boundary(request);
      const { user } = await authenticate(request);
      const path = new URL(request.url).pathname.replace(/^\/api\/camera\//, "");
      const config = await settings.get();
      if (request.method === "GET" && path === "status") {
        const camera = publicCamera(config);
        if (!camera.configured) return json({ ...camera, connected: false, ptz: false, presetsSupported: false, presets: [] });
        try { return json({ ...camera, ...await control.status(config) }); }
        catch (error) { return json({ ...camera, connected: false, ptz: false, presetsSupported: false, presets: [], issue: error instanceof MediaError ? error.message : "La caméra est inaccessible depuis le serveur." }); }
      }
      const asset = /^stream\/(hd|sd)\/(index\.m3u8|segment-\d{9}\.ts)$/.exec(path);
      if (request.method === "GET" && asset) {
        const bytes = await streams.asset(config, asset[1] as Quality, asset[2], request.signal);
        return new Response(bytes, { headers: { ...headers, "Content-Type": asset[2].endsWith("m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t" } });
      }
      if (request.method === "POST" && ["settings", "move", "stop", "preset"].includes(path)) {
        const count = rates.get(user.username) || 0;
        if (count >= 100) throw new MediaError("rate_limit", "Patiente un instant avant de continuer.", 429);
        rates.set(user.username, count + 1);
        const data = await body(request);
        if (path === "settings") { const saved = await settings.save(data); control.reset(); streams.reset(); return json(publicCamera(saved)); }
        if (path === "move") {
          if (typeof data.direction !== "string" || typeof data.speed !== "number") throw new MediaError("input", "Choisis une direction et une vitesse.", 400);
          await control.move(config, data.direction, data.speed);
        }
        if (path === "stop") await control.stop(config);
        if (path === "preset") {
          if (typeof data.action !== "string" || typeof data.value !== "string") throw new MediaError("input", "Choisis un point de vue valide.", 400);
          await control.preset(config, data.action, data.value);
        }
        return json({ ok: true });
      }
      throw new MediaError("not_found", "Cette action est indisponible.", 404);
    } catch (error) {
      if (error instanceof MediaError) return json({ error: error.message, code: error.code }, error.status);
      if (error instanceof SyntaxError) return json({ error: "La demande est invalide.", code: "input" }, 400);
      return json({ error: "La caméra est momentanément indisponible.", code: "camera_unavailable" }, 503);
    }
  };
}
