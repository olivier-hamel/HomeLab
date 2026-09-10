import { useEffect, useRef, useState, type ReactNode } from "react";
import { Film, Play, Search, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { mediaApi, sourceIntent, type Details, type Kind, type SearchIntent, type Title } from "../../lib/media";
import { useTvMode } from "../../lib/tv";
import TvScrollControls from "../TvScrollControls";

const field = "h-11 rounded border border-neutral-600 bg-neutral-950 px-3 text-sm text-white focus:outline-orange-500";
type CatalogueResponse = { titles: Title[]; pages: number; originalQuery?: string; correctedQuery?: string; correctionProvider?: "gemini" };
export default function Catalogue({ find, simple = false, continueWatching }: { find: (intent: SearchIntent) => void; simple?: boolean; continueWatching?: ReactNode }) {
  const [kind, setKind] = useState<Kind>("movie");
  const [text, setText] = useState("");
  const [q, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<Title | null>(null);
  const [retry, setRetry] = useState(0);
  const [suggestions, setSuggestions] = useState<Title[]>([]);
  const [suggestionFocus, setSuggestionFocus] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  useEffect(() => {
    const value = text.trim();
    if (!suggestionFocus || value.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSuggesting(true);
      void mediaApi<{ titles: Title[] }>(`suggestions?${new URLSearchParams({ kind, q: value })}`, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
        .then(result => { if (!controller.signal.aborted) setSuggestions(result.titles); })
        .catch(() => { if (!controller.signal.aborted) setSuggestions([]); })
        .finally(() => { if (!controller.signal.aborted) setSuggesting(false); });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [kind, text, suggestionFocus]);
  const choose = (title: Title) => {
    if (simple && title.kind === "movie") find(sourceIntent({ ...title, imdbId: null, tvdbId: null, seasons: [] }));
    else setChosen(title);
  };
  return <div className="space-y-5">
    <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); setSuggestionFocus(false); setQuery(text.trim()); setPage(1); setRetry(r => r + 1); }}>
      {simple ? <div role="group" aria-label="Catalogue type" className="simple-catalogue-tabs">{(["movie", "tv"] as const).map(value => <button key={value} type="button" aria-pressed={kind === value} onClick={() => { setKind(value); setPage(1); setChosen(null); }}>{value === "movie" ? "Movies" : "TV shows"}</button>)}</div> : <><label className="sr-only" htmlFor="catalogue-kind">Catalogue type</label>
      <select id="catalogue-kind" className={field} value={kind} onChange={e => { setKind(e.target.value as Kind); setPage(1); setChosen(null); }}><option value="movie">Movies</option><option value="tv">TV shows</option></select></>}
      <label className="sr-only" htmlFor="catalogue-query">Search catalogue</label>
      <div className="relative min-w-40 flex-1" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSuggestionFocus(false); }}>
        <Input id="catalogue-query" maxLength={250} className="h-11 w-full border-neutral-600 bg-neutral-950" placeholder="Find a title…" value={text} onChange={e => { setText(e.target.value); setSuggestions([]); setSuggesting(false); setSuggestionFocus(true); }} onFocus={() => setSuggestionFocus(true)} role="combobox" aria-autocomplete="list" aria-expanded={suggestionFocus && text.trim().length >= 2 && (suggesting || suggestions.length > 0)} aria-controls="catalogue-suggestions" autoComplete="off" />
        {suggestionFocus && text.trim().length >= 2 && (suggesting || suggestions.length > 0) && <div id="catalogue-suggestions" role="listbox" aria-label="Title suggestions" className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-30 overflow-hidden rounded-lg border border-neutral-600 bg-neutral-900 shadow-2xl">
          {suggesting && !suggestions.length ? <p className="px-3 py-3 text-sm text-neutral-400">Finding titles…</p> : suggestions.map(title => <button key={`${title.kind}/${title.id}`} type="button" role="option" aria-selected="false" className="flex w-full items-center gap-3 border-b border-neutral-800 px-3 py-2 text-left last:border-0 hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none" onClick={() => { setText(title.title); setSuggestionFocus(false); choose(title); }}>
            {title.poster ? <img src={title.poster} alt="" className="h-12 w-8 rounded object-cover" referrerPolicy="no-referrer" /> : <span className="flex h-12 w-8 items-center justify-center rounded bg-neutral-800"><Film className="h-4 w-4 text-neutral-500" /></span>}
            <span className="min-w-0"><strong className="block truncate text-sm text-white">{title.title}</strong><span className="text-xs text-neutral-400">{title.year || "Year unknown"} · {title.kind === "movie" ? "Movie" : "TV"}</span></span>
          </button>)}
        </div>}
      </div>
      <Button className="h-11 bg-orange-600 text-white hover:bg-orange-700"><Search />Search</Button>
    </form>
    {!q && continueWatching}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="text-sm text-neutral-400">{q ? `Results for “${q}”` : simple ? kind === "movie" ? "Popular movies" : "Popular TV shows" : "Popular on TMDB"}{!simple && " · Metadata only."}</p>
    </div>
    {chosen && <TitleDetails key={`${chosen.kind}/${chosen.id}`} title={chosen} close={() => setChosen(null)} find={intent => { setChosen(null); find(intent); }} simple={simple} />}
    <CatalogueResults key={`${kind}/${q}/${page}/${retry}`} kind={kind} query={q} page={page} setPage={setPage} choose={choose} retry={() => setRetry(r => r + 1)} simple={simple} />
  </div>;
}

