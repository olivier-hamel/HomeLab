import { Cam } from "onvif";
import { cameraHost, type CameraConfig } from "./config.ts";
import { MediaError } from "../media/core.ts";

export type Preset = { token: string; name: string };
export const validPreset = (token: unknown): token is string => typeof token === "string" && /^[\w.-]{1,128}$/.test(token);
type CameraFactory = (config: CameraConfig, callback: (error: Error | null) => void) => Cam;
const connectCamera: CameraFactory = (config, callback) => new Cam({ hostname: cameraHost(), port: 2020, username: config.username, password: config.password, timeout: 5000, preserveAddress: true }, callback);
export interface CameraControl {
  status(config: CameraConfig): Promise<{ connected: boolean; ptz: boolean; presetsSupported: boolean; presets: Preset[] }>;
  move(config: CameraConfig, direction: string, speed: number): Promise<void>;
  stop(config: CameraConfig): Promise<void>;
  preset(config: CameraConfig, action: string, value: string): Promise<void>;
  reset(): void;
}
export class TapoControl implements CameraControl {
  private connection?: Promise<Cam>;
  private factory: CameraFactory;
  constructor(factory = connectCamera) { this.factory = factory; }
  reset() { this.connection = undefined; }
  private async camera(config: CameraConfig) {
    if (!config.username || !config.password) throw new MediaError("camera_setup", "Ajoute le compte caméra dans les paramètres pour commencer.", 409);
    this.connection ??= new Promise<Cam>((resolve, reject) => {
      const cam = this.factory(config, error => error ? reject(error) : resolve(cam));
      cam.on("error", () => this.reset());
    });
    try { return await this.connection; }
    catch { this.reset(); throw new MediaError("camera_offline", "Connexion impossible. Vérifie le compte caméra, le réseau et le mode Confidentialité dans Tapo.", 503); }
  }
  private async call<T>(config: CameraConfig, invoke: (cam: Cam, done: (error: Error | null, value: T) => void) => void): Promise<T> {
    const cam = await this.camera(config);
    return new Promise<T>((resolve, reject) => invoke(cam, (error, value) => {
      if (error) { this.reset(); reject(new MediaError("camera_control", "La caméra n’a pas accepté cette commande. Vérifie la connexion ou la compatibilité de son firmware.", 502)); }
      else resolve(value);
    }));
  }
  async status(config: CameraConfig) {
    const cam = await this.camera(config);
    await this.call(config, (c, done) => c.getDeviceInformation(done));
    let presetsSupported = true, presets: Preset[] = [];
    try {
      const values = await this.call<Record<string, { name?: string }>>(config, (c, done) => c.getPresets({}, done));
      presets = Object.entries(values || {}).filter(([token]) => validPreset(token)).map(([token, preset]) => ({ token, name: String(preset.name || "Point de vue").slice(0, 48) }));
    } catch { presetsSupported = false; }
    return { connected: true, ptz: !!cam.activeSource?.ptz, presetsSupported, presets };
  }
  async move(config: CameraConfig, direction: string, speed: number) {
    const vectors: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] };
    const vector = vectors[direction];
    if (!vector || ![0.25, 0.5, 0.8].includes(speed)) throw new MediaError("input", "Choisis une direction et une vitesse valides.", 400);
    // The camera itself limits each movement, even if the browser disconnects.
    await this.call(config, (cam, done) => cam.continuousMove({ x: vector[0] * speed, y: vector[1] * speed, timeout: 350 }, done));
  }
  async stop(config: CameraConfig) { await this.call(config, (cam, done) => cam.stop({ panTilt: true, zoom: false }, done)); }
  async preset(config: CameraConfig, action: string, value: string) {
    if (action === "save") {
      if (!/^[\p{L}\p{N} ._-]{1,32}$/u.test(value)) throw new MediaError("input", "Utilise 1 à 32 lettres, chiffres, espaces, points ou tirets.", 400);
      await this.call(config, (cam, done) => cam.setPreset({ presetName: value }, done));
    } else {
      if (!validPreset(value)) throw new MediaError("input", "Ce point de vue est invalide.", 400);
      if (action === "go") await this.call(config, (cam, done) => cam.gotoPreset({ preset: value }, done));
      else if (action === "remove") await this.call(config, (cam, done) => cam.removePreset({ presetToken: value }, done));
      else throw new MediaError("input", "Cette commande est invalide.", 400);
    }
  }
}
export const tapoControl = new TapoControl();
