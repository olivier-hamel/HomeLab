import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Captions, Minus, Plus, RotateCcw, Search, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { type SearchIntent, type TorrentFile } from "../../lib/media";
import { MAX_SUBTITLE_BYTES, subtitleFormat, subtitleTiming, subtitleVtt } from "../../lib/subtitles";
import OnlineSubtitles from "./OnlineSubtitles";

type Subtitle = { key: string; name: string; content: string };

function disableSubtitles(element: HTMLVideoElement | null) {
  for (const track of element?.textTracks ?? []) {
    if (track.kind === "subtitles" || track.kind === "captions") track.mode = "disabled";
  }
}

export default function Subtitles({ video, playbackId, files, filename, search }: { video: RefObject<HTMLVideoElement | null>; playbackId: string; files: TorrentFile[]; filename: string; search?: SearchIntent }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const selectionVersion = useRef(0);
  const offsetValue = useRef(0);
  const applyOffset = useRef<((offset: number) => void) | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState<Subtitle | null>(null);
  const [local, setLocal] = useState<Subtitle | null>(null);
  const [online, setOnline] = useState<Subtitle | null>(null);
  const [showOnline, setShowOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subtitles = files.filter(file => file.kind === "subtitle" && subtitleFormat(file.path));

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    offsetValue.current = offset;
    applyOffset.current?.(offset);
  }, [offset]);
  useEffect(() => {
    const element = video.current;
    if (!element || !loaded || loaded.key !== selected) return;
    const url = URL.createObjectURL(new Blob([loaded.content], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles"; track.label = loaded.name; track.srclang = "und"; track.src = url;
    const failed = () => setError("The subtitles could not be read. Try another SRT or VTT file.");
    const ready = () => {
      if (!track.track.cues?.length) { failed(); return; }
      applyOffset.current = subtitleTiming(track.track.cues);
      applyOffset.current(offsetValue.current);
    };
    const changed = () => { if (track.track.mode === "disabled") { selectionVersion.current++; setSelected(""); } };
    track.addEventListener("load", ready); track.addEventListener("error", failed);
    disableSubtitles(element);
    element.append(track); track.track.mode = "showing";
    element.textTracks.addEventListener("change", changed);
    return () => {
      applyOffset.current = null;
      element.textTracks.removeEventListener("change", changed);
      track.removeEventListener("load", ready); track.removeEventListener("error", failed);
      track.remove(); URL.revokeObjectURL(url);
    };
  }, [loaded, selected, video]);

  const load = async (key: string, name: string, read: (signal: AbortSignal) => Promise<ArrayBuffer>) => {
    selectionVersion.current++;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const deadline = AbortSignal.timeout(35_000);
    const signal = AbortSignal.any([controller.signal, deadline]);
    setSelected(key); setBusy(true); setError(""); setLoaded(null); setOffset(0);
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
    setOffset(0);
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

  return <div aria-label="Subtitle controls" className="space-y-3 rounded border border-neutral-700 bg-neutral-950 p-4">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-56"><label htmlFor={id} className="mb-2 flex items-center gap-2 text-sm"><Captions className="h-4 w-4 text-orange-400" />Subtitles</label>
        <select id={id} value={selected} onChange={event => choose(event.target.value)} className="h-10 w-full min-w-0 rounded border border-neutral-600 bg-neutral-900 px-3 text-sm text-white">
          <option value="">Off</option>
          {subtitles.map(file => <option key={file.id} value={String(file.id)}>{file.path}</option>)}
          {(local || selected === "local") && <option value="local">{local ? `${local.name} (local)` : "Loading local subtitles…"}</option>}
          {(online || selected === "online") && <option value="online">{online ? `${online.name} (SubDL)` : "Loading online subtitles…"}</option>}
        </select>
      </div>
      <Button variant="outline" onClick={() => input.current?.click()}><Upload />Load SRT / VTT</Button>
      <Button variant="outline" aria-expanded={showOnline} aria-controls={`${id}-online`} onClick={() => setShowOnline(value => !value)}><Search />{showOnline ? "Hide online search" : "Find online subtitles"}</Button>
      <input ref={input} type="file" accept=".srt,.vtt" aria-label="Load subtitle file" className="hidden" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void load("local", file.name, async () => {
          if (!subtitleFormat(file.name)) throw new Error("Choose an SRT or VTT subtitle file.");
          if (file.size > MAX_SUBTITLE_BYTES) throw new Error("Subtitle files must be 2 MiB or smaller.");
          return file.arrayBuffer();
        });
      }} />
    </div>
    {loaded && loaded.key === selected && <div role="group" aria-label="Subtitle timing" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-300">Subtitle timing</span>
        <Button variant="outline" size="sm" aria-label="Show subtitles 0.5 seconds earlier" onClick={() => setOffset(value => value - 0.5)}><Minus />Earlier 0.5 s</Button>
        <output aria-label="Subtitle offset" aria-live="polite" className="min-w-16 text-center text-sm tabular-nums text-orange-400">{offset > 0 ? "+" : ""}{offset.toFixed(1)} s</output>
        <Button variant="outline" size="sm" aria-label="Show subtitles 0.5 seconds later" onClick={() => setOffset(value => value + 0.5)}><Plus />Later 0.5 s</Button>
        <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(0)}><RotateCcw />Reset timing</Button>
      </div>
      <p className="text-xs leading-relaxed text-neutral-500">Negative shows subtitles earlier; positive shows them later. Selecting a subtitle file resets the timing.</p>
    </div>}
    <p className="text-xs leading-relaxed text-neutral-400">{subtitles.length ? "Choose a subtitle file, find one online, or load your own." : "No SRT or VTT files in this torrent. Find subtitles online or load your own."} Local files stay in your browser. Maximum 2 MiB.</p>
    <p className="text-xs leading-relaxed text-neutral-500">Embedded subtitles and ASS/SSA or image subtitles may need an external player.</p>
    {busy && <p role="status" className="text-xs text-orange-400">Loading subtitles… <Button variant="ghost" size="sm" onClick={() => choose("")}>Cancel</Button></p>}
    {error && <p role="alert" className="text-sm text-orange-400">{error}</p>}
    <div id={`${id}-online`}>{showOnline && <OnlineSubtitles playbackId={playbackId} filename={filename} search={search} selectionVersion={selectionVersion} onLoad={(name, content) => { void load("online", name, async () => content); }} />}</div>
  </div>;
}
