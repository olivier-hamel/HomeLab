declare module "onvif" {
  type Callback<T = unknown> = (error: Error | null, data: T) => void;
  export class Cam {
    constructor(options: { hostname: string; port: number; username: string; password: string; timeout: number; preserveAddress: boolean }, callback: (error: Error | null) => void);
    on(event: "error", callback: () => void): this;
    activeSource?: { ptz?: boolean };
    getDeviceInformation(callback: Callback): void;
    getPresets(options: Record<string, never>, callback: Callback<Record<string, { name?: string }>>): void;
    continuousMove(options: { x: number; y: number; timeout: number }, callback: Callback): void;
    stop(options: { panTilt: boolean; zoom: boolean }, callback: Callback): void;
    gotoPreset(options: { preset: string }, callback: Callback): void;
    setPreset(options: { presetName: string }, callback: Callback<string>): void;
    removePreset(options: { presetToken: string }, callback: Callback): void;
  }
}
