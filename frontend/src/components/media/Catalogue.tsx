import { useEffect, useRef, useState } from "react";
import { Film, Search, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { mediaApi, sourceIntent, type Details, type Kind, type SearchIntent, type Title } from "../../lib/media";

const field = "h-11 rounded border border-neutral-600 bg-neutral-950 px-3 text-sm text-white focus:outline-orange-500";
export default function Catalogue({ find }: { find: (intent: SearchIntent) => void }) {
  const [kind, setKind] = useState<Kind>("movie");
  const [text, setText] = useState("");
  const [q, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<Title | null>(null);
  const [retry, setRetry] = useState(0);
  return <div className="space-y-5">
    <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); setQuery(text.trim()); setPage(1); setRetry(r => r + 1); }}>
      <label className="sr-only" htmlFor="catalogue-kind">Catalogue type</label>
      <select id="catalogue-kind" className={field} value={kind} onChange={e => { setKind(e.target.value as Kind); setPage(1); setChosen(null); }}><option value="movie">Movies</option><option value="tv">TV shows</option></select>
      <label className="sr-only" htmlFor="catalogue-query">Search catalogue</label>
      <Input id="catalogue-query" maxLength={250} className="h-11 min-w-40 flex-1 border-neutral-600 bg-neutral-950" placeholder="Find a title…" value={text} onChange={e => setText(e.target.value)} />
      <Button className="h-11 bg-orange-600 text-white hover:bg-orange-700"><Search />Search</Button>
    </form>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="text-sm text-neutral-400">{q ? `Catalogue matches for “${q}”` : "Popular on TMDB"} · Metadata only. Find sources to check your indexers.</p>
      <details aria-label="About TMDB" className="max-w-md text-xs leading-relaxed text-neutral-500">
        <summary className="cursor-pointer py-1 text-neutral-400">About TMDB</summary>
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" className="my-3 inline-block"><img src="/tmdb-logo.svg" alt="TMDB" className="h-4 w-auto" /></a>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <p className="mt-2">TMDB provides metadata, not playable videos.</p>
      </details>
    </div>
    {chosen && <TitleDetails key={`${chosen.kind}/${chosen.id}`} title={chosen} close={() => setChosen(null)} find={find} />}
    <CatalogueResults key={`${kind}/${q}/${page}/${retry}`} kind={kind} query={q} page={page} setPage={setPage} choose={setChosen} retry={() => setRetry(r => r + 1)} />
  </div>;
}

