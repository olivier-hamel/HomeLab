import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Copy, Download, FastForward, LoaderCircle, Maximize, Pause, Play, RefreshCw, Rewind, Square, X } from "lucide-react";
import { Button } from "../ui/button";
import { bytes, mainVideo, mediaApi, preparePlayback, recordWatchHistory, savePlaybackProgress, type PreparedPlayback, type SearchIntent, type Selection, type Source, type TorrentStatus } from "../../lib/media";
import { useMediaTask } from "./useMediaTask";
import Subtitles, { type NativeSubtitleState } from "./Subtitles";
import PlaybackTimeline from "./PlaybackTimeline";
import { useTvMode } from "../../lib/tv";
import { useTvFocus } from "../useTvNavigation";
import TvDetails from "../TvDetails";
import { hasNativeVideoPlayer, isNativeApp, nativePlaybackSupport, nativePlayerStatus, onNativePlayerRequest, playNativeVideo, respondToNativePlayer } from "../../native";
import { offsetSubtitleVtt, subtitleSearch } from "../../lib/subtitles";
import { nativeSubtitleSession } from "../../lib/native-subtitles";

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
type SimplePlayback = { nativeSession?: string; qualityInfo?: string; simple?: boolean; resumeAt?: number; onFailure?: () => void; onNext?: (position?: number) => void; englishEnabled?: boolean; onEnglishChange?: (enabled: boolean) => void };

const VIDEO_CACHE_TARGET_BYTES = 5 * 1024 * 1024;

function CacheProgress({ stats }: { stats: TorrentStatus }) {
  const cached = stats.preloadBytes ?? stats.completedBytes ?? 0;
  const percent = Math.min(100, Math.max(0, cached / VIDEO_CACHE_TARGET_BYTES * 100));
  const rounded = Math.round(percent);
  return <div className="mx-auto w-full max-w-sm space-y-1" role="progressbar" aria-label="Video cache loading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rounded} aria-valuetext={`${rounded}%`}>
    <div className="flex items-center justify-between gap-3 text-xs text-neutral-400"><span>Loading video cache</span><span className="tabular-nums text-orange-300">{rounded}%</span></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-700">
      <span className="block h-full rounded-full bg-orange-500 transition-[width] duration-300" style={{ width: `${percent}%` }} />
    </div>
  </div>;
}

function QualityReview({ value }: { value: string }) {
  const [heading, details, ...review] = value.split("\n\n");
  return <div role="status" aria-label="Quality review" className="max-w-3xl space-y-1 text-center">
    <p className="text-lg font-semibold text-orange-300">{heading.replace("Gemini quality review:", "Quality review ·")}</p>
    <p className="text-xs text-neutral-400">{details}</p>
    <p className="text-xs leading-relaxed text-neutral-300">{review.join(" ")}</p>
  </div>;
}

