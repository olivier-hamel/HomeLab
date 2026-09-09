import { useEffect, useRef, useState } from "react";
import { Copy, Download, Maximize, Play, Square, X } from "lucide-react";
import { Button } from "../ui/button";
import { bytes, mediaApi, type SearchIntent, type Selection, type Source, type TorrentStatus } from "../../lib/media";
import { useMediaTask } from "./useMediaTask";
import Subtitles from "./Subtitles";

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
export default function Playback({ source, search, close }: { source: Source | string; search?: SearchIntent; close: () => void }) {
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const task = useMediaTask();
  const lastId = useRef<string | null>(null);
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
      } catch (e) { if (!controller.signal.aborted) setError(deadline.aborted ? "Torrent metadata timed out. Check the connection, then retry." : e instanceof Error ? e.message : "Torrent failed."); }
    })();
    return () => controller.abort();
  }, [source, retry]);
  const videos = status?.files.filter(f => f.kind === "video") ?? [];
  return <section aria-label="Playback" className="space-y-4 rounded-lg border border-orange-500/50 bg-neutral-900 p-4 sm:p-6">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="mb-2 text-xs tracking-widest text-orange-400">YOUR SELECTION</p><h2 className="break-words text-lg font-semibold text-white">{status?.title || (typeof source === "string" ? "Manual magnet" : source.title)}</h2></div><Button aria-label="Close playback" variant="ghost" size="icon" onClick={close}><X /></Button></div>
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
    {selection && <Player key={selection.id} selection={selection} initial={status!} search={search} />}
    <Button variant="outline" onClick={close}>{selection ? "Stop and close" : "Cancel"}</Button>
    <p className="text-xs text-neutral-500">Closing stops this browser’s requests. Shared torrents are retained and follow TorrServer’s existing cache policy.</p>
  </section>;
}