function CatalogueResults({ kind, query, page, setPage, choose, retry }: { kind: Kind; query: string; page: number; setPage: (p: number) => void; choose: (t: Title) => void; retry: () => void }) {
  const [result, setResult] = useState<{ titles: Title[]; pages: number } | null>(null);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [controller] = useState(() => new AbortController());
  useEffect(() => {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, controller.signal, AbortSignal.timeout(20_000)]);
    void mediaApi<{ titles: Title[]; pages: number }>(`catalogue?${new URLSearchParams({ kind, q: query, page: String(page) })}`, signal).then(r => { if (!signal.aborted) setResult(r); }).catch(e => { if (!stop.signal.aborted && !controller.signal.aborted) setError(e instanceof Error ? e.message : "Catalogue unavailable."); });
    return () => stop.abort();
  }, [kind, query, page, controller]);
  if (error || cancelled) return <div role="alert" className="space-y-3 rounded border border-orange-500/40 p-5"><p>{error || "Catalogue request cancelled."}</p><Button variant="outline" onClick={retry}>Retry catalogue</Button></div>;
  if (!result) return <div role="status" className="flex items-center gap-4 p-5">Searching catalogue…<Button variant="outline" onClick={() => { controller.abort(); setCancelled(true); }}>Cancel</Button></div>;
  return <>
    {!result.titles.length && <p className="py-10 text-neutral-400">No catalogue titles found. Try a different name, or search your indexers directly.</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {result.titles.map(title => <button key={title.id} className="group overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-left transition-colors hover:border-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500" onClick={() => choose(title)} aria-label={`Details for ${title.title}`}>
        <div className="flex aspect-[2/3] items-center justify-center overflow-hidden bg-neutral-800">{title.poster ? <img src={title.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <Film className="h-12 w-12 text-neutral-600" />}</div>
        <div className="space-y-2 p-3"><p className="line-clamp-2 text-sm font-semibold text-white group-hover:text-orange-400">{title.title}</p><p className="text-xs text-neutral-400">{title.year || "Year unknown"} · {title.kind === "movie" ? "Movie" : "TV"}</p><p className="line-clamp-2 text-xs leading-relaxed text-neutral-500">{title.overview || "No overview available."}</p><span className="block text-xs text-orange-400">View details</span></div>
      </button>)}
    </div>
    <div className="flex items-center justify-center gap-4"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs text-neutral-400">Page {page} / {result.pages || 1}</span><Button variant="outline" disabled={page >= result.pages} onClick={() => setPage(page + 1)}>Next</Button></div>
  </>;
}

function TitleDetails({ title, close, find }: { title: Title; close: () => void; find: (intent: SearchIntent) => void }) {
  const panel = useRef<HTMLElement>(null);
  const [data, setData] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [season, setSeason] = useState<number | undefined>();
  useEffect(() => {
    panel.current?.focus();
    const controller = new AbortController();
    void mediaApi<Details>(`details/${title.kind}/${title.id}`, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])).then(d => { if (!controller.signal.aborted) { setData(d); setSeason(d.seasons.find(s => s.number > 0)?.number ?? d.seasons[0]?.number); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [title.id, title.kind]);
  return <section ref={panel} tabIndex={-1} aria-label="Title details" className="scroll-mt-5 space-y-4 rounded-lg border border-orange-500/40 bg-neutral-900 p-4 focus:outline-none sm:p-6">
    <div className="flex items-start justify-between gap-4"><div><p className="mb-2 text-xs tracking-widest text-orange-400">CATALOGUE DETAILS</p><h2 className="text-xl font-semibold text-white">{title.title} {title.year && `(${title.year})`}</h2></div><Button size="icon" variant="ghost" aria-label="Close details" onClick={close}><X /></Button></div>
    <p className="max-w-4xl text-sm leading-relaxed text-neutral-300">{data?.overview || title.overview || "No overview available."}</p>
    <p className="text-xs text-neutral-400">A catalogue entry does not establish torrent availability or identify a matching release.</p>
    {error ? <p role="alert">{error} Close and reopen details to retry.</p> : !data ? <p role="status">Loading details…</p> : data.kind === "movie" ? <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => find(sourceIntent(data))}>Find sources</Button> : <div className="space-y-4">
      <label className="flex flex-wrap items-center gap-3 text-sm">Season<select className={field} value={season ?? ""} onChange={e => setSeason(Number(e.target.value))}>{data.seasons.map(s => <option key={s.number} value={s.number}>{s.name} ({s.episodes ?? "?"} episodes)</option>)}</select></label>
      {season !== undefined ? <Episodes key={season} title={data} season={season} find={find} /> : <p>No season information is available.</p>}
    </div>}
  </section>;
}
function Episodes({ title, season, find }: { title: Details; season: number; find: (intent: SearchIntent) => void }) {
  const [episodes, setEpisodes] = useState<{ number: number; name: string; overview: string; airDate: string }[] | null>(null);
  const [episode, setEpisode] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<{ episodes: NonNullable<typeof episodes> }>(`season/${title.id}/${season}`, AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])).then(d => { if (!controller.signal.aborted) setEpisodes(d.episodes); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [title.id, season]);
  const selected = episodes?.find(e => e.number === Number(episode));
  return <div className="space-y-3">
    {error ? <p role="alert">{error} Reselect the season to retry.</p> : !episodes ? <p role="status">Loading episodes…</p> : <label className="flex flex-wrap items-center gap-3 text-sm">Episode<select className={`${field} max-w-full`} value={episode} onChange={e => setEpisode(e.target.value)}><option value="">Whole season / season pack</option>{episodes.map(e => <option key={e.number} value={e.number}>{e.number}. {e.name}</option>)}</select></label>}
    {selected && <p className="text-sm text-neutral-400">{selected.airDate && `${selected.airDate} · `}{selected.overview}</p>}
    <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => find(sourceIntent(title, season, episode ? Number(episode) : undefined))}>Find sources</Button>
  </div>;
}
