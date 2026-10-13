import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Presentation, X } from "lucide-react";
import { fileSize, type LibraryFile } from "../../lib/library";
const PdfViewer = lazy(() => import("./PdfViewer"));

export default function LibraryReader({ file, onClose, initialPage = 1 }: { file: LibraryFile; onClose: () => void; initialPage?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  useEffect(() => {
    let disposed = false, objectUrl = ""; const controller = new AbortController();
    fetch(`/api/library/files/${file.id}/preview`, { credentials: "same-origin", signal: controller.signal }).then(async response => {
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || "L’aperçu est indisponible."); }
      const blob = await response.blob(); if (disposed) return;
      objectUrl = URL.createObjectURL(blob); setPreview(objectUrl);
    }).catch(error => { if (!disposed) setError(error instanceof Error ? error.message : "L’aperçu est indisponible."); });
    return () => { disposed = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id]);
  const Icon = file.kind === "pdf" ? FileText : Presentation;
  return <dialog ref={dialog} className="library-reader" onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="library-reader-title">
    <header><span className={`library-type-icon ${file.kind}`}><Icon size={22} /></span><div><h2 id="library-reader-title">{file.name}</h2><p>{file.kind === "pdf" ? "Document PDF" : "Présentation PowerPoint"} · {fileSize(file.size)}{file.source ? " · Moodle" : ""}</p></div><a href={`/api/library/files/${file.id}/original`} download title="Télécharger l’original" aria-label="Télécharger l’original"><Download size={19} /><span>Télécharger</span></a><button type="button" onClick={onClose} aria-label="Fermer l’aperçu"><X size={22} /></button></header>
    {preview ? <><Suspense fallback={<div className="library-preview-status"><span className="library-spinner" /></div>}><PdfViewer url={preview} name={file.name} initialPage={initialPage} /></Suspense><div className="library-reader-footer"><span>{file.kind === "powerpoint" ? "Aperçu PDF de la présentation · original PowerPoint conservé" : "Document original"}</span><a href={preview} target="_blank" rel="noreferrer"><ExternalLink size={14} />Ouvrir l’aperçu</a></div></> : <div className="library-preview-status" role={error ? "alert" : "status"}>{error ? <><Icon size={42} /><h3>Aperçu indisponible</h3><p>{error}</p><a className="library-primary" href={`/api/library/files/${file.id}/original`} download><Download size={17} />Télécharger l’original</a></> : <><span className="library-spinner" /><h3>{file.kind === "powerpoint" ? "Préparation des diapositives…" : "Ouverture du document…"}</h3><p>{file.kind === "powerpoint" ? "Le premier aperçu peut prendre quelques instants." : "Ton fichier reste dans ta bibliothèque."}</p></>}</div>}
  </dialog>;
}
