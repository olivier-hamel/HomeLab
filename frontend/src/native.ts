import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Preferences } from "@capacitor/preferences";

const serverKey = "homelab-server-url";
const shellKey = "homelab-shell-url";

export const isNativeApp = () => Capacitor.isNativePlatform();
export const hasNativeVideoPlayer = () => isNativeApp() && Capacitor.isPluginAvailable("NativeVideoPlayer");

type NativePlaybackResult = { position: number; duration: number; ended: boolean };
export type NativeSubtitle = { name: string; language: string; content: string };
const NativeVideoPlayer = registerPlugin<{ play(options: { url: string; title: string; position: number; subtitle?: NativeSubtitle }): Promise<NativePlaybackResult> }>("NativeVideoPlayer");

export function playNativeVideo(url: string, title: string, position = 0, subtitle?: NativeSubtitle): Promise<NativePlaybackResult> {
  return NativeVideoPlayer.play({ url, title, position: Math.max(0, position), subtitle });
}

export function normalizedServerUrl(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter an HTTP or HTTPS address without a username or password.");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.href.replace(/\/$/, "");
}

function tvUrl(server: string): string {
  const url = new URL(server);
  url.searchParams.set("tv", "1");
  return url.href;
}

export async function saveNativeServer(value: string): Promise<void> {
  const server = normalizedServerUrl(value);
  await Preferences.set({ key: serverKey, value: server });
  location.replace(tvUrl(server));
}

export async function prepareNativeApp(): Promise<"browser" | "setup" | "ready" | "redirecting"> {
  if (!isNativeApp()) return "browser";

  const localShell = location.hostname === "localhost";
  if (localShell) await Preferences.set({ key: shellKey, value: `${location.origin}/` });
  const configure = new URLSearchParams(location.search).get("configure") === "1";
  const { value } = await Preferences.get({ key: serverKey });

  if (localShell && (configure || !value)) return "setup";
  if (!value) return "setup";

  const server = normalizedServerUrl(value);
  const destination = tvUrl(server);
  if (location.origin !== new URL(server).origin || location.pathname !== new URL(server).pathname || new URLSearchParams(location.search).get("tv") !== "1") {
    location.replace(destination);
    return "redirecting";
  }
  return "ready";
}

export async function openNativeServerSetup(): Promise<void> {
  const { value } = await Preferences.get({ key: shellKey });
  location.replace(`${value ?? "http://localhost/"}?configure=1`);
}

export function installNativeLifecycle(): void {
  if (!isNativeApp()) return;
  void NativeApp.addListener("backButton", () => {
    const event = new KeyboardEvent("keydown", { key: "BrowserBack", bubbles: true, cancelable: true });
    const handled = !document.dispatchEvent(event);
    if (!handled) void NativeApp.exitApp();
  });
  void NativeApp.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) document.querySelectorAll("video").forEach(video => video.pause());
  });
}
