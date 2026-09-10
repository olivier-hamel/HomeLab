import { useEffect, useId, useState, type RefObject } from "react";
import { Download, Search } from "lucide-react";
import { Button } from "../ui/button";
import { mediaApi, type Kind, type SearchIntent } from "../../lib/media";
import { subtitleSearch, type OnlineSubtitle, type SubtitleDownload, type SubtitleSearch } from "../../lib/subtitles";
import { useMediaTask } from "./useMediaTask";

const field = "mt-2 h-10 w-full min-w-0 rounded border border-neutral-600 bg-neutral-900 px-3 text-sm text-white";
const languages = [["EN", "English"], ["FR", "French"], ["ES", "Spanish"], ["DE", "German"], ["IT", "Italian"], ["AR", "Arabic"], ["NL", "Dutch"], ["RU", "Russian"], ["HI", "Hindi"], ["JA", "Japanese"], ["KO", "Korean"], ["ZH", "Chinese"]];

export default function OnlineSubtitles({ playbackId, filename, search, selectionVersion, onLoad }: { playbackId: string; filename: string; search?: SearchIntent; selectionVersion: RefObject<number>; onLoad: (name: string, bytes: ArrayBuffer) => void }) {
  const id = useId();
  const [initial] = useState(() => subtitleSearch(filename, search));
  const [q, setQuery] = useState(initial.query);
  const [kind, setKind] = useState<Kind>(initial.context.kind);
  const [season, setSeason] = useState(String(initial.context.season ?? ""));
  const [episode, setEpisode] = useState(String(initial.context.episode ?? ""));
  const [language, setLanguage] = useState("EN");
  const [useIds, setUseIds] = useState(!!(initial.context.imdbId || initial.context.tmdbId));
  const [config, setConfig] = useState<{ configured: boolean } | null>(null);
  const [configError, setConfigError] = useState("");
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<SubtitleSearch | null>(null);
  const [download, setDownload] = useState<SubtitleDownload | null>(null);
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState("");
  const task = useMediaTask();
  const downloadTask = useMediaTask();
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<{ configured: boolean }>("subtitles/provider", AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
      .then(value => { if (!controller.signal.aborted) { setConfig(value); setConfigError(""); } })
      .catch(() => { if (!controller.signal.aborted) setConfigError("Could not check the subtitle service. Try again."); });
    return () => controller.abort();
  }, [retry]);
  const apply = (file: SubtitleDownload["files"][number]) => {
    const data = Uint8Array.from(atob(file.content), c => c.charCodeAt(0));
    onLoad(file.name, data.buffer); setApplied(true); setNotice(`${file.name} downloaded.`);
  };
  const fetchSubtitle = (subtitle: OnlineSubtitle) => {
    const version = selectionVersion.current;
    setDownload(null); setApplied(false); setNotice("");
    void downloadTask.run(s => mediaApi<SubtitleDownload>("subtitles/download", s, { id: playbackId, choice: subtitle.id }), data => {
      setDownload(data); if (data.files.length === 1 && selectionVersion.current === version) apply(data.files[0]);
    }, 30_000);
  };

  return <section aria-label="Online subtitles" className="space-y-4 border-t border-neutral-700 pt-4">
    <p className="text-sm text-neutral-200">Find subtitles on <a href="https://subdl.com" target="_blank" rel="noreferrer" className="text-orange-400 underline">SubDL</a> before you press Play.</p>
    {configError ? <div role="alert" className="space-y-2 text-sm text-orange-400"><p>{configError}</p><Button variant="outline" onClick={() => setRetry(n => n + 1)}>Retry subtitle service</Button></div> : !config ? <p role="status" className="text-xs text-neutral-400">Checking subtitle service…</p> : !config.configured ? <div className="space-y-3 text-sm text-neutral-400">
      <p>Add your SubDL API key as <code>SUBDL_API_KEY</code> in <code>backend/.env</code>, then restart the backend.</p>
      <div className="flex flex-wrap items-center gap-3"><a href="https://subdl.com/panel" target="_blank" rel="noreferrer" className="text-orange-400 underline">Get a SubDL API key</a><Button variant="outline" onClick={() => setRetry(n => n + 1)}>Check again</Button></div>
    </div> : <>
      <form onSubmit={event => {
        event.preventDefault(); setResult(null); setNotice("");
        const context = { ...(useIds ? initial.context : {}), kind, ...(kind === "tv" && season !== "" ? { season: Number(season) } : {}), ...(kind === "tv" && episode !== "" ? { episode: Number(episode) } : {}) };
        // Cleared episode fields must also clear values inherited from the catalogue.
        if (kind !== "tv" || season === "") delete context.season;
        if (kind !== "tv" || episode === "") delete context.episode;
        void task.run(s => mediaApi<SubtitleSearch>("subtitles/search", s, { id: playbackId, query: q, language, context }), setResult, 20_000);
      }}>
        <fieldset disabled={task.busy || downloadTask.busy} className="space-y-3">
          <div><label htmlFor={`${id}-title`} className="text-xs text-neutral-400">Movie or show title</label><input id={`${id}-title`} required maxLength={250} value={q} onChange={event => { setQuery(event.target.value); setUseIds(false); setResult(null); }} className={field} /></div>
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0 text-xs text-neutral-400">Type<select value={kind} onChange={event => { setKind(event.target.value as Kind); setUseIds(false); setResult(null); }} className={field}><option value="movie">Movie</option><option value="tv">TV episode</option></select></label>
            <label className="min-w-0 text-xs text-neutral-400">Subtitle language<select value={language} onChange={event => { setLanguage(event.target.value); setResult(null); }} className={field}>{languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
            {kind === "tv" && <><label className="min-w-0 text-xs text-neutral-400">Season<input type="number" min={0} max={1000} value={season} onChange={event => { setSeason(event.target.value); setResult(null); }} className={field} /></label><label className="min-w-0 text-xs text-neutral-400">Episode<input type="number" min={1} max={10000} value={episode} onChange={event => { setEpisode(event.target.value); setResult(null); }} className={field} /></label></>}
          </div>
          {(initial.context.imdbId || initial.context.tmdbId) && q === initial.query && kind === initial.context.kind && <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={useIds} onChange={event => { setUseIds(event.target.checked); setResult(null); }} className="h-4 w-4 accent-orange-500" />Match the catalogue title</label>}
          <Button type="submit" variant="outline" disabled={!q.trim()}><Search />Search SubDL</Button>
        </fieldset>
      </form>
      {task.busy && <p role="status" className="text-sm text-orange-400">Searching SubDL… <Button variant="ghost" onClick={task.cancel}>Cancel search</Button></p>}
      {task.error && <p role="alert" className="text-sm text-orange-400">{task.error}</p>}
      {result && <div className="space-y-3">
        <p role="status" className="text-xs text-neutral-400">{result.results.length ? `${result.results.length} subtitle choices${result.title ? ` for ${result.title}${result.year ? ` (${result.year})` : ""}` : ""}. Choose the release that matches your video.` : "No subtitles found. Try another language or title, or turn off catalogue matching."}</p>
        <div aria-label="SubDL results" className="max-h-80 space-y-2 overflow-y-auto">
          {result.results.map(subtitle => <article key={subtitle.id} className="space-y-2 rounded border border-neutral-700 bg-neutral-900 p-3">
            <p className="break-words text-sm text-white">{subtitle.release || subtitle.name}</p>
            <p className="break-words text-xs text-neutral-400">{subtitle.name} · {subtitle.language}{subtitle.fps ? ` · ${subtitle.fps} FPS` : ""}{subtitle.hearingImpaired ? " · Hearing impaired" : ""}{subtitle.archive ? " · ZIP" : ""}</p>
            <Button variant="outline" disabled={downloadTask.busy || task.busy} onClick={() => fetchSubtitle(subtitle)}><Download />Download &amp; use</Button>
          </article>)}
        </div>
      </div>}
      {downloadTask.busy && <p role="status" className="text-sm text-orange-400">Downloading subtitles… <Button variant="ghost" onClick={downloadTask.cancel}>Cancel download</Button></p>}
      {downloadTask.error && <p role="alert" className="text-sm text-orange-400">{downloadTask.error}</p>}
      {download && (download.files.length > 1 || !applied) && <div aria-label="Downloaded subtitle files" className="space-y-2"><p className="text-xs text-neutral-400">Download ready. Choose the file for your movie or episode.</p>{download.files.map((file, index) => <div key={index} className="flex flex-wrap items-center gap-2 rounded bg-neutral-900 p-3"><span className="min-w-0 flex-1 break-words text-xs">{file.name}</span><Button variant="outline" onClick={() => apply(file)}>Use subtitle</Button></div>)}</div>}
      {notice && <p role="status" className="break-words text-xs text-neutral-300">{notice}</p>}
    </>}
  </section>;
}