function CatalogueResults({ kind, query, page, setPage, choose, retry, simple }: { kind: Kind; query: string; page: number; setPage: (p: number) => void; choose: (t: Title) => void; retry: () => void; simple: boolean }) {
  const [result, setResult] = useState<CatalogueResponse | null>(null);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, controller.signal, AbortSignal.timeout(20_000)]);
    void mediaApi<CatalogueResponse>(`catalogue?${new URLSearchParams({ kind, q: query, page: String(page) })}`, signal).then(r => { if (!signal.aborted) setResult(r); }).catch(e => { if (!stop.signal.aborted && !controller.signal.aborted) setError(e instanceof Error ? e.message : "Catalogue unavailable."); });
    return () => stop.abort();
  }, [kind, query, page, controller]);
  if (error || cancelled) return <div role="alert" className="space-y-3 rounded border border-orange-500/40 p-5"><p>{error || "Catalogue request cancelled."}</p><Button variant="outline" onClick={retry}>Retry catalogue</Button></div>;
  if (!result) return <div role="status" className="flex items-center gap-4 p-5">Searching catalogue…<Button variant="outline" onClick={() => { controller.abort(); setCancelled(true); }}>Cancel</Button></div>;
  return <>
    {result.correctedQuery && <p role="status" className="rounded border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-neutral-200">Showing likely matches for <strong className="text-white">{result.correctedQuery}</strong>. Results for your original search are included too.</p>}
    {!result.titles.length && <p className="py-10 text-neutral-400">No titles found. Try a different name.</p>}
    <div className="tv-catalogue-grid grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {result.titles.map(title => <button key={title.id} className={`group overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-left transition-colors hover:border-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 ${simple ? "simple-title-card" : ""}`} onClick={() => choose(title)} aria-label={`${simple ? title.kind === "movie" ? "Watch" : "Choose episode of" : "Details for"} ${title.title}`}>
        <div className="relative flex aspect-[2/3] items-center justify-center overflow-hidden bg-neutral-800">{title.poster ? <img src={title.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <Film className="h-12 w-12 text-neutral-600" />}{simple && <span className="simple-card-action"><Play className="h-5 w-5 fill-current" />{title.kind === "movie" ? "Watch now" : "Choose episode"}</span>}</div>
        <div className="space-y-2 p-3"><p className="line-clamp-2 text-sm font-semibold text-white group-hover:text-orange-400">{title.title}</p><p className="text-xs text-neutral-400">{title.year || "Year unknown"} · {title.kind === "movie" ? "Movie" : "TV"}</p>{!simple && <><p className="line-clamp-2 text-xs leading-relaxed text-neutral-500">{title.overview || "No overview available."}</p><span className="block text-xs text-orange-400">View details</span></>}</div>
      </button>)}
    </div>
    <div className="flex items-center justify-center gap-4"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs text-neutral-400">Page {page} / {result.pages || 1}</span><Button variant="outline" disabled={page >= result.pages} onClick={() => setPage(page + 1)}>Next</Button></div>
  </>;
}

