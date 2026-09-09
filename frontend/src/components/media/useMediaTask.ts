import { useCallback, useEffect, useRef, useState } from "react";

export function useMediaTask() {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => active.current?.abort(), []);
  const cancel = useCallback(() => { active.current?.abort(); active.current = null; setBusy(false); setError("Request cancelled. You can retry."); }, []);
  const run = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>, done: (result: T) => void, timeout = 120_000) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const deadline = AbortSignal.timeout(timeout);
    setBusy(true); setError("");
    try { const result = await work(AbortSignal.any([controller.signal, deadline])); if (!controller.signal.aborted) done(result); }
    catch (e) { if (!controller.signal.aborted) setError(deadline.aborted ? "Request timed out. Retry or check the service connection." : e instanceof Error ? e.message : "Request failed."); }
    finally { if (active.current === controller && !controller.signal.aborted) setBusy(false); }
  }, []);
  return { busy, error, cancel, run };
}
