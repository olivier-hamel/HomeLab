import { useEffect, useRef, useState } from "react";
import { Film, Play, Sparkles, Star, X } from "lucide-react";
import { Button } from "../ui/button";
import { useTvFocus } from "../useTvNavigation";
import { mediaApi, sourceIntent, type Details, type SearchIntent, type Title } from "../../lib/media";

type Batch = { sessionId: string; titles: Title[] };
type DiscoveryRequest = { sessionId?: string; choices?: (number | null)[] };
const batchSize = 16;
const groupSize = 4;

export default function MovieDiscovery({ close, watch }: { close: () => void; watch: (intent: SearchIntent) => void }) {
  const root = useRef<HTMLElement>(null);
  const locked = useRef(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [choices, setChoices] = useState<(number | null)[]>([]);
  const [request, setRequest] = useState<DiscoveryRequest>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useTvFocus(root);
  useEffect(() => {
    document.documentElement.dataset.tvDiscovery = "true";
    window.scrollTo({ top: 0, behavior: "auto" });
    return () => { delete document.documentElement.dataset.tvDiscovery; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<Batch>("discovery", AbortSignal.any([controller.signal, AbortSignal.timeout(125_000)]), request)
      .then(result => {
        if (controller.signal.aborted) return;
        if (result.titles.length !== batchSize || result.titles.some(title => title.kind !== "movie")) throw new Error("Couldn't load these suggestions. Please try again.");
        setBatch(result); setChoices([]); setLoading(false);
      })
      .catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Couldn't load your movies."); setLoading(false); } });
    return () => controller.abort();
  }, [request, retry]);
  useEffect(() => {
    locked.current = false;
    if (!batch || loading || error) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("[data-discovery-skip]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [batch, choices.length, loading, error]);
  const choose = (id: number | null) => {
    if (!batch || loading || error || locked.current) return;
    locked.current = true;
    const next = [...choices, id];
    setChoices(next);
    if (next.length === batchSize / groupSize) { setLoading(true); setRequest({ sessionId: batch.sessionId, choices: next }); }
  };
  const tryAgain = () => { setError(""); setLoading(true); setRetry(value => value + 1); };
  const startOver = () => { setError(""); setLoading(true); setBatch(null); setChoices([]); setRequest({}); };
  const group = batch?.titles.slice(choices.length * groupSize, (choices.length + 1) * groupSize) ?? [];
  const card = (title: Title, index: number) => <DiscoveryCard key={`${batch?.sessionId}:${choices.length}:${index}:${title.id}`} title={title} choose={() => choose(title.id)} watch={watch} />;
  return <section ref={root} className="movie-discovery tv-surface-enter" aria-labelledby="discovery-heading" onKeyDownCapture={event => {
    if (event.repeat && ["Enter", "Select"].includes(event.key)) event.preventDefault();
  }}>
    <header className="discovery-header">
      <div><p className="mb-2 flex items-center gap-2 text-sm text-orange-400"><Sparkles aria-hidden="true" />Find your next movie</p><h1 id="discovery-heading" className="text-2xl font-semibold text-white">Which would you rather watch?</h1><p className="mt-2 text-sm text-neutral-400">Pick your favorite, skip if you're unsure, or watch a movie now.</p></div>
      <Button variant="ghost" data-tv-back="" onClick={close}><X aria-hidden="true" />I'm all set</Button>
    </header>
    {error ? <div role="alert" className="discovery-status space-y-5"><p>{error}</p><div className="flex justify-center gap-4"><Button onClick={tryAgain}>Try again</Button>{batch && <Button variant="outline" onClick={startOver}>Start over</Button>}</div></div>
      : loading ? <div className="discovery-status" role="status"><div className="discovery-loader" aria-hidden="true"><span className="discovery-loader-ring" /><Sparkles /><span className="discovery-loader-dots"><i /><i /><i /></span></div><p className="text-xl text-white">{batch ? "Finding your next favorites…" : "Finding a few movies for you…"}</p><p className="mt-3 text-sm text-neutral-400">{batch ? "Putting together more movies for you to explore." : "A little inspiration for movie night."}</p></div>
        : <div className="discovery-grid">{group.slice(0, 2).map(card)}<div className="discovery-skip"><Button variant="outline" data-discovery-skip="" data-tv-initial-focus="" onClick={() => choose(null)}>Don't know</Button><p>Show me more</p></div>{group.slice(2).map((title, index) => card(title, index + 2))}</div>}
  </section>;
}

function DiscoveryCard({ title, choose, watch }: { title: Title; choose: () => void; watch: (intent: SearchIntent) => void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [ratingLoading, setRatingLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<Details>(`details/movie/${title.id}`, AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]))
      .then(result => { if (!controller.signal.aborted) setDetails(result); })
      .catch(() => { /* The verified catalogue metadata still allows choosing and watching. */ })
      .finally(() => { if (!controller.signal.aborted) setRatingLoading(false); });
    return () => controller.abort();
  }, [title.id]);
  return <article className="discovery-card">
    <button type="button" data-discovery-choice="" className="discovery-choice" onClick={choose} aria-label={`I'm more interested in ${title.title}`}>
      <div className="discovery-poster">{title.poster && !imageFailed ? <img src={title.poster} alt={`${title.title} poster`} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : <Film aria-label="Poster unavailable" />}</div>
      <div className="discovery-copy"><h2 className="line-clamp-2 text-xl font-semibold text-white">{title.title}</h2><p className="discovery-rating my-2 flex items-center justify-center text-sm text-amber-300"><Star aria-hidden="true" />{ratingLoading ? "IMDb …" : details?.rating != null ? `IMDb ${details.rating.toFixed(1)}/10` : "IMDb unavailable"}</p></div>
    </button>
    <Button variant="ghost" className="discovery-watch" aria-label={`Watch ${title.title} now`} onClick={() => watch(sourceIntent(details ?? { ...title, imdbId: null, tvdbId: null, rating: null, seasons: [] }))}><Play aria-hidden="true" />Watch now</Button>
  </article>;
}
