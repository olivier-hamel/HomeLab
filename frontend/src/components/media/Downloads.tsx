import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { bytes, mediaApi, type MediaDownload } from "../../lib/media";
import Playback from "./Playback";
import { useTvFocus } from "../useTvNavigation";

const labels = { queued: "En attente", downloading: "Téléchargement en cours", ready: "Prêt à regarder", error: "Téléchargement interrompu" };
export default function Downloads({ query = "" }: { query?: string }) {
  const panel = useRef<HTMLElement>(null);
  useTvFocus(panel);
  const [downloads, setDownloads] = useState<MediaDownload[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [watching, setWatching] = useState<{ download: MediaDownload; source: { downloadId: string } } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async (signal: AbortSignal) => {
    const result = await mediaApi<{ downloads: MediaDownload[] }>("downloads", signal);
    if (!signal.aborted) { setDownloads(result.downloads); setError(""); }
  }, []);
  useEffect(() => {
    const active = new AbortController(); controller.current = active;
    let pending = false, initialized = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const signal = AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]);
        if (!initialized) { await mediaApi("status", signal); initialized = true; }
        await reload(signal);
      } catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Téléchargements indisponibles."); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    const changed = () => { void refresh(); };
    window.addEventListener("homelab:downloads-changed", changed);
    return () => { active.abort(); clearInterval(timer); window.removeEventListener("homelab:downloads-changed", changed); };
  }, [reload]);
  const act = async (download: MediaDownload, action: "retry" | "remove") => {
    setBusy(download.id); setError("");
    try {
      const signal = AbortSignal.any([controller.current!.signal, AbortSignal.timeout(20_000)]);
      await mediaApi(`downloads/${action}`, signal, { downloadId: download.id });
      setConfirm(null); await reload(signal);
      window.dispatchEvent(new Event("homelab:downloads-changed"));
    } catch (cause) { if (!controller.current?.signal.aborted) setError(cause instanceof Error ? cause.message : "Action impossible."); }
    finally { setBusy(null); }
  };
  const visible = downloads?.filter(download => `${download.title} ${download.file.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section ref={panel} lang="fr" aria-label="Téléchargements cinéma" className="space-y-5 text-neutral-200">
    {watching ? <><Button data-tv-back="" variant="ghost" onClick={() => setWatching(null)}><ArrowLeft />Retour aux téléchargements</Button><h2 className="text-xl font-semibold text-white">{watching.download.title}</h2><Playback key={watching.download.id} source={watching.source} search={watching.download.intent} simple close={() => setWatching(null)} /></> : <>
      <div><h2 className="flex items-center gap-2 text-xl font-semibold text-white"><Download />Téléchargements</h2><p className="mt-2 text-sm text-neutral-400">Films et épisodes conservés sur le serveur jusqu’à leur suppression. La lecture se fait depuis HomeLab.</p>{downloads && <p className="mt-2 text-xs text-neutral-400">{downloads.length} fichier{downloads.length !== 1 ? "s" : ""} · {bytes(downloads.reduce((sum, row) => sum + row.downloadedBytes, 0))} conservés</p>}</div>
      {!downloads && !error && <p role="status">Chargement des téléchargements…</p>}
      {visible?.length === 0 && <p className="rounded-lg border border-neutral-700 p-6 text-neutral-400">{query ? "Aucun téléchargement ne correspond à cette recherche." : "Aucun téléchargement. Ouvre les détails d’un film ou choisis un épisode, puis sélectionne Télécharger sur le serveur."}</p>}
      <div className="space-y-3">{visible?.map(download => {
        const percent = Math.min(100, Math.round(download.downloadedBytes / download.totalBytes * 100));
        return <article key={download.id} aria-label={download.title} className="flex flex-col gap-4 rounded-lg border border-neutral-700 bg-neutral-900 p-4 sm:flex-row sm:items-center">
          {download.intent.media?.poster && <img src={download.intent.media.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="hidden h-24 w-16 rounded object-cover sm:block" />}
          <div className="min-w-0 flex-1 space-y-2"><h3 className="break-words font-semibold text-white">{download.title}</h3><p className="break-words text-xs text-neutral-400">{download.file.path}</p><p className="text-sm text-orange-300">{labels[download.state]} · {bytes(download.downloadedBytes)} / {bytes(download.totalBytes)}</p>{download.state !== "ready" && <div role="progressbar" aria-label={`Téléchargement de ${download.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded bg-neutral-700"><div className="h-full bg-orange-500" style={{ width: `${percent}%` }} /></div>}{download.error && <p className="text-sm text-orange-400">{download.error}</p>}</div>
          <div className="flex flex-wrap gap-2">{download.state === "ready" && <Button disabled={!!busy} onClick={() => setWatching({ download, source: { downloadId: download.id } })}><Play />Regarder</Button>}{download.state === "error" && <Button variant="outline" disabled={!!busy} onClick={() => { void act(download, "retry"); }}><RefreshCw />Reprendre</Button>}{confirm === download.id ? <div className="space-y-2"><p className="text-xs text-neutral-300">Supprimer ce fichier du serveur ?</p><div className="flex gap-2"><Button variant="outline" className="text-rose-300" disabled={!!busy} onClick={() => { void act(download, "remove"); }}>{busy === download.id ? "Suppression…" : "Confirmer la suppression"}</Button><Button variant="ghost" disabled={!!busy} onClick={() => setConfirm(null)}>Annuler</Button></div></div> : <Button variant="ghost" disabled={!!busy} aria-label={`Supprimer ${download.title}`} onClick={() => setConfirm(download.id)}><Trash2 />{download.state === "ready" ? "Supprimer" : "Annuler et supprimer"}</Button>}</div>
        </article>;
      })}</div>
    </>}
    {error && <p role="alert" className="text-sm text-orange-400">{error}</p>}
  </section>;
}
