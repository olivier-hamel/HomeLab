import { useEffect, useRef, useState } from "react";
import { CalendarPlus, ExternalLink, X } from "lucide-react";
import { libraryRequest, type EventDraft, type LibraryFile } from "../../lib/library";

export default function TempoReviewDialog({ files, onClose, onSaved }: { files: LibraryFile[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(() => new Set(files.flatMap(file => file.tempoScan!.proposals.filter(row => row.decision === "pending").map(row => row.id))));
  const [drafts, setDrafts] = useState<Record<string, EventDraft>>({}), [resolved, setResolved] = useState(new Set<string>());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const pending = files.filter(file => !resolved.has(file.id)), proposals = pending.flatMap(file => file.tempoScan!.proposals.filter(row => row.decision === "pending"));
  const count = proposals.filter(row => selected.has(row.id)).length;
  const edit = (id: string, original: EventDraft, patch: Partial<EventDraft>) => setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] || original), ...patch } }));
  return <dialog ref={dialog} className="library-dialog library-tempo-review" aria-labelledby="library-tempo-review-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        for (const file of pending) {
          const rows = file.tempoScan!.proposals.filter(row => row.decision === "pending");
          await libraryRequest(`/files/${file.id}/events`, "POST", { scanId: file.tempoScan!.id,
            events: rows.filter(row => selected.has(row.id)).map(row => ({ proposalId: row.id, event: drafts[row.id] || row.event })),
            ignored: rows.filter(row => !selected.has(row.id)).map(row => row.id) });
          setResolved(previous => new Set([...previous, file.id]));
        }
        await onSaved(); onClose();
      } catch (error) { setError(error instanceof Error ? error.message : "Les choix n’ont pas pu être enregistrés."); setBusy(false); await onSaved().catch(() => {}); }
    }}>
      <header><span className="library-dialog-icon"><CalendarPlus size={25} /></span><div><p>TEMPO · BIBLIOTHÈQUE</p><h2 id="library-tempo-review-title">Des événements à vérifier</h2></div><button type="button" aria-label="Fermer la revue" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <p>Vérifie les dates et les détails. Les propositions non cochées seront ignorées; « Plus tard » conserve la notification.</p>
      <div className="library-tempo-select"><label><input type="checkbox" checked={proposals.length > 0 && count === proposals.length} disabled={busy} onChange={event => setSelected(event.target.checked ? new Set(proposals.map(row => row.id)) : new Set())} />Tout sélectionner</label><span>Heure de Toronto</span></div>
      <div className="library-tempo-review-content">{pending.map(file => <section key={file.id}><div className="library-tempo-file-heading"><strong>{file.name}</strong><a href={`/?section=library&file=${file.id}`} target="_blank" rel="noreferrer" aria-label={`Voir ${file.name}`}><ExternalLink size={16} /></a></div>{file.tempoScan!.summary && <p>{file.tempoScan!.summary}</p>}{file.tempoScan!.changed && <p className="library-error">Ce document a changé. Relance son scan avant d’ajouter ces événements.</p>}
        {file.tempoScan!.proposals.filter(row => row.decision === "pending").map(proposal => { const draft = drafts[proposal.id] || proposal.event; return <article key={proposal.id}>
          <label className="library-tempo-proposal-heading"><input type="checkbox" disabled={busy} checked={selected.has(proposal.id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(proposal.id); else next.delete(proposal.id); return next; })} /><span><strong>{draft.title}</strong><small>{draft.date}{draft.endDate !== draft.date ? ` → ${draft.endDate}` : ""} · {draft.allDay ? "Toute la journée" : `${draft.startTime} – ${draft.endTime}`}{proposal.page ? ` · Page ${proposal.page}` : ""}</small></span></label>
          {proposal.note && <p className="library-tempo-proposal-note">{proposal.note}</p>}
          <details><summary>Modifier les détails</summary><fieldset disabled={busy || !selected.has(proposal.id)}><label>Titre<input value={draft.title} maxLength={160} required onChange={event => edit(proposal.id, proposal.event, { title: event.target.value })} /></label><label className="library-tempo-all-day"><input type="checkbox" checked={draft.allDay} onChange={event => edit(proposal.id, proposal.event, { allDay: event.target.checked, startTime: event.target.checked ? null : "09:00", endTime: event.target.checked ? null : "10:00" })} />Toute la journée</label><div><label>Date de début<input type="date" value={draft.date} required onChange={event => edit(proposal.id, proposal.event, { date: event.target.value, ...(draft.endDate < event.target.value ? { endDate: event.target.value } : {}) })} /></label><label>Date de fin<input type="date" min={draft.date} value={draft.endDate} required onChange={event => edit(proposal.id, proposal.event, { endDate: event.target.value })} /></label>{!draft.allDay && <><label>Heure de début<input type="time" value={draft.startTime || ""} required onChange={event => edit(proposal.id, proposal.event, { startTime: event.target.value })} /></label><label>Heure de fin<input type="time" value={draft.endTime || ""} required onChange={event => edit(proposal.id, proposal.event, { endTime: event.target.value })} /></label></>}</div><label>Description<textarea value={draft.description} maxLength={4000} rows={2} onChange={event => edit(proposal.id, proposal.event, { description: event.target.value })} /></label></fieldset></details>
        </article>; })}</section>)}</div>
      {error && <p className="library-error" role="alert">{error}</p>}
      <div className="library-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Plus tard</button><button type="submit" className="library-primary" disabled={busy}>{busy ? "Enregistrement…" : count ? `Ajouter ${count} événement${count > 1 ? "s" : ""}` : "Ignorer les propositions"}</button></div>
    </form>
  </dialog>;
}
