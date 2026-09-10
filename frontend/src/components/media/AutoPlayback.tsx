import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import Playback from "./Playback";
import { useTvFocus } from "../useTvNavigation";
import { automaticSources, loadDismissedSources, mediaApi, saveDismissedSources, sourceFingerprint, type SearchIntent, type SearchResults, type Source, type SourceAdvice } from "../../lib/media";

export default function AutoPlayback({ intent, close }: { intent: SearchIntent; close: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useTvFocus(panel);
  const [chosen, setChosen] = useState<{ source: Source; key: number } | null>(null);
  const [message, setMessage] = useState("Finding the best version for you…");
  const [error, setError] = useState("");
  const [english, setEnglish] = useState(false);
  const [review, setReview] = useState<Pick<SourceAdvice, "provider" | "warning"> | null>(null);
  const active = useRef<AbortController | null>(null);
  const dismissed = useRef(loadDismissedSources());
  const queue = useRef<Source[]>([]);
  const nextBatch = useRef(1);
  const fetchedAt = useRef(0);
  const attempts = useRef(0);
  const current = useRef<Source | null>(null);
  const sequence = useRef(0);

  const next = async (failed = false, manual = false) => {
    if (active.current) return;
    if (manual) attempts.current = 0;
    if (failed && current.current) {
      dismissed.current.add(sourceFingerprint(current.current));
      saveDismissedSources(dismissed.current);
    }
    current.current = null;
    setChosen(null); setError("");
    setMessage(failed ? "Trying another version…" : "Finding the best version for you…");
    if (attempts.current >= 5) { setError("These versions couldn't play. Try more versions, or come back a little later."); return; }
    const controller = new AbortController(); active.current = controller;
    try {
      // Source handles expire after ten minutes. Refresh them before switching late in a film.
      if (Date.now() - fetchedAt.current > 8 * 60_000) { queue.current = []; nextBatch.current = 1; }
      let candidate: Source | undefined;
      let batches = 0;
      while (!candidate) {
        candidate = queue.current.shift();
        if (candidate && dismissed.current.has(sourceFingerprint(candidate))) { candidate = undefined; continue; }
        if (candidate) break;
        if (!nextBatch.current || batches >= 3) throw new Error("No more matching versions are available right now. Try again later or choose another title.");
        const result = await mediaApi<SearchResults>("search", AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]), { ...intent, batch: nextBatch.current });
        controller.signal.throwIfAborted();
        let advice = result.advice;
        if (result.results.length) {
          setMessage("Scanning for the best torrent available…");
          try { advice = await mediaApi<SourceAdvice>("recommend", AbortSignal.any([controller.signal, AbortSignal.timeout(65_000)]), { searchId: result.searchId }); }
          catch (error) {
            controller.signal.throwIfAborted();
            advice = { ...advice, warning: error instanceof Error && error.name !== "TimeoutError" ? `${error.message} Using basic matching for this search.` : "The AI review timed out. Using basic matching for this search." };
          }
        }
        controller.signal.throwIfAborted();
        setReview({ provider: advice.provider, warning: advice.warning });
        queue.current = automaticSources(result.results, advice, dismissed.current);
        fetchedAt.current = Date.now();
        nextBatch.current = result.more && result.batch < 20 ? result.batch + 1 : 0;
        batches++;
      }
      controller.signal.throwIfAborted();
      current.current = candidate;
      attempts.current++;
      setChosen({ source: candidate, key: ++sequence.current });
    } catch {
      if (!controller.signal.aborted) setError(nextBatch.current ? "We couldn't find a playable version. Try again in a moment." : "No more matching versions are available right now. Try again later or choose another title.");
    } finally { if (active.current === controller) active.current = null; }
  };
  const begin = useEffectEvent(() => { void next(); });
  useEffect(() => {
    // The request owns loading state and cancellation for this mounted viewing session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    begin();
    return () => { active.current?.abort(); active.current = null; };
  }, []);

  return <section ref={panel} aria-label="Watch title" className="simple-watch space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <Button variant="ghost" data-tv-back="" onClick={close}><ArrowLeft />Back to browse</Button>
      {chosen && review && <p role="status" className="max-w-lg text-xs text-neutral-400">{review.provider === "gemini" ? "Selected with Gemini" : review.warning || "Selected with basic matching"}</p>}
    </div>
    <h2 className="text-2xl font-semibold text-white sm:text-3xl">{intent.label || intent.query}</h2>
    {chosen ? <Playback key={chosen.key} source={chosen.source} search={intent} close={close} simple onFailure={() => { void next(true); }} onNext={() => { void next(true, true); }} englishEnabled={english} onEnglishChange={setEnglish} /> : <div className="simple-watch-pending">
      {error ? <><p role="alert" className="max-w-md text-center text-neutral-300">{error}</p><Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => { if (!nextBatch.current && !queue.current.length) nextBatch.current = 1; void next(false, true); }}><RotateCcw />Try again</Button></> : <><LoaderCircle className="h-10 w-10 animate-spin text-orange-400" aria-hidden="true" /><p role="status" className="text-neutral-200">{message}</p><p className="text-sm text-neutral-400">This can take a moment. We'll start when it's ready.</p></>}
      <Button variant="ghost" onClick={close}>{error ? "Choose another title" : "Cancel"}</Button>
    </div>}
  </section>;
}