export default function Playback({ source, search, close, simple = false, nativeSession, qualityInfo, resumeAt = 0, onFailure, onNext, englishEnabled, onEnglishChange }: { source: Source | string; search?: SearchIntent; close: () => void } & SimplePlayback) {
  const panel = useRef<HTMLElement>(null);
  useTvFocus(panel);
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const task = useMediaTask();
  const lastId = useRef<string | null>(null);
  const failed = useEffectEvent(() => onFailure?.());
  useEffect(() => {
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(75_000);
    const signal = AbortSignal.any([controller.signal, deadline]);
    void (async () => {
      try {
        let current = lastId.current ? await mediaApi<TorrentStatus>(`playback/${lastId.current}`, signal) : await mediaApi<TorrentStatus>("playback", signal, typeof source === "string" ? { magnet: source } : { sourceId: source.id });
        if (signal.aborted) return;
        lastId.current = current.id;
        setStatus(current); setError("");
        const until = Date.now() + 60_000;
        while (!current.files.length && current.state !== "unavailable" && Date.now() < until) {
          await pause(2000, signal);
          current = await mediaApi<TorrentStatus>(`playback/${current.id}`, signal);
          if (!signal.aborted) setStatus(current);
        }
        if (!current.files.length) throw new Error(current.state === "unavailable" ? "Torrent is unavailable. Choose another source or retry." : "Torrent metadata did not arrive within 60 seconds. Retry or choose another source.");
        if (simple) {
          const file = mainVideo(current.files, search);
          if (!file) throw new Error("No matching main video is available in this version.");
          const selected = await mediaApi<Selection>("select", signal, { id: current.id, fileId: file.id });
          if (!signal.aborted) setSelection(selected);
        }
      } catch (e) { if (!controller.signal.aborted) { setError(deadline.aborted ? "Torrent metadata timed out. Check the connection, then retry." : e instanceof Error ? e.message : "Torrent failed."); if (simple) failed(); } }
    })();
    return () => controller.abort();
  }, [source, retry, simple, search]);
  const videos = status?.files.filter(f => f.kind === "video") ?? [];
  if (simple) return <section ref={panel} aria-label="Playback" className="simple-playback">
    {selection ? <Player close={close} nativeSession={nativeSession} qualityInfo={qualityInfo} key={selection.id} selection={selection} initial={status!} search={search} simple resumeAt={resumeAt} onFailure={onFailure} onNext={onNext} englishEnabled={englishEnabled} onEnglishChange={onEnglishChange} /> : <div className="simple-watch-pending"><LoaderCircle className="h-10 w-10 animate-spin text-orange-400" aria-hidden="true" /><p role="status">{error ? "Trying another version…" : "Torrent found. Getting your video ready…"}</p>{qualityInfo && <QualityReview value={qualityInfo} />}<Button variant="outline" onClick={() => onNext?.()}><RefreshCw />Not working? Try another source</Button></div>}
  </section>;
  return <section ref={panel} aria-label="Playback" className="space-y-4 rounded-lg border border-orange-500/50 bg-neutral-900 p-4 sm:p-6">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="mb-2 text-xs tracking-widest text-orange-400">YOUR SELECTION</p><h2 className="break-words text-lg font-semibold text-white">{status?.title || (typeof source === "string" ? "Manual magnet" : source.title)}</h2></div><Button data-tv-back="" aria-label="Close playback" variant="ghost" size="icon" onClick={close}><X /></Button></div>
    {!selection && <p role="status" className="text-sm text-orange-400">{error ? "Failed" : status?.files.length ? "Ready — choose a video file" : "Fetching metadata…"}</p>}
    {error && <div role="alert" className="space-y-3"><p className="text-sm">{error}</p><Button variant="outline" onClick={() => { setError(""); setRetry(r => r + 1); }}>Retry metadata</Button></div>}
    {status && status.files.length > 0 && <>
      <p className="text-xs text-neutral-400">{status.files.length} files · {videos.length} video candidates. Extensions are hints; they do not establish codec compatibility.</p>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded border border-neutral-700 p-2" aria-label="Torrent files">
        {status.files.map(file => <div key={file.id} className="flex flex-col gap-2 rounded bg-neutral-950 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="break-words text-sm text-neutral-200">{file.path}</p><p className="mt-1 text-xs text-neutral-500">{bytes(file.size)} · {file.kind}{file.sample ? " · SAMPLE" : ""}</p></div>{file.kind === "video" && <Button variant="outline" className="shrink-0" disabled={task.busy} onClick={() => { void task.run(signal => mediaApi<Selection>("select", signal, { id: status.id, fileId: file.id }), setSelection, 20_000); }}>Choose {file.sample ? "sample" : "video"}</Button>}</div>)}
      </div>
      {!videos.length && <p role="alert">No recognized video files. Choose another torrent. Subtitles and other files are listed for identification only.</p>}
    </>}
    {task.busy && <p role="status">Validating file… <Button variant="ghost" onClick={task.cancel}>Cancel</Button></p>}
    {task.error && <p role="alert" className="text-sm text-orange-400">{task.error} Choose the file again to retry.</p>}
    {selection && <Player close={close} nativeSession={nativeSession} key={selection.id} selection={selection} initial={status!} search={search} />}
    <Button variant="outline" onClick={close}>{selection ? "Stop and close" : "Cancel"}</Button>
  </section>;
}

function Player({ selection, initial, search, close, simple = false, nativeSession, qualityInfo, resumeAt = 0, onFailure, onNext, englishEnabled, onEnglishChange }: { selection: Selection; initial: TorrentStatus; search?: SearchIntent; close: () => void } & SimplePlayback) {
  const tvMode = useTvMode();
  const screen = useRef<HTMLDivElement>(null);
  useTvFocus(screen);
  const video = useRef<HTMLVideoElement>(null);
  const [nativeDuration, setNativeDuration] = useState<number | null>(null);
  const [state, setState] = useState("ready");
  const [error, setError] = useState("");
  const [stats, setStats] = useState(initial);
  const [statsError, setStatsError] = useState("");
  const [buffer, setBuffer] = useState<number | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string>();
  const [prepared, setPrepared] = useState<PreparedPlayback | null>(null);
  const preparing = useRef<AbortController | null>(null);
  const starting = useRef(false);
  const autoplayStarted = useRef(false);
  const [timelineStart, setTimelineStart] = useState(0);
  const [position, setPosition] = useState(0);
  const [share, setShare] = useState<{ token: string; path: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [nativeSubtitle, setNativeSubtitle] = useState<NativeSubtitleState>(() => simple && englishEnabled ? { status: "loading" } : { status: "off" });
  const task = useMediaTask();
  const failedOnce = useRef(false);
  const historyRecorded = useRef(false);
  const initialResume = useRef(Math.max(0, resumeAt));
  const pendingDirectSeek = useRef(0);
  const latestPosition = useRef(0);
  const latestDuration = useRef<number | null>(null);
  const isResume = resumeAt > 0;
  useEffect(() => {
    if (!hasNativeVideoPlayer()) return;
    const handle = nativeSubtitleSession(selection.id, selection.file.path, initial.files, search);
    let active: AbortController | null = null;
    let disposed = false;
    const listener = onNativePlayerRequest(request => {
      if (disposed || request.playbackId !== selection.id || !request.action.startsWith("subtitle")) return;
      active?.abort();
      if (request.action === "subtitleOff") return;
      const controller = new AbortController(); active = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(request.action === "subtitleAuto" ? 100_000 : 40_000)]);
      void (async () => {
        let response: Record<string, unknown>;
        try { response = await handle(request, signal); }
        catch (error) { response = { error: error instanceof Error ? error.message : "Subtitles could not be loaded." }; }
        if (!controller.signal.aborted && !disposed) {
          await respondToNativePlayer({ ...response, playbackId: selection.id, requestId: request.requestId }).catch(() => {});
        }
      })();
    });
    return () => { disposed = true; active?.abort(); void listener.then(handle => handle.remove()).catch(() => {}); };
  }, [selection.id, selection.file.path, initial.files, search]);
  const persistNow = () => {
    if (search && latestDuration.current) void savePlaybackProgress(search, latestPosition.current, latestDuration.current).catch(() => {});
  };
  const persist = useEffectEvent(persistNow);
  const recordHistory = () => {
    if (!search || historyRecorded.current) return;
    historyRecorded.current = true;
    void recordWatchHistory(selection.id, search).catch(() => { historyRecorded.current = false; });
  };
  const fail = useEffectEvent(() => {
    if (!simple || failedOnce.current) return;
    failedOnce.current = true;
    onFailure?.();
  });
  useEffect(() => {
    const element = video.current;
    return () => { persist(); preparing.current?.abort(); if (element) { element.pause(); element.removeAttribute("src"); element.load(); } };
  }, []);
  useEffect(() => {
    if (state !== "playing") return;
    const timer = window.setInterval(persist, 60_000);
    const visibility = () => { if (document.visibilityState === "hidden") persist(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [state]);
  useEffect(() => {
    if (state !== "buffering") return;
    const timer = setTimeout(() => { video.current?.pause(); video.current?.removeAttribute("src"); video.current?.load(); setState("stalled"); setError("No playable data arrived for 90 seconds. Retry, choose another source, or use an external player."); setPlaybackUrl(undefined); fail(); }, 90_000);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (state !== "playing" && state !== "buffering" && state !== "checking format") return;
    const controller = new AbortController();
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          await pause(state === "playing" ? 3000 : 1000, controller.signal);
          const result = await mediaApi<TorrentStatus>(`playback/${selection.id}`, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
          if (!controller.signal.aborted) { setStats(result); setStatsError(""); }
        }
      } catch { if (!controller.signal.aborted) setStatsError("Live statistics unavailable. Monitoring resumes on the next playback attempt."); }
    })();
    return () => controller.abort();
  }, [state, selection.id]);
  const start = async (at?: number) => {
    const element = video.current;
    if (!element || starting.current) return;
    if (hasNativeVideoPlayer() && nativeSubtitle.status === "loading") { setNotice("Waiting for subtitles to finish loadingâ€¦"); return; }
    preparing.current?.abort();
    starting.current = true;
    const controller = new AbortController(); preparing.current = controller;
    setError(""); setState(prepared ? "buffering" : "checking format");
    try {
      let plan = prepared ?? await preparePlayback(selection.id, AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]), mime => element.canPlayType(mime), isNativeApp() ? "android-tv" : "browser", hasNativeVideoPlayer() ? nativePlaybackSupport : undefined);
      if (controller.signal.aborted) return;
      setPrepared(plan); setState("buffering");
      let target = at ?? (!element.getAttribute("src") || element.error ? initialResume.current : 0);
      if (at !== undefined || !element.getAttribute("src") || element.error) {
        const offset = plan.mode === "direct" ? 0 : target;
        const url = offset ? `${plan.stream}?start=${offset}` : plan.stream;
        setTimelineStart(offset); setPosition(target); latestPosition.current = target; setPlaybackUrl(url);
        pendingDirectSeek.current = plan.mode === "direct" ? target : 0;
        if (hasNativeVideoPlayer()) {
          // A codec can still fail at runtime despite vendor capability claims.
          // Retry that case once with H.264, retaining the position and subtitle clock.
          for (let attempt = 0; attempt < 2; attempt++) {
            const nativeOffset = plan.mode === "direct" ? 0 : target;
            const nativeUrl = nativeOffset ? `${plan.stream}?start=${nativeOffset}` : plan.stream;
            setState("playing"); recordHistory();
            const subtitle = nativeSubtitle.status === "ready" ? { ...nativeSubtitle.subtitle, content: offsetSubtitleVtt(nativeSubtitle.subtitle.content, nativeSubtitle.subtitle.offset - nativeOffset) } : undefined;
            const result = await playNativeVideo(new URL(nativeUrl, window.location.href).href, selection.file.path, plan.mode === "direct" ? target : 0, subtitle, {
              playbackId: selection.id, timelineOffset: nativeOffset, searchQuery: subtitleSearch(selection.file.path, search).query,
              sessionId: nativeSession ?? selection.id, allowNext: !!onNext, qualityInfo,
            });
            if (controller.signal.aborted) return;
            latestPosition.current = nativeOffset + (result.ended && result.duration > 0 ? result.duration : result.position);
            latestDuration.current = plan.duration ?? (result.duration > 0 ? nativeOffset + result.duration : null);
            initialResume.current = result.ended ? 0 : latestPosition.current;
            setPosition(latestPosition.current); persistNow();
            if (result.action === "next") { onNext?.(latestPosition.current); return; }
            if (result.action === "close") { close(); return; }
            if (!result.error) { setState("ready"); return; }
            if (attempt === 0 && plan.video === "copy" && result.errorCode && result.errorCode >= 4001 && result.errorCode <= 4005) {
              target = Math.max(target, latestPosition.current);
              setState("checking format");
              plan = await preparePlayback(selection.id, AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]), mime => element.canPlayType(mime), "android-tv", inspection => nativePlaybackSupport({
                ...inspection,
                options: inspection.options.filter(option => option.container === "mp4" && option.video === "h264" && ["aac", "none"].includes(option.audio)),
              }));
              if (controller.signal.aborted) return;
              setPrepared(plan);
              continue;
            }
            throw new Error(result.error);
          }
          return;
        }
        element.src = url; element.load();
      }
      await element.play();
    } catch (e) {
      if (!controller.signal.aborted) {
        const blocked = e instanceof Error && e.name === "NotAllowedError";
        if (hasNativeVideoPlayer()) void nativePlayerStatus(e instanceof Error ? e.message : "This source could not play. Try another source.", true);
        setState(blocked ? "ready" : "failed");
        setError(blocked ? "Ready to watch. Press Play to start." : simple && isResume ? "Resume couldn't start. Retry playback or choose another source." : simple ? "This version couldn't play. Trying another…" : e instanceof Error ? e.message : "Playback could not start. Retry or use an external player.");
        if (!blocked && simple && !isResume && !failedOnce.current) { failedOnce.current = true; onFailure?.(); }
      }
    } finally { starting.current = false; }
  };
  const autoplay = useEffectEvent(() => {
    if (autoplayStarted.current) return;
    autoplayStarted.current = true;
    void start();
  });
  // Native autoplay must wait until the asynchronous subtitle selection settles.
  useEffect(() => { if (simple && nativeSubtitle.status !== "loading") autoplay(); }, [simple, nativeSubtitle.status]);
  const updateBuffer = () => {
    const element = video.current;
    if (!element) return;
    let ahead = 0;
    for (let i = 0; i < element.buffered.length; i++) if (element.buffered.start(i) <= element.currentTime && element.buffered.end(i) >= element.currentTime) ahead = element.buffered.end(i) - element.currentTime;
    setBuffer(ahead);
    const absolute = timelineStart + element.currentTime;
    latestPosition.current = absolute;
    setPosition(absolute);
  };
  const seek = (target: number) => {
    const element = video.current;
    if (!element || !prepared) return;
    if (prepared.mode === "direct") { element.currentTime = target; setPosition(target); return; }
    const localTime = target - timelineStart;
    // Reuse downloaded data when possible; otherwise request a stream at the target.
    for (let i = 0; i < element.buffered.length; i++) {
      if (localTime >= element.buffered.start(i) && localTime < element.buffered.end(i)) {
        element.currentTime = localTime;
        setPosition(target);
        return;
      }
    }
    void start(target);
  };
  const duration = prepared?.duration ?? (prepared?.mode === "direct" ? nativeDuration : null);
  useEffect(() => { latestDuration.current = duration; }, [duration]);
  const skip = (delta: number) => {
    if (duration && Number.isFinite(duration)) seek(Math.min(Math.max(0, duration - 1), Math.max(0, position + delta)));
  };
  const remotePlayback = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]")) return;
    if (document.activeElement?.matches("input, select, textarea, [contenteditable='true']")) return;
    const key = ({ 179: "MediaPlayPause", 227: "MediaRewind", 228: "MediaFastForward" } as Record<number, string>)[event.keyCode] ?? event.key;
    if (!["MediaPlayPause", "MediaPlay", "MediaPause", "MediaRewind", "MediaFastForward"].includes(key)) return;
    event.preventDefault();
    if (key === "MediaRewind") skip(-10);
    else if (key === "MediaFastForward") skip(10);
    else if (key === "MediaPause" || (key === "MediaPlayPause" && !video.current?.paused)) video.current?.pause();
    else if (state !== "checking format") void start();
  });
  useEffect(() => {
    if (!tvMode) return;
    const handle = (event: KeyboardEvent) => remotePlayback(event);
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [tvMode]);
  const fullscreen = () => {
    // TV viewers still need the large remote-friendly playback controls while
    // fullscreen; desktop browsers can use their native video controls.
    const target = tvMode ? screen.current : video.current;
    if (document.fullscreenElement === target) { void document.exitFullscreen().catch(() => setNotice("Use Back to leave fullscreen.")); return; }
    void target?.requestFullscreen().catch(() => setNotice("Use the native player fullscreen control on this device."));
  };
  const shareUrl = share ? new URL(share.path, window.location.origin).href : "";
  const cacheProgress = state === "checking format" || state === "buffering" ? <CacheProgress stats={stats} /> : null;
  const playerControls = <>
    <video ref={video} controls playsInline preload="none" aria-label="Selected video" className="aspect-video w-full rounded bg-black"
      onLoadedMetadata={() => { const element = video.current; if (element && pendingDirectSeek.current) { element.currentTime = Math.min(pendingDirectSeek.current, Math.max(0, element.duration - 1)); pendingDirectSeek.current = 0; } }}
      onDurationChange={() => { const value = video.current?.duration; if (value && Number.isFinite(value)) { setNativeDuration(value); latestDuration.current = prepared?.duration ?? value; } }}
      onPlaying={() => { initialResume.current = 0; setState("playing"); setError(""); recordHistory(); }} onWaiting={() => setState("buffering")} onStalled={() => setState("buffering")} onSeeking={() => setState("buffering")} onCanPlay={() => setState(s => s === "playing" ? s : "ready")} onPause={() => { setState(s => s === "stalled" || s === "failed" ? s : "ready"); persistNow(); }} onEnded={() => { if (latestDuration.current) latestPosition.current = latestDuration.current; persistNow(); setState("ready"); }} onProgress={updateBuffer} onTimeUpdate={updateBuffer}
      onError={() => { if (!playbackUrl) return; setState("failed"); setError(simple && isResume ? "Resume couldn't start. Retry playback or choose another source." : simple ? "This version couldn't play. Trying another…" : "Playback was interrupted or the browser could not decode the prepared stream. Retry, choose another file, or use an external player."); if (simple && !isResume && !failedOnce.current) { failedOnce.current = true; onFailure?.(); } }} />
    {cacheProgress}
    {prepared && (tvMode || prepared.mode !== "direct") && duration !== null && Number.isFinite(duration) && duration > 0 && <PlaybackTimeline duration={duration} position={position} onSeek={seek} />}
    <div className="tv-playback-controls flex flex-wrap items-center gap-3"><span role="status" className="mr-auto text-sm capitalize text-orange-400">{simple && state === "checking format" ? "Loading media... This can take a few seconds." : state}</span>
      {(tvMode || simple) && <Button variant="outline" disabled={!prepared || !duration || state === "checking format"} aria-label="Rewind 10 seconds" onClick={() => skip(-10)}><Rewind />10 s</Button>}
      <Button data-tv-initial-focus="" disabled={state === "checking format"} onClick={() => { if ((tvMode || simple) && state === "playing") video.current?.pause(); else void start(); }} className="bg-orange-600 text-white hover:bg-orange-700">{(tvMode || simple) && state === "playing" ? <Pause /> : <Play />}{state === "failed" || state === "stalled" ? "Retry playback" : (tvMode || simple) && state === "playing" ? "Pause" : "Play"}</Button>
      {(tvMode || simple) && <Button variant="outline" disabled={!prepared || !duration || state === "checking format"} aria-label="Forward 10 seconds" onClick={() => skip(10)}><FastForward />10 s</Button>}
      {!simple && <Button variant="outline" onClick={() => { preparing.current?.abort(); video.current?.pause(); video.current?.removeAttribute("src"); video.current?.load(); setPlaybackUrl(undefined); setState("ready"); setBuffer(null); setNotice("Playback stopped."); }}><Square />Stop</Button>}
      {document.fullscreenEnabled && <Button variant="outline" aria-label={tvMode ? "Toggle fullscreen video" : "Fullscreen video"} onClick={fullscreen}><Maximize />{tvMode && "Fullscreen"}</Button>}
    </div>
  </>;
  if (simple && hasNativeVideoPlayer()) return <div ref={screen} className="simple-player-screen">
    <div hidden>{playerControls}</div>
    <div className="simple-watch-pending">
      <LoaderCircle className="h-10 w-10 animate-spin text-orange-400" aria-hidden="true" />
      <p role="status">{error || (state === "playing" ? "Playing in the fullscreen player" : "Getting your video ready…")}</p>
      {cacheProgress}
      <Button variant="ghost" onClick={close}>Cancel</Button>
    </div>
  </div>;
  if (simple) return <div ref={screen} className="simple-player-screen space-y-4">
    {playerControls}
    {error && <p role="status" className="text-sm text-orange-300">{error}</p>}
    {qualityInfo && <QualityReview value={qualityInfo} />}
    <div className="simple-player-options">
      <Subtitles video={video} playbackId={selection.id} files={stats.files} filename={selection.file.path} search={search} timelineStart={timelineStart} simple englishEnabled={englishEnabled} onEnglishChange={onEnglishChange} onNativeSubtitleChange={setNativeSubtitle} />
      <div className="space-y-2"><Button variant="outline" onClick={() => onNext?.()}><RefreshCw />Try another source</Button><p className="text-xs text-neutral-400">Playback not working?</p></div>
    </div>
    {notice && <p role="status" className="text-sm text-neutral-300">{notice}</p>}
  </div>;
  return <div className="space-y-4 border-t border-neutral-700 pt-5">
    <h3 className="break-words text-sm text-white">{selection.file.path}</h3>
    {tvMode ? <div ref={screen} className="tv-player-screen space-y-4">{playerControls}</div> : playerControls}
    {prepared && <p className="text-xs text-neutral-400">{prepared.mode === "direct" ? "Direct play" : prepared.mode === "remux" ? "Remuxing · original video and audio" : `Converting ${prepared.video === "copy" ? "audio" : prepared.audio === "copy" || prepared.audio === "none" ? "video" : "video and audio"}`}</p>}
    {error && <p role="alert" className="text-sm text-orange-400">{error}</p>}
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-400"><span>Download: {stats.downloadSpeed === null ? "Unknown" : `${bytes(stats.downloadSpeed)}/s`}</span><span>Connected peers: {stats.connectedPeers ?? "Unknown"}</span><span>Received torrent data: {bytes(stats.downloadedBytes)}</span>{buffer !== null && <span>Browser buffer ahead: {buffer.toFixed(1)} s</span>}</div>
    {stats.preloadBytes !== null && stats.preloadTarget !== null && stats.preloadTarget > 0 && <p className="text-xs text-neutral-500">TorrServer torrent-wide preload: {bytes(stats.preloadBytes)} / {bytes(stats.preloadTarget)}. This may include another viewer’s buffer.</p>}
    {statsError && <p className="text-xs text-orange-400">{statsError}</p>}
    <p className="text-xs leading-relaxed text-neutral-400">Playback checks this browser’s format support and preserves compatible video and audio. External players receive the original file.</p>
    <Subtitles video={video} playbackId={selection.id} files={stats.files} filename={selection.file.path} search={search} timelineStart={timelineStart} onNativeSubtitleChange={setNativeSubtitle} />
    <TvDetails className="rounded border border-neutral-700 p-4"><summary className="cursor-pointer text-sm">External player · VLC / M3U</summary><div className="mt-4 space-y-3">
      <p className="text-xs leading-relaxed text-neutral-400">Create a link valid for 15 minutes, scoped to this file. The player must reach this dashboard on your LAN/tailnet. The link works without browser cookies; anyone who has it and network access can use it until expiry or revocation. A separate login proxy may still block VLC.</p>
      <Button variant="outline" disabled={task.busy || !!share} onClick={() => { void task.run(s => mediaApi<NonNullable<typeof share>>("share", s, { id: selection.id }), setShare, 15_000); }}>Create player link</Button>
      {share && <><label className="block text-xs text-neutral-400">Stream link<input readOnly value={shareUrl} onFocus={e => e.target.select()} className="mt-2 h-10 w-full rounded border border-neutral-600 bg-neutral-950 px-3 text-sm text-white" /></label><p className="text-xs text-neutral-500">Expires {new Date(share.expiresAt).toLocaleTimeString()}; long playback needs a new link after expiry.</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(shareUrl).then(() => setNotice("Stream link copied.")).catch(() => setNotice("Select and copy the link field manually.")); else setNotice("Select and copy the link field manually."); }}><Copy />Copy link</Button><Button variant="outline" onClick={() => { const objectUrl = URL.createObjectURL(new Blob([`#EXTM3U\n#EXTINF:-1,HomeLab video\n${shareUrl}\n`], { type: "audio/x-mpegurl" })); const a = document.createElement("a"); a.href = objectUrl; a.download = "homelab-video.m3u"; a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }}><Download />Download M3U</Button><Button variant="outline" disabled={task.busy} onClick={() => { void task.run(s => mediaApi("revoke", s, { token: share.token }), () => { setShare(null); setNotice("Player link revoked."); }); }}>Revoke link</Button></div></>}
      {task.error && <p role="alert" className="text-sm text-orange-400">{task.error}</p>}
    </div></TvDetails>
    {notice && <p role="status" className="text-xs text-neutral-300">{notice}</p>}
  </div>;
}
