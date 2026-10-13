import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { cameraLiveConfig, cameraLiveSeekPosition } from "../../lib/camera-live";

export type VideoState = "connecting" | "playing" | "buffering" | "error";
export default function CameraVideo({ videoRef, quality, muted, zoom, attempt, onState }: {
  videoRef: RefObject<HTMLVideoElement | null>; quality: "hd" | "sd"; muted: boolean; zoom: number; attempt: number;
  onState: (state: VideoState, issue?: string) => void;
}) {
  const stateCallback = useRef(onState);
  useEffect(() => { stateCallback.current = onState; }, [onState]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let cleanup = () => {};
    let stalled: ReturnType<typeof setTimeout> | undefined;
    const emit = (state: VideoState, issue?: string) => { if (!disposed) stateCallback.current(state, issue); };
    const timeout = setTimeout(() => emit("error", "Le flux tarde à arriver. Vérifie le réseau et le mode Confidentialité dans Tapo."), 30_000);
    const playing = () => { clearTimeout(timeout); clearTimeout(stalled); emit("playing"); };
    const waiting = () => {
      emit("buffering"); clearTimeout(stalled);
      stalled = setTimeout(() => emit("error", "La vidéo a été interrompue. Relance le direct pour te reconnecter."), 20_000);
    };
    const failed = () => emit("error", "Impossible de lire le flux. Vérifie le compte caméra, le réseau et FFmpeg sur le serveur.");
    video.addEventListener("playing", playing); video.addEventListener("waiting", waiting); video.addEventListener("error", failed);
    const start = async () => {
      emit("connecting");
      const source = `/api/camera/stream/${quality}/index.m3u8`;
      const player = await import("hls.js").catch(() => null);
      if (disposed) return;
      if (!player) { clearTimeout(timeout); emit("error", "Le lecteur vidéo n’a pas pu être chargé. Recharge la page pour réessayer."); return; }
      const Hls = player.default;
      // Chromium can report native HLS support but reject the C200's DTS ordering.
      // HLS.js remuxes the stream and normalizes timestamps before browser decode.
      if (Hls.isSupported()) {
        const hls = new Hls({ ...cameraLiveConfig, fragLoadPolicy: { default: {
          ...Hls.DefaultConfig.fragLoadPolicy.default,
          maxTimeToFirstByteMs: 2000, maxLoadTimeMs: 4000,
          timeoutRetry: { maxNumRetry: 1, retryDelayMs: 250, maxRetryDelayMs: 1000 },
          errorRetry: { maxNumRetry: 2, retryDelayMs: 250, maxRetryDelayMs: 1000 },
        } } });
        let recoveries = 0;
        let recovery: ReturnType<typeof setTimeout> | undefined;
        const followLive = (force = false) => {
          if (disposed || document.hidden || video.paused || video.seeking || !hls.latestLevelDetails?.live) return;
          const target = cameraLiveSeekPosition(video.currentTime, hls.liveSyncPosition, video.buffered, force);
          if (target !== null) video.currentTime = target;
        };
        const returnLive = () => followLive(true);
        const visible = () => { if (!document.hidden) followLive(true); };
        const liveTimer = setInterval(() => followLive(), 1000);
        document.addEventListener("visibilitychange", visible);
        video.addEventListener("camera:return-live", returnLive);
        hls.on(Hls.Events.LEVEL_UPDATED, () => followLive());
        cleanup = () => {
          clearInterval(liveTimer); clearTimeout(recovery); document.removeEventListener("visibilitychange", visible);
          video.removeEventListener("camera:return-live", returnLive); hls.destroy();
        };
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || disposed) return;
          hls.stopLoad();
          // Re-read the live playlist after a lost/expired fragment instead of
          // repeatedly downloading an old segment or requiring a manual retry.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveries++ < 2) {
            emit("buffering");
            recovery = setTimeout(() => { if (!disposed) hls.loadSource(source); }, 250);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoveries++ < 2) {
            hls.recoverMediaError();
          } else failed();
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => emit("error", "La lecture automatique a été bloquée. Appuie sur Relancer le direct.")); });
        hls.loadSource(source); hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        const returnLive = () => {
          if (!video.seekable.length || video.seeking) return;
          const target = cameraLiveSeekPosition(video.currentTime, video.seekable.end(video.seekable.length - 1) - 1, video.buffered, true);
          if (target !== null) video.currentTime = target;
        };
        video.addEventListener("camera:return-live", returnLive);
        cleanup = () => video.removeEventListener("camera:return-live", returnLive);
        video.src = source; void video.play().catch(() => emit("error", "La lecture automatique a été bloquée. Appuie sur Relancer le direct."));
      } else {
        emit("error", "Ce navigateur ne prend pas en charge le direct. Utilise une version récente de Chrome, Firefox, Edge ou Safari.");
      }
    };
    void start().catch(failed);
    return () => {
      disposed = true; clearTimeout(timeout); clearTimeout(stalled); cleanup();
      video.removeEventListener("playing", playing); video.removeEventListener("waiting", waiting); video.removeEventListener("error", failed);
      video.pause(); video.removeAttribute("src"); video.load();
    };
  }, [videoRef, quality, attempt]);
  return <video ref={videoRef} className="camera-video" autoPlay playsInline muted={muted} aria-label="Flux vidéo de la caméra" style={{ transform: `scale(${zoom})` }} />;
}
