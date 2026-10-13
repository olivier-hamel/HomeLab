export type CameraStatus = {
  name: string; model: string; configured: boolean; connected: boolean; ptz: boolean;
  credentialsFromEnv: boolean; presetsSupported: boolean;
  network: { host: string; mask: string; gateway: string; dns: string };
  presets: { token: string; name: string }[]; issue?: string;
};
export const initialCamera: CameraStatus = {
  name: "Caméra maison", model: "Tapo C200", configured: false, connected: false, ptz: false, credentialsFromEnv: false,
  network: { host: "192.168.0.188", mask: "255.255.255.0", gateway: "192.168.0.1", dns: "192.168.0.202" },
  presetsSupported: false, presets: [],
};
export async function cameraRequest<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/camera/${path}`, {
    credentials: "same-origin", cache: "no-store", signal,
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Camera-Request": "1" }, body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error || "La connexion à la caméra est indisponible.");
  return value as T;
}
export function captureFrame(video: HTMLVideoElement) {
  if (video.readyState < 2 || !video.videoWidth) throw new Error("Attends l’arrivée de la vidéo pour prendre une capture.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("La capture est indisponible dans ce navigateur.");
  context.drawImage(video, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}
