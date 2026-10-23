import { useEffect, useRef, useState } from "react";
import { Folder, X } from "lucide-react";
import { folderPath, type LibraryFile, type LibraryFolder } from "../../lib/library";

export type LibraryAction = { type: "create" } | { type: "rename" | "move" | "delete"; entry: LibraryFolder | LibraryFile; isFolder: boolean };
export default function LibraryDialog({ action, folders, location, onClose, onSubmit }: {
  action: LibraryAction; folders: LibraryFolder[]; location: string | null; onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(action.type === "rename" ? action.entry.name : action.type === "move" ? (action.isFolder ? (action.entry as LibraryFolder).parentId : (action.entry as LibraryFile).folderId) || "" : "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const node = dialog.current; node?.showModal(); node?.querySelector<HTMLElement>("input, select")?.focus(); return () => node?.close(); }, []);
  const title = { create: "Nouveau dossier", rename: "Renommer", move: "Déplacer", delete: "Supprimer cet élément ?" }[action.type];
  const choices = folders.filter(folder => !folder.managed && !(action.type === "move" && action.isFolder && folderPath(folders, folder.id).some(row => row.id === action.entry.id)));
  return <dialog ref={dialog} className="library-dialog" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }} aria-labelledby="library-dialog-title">
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await onSubmit(value); onClose(); } catch (error) { setError(error instanceof Error ? error.message : "L’action a échoué."); setBusy(false); } }}>
      <div className="library-dialog-heading"><span className="library-dialog-icon"><Folder size={24} /></span><button type="button" aria-label="Fermer" disabled={busy} onClick={onClose}><X size={20} /></button></div>
      <h2 id="library-dialog-title">{title}</h2>
      {action.type === "delete" ? <p>« {action.entry.name} » sera supprimé de ta bibliothèque. {action.isFolder ? "Le dossier doit être vide." : "Cette action supprime le fichier enregistré."}</p> : action.type === "move" ? <><p>Choisis un emplacement pour « {action.entry.name} ».</p><label htmlFor="library-destination">Dossier de destination</label><select id="library-destination" value={value} onChange={event => setValue(event.target.value)} autoFocus><option value="">Mes documents</option>{choices.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folders, folder.id).map(row => row.name).join(" / ")}</option>)}</select></> : <><p>{action.type === "create" ? `Dans ${location ? folders.find(row => row.id === location)?.name : "Mes documents"}` : "Choisis un nom facile à retrouver."}</p><label htmlFor="library-entry-name">{action.type === "create" ? "Nom du dossier" : "Nouveau nom"}</label><input id="library-entry-name" value={value} onChange={event => setValue(event.target.value)} maxLength={action.type === "create" || action.isFolder ? 120 : 240} required autoFocus autoComplete="off" placeholder="Ex. Notes de cours" /></>}
      {error && <p className="library-error" role="alert">{error}</p>}
      <div className="library-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Annuler</button><button className={action.type === "delete" ? "library-danger" : "library-primary"} type="submit" disabled={busy || (["create", "rename"].includes(action.type) && !value.trim())}>{busy ? "Enregistrement…" : { create: "Créer le dossier", rename: "Enregistrer", move: "Déplacer ici", delete: "Supprimer" }[action.type]}</button></div>
    </form>
  </dialog>;
}