function TitleDetails({ title, close, find, simple }: { title: Title; close: () => void; find: (intent: SearchIntent) => void; simple: boolean }) {
  const tvMode = useTvMode();
  const panel = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [season, setSeason] = useState<number | undefined>();
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const poster = data?.poster || title.poster;
  useEffect(() => {
    const dialog = panel.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scroller = tvMode ? document.documentElement : document.getElementById("dashboard-content") ?? document.body;
    const previousOverflow = scroller.style.overflow;
    dialog?.showModal();
    scroller.style.overflow = "hidden";
    return () => {
      dialog?.close();
      scroller.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [tvMode]);
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<Details>(`details/${title.kind}/${title.id}`, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])).then(d => { if (!controller.signal.aborted) { setData(d); setSeason(d.seasons.find(s => s.number > 0)?.number ?? d.seasons[0]?.number); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [title.id, title.kind]);
  return <dialog ref={panel} aria-labelledby="catalogue-details-title" onCancel={e => { e.preventDefault(); close(); }} onClick={e => {
    if (e.target !== e.currentTarget) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) close();
  }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl space-y-4 overflow-y-auto overscroll-contain rounded-lg border border-orange-500/40 bg-neutral-900 p-4 text-neutral-200 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm sm:p-6">
    <div className="flex items-start justify-between gap-4"><div><p className="mb-2 text-xs tracking-widest text-orange-400">CATALOGUE DETAILS</p><h2 id="catalogue-details-title" className="text-xl font-semibold text-white">{title.title} {title.year && `(${title.year})`}</h2></div><Button size="icon" variant="ghost" className="shrink-0" aria-label="Close details" onClick={close}><X /></Button></div>
    <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_10rem]">
    <div className="min-w-0 space-y-4">
    <p className="max-w-4xl text-sm leading-relaxed text-neutral-300">{data?.overview || title.overview || "No overview available."}</p>
    {error ? <p role="alert">{error} Close and reopen details to retry.</p> : !data ? <p role="status">Loading details…</p> : data.kind === "movie" ? <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => find(sourceIntent(data))}>Find sources</Button> : <div className="space-y-4">
      <label className="flex flex-wrap items-center gap-3 text-sm">Season<select className={field} value={season ?? ""} onChange={e => setSeason(Number(e.target.value))}>{data.seasons.map(s => <option key={s.number} value={s.number}>{s.name} ({s.episodes ?? "?"} episodes)</option>)}</select></label>
      {season !== undefined ? <Episodes key={season} title={data} season={season} find={find} simple={simple} /> : <p>No season information is available.</p>}
    </div>}
    </div>
    <div className="flex aspect-[2/3] w-40 max-w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800 justify-self-center sm:justify-self-end">
      {poster && poster !== failedPoster ? <img src={poster} alt={`${title.title} poster`} referrerPolicy="no-referrer" className="h-full w-full object-contain" onError={() => setFailedPoster(poster)} /> : <div className="flex flex-col items-center gap-2 text-neutral-500"><Film className="h-10 w-10" aria-hidden="true" /><span className="text-xs">No poster available</span></div>}
    </div>
    </div>
    {tvMode && <TvScrollControls dialog />}
  </dialog>;
}
function Episodes({ title, season, find, simple }: { title: Details; season: number; find: (intent: SearchIntent) => void; simple: boolean }) {
  const [episodes, setEpisodes] = useState<{ number: number; name: string; overview: string; airDate: string }[] | null>(null);
  const [episode, setEpisode] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<{ episodes: NonNullable<typeof episodes> }>(`season/${title.id}/${season}`, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])).then(d => { if (!controller.signal.aborted) setEpisodes(d.episodes); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [title.id, season]);
  const selected = episodes?.find(e => e.number === Number(episode));
  if (simple) return <div className="space-y-3">
    {error ? <p role="alert">Couldn't load episodes. Reselect the season to retry.</p> : !episodes ? <p role="status">Loading episodes…</p> : episodes.length ? <div className="simple-episodes">{episodes.map(item => <button key={item.number} onClick={() => find(sourceIntent(title, season, item.number))} aria-label={`Watch episode ${item.number}: ${item.name}`}><span className="text-orange-400"><Play className="h-5 w-5" /></span><span><strong className="block text-sm text-white">{item.number}. {item.name}</strong><span className="mt-1 line-clamp-2 block text-xs text-neutral-400">{item.overview}</span></span></button>)}</div> : <p>No episodes are available for this season.</p>}
  </div>;
  return <div className="space-y-3">
    {error ? <p role="alert">{error} Reselect the season to retry.</p> : !episodes ? <p role="status">Loading episodes…</p> : <label className="flex flex-wrap items-center gap-3 text-sm">Episode<select className={`${field} max-w-full`} value={episode} onChange={e => setEpisode(e.target.value)}><option value="">Whole season / season pack</option>{episodes.map(e => <option key={e.number} value={e.number}>{e.number}. {e.name}</option>)}</select></label>}
    {selected && <p className="text-sm text-neutral-400">{selected.airDate && `${selected.airDate} · `}{selected.overview}</p>}
    <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => find(sourceIntent(title, season, episode ? Number(episode) : undefined))}>Find sources</Button>
  </div>;
}
