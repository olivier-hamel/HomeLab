import { useState } from "react";
import { CalendarSearch, Download, FileText, Presentation } from "lucide-react";
import { fileSize, folderPath, type LibraryFile, type LibraryFolder } from "../../lib/library";

const date = (value: string) => new Date(value).toLocaleDateString("fr-CA", { day: "numeric", month: "short" });

export default function LibraryFileInfo({ file, folders, aiAvailable, onOpen, onScan }: {
  file: LibraryFile; folders: LibraryFolder[]; aiAvailable?: boolean;
  onOpen?: () => void; onScan: (file: LibraryFile) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const Icon = file.kind === "pdf" ? FileText : Presentation;
  const scan = file.tempoScan;
  const scanLabel = scan?.state === "queued" ? (aiAvailable ? "Scan Tempo en attente…" : "En attente de configuration…") : scan?.state === "scanning" ? "Scan Tempo en cours…" : scan ? "Relancer le scan Tempo" : "Scanner pour Tempo";
  const scanFile = async () => {
    setBusy(true); setError("");
    try { setError(await onScan(file) || ""); }
    catch (error) { setError(error instanceof Error ? error.message : "Le scan n’a pas pu être lancé."); }
    finally { setBusy(false); }
  };
  return <div className="library-file-info">
    <span className={`library-inspector-art library-type-icon ${file.kind}`}><Icon size={58} strokeWidth={1} /></span>
    <h2>{file.name}</h2><p>{file.kind === "pdf" ? "Document PDF" : "Présentation PowerPoint"}</p>
    <dl><dt>Taille</dt><dd>{fileSize(file.size)}</dd><dt>Ajouté le</dt><dd>{date(file.createdAt)}</dd><dt>Modifié le</dt><dd>{date(file.updatedAt)}</dd><dt>Origine</dt><dd>{file.source ? "Moodle" : "Import personnel"}</dd><dt>Emplacement</dt><dd>{folderPath(folders, file.folderId).map(row => row.name).join(" / ") || "Mes documents"}</dd><dt>État</dt><dd>{file.ready ? "Enregistré dans HomeLab" : "En attente de téléchargement"}</dd></dl>
    {file.error && <p className="library-inspector-warning">{file.error}</p>}
    {file.ready && <>
      {onOpen && <button className="library-primary" onClick={onOpen}>Ouvrir le document</button>}
      <button className="library-scan-button" disabled={busy || !!scan && ["queued", "scanning"].includes(scan.state)} onClick={() => void scanFile()}><CalendarSearch size={16} />{busy ? "Lancement du scan…" : scanLabel}</button>
      {(error || scan?.error) && <p className="library-inspector-warning" role="alert">{error || scan?.error}</p>}
      {scan?.state === "ready" && <p className="library-inspector-tip">{scan.proposals.filter(row => row.decision === "pending").length} proposition(s) à vérifier.{scan.summary ? ` ${scan.summary}` : ""}</p>}
      <a className="library-inspector-download" href={`/api/library/files/${file.id}/original`} download><Download size={16} />Télécharger l’original</a>
    </>}
  </div>;
}
