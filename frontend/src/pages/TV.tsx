import { useEffect, useState } from "react";
import { ChevronDown, Clapperboard, Radio, Search, UserRound } from "lucide-react";
import { Button } from "../components/ui/button";
import Catalogue from "../components/media/Catalogue";
import Sources from "../components/media/Sources";
import Playback from "../components/media/Playback";
import AutoPlayback from "../components/media/AutoPlayback";
import Welcome from "../components/media/Welcome";
import ContinueWatching from "../components/media/ContinueWatching";
import Switch from "../components/ui/switch";
import { useMediaTask } from "../components/media/useMediaTask";
import { loadMediaProfile, mediaApi, mediaProfiles, saveMediaProfile, sourceFingerprint, type MediaProfileId, type SearchIntent, type Source } from "../lib/media";
import { useTvMode } from "../lib/tv";
import ProfileChooser from "../components/media/ProfileChooser";

export default function TV() {
  const tvMode = useTvMode();
  const [profile, setProfile] = useState<MediaProfileId | null>(() => loadMediaProfile());
  const [choosingProfile, setChoosingProfile] = useState(() => loadMediaProfile() === null);
  const [advanced, setAdvanced] = useState(() => { try { return localStorage.getItem("homelab:advanced-media") === "true"; } catch { return false; } });
  const [watchIntent, setWatchIntent] = useState<{ intent: SearchIntent; resumeAt: number } | null>(null);
  const [config, setConfig] = useState<{ tmdb: boolean; prowlarr: boolean; torrserver: boolean; continueWatching?: boolean; recommendations?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"catalogue" | "sources">("catalogue");
  const [intent, setIntent] = useState<SearchIntent>({ query: "" });
  const [chosen, setChosen] = useState<{ source: Source | string; key: number; search?: SearchIntent } | null>(null);
  const [retry, setRetry] = useState(0);
  const [checks, setChecks] = useState<Record<string, { state: string; version?: string; error?: string }> | null>(null);
  const task = useMediaTask();
  const chooseProfile = (next: MediaProfileId) => {
    saveMediaProfile(next);
    setProfile(next);
    setChoosingProfile(false);
    setChosen(null);
    setWatchIntent(null);
    window.dispatchEvent(new CustomEvent("homelab:continue-watching-changed"));
  };
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<NonNullable<typeof config>>("status", AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])).then(c => { if (!controller.signal.aborted) { setConfig(c); setError(""); if (!c.tmdb) setMode("sources"); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!tvMode || !watchIntent) return;
    document.documentElement.dataset.tvWatching = "true";
    window.scrollTo({ top: 0, behavior: "auto" });
    return () => { delete document.documentElement.dataset.tvWatching; };
  }, [tvMode, watchIntent]);
  const find = (value: SearchIntent, resumeAt = 0) => {
    if (advanced) { setIntent(value); setMode("sources"); }
    else setWatchIntent({ intent: value, resumeAt });
    (tvMode ? document.scrollingElement : document.getElementById("dashboard-content"))?.scrollTo({ top: 0, behavior: "auto" });
  };
  const continueWatching = config?.continueWatching ? <ContinueWatching onResume={(resumeIntent, resumeAt) => { setChosen(null); setWatchIntent({ intent: resumeIntent, resumeAt }); (tvMode ? document.scrollingElement : document.getElementById("dashboard-content"))?.scrollTo({ top: 0, behavior: "auto" }); }} /> : undefined;
  const connections = config && <>
      <div className="flex flex-wrap items-center gap-3 text-xs">{(["tmdb", "prowlarr", "torrserver"] as const).map(service => <span key={service} className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"><span className="text-neutral-300">{service === "tmdb" ? "TMDB" : service === "prowlarr" ? "Prowlarr" : "TorrServer"}</span><span className="ml-2 text-neutral-500">{config[service] ? "Configured" : "Needs setup"}</span></span>)}<Button size="sm" variant="ghost" disabled={task.busy} onClick={() => { void task.run(s => mediaApi<NonNullable<typeof checks>>("check", s), setChecks, 50_000); }}>{task.busy ? "Checking connections…" : "Check media connections"}</Button>{task.busy && <Button variant="ghost" size="sm" onClick={task.cancel}>Cancel</Button>}</div>
      {checks && <div className="space-y-2 rounded border border-neutral-700 p-4 text-xs">{Object.entries(checks).map(([name, check]) => <p key={name}><strong className="capitalize">{name}:</strong> {check.error || `${check.state}${check.version ? ` · ${check.version}` : ""}`}</p>)}</div>}
      {task.error && <p role="alert" className="text-sm text-orange-400">{task.error}</p>}
  </>;
  if (!profile || choosingProfile) return <ProfileChooser current={profile} choose={chooseProfile} />;
  const activeProfile = mediaProfiles.find(item => item.id === profile)!;
  return <div className={`tv-media-page mx-auto max-w-[1600px] space-y-6 p-4 text-neutral-200 sm:p-6 lg:p-8 ${advanced ? "" : "simple-media"}`}>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="mb-2 text-xs tracking-[0.2em] text-orange-400">TV & Movies</p><h1 className="text-2xl font-semibold text-white sm:text-3xl">HomeLab Cinema</h1></div>
      <div className="media-profile-actions"><Switch label="Advanced mode" checked={advanced} onChange={enabled => {
        setAdvanced(enabled); setChosen(null); setWatchIntent(null); setMode("catalogue");
        try { localStorage.setItem("homelab:advanced-media", String(enabled)); } catch { /* The switch still works without storage. */ }
      }} /><button type="button" className={`media-account-button media-profile-${activeProfile.color}`} aria-label={`Current account: ${activeProfile.name}. Switch account`} onClick={() => setChoosingProfile(true)}><span className="media-account-avatar"><UserRound aria-hidden="true" /></span><span>{activeProfile.name}</span><ChevronDown aria-hidden="true" /></button></div>
    </div>
    {error ? <div role="alert" className="space-y-3 rounded-lg border border-orange-500/40 bg-neutral-900 p-5"><h2 className="font-semibold text-white">Set up TV & Movies</h2><p className="text-sm leading-relaxed">{error}</p><Button variant="outline" onClick={() => { setError(""); setRetry(r => r + 1); }}>Retry setup</Button></div> : !config ? <p role="status">Checking media configuration…</p> : <>
      {watchIntent ? <AutoPlayback key={JSON.stringify(watchIntent)} intent={watchIntent.intent} resumeAt={watchIntent.resumeAt} close={() => setWatchIntent(null)} /> : <>
      {!advanced ? <>
        <Welcome />
        <div>
          {config.tmdb && config.prowlarr && config.torrserver ? <Catalogue find={find} simple continueWatching={continueWatching} recommendations={config.recommendations} /> : <div className="space-y-3 rounded-xl border border-neutral-700 bg-neutral-900 p-6"><h2 className="text-lg text-white">Movie night needs a little setup</h2><p className="text-sm text-neutral-400">Turn on Advanced mode to connect the catalogue and playback services.</p></div>}
        </div>
      </> : <>
      {!tvMode && <><div className="flex items-center gap-2 text-xs text-neutral-400"><Radio className="h-4 w-4 text-orange-400" />LAN / tailnet access</div>{connections}</>}
      {chosen && <Playback key={chosen.key} source={chosen.source} search={chosen.search} close={() => setChosen(null)} />}
      <div className="flex gap-2 border-b border-neutral-700 pb-3" role="group" aria-label="Media mode"><Button data-tv-initial-focus={mode === "catalogue" ? "" : undefined} data-tv-back={tvMode && mode === "sources" && !chosen ? "" : undefined} aria-pressed={mode === "catalogue"} variant="ghost" className={mode === "catalogue" ? "bg-orange-500/15 text-orange-400" : "text-neutral-400"} onClick={() => { setMode("catalogue"); setChosen(null); }}><Clapperboard />Catalogue</Button><Button aria-pressed={mode === "sources"} variant="ghost" className={mode === "sources" ? "bg-orange-500/15 text-orange-400" : "text-neutral-400"} onClick={() => { setMode("sources"); setChosen(null); }}><Search />Source search</Button></div>
      {mode === "catalogue" ? config.tmdb ? <Catalogue find={find} continueWatching={continueWatching} recommendations={config.recommendations} /> : <div className="space-y-3 rounded border border-neutral-700 p-6"><h2 className="text-white">Connect the catalogue</h2><p className="text-sm text-neutral-400">Set TMDB_READ_ACCESS_TOKEN in backend/.env to browse titles, posters and descriptions. Direct source search works independently.</p><Button variant="outline" onClick={() => setMode("sources")}>Search sources</Button></div> : <>
        {!config.prowlarr && <p className="rounded border border-orange-500/30 p-4 text-sm text-neutral-400">Set PROWLARR_BASE_URL and PROWLARR_API_KEY in backend/.env to search indexers. Manual magnets remain available when TorrServer is configured.</p>}
        {!config.torrserver && <p className="rounded border border-orange-500/30 p-4 text-sm text-neutral-400">Set TORRSERVER_BASE_URL in backend/.env to load files and play sources.</p>}
        <Sources key={JSON.stringify(intent)} intent={intent} disabled={!config.torrserver} reject={source => { if (chosen && typeof chosen.source !== "string" && sourceFingerprint(chosen.source) === sourceFingerprint(source)) setChosen(null); }} choose={(source, search) => { setChosen({ source, search, key: Date.now() }); (tvMode ? document.scrollingElement : document.getElementById("dashboard-content"))?.scrollTo({ top: 0, behavior: tvMode ? "auto" : "smooth" }); }} />
      </>}
      </>}
      {tvMode && <details className="space-y-4 rounded border border-neutral-700 p-4"><summary>Media connections</summary>{connections}</details>}
      </>}
    </>}
  </div>;
}
