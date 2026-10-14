import { useEffect, useEffectEvent, useId, useRef, useState, type RefObject } from "react";
import { Captions, Check, ChevronDown, LoaderCircle, Search, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { type SearchIntent, type TorrentFile } from "../../lib/media";
import { MAX_SUBTITLE_BYTES, subtitleFormat, subtitleTiming, subtitleVtt } from "../../lib/subtitles";
import { loadEnglishSubtitles } from "../../lib/automatic-subtitles";
import OnlineSubtitles from "./OnlineSubtitles";
import Switch from "../ui/switch";
import SubtitleTimingControls from "./SubtitleTimingControls";

type Subtitle = { key: string; name: string; content: string };
export type NativeSubtitleState = { status: "off" | "loading" } | { status: "ready"; subtitle: { name: string; language: string; content: string; offset: number } };

function disableSubtitles(element: HTMLVideoElement | null) {
  for (const track of element?.textTracks ?? []) {
    if (track.kind === "subtitles" || track.kind === "captions") track.mode = "disabled";
  }
}

export default function Subtitles({ video, playbackId, files, filename, search, timelineStart = 0, initialOffset = 0, onOffsetChange, simple = false, compact = false, customDisplay = false, englishEnabled = false, onEnglishChange, onNativeSubtitleChange }: { video: RefObject<HTMLVideoElement | null>; playbackId: string; files: TorrentFile[]; filename: string; search?: SearchIntent; timelineStart?: number; initialOffset?: number; onOffsetChange?: (offset: number) => void; simple?: boolean; compact?: boolean; customDisplay?: boolean; englishEnabled?: boolean; onEnglishChange?: (enabled: boolean) => void; onNativeSubtitleChange?: (state: NativeSubtitleState) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const selectionVersion = useRef(0);
  const offsetValue = useRef(initialOffset - timelineStart);
  const applyOffset = useRef<((offset: number) => void) | null>(null);
  const autoStarted = useRef(false);
  const [offset, setOffset] = useState(initialOffset);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState<Subtitle | null>(null);
  const [local, setLocal] = useState<Subtitle | null>(null);
  const [online, setOnline] = useState<Subtitle | null>(null);
  const [showOnline, setShowOnline] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subtitles = files.filter(file => file.kind === "subtitle" && subtitleFormat(file.path));
  const changedEnglish = useEffectEvent((enabled: boolean) => onEnglishChange?.(enabled));
  const changedNativeSubtitle = useEffectEvent((state: NativeSubtitleState) => onNativeSubtitleChange?.(state));

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (busy || (simple && englishEnabled && !error && (!loaded || loaded.key !== selected))) changedNativeSubtitle({ status: "loading" });
    else if ((!simple || englishEnabled) && loaded && loaded.key === selected) changedNativeSubtitle({ status: "ready", subtitle: { name: loaded.name, language: simple ? "en" : "und", content: loaded.content, offset } });
    else changedNativeSubtitle({ status: "off" });
  }, [busy, loaded, selected, offset, simple, englishEnabled, error]);
  useEffect(() => {
    offsetValue.current = offset - timelineStart;
    applyOffset.current?.(offset - timelineStart);
  }, [offset, timelineStart]);
  useEffect(() => {
    const element = video.current;
    if (!element || !loaded || loaded.key !== selected) return;
    const url = URL.createObjectURL(new Blob([loaded.content], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles"; track.label = simple ? "English" : loaded.name; track.srclang = simple ? "en" : "und"; track.src = url;
    const failed = () => setError("The subtitles could not be read. Try another SRT or VTT file.");
    const ready = () => {
      if (!track.track.cues?.length) { failed(); return; }
      applyOffset.current = subtitleTiming(track.track);
      applyOffset.current(offsetValue.current);
    };
    // Loading another converted time range temporarily resets native track modes.
    // Keep the user's selection through that reset and restore it after metadata.
    const restore = () => { track.track.mode = customDisplay ? "hidden" : "showing"; };
    const changed = () => { if (element.readyState > 0 && track.track.mode === "disabled") { selectionVersion.current++; setSelected(""); if (simple) changedEnglish(false); } };
    track.addEventListener("load", ready); track.addEventListener("error", failed);
    disableSubtitles(element);
    element.append(track); restore();
    element.textTracks.addEventListener("change", changed);
    element.addEventListener("loadedmetadata", restore);
    return () => {
      applyOffset.current = null;
      element.textTracks.removeEventListener("change", changed);
      element.removeEventListener("loadedmetadata", restore);
      track.removeEventListener("load", ready); track.removeEventListener("error", failed);
      track.remove(); URL.revokeObjectURL(url);
    };
  }, [loaded, selected, video, simple, customDisplay]);

  const loadEnglish = async () => {
    selectionVersion.current++;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]);
    setBusy(true); setError(""); setSelected("auto");
    try {
      const subtitle = loaded?.key === "auto" ? loaded : {
        key: "auto", ...await loadEnglishSubtitles(playbackId, filename, files, search, signal),
      };
      signal.throwIfAborted();
      setLoaded(subtitle);
    } catch {
      if (!controller.signal.aborted) { setSelected(""); setError("English subtitles aren't available for this version right now. Try again in a moment."); }
    } finally { if (active.current === controller) setBusy(false); }
  };
  const syncEnglish = useEffectEvent(() => {
    if (englishEnabled) void loadEnglish();
    else { active.current?.abort(); setBusy(false); setSelected(""); setError(""); disableSubtitles(video.current); }
  });
  useEffect(() => {
    // Keep the native text track and its cancellable download in sync with the switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (simple) syncEnglish();
  }, [simple, englishEnabled]);
  const autoEnglish = useEffectEvent(() => { void loadEnglish(); });
  useEffect(() => {
    if (compact && englishEnabled && !autoStarted.current) { autoStarted.current = true; autoEnglish(); }
  }, [compact, englishEnabled]);
  useEffect(() => { if (compact) changedEnglish(selected === "auto" && !error); }, [compact, selected, error]);

  const load = async (key: string, name: string, read: (signal: AbortSignal) => Promise<ArrayBuffer>) => {
    selectionVersion.current++;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const deadline = AbortSignal.timeout(35_000);
    const signal = AbortSignal.any([controller.signal, deadline]);
    setSelected(key); setBusy(true); setError(""); setLoaded(null);
    try {
      const content = subtitleVtt(await read(signal), name);
      if (signal.aborted) { if (deadline.aborted && !controller.signal.aborted) throw new Error("Subtitle download timed out. Try again."); return; }
      const subtitle = { key, name, content };
      setLoaded(subtitle); if (key === "local") setLocal(subtitle); if (key === "online") setOnline(subtitle);
    } catch (e) {
      if (!controller.signal.aborted) { setSelected(""); setError(deadline.aborted ? "Subtitle download timed out. Try again." : e instanceof Error ? e.message : "The subtitles could not be loaded."); }
    } finally { if (active.current === controller) setBusy(false); }
  };
  const choose = (key: string) => {
    selectionVersion.current++;
    active.current?.abort(); setBusy(false); setError(""); setSelected(key);
    if (!key) { disableSubtitles(video.current); return; }
    if (key === "auto") { void loadEnglish(); return; }
    if (key === "local" && local) { setLoaded(local); return; }
    if (key === "online" && online) { setLoaded(online); return; }
    const file = subtitles.find(file => String(file.id) === key);
    if (!file) return;
    void load(key, file.path, async signal => {
      const response = await fetch(`/api/media/subtitles/${playbackId}/${file.id}`, { signal, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Subtitle download failed (HTTP ${response.status}). Try again.`);
      }
      return response.arrayBuffer();
    });
  };
  const timing = loaded && loaded.key === selected ? <SubtitleTimingControls compact={compact} offset={offset} onChange={value => { const next = Math.max(-600, Math.min(600, value)); setOffset(next); onOffsetChange?.(next); }} /> : null;

  return <div aria-label="Subtitle controls" className={`space-y-3 ${compact ? "cinema-subtitle-controls" : simple ? "simple-subtitles" : "rounded border border-neutral-700 bg-neutral-950 p-4"}`}>
    {compact && <>
      <div className="cinema-subtitle-selection" role="group" aria-label="Subtitle language">
        <button type="button" aria-pressed={!selected} onClick={() => choose("")}>Off{!selected && <Check size={16} />}</button>
        <button type="button" className="cinema-auto-subtitles" aria-label="English subtitles" aria-pressed={selected === "auto"} disabled={busy && selected === "auto"} onClick={() => { autoStarted.current = true; void loadEnglish(); }}><span>{busy && selected === "auto" ? <LoaderCircle className="cinema-spinner" size={16} /> : <Captions size={17} />}English <small>Automatic</small></span>{selected === "auto" && !busy && <Check size={16} />}</button>
      </div>
      {loaded && selected && selected !== "auto" && <p className="truncate" title={loaded.name}>{loaded.name}</p>}
      {timing}
    </>}
    {simple ? <Switch label="English subtitles" checked={englishEnabled} onChange={enabled => onEnglishChange?.(enabled)} description={busy ? "Finding the best match…" : selected === "auto" && loaded ? "On · matched to this video" : "Automatically find and load captions"} /> : <>
    {compact && <button type="button" className="cinema-subtitle-more" aria-expanded={showMore} aria-controls={`${id}-more`} onClick={() => setShowMore(value => !value)}>More options<ChevronDown size={15} /></button>}
    <div id={`${id}-more`} hidden={compact && !showMore}>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-56"><label htmlFor={id} className="mb-2 flex items-center gap-2 text-sm"><Captions className="h-4 w-4 text-orange-400" />Subtitles</label>
        <select id={id} value={selected} onChange={event => choose(event.target.value)} className="h-10 w-full min-w-0 rounded border border-neutral-600 bg-neutral-900 px-3 text-sm text-white">
          <option value="">Off</option>
          {compact && (selected === "auto" || loaded?.key === "auto") && <option value="auto">English · automatic</option>}
          {subtitles.map(file => <option key={file.id} value={String(file.id)}>{file.path}</option>)}
          {(local || selected === "local") && <option value="local">{local ? `${local.name} (local)` : "Loading local subtitles…"}</option>}
          {(online || selected === "online") && <option value="online">{online ? `${online.name} (SubDL)` : "Loading online subtitles…"}</option>}
        </select>
      </div>
      <div className={compact ? "cinema-subtitle-actions" : "contents"}>
        <Button variant="outline" onClick={() => input.current?.click()}><Upload />{compact ? "Load file" : "Load SRT / VTT"}</Button>
        <Button variant="outline" aria-expanded={showOnline} aria-controls={`${id}-online`} onClick={() => setShowOnline(value => !value)}><Search />{compact ? showOnline ? "Hide search" : "Find online" : showOnline ? "Hide online search" : "Find online subtitles"}</Button>
      </div>
      <input ref={input} type="file" accept=".srt,.vtt" aria-label="Load subtitle file" className="hidden" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void load("local", file.name, async () => {
          if (!subtitleFormat(file.name)) throw new Error("Choose an SRT or VTT subtitle file.");
          if (file.size > MAX_SUBTITLE_BYTES) throw new Error("Subtitle files must be 2 MiB or smaller.");
          return file.arrayBuffer();
        });
      }} />
    </div>
    <div id={`${id}-online`}>{showOnline && <OnlineSubtitles playbackId={playbackId} filename={filename} search={search} selectionVersion={selectionVersion} onLoad={(name, content) => { void load("online", name, async () => content); }} />}</div>
    </div></>}
    {!compact && timing}
    {!simple && !compact && <p className="text-xs leading-relaxed text-neutral-400">{subtitles.length ? "Choose a subtitle file, find one online, or load your own." : "No SRT or VTT files in this torrent. Download subtitle or load your own."} Maximum 2 MiB.</p>}
    {busy && <p role="status" className="text-xs text-orange-400">Loading subtitles… {!simple && <Button variant="ghost" size="sm" onClick={() => choose("")}>Cancel</Button>}</p>}
    {error && <p role="alert" className="text-sm text-orange-400">{error}</p>}
    {(simple || compact) && error && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void loadEnglish(); }}>Retry subtitles</Button>}
  </div>;
}