function Player({ selection, initial, search }: { selection: Selection; initial: TorrentStatus; search?: SearchIntent }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState("ready");
  const [error, setError] = useState("");
  const [stats, setStats] = useState(initial);
  const [statsError, setStatsError] = useState("");
  const [buffer, setBuffer] = useState<number | null>(null);
  const [attached, setAttached] = useState(true);
  const [share, setShare] = useState<{ token: string; path: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState("");
  const task = useMediaTask();
  useEffect(() => {
    const element = video.current;
    return () => { if (element) { element.pause(); element.removeAttribute("src"); element.load(); } };
  }, []);
  useEffect(() => {
    if (state !== "buffering") return;
    const timer = setTimeout(() => { setState("stalled"); setError("No playable data arrived for 30 seconds. Retry, choose another source, or use an external player."); setAttached(false); }, 60_000);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (state !== "playing" && state !== "buffering") return;
    const controller = new AbortController();
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          await pause(3000, controller.signal);
          const result = await mediaApi<TorrentStatus>(`playback/${selection.id}`, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
          if (!controller.signal.aborted) { setStats(result); setStatsError(""); }
        }
      } catch { if (!controller.signal.aborted) setStatsError("Live statistics unavailable. Monitoring resumes on the next playback attempt."); }
    })();
    return () => controller.abort();
  }, [state, selection.id]);
  const start = () => {
    const element = video.current;
    if (!element) return;
    setError(""); setState("buffering"); setAttached(true);
    if (!element.getAttribute("src")) { element.src = selection.stream; element.load(); }
    void element.play().catch(() => { setState("failed"); setError("This browser could not start the stream. Try the native controls or an external player."); });
  };
  const updateBuffer = () => {
    const element = video.current;
    if (!element) return;
    let ahead = 0;
    for (let i = 0; i < element.buffered.length; i++) if (element.buffered.start(i) <= element.currentTime && element.buffered.end(i) >= element.currentTime) ahead = element.buffered.end(i) - element.currentTime;
    setBuffer(ahead);
  };
  const shareUrl = share ? new URL(share.path, window.location.origin).href : "";
  return <div className="space-y-4 border-t border-neutral-700 pt-5">
    <h3 className="break-words text-sm text-white">{selection.file.path}</h3>
    <video ref={video} src={attached ? selection.stream : undefined} controls playsInline preload="none" aria-label="Selected video" className="aspect-video w-full rounded bg-black"
      onPlaying={() => { setState("playing"); setError(""); }} onWaiting={() => setState("buffering")} onStalled={() => setState("buffering")} onSeeking={() => setState("buffering")} onCanPlay={() => setState(s => s === "playing" ? s : "ready")} onPause={() => setState(s => s === "stalled" || s === "failed" ? s : "ready")} onEnded={() => setState("ready")} onProgress={updateBuffer} onTimeUpdate={updateBuffer}
      onError={() => { if (!attached) return; setState("failed"); setError("Unsupported format or interrupted stream. MKV/HEVC/DTS may fail or have no audio. Try another file or an external player."); }} />
    <div className="flex flex-wrap items-center gap-3"><span role="status" className="mr-auto text-sm capitalize text-orange-400">{state}</span><Button onClick={start} className="bg-orange-600 text-white hover:bg-orange-700"><Play />{state === "failed" || state === "stalled" ? "Retry playback" : "Play"}</Button><Button variant="outline" onClick={() => { video.current?.pause(); setAttached(false); setState("ready"); setBuffer(null); setNotice("Playback stopped."); }}><Square />Stop</Button>{document.fullscreenEnabled && <Button variant="outline" aria-label="Fullscreen video" onClick={() => { void video.current?.requestFullscreen().catch(() => setNotice("Use the native player fullscreen control on this device.")); }}><Maximize /></Button>}</div>
    {error && <p role="alert" className="text-sm text-orange-400">{error}</p>}
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-400"><span>Download: {stats.downloadSpeed === null ? "Unknown" : `${bytes(stats.downloadSpeed)}/s`}</span><span>Connected peers: {stats.connectedPeers ?? "Unknown"}</span><span>Received torrent data: {bytes(stats.downloadedBytes)}</span>{buffer !== null && <span>Browser buffer ahead: {buffer.toFixed(1)} s</span>}</div>
    {stats.preloadBytes !== null && stats.preloadTarget !== null && stats.preloadTarget > 0 && <p className="text-xs text-neutral-500">TorrServer torrent-wide preload: {bytes(stats.preloadBytes)} / {bytes(stats.preloadTarget)}. This may include another viewer’s buffer.</p>}
    {statsError && <p className="text-xs text-orange-400">{statsError}</p>}
    <p className="text-xs leading-relaxed text-neutral-400">No transcoding. H.264/AAC MP4 is a useful target; compatibility depends on the actual codecs and your browser. If video has no audio, try the external-player option.</p>
    <Subtitles video={video} playbackId={selection.id} files={stats.files} filename={selection.file.path} search={search} />
    <details className="rounded border border-neutral-700 p-4"><summary className="cursor-pointer text-sm">External player · VLC / M3U</summary><div className="mt-4 space-y-3">
      <p className="text-xs leading-relaxed text-neutral-400">Create a link valid for 15 minutes, scoped to this file. The player must reach this dashboard on your LAN/tailnet. The link works without browser cookies; anyone who has it and network access can use it until expiry or revocation. A separate login proxy may still block VLC.</p>
      <Button variant="outline" disabled={task.busy || !!share} onClick={() => { void task.run(s => mediaApi<NonNullable<typeof share>>("share", s, { id: selection.id }), setShare, 15_000); }}>Create player link</Button>
      {share && <><label className="block text-xs text-neutral-400">Stream link<input readOnly value={shareUrl} onFocus={e => e.target.select()} className="mt-2 h-10 w-full rounded border border-neutral-600 bg-neutral-950 px-3 text-sm text-white" /></label><p className="text-xs text-neutral-500">Expires {new Date(share.expiresAt).toLocaleTimeString()}; long playback needs a new link after expiry.</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(shareUrl).then(() => setNotice("Stream link copied.")).catch(() => setNotice("Select and copy the link field manually.")); else setNotice("Select and copy the link field manually."); }}><Copy />Copy link</Button><Button variant="outline" onClick={() => { const objectUrl = URL.createObjectURL(new Blob([`#EXTM3U\n#EXTINF:-1,HomeLab video\n${shareUrl}\n`], { type: "audio/x-mpegurl" })); const a = document.createElement("a"); a.href = objectUrl; a.download = "homelab-video.m3u"; a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }}><Download />Download M3U</Button><Button variant="outline" disabled={task.busy} onClick={() => { void task.run(s => mediaApi("revoke", s, { token: share.token }), () => { setShare(null); setNotice("Player link revoked."); }); }}>Revoke link</Button></div></>}
      {task.error && <p role="alert" className="text-sm text-orange-400">{task.error}</p>}
    </div></details>
    {notice && <p role="status" className="text-xs text-neutral-300">{notice}</p>}
  </div>;
}
