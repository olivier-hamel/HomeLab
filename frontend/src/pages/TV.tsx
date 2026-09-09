import { useEffect, useState } from "react";
import { Clapperboard, Radio, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import Catalogue from "../components/media/Catalogue";
import Sources from "../components/media/Sources";
import Playback from "../components/media/Playback";
import { useMediaTask } from "../components/media/useMediaTask";
import { mediaApi, sourceFingerprint, type SearchIntent, type Source } from "../lib/media";

export default function TV() {
  const [config, setConfig] = useState<{ tmdb: boolean; prowlarr: boolean; torrserver: boolean } | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"catalogue" | "sources">("catalogue");
  const [intent, setIntent] = useState<SearchIntent>({ query: "" });
  const [chosen, setChosen] = useState<{ source: Source | string; key: number; search?: SearchIntent } | null>(null);
  const [retry, setRetry] = useState(0);
  const [checks, setChecks] = useState<Record<string, { state: string; version?: string; error?: string }> | null>(null);
  const task = useMediaTask();
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<NonNullable<typeof config>>("status", AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])).then(c => { if (!controller.signal.aborted) { setConfig(c); setError(""); if (!c.tmdb) setMode("sources"); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [retry]);
  const find = (value: SearchIntent) => { setIntent(value); setMode("sources"); };
  return <div className="mx-auto max-w-[1600px] space-y-6 p-4 text-neutral-200 sm:p-6 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-2 text-xs tracking-[0.2em] text-orange-400">HomeLab streaming service</p><h1 className="text-2xl font-bold tracking-wide text-white sm:text-3xl">TV & Movies</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400"></p></div><div className="flex items-center gap-2 rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-400"><Radio className="h-4 w-4 text-orange-400" />LAN / tailnet access</div></div>
    {error ? <div role="alert" className="space-y-3 rounded-lg border border-orange-500/40 bg-neutral-900 p-5"><h2 className="font-semibold text-white">Set up TV & Movies</h2><p className="text-sm leading-relaxed">{error}</p><Button variant="outline" onClick={() => { setError(""); setRetry(r => r + 1); }}>Retry setup</Button></div> : !config ? <p role="status">Checking media configuration…</p> : <>
      <div className="flex flex-wrap items-center gap-3 text-xs">{(["tmdb", "prowlarr", "torrserver"] as const).map(service => <span key={service} className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"><span className="text-neutral-300">{service === "tmdb" ? "TMDB" : service === "prowlarr" ? "Prowlarr" : "TorrServer"}</span><span className="ml-2 text-neutral-500">{config[service] ? "Configured" : "Needs setup"}</span></span>)}<Button size="sm" variant="ghost" disabled={task.busy} onClick={() => { void task.run(s => mediaApi<NonNullable<typeof checks>>("check", s), setChecks, 50_000); }}>{task.busy ? "Checking connections…" : "Check media connections"}</Button>{task.busy && <Button variant="ghost" size="sm" onClick={task.cancel}>Cancel</Button>}</div>
      {checks && <div className="space-y-2 rounded border border-neutral-700 p-4 text-xs">{Object.entries(checks).map(([name, check]) => <p key={name}><strong className="capitalize">{name}:</strong> {check.error || `${check.state}${check.version ? ` · ${check.version}` : ""}`}</p>)}</div>}
      {task.error && <p role="alert" className="text-sm text-orange-400">{task.error}</p>}
      {chosen && <Playback key={chosen.key} source={chosen.source} search={chosen.search} close={() => setChosen(null)} />}
      <div className="flex gap-2 border-b border-neutral-700 pb-3" role="group" aria-label="Media mode"><Button aria-pressed={mode === "catalogue"} variant="ghost" className={mode === "catalogue" ? "bg-orange-500/15 text-orange-400" : "text-neutral-400"} onClick={() => { setMode("catalogue"); setChosen(null); }}><Clapperboard />Catalogue</Button><Button aria-pressed={mode === "sources"} variant="ghost" className={mode === "sources" ? "bg-orange-500/15 text-orange-400" : "text-neutral-400"} onClick={() => { setMode("sources"); setChosen(null); }}><Search />Source search</Button></div>
      {mode === "catalogue" ? config.tmdb ? <Catalogue find={find} /> : <div className="space-y-3 rounded border border-neutral-700 p-6"><h2 className="text-white">Connect the catalogue</h2><p className="text-sm text-neutral-400">Set TMDB_READ_ACCESS_TOKEN in backend/.env to browse titles, posters and descriptions. Direct source search works independently.</p><Button variant="outline" onClick={() => setMode("sources")}>Search sources</Button></div> : <>
        {!config.prowlarr && <p className="rounded border border-orange-500/30 p-4 text-sm text-neutral-400">Set PROWLARR_BASE_URL and PROWLARR_API_KEY in backend/.env to search indexers. Manual magnets remain available when TorrServer is configured.</p>}
        {!config.torrserver && <p className="rounded border border-orange-500/30 p-4 text-sm text-neutral-400">Set TORRSERVER_BASE_URL in backend/.env to load files and play sources.</p>}
        <Sources key={JSON.stringify(intent)} intent={intent} disabled={!config.torrserver} reject={source => { if (chosen && typeof chosen.source !== "string" && sourceFingerprint(chosen.source) === sourceFingerprint(source)) setChosen(null); }} choose={(source, search) => { setChosen({ source, search, key: Date.now() }); document.getElementById("dashboard-content")?.scrollTo({ top: 0, behavior: "smooth" }); }} />
      </>}
    </>}
  </div>;
}
