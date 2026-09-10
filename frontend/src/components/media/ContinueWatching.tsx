import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Film, Play, X } from "lucide-react";
import { Button } from "../ui/button";
import { mediaApi, type ContinueWatchingMovie, type SearchIntent } from "../../lib/media";
import { useTvMode } from "../../lib/tv";

function clock(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export default function ContinueWatching({ onResume }: { onResume: (intent: SearchIntent, position: number) => void }) {
  const tvMode = useTvMode();
  const row = useRef<HTMLDivElement>(null);
  const [movies, setMovies] = useState<ContinueWatchingMovie[]>([]);
  const [error, setError] = useState("");
  const load = () => {
    const controller = new AbortController();
    void mediaApi<{ movies: ContinueWatchingMovie[] }>("continue-watching", AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]))
      .then(result => { if (!controller.signal.aborted) { setMovies(result.movies); setError(""); } })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Continue Watching is unavailable."); });
    return controller;
  };
  useEffect(() => {
    let active = load();
    const refresh = () => { active.abort(); active = load(); };
    window.addEventListener("homelab:continue-watching-changed", refresh);
    return () => { active.abort(); window.removeEventListener("homelab:continue-watching-changed", refresh); };
  }, []);
  const remove = (movieId: number) => {
    setMovies(current => current.filter(movie => movie.movieId !== movieId));
    void mediaApi("continue-watching/remove", AbortSignal.timeout(10_000), { movieId }).catch(e => {
      setError(e instanceof Error ? e.message : "Could not remove this movie.");
      load();
    });
  };
  if (!movies.length && !error) return null;
  return <section aria-labelledby="continue-watching-title" className="continue-watching space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div><h2 id="continue-watching-title" className="text-xl font-semibold text-white">Continue Watching</h2><p className="mt-1 text-xs text-neutral-400">Pick up where you left off.</p></div>
      {!tvMode && movies.length > 1 && <div className="flex gap-2" aria-label="Continue Watching carousel controls">
        <Button size="icon" variant="outline" aria-label="Scroll Continue Watching left" onClick={() => row.current?.scrollBy({ left: -row.current.clientWidth * .8, behavior: "smooth" })}><ChevronLeft /></Button>
        <Button size="icon" variant="outline" aria-label="Scroll Continue Watching right" onClick={() => row.current?.scrollBy({ left: row.current.clientWidth * .8, behavior: "smooth" })}><ChevronRight /></Button>
      </div>}
    </div>
    {error && <p role="alert" className="text-sm text-orange-400">{error}</p>}
    {!!movies.length && <div ref={row} className="continue-watching-row" aria-label="In-progress movies">
      {movies.map(movie => {
        const percent = Math.max(0, Math.min(100, movie.playbackPositionSeconds / movie.durationSeconds * 100));
        const intent: SearchIntent = { query: movie.query, label: movie.title, context: movie.context, target: { kind: "movie", tmdbId: movie.movieId }, movie: { id: movie.movieId, title: movie.title, year: movie.year, poster: movie.poster } };
        return <article key={movie.movieId} className="continue-card">
          <button type="button" className="continue-card-main" aria-label={`Resume ${movie.title} at ${clock(movie.playbackPositionSeconds)}`} onClick={() => onResume(intent, movie.playbackPositionSeconds)}>
            <span className="continue-poster">{movie.poster ? <img src={movie.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Film aria-hidden="true" />}
              <span className="continue-play"><Play className="fill-current" aria-hidden="true" />Resume</span>
              <span className="continue-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
            </span>
            <strong>{movie.title}</strong>
            <span>{Math.round(percent)}% · {clock(movie.playbackPositionSeconds)} of {clock(movie.durationSeconds)}</span>
          </button>
          <button type="button" className="continue-remove" aria-label={`Remove ${movie.title} from Continue Watching`} onClick={() => remove(movie.movieId)}><X aria-hidden="true" /><span>Remove</span></button>
        </article>;
      })}
    </div>}
  </section>;
}
