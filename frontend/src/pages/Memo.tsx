import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

export default function Memo() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (location.protocol !== "https:") {
      const url = new URL(location.href);
      url.protocol = "https:";
      url.port = import.meta.env.VITE_MEMO_HTTPS_PORT || "3443";
      url.searchParams.set("section", "memo");
      location.replace(url.href);
      return;
    }
    const controller = new AbortController();
    fetch("/memo/api/health", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("Memo unavailable");
        if (!controller.signal.aborted) setStatus("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, [attempt]);

  return <section className="memo-page" aria-label="Mémo">
    {status === "ready" ? <iframe title="Mémo — mon espace d’étude" src="/memo/" className="memo-frame" /> : <div className="memo-status" role="status">
      <h1>{status === "error" ? "Mémo prend une pause." : "Ton espace d’étude se prépare…"}</h1>
      {status === "error" && <><p>La connexion est momentanément indisponible. Réessaie dans un instant.</p><button type="button" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}><RefreshCw size={18} /> Réessayer</button></>}
    </div>}
  </section>;
}
