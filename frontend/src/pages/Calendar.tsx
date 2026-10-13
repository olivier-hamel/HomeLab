import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

export default function Calendar({ onEscape }: { onEscape?: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const iframe = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = iframe.current;
    if (!frame || !onEscape) return;
    let child: Window | null = null;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !child?.document.querySelector("dialog[open]")) onEscape();
    };
    const connect = () => {
      child?.removeEventListener("keydown", escape);
      child = frame.contentWindow;
      child?.addEventListener("keydown", escape);
    };
    connect();
    frame.addEventListener("load", connect);
    return () => { frame.removeEventListener("load", connect); child?.removeEventListener("keydown", escape); };
  }, [status, onEscape]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/calendar/healthz", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store" })
      .then(async response => {
        if (!response.ok || (await response.text()).trim() !== "ok") throw new Error("Calendar unavailable");
        if (!controller.signal.aborted) setStatus("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [attempt]);

  return <section className="calendar-page" aria-label="Calendar">
    {status === "ready" ? <iframe ref={iframe} title="Calendar — your day at a glance" src="/calendar/" className="calendar-frame" /> : <div className="calendar-status" role="status">
      <h1>{status === "error" ? "Calendar is unavailable." : "Opening your calendar…"}</h1>
      {status === "error" && <><p>The connection is temporarily unavailable. Please try again.</p><button type="button" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}><RefreshCw size={18} /> Try again</button></>}
    </div>}
  </section>;
}
