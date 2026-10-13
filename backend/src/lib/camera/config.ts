import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { MediaError } from "../media/core.ts";

export type CameraConfig = { name: string; username: string; password: string };
export const cameraNetwork = () => ({
  host: process.env.TAPO_HOST || "192.168.0.188",
  mask: process.env.TAPO_MASK || "255.255.255.0",
  gateway: process.env.TAPO_GATEWAY || "192.168.0.1",
  dns: process.env.TAPO_DNS || "192.168.0.202",
});
export function cameraHost() {
  const host = cameraNetwork().host;
  if (isIP(host) !== 4 || !/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    throw new MediaError("camera_config", "TAPO_HOST doit être une adresse IPv4 privée du réseau local.", 503);
  }
  return host;
}
export class CameraSettings {
  private directory: string;
  private pending = Promise.resolve();
  constructor(directory = process.env.CAMERA_STORAGE_PATH || resolve(process.cwd(), "../.local-data/camera")) { this.directory = directory; }
  async get(): Promise<CameraConfig> {
    let saved: Partial<CameraConfig> = {};
    try { saved = JSON.parse(await readFile(join(this.directory, "account.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new MediaError("camera_storage", "Impossible de lire la configuration de la caméra.", 503); }
    return { name: process.env.TAPO_NAME || saved.name || "Caméra maison", username: process.env.TAPO_USERNAME || saved.username || "", password: process.env.TAPO_PASSWORD || saved.password || "" };
  }
  async save(input: Record<string, unknown>) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 48) throw new MediaError("input", "Choisis un nom de 1 à 48 caractères.", 400);
    if ((input.username !== undefined || input.password !== undefined) && (process.env.TAPO_USERNAME || process.env.TAPO_PASSWORD)) throw new MediaError("camera_env", "Les identifiants sont définis dans backend/.env. Modifie-les sur le serveur.", 409);
    if ((input.username === undefined) !== (input.password === undefined)) throw new MediaError("input", "Renseigne les deux identifiants du compte caméra.", 400);
    for (const key of ["username", "password"] as const) {
      const value = input[key];
      if (value !== undefined && (typeof value !== "string" || !value || value.length > 128 || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) throw new MediaError("input", "Renseigne les deux identifiants du compte caméra.", 400);
    }
    const operation = this.pending.then(async () => {
      const previous = await this.get();
      const value = { ...previous, name: (input.name as string).trim(), ...(input.username !== undefined ? { username: input.username as string, password: input.password as string } : {}) };
      if (!value.username || !value.password) throw new MediaError("input", "Renseigne les deux identifiants du compte caméra.", 400);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const temporary = join(this.directory, `.${randomUUID()}.json`);
      // Environment credentials are never copied into the settings file.
      await writeFile(temporary, JSON.stringify({ name: value.name, username: process.env.TAPO_USERNAME ? "" : value.username, password: process.env.TAPO_PASSWORD ? "" : value.password }), { mode: 0o600 });
      await rename(temporary, join(this.directory, "account.json"));
      return value;
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }
}
export function publicCamera(config: CameraConfig) {
  return { name: config.name, model: "Tapo C200", network: cameraNetwork(), configured: !!(config.username && config.password), credentialsFromEnv: !!(process.env.TAPO_USERNAME || process.env.TAPO_PASSWORD) };
}
export const cameraSettings = new CameraSettings();
