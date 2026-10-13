import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownAZ, ArrowLeft, Bell, CalendarSearch, ChevronDown, ChevronRight, Clock3, CloudDownload, Download, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Grid2X2, HardDrive, Info, List, MoreHorizontal, Pencil, Presentation, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { descendants, fileSize, folderPath, libraryRequest, normalized, type LibraryData, type LibraryFile, type LibraryFolder } from "../lib/library";
import LibraryDialog, { type LibraryAction } from "../components/library/LibraryDialog";
import LibraryReader from "../components/library/LibraryReader";
import LibraryFileInfo from "../components/library/LibraryFileInfo";
import TempoReviewDialog from "../components/library/TempoReviewDialog";
import "./library.css";

type Scope = "folder" | "recent" | "all";
const date = (value: string) => new Date(value).toLocaleDateString("fr-CA", { day: "numeric", month: "short" });
export default function Library() {
  const [data, setData] = useState<LibraryData | null>(null), [error, setError] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null), [scope, setScope] = useState<Scope>("folder");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(["moodle"]));
  const [reviewFiles, setReviewFiles] = useState<LibraryFile[] | null>(null);
  const [readerPage, setReaderPage] = useState(1);
  const consumedLink = useRef(false);
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<"all" | "pdf" | "powerpoint">("all");
  const [view, setView] = useState<"list" | "grid">("list"), [sort, setSort] = useState<"name" | "date">("name");
  const [action, setAction] = useState<LibraryAction | null>(null), [reader, setReader] = useState<LibraryFile | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [uploads, setUploads] = useState<string[]>([]);
  const [syncBusy, setSyncBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [mobileFolders, setMobileFolders] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null), mounted = useRef(false), requestNumber = useRef(0);
  const folderTree = useRef<HTMLElement>(null);
  const reload = useCallback(async () => {
    const number = ++requestNumber.current;
    const result = await libraryRequest<LibraryData>();
    if (mounted.current && number === requestNumber.current) {
      setData(result); setError("");
      if (!consumedLink.current) {
        const url = new URL(location.href), id = url.searchParams.get("file");
        if (id) { const linked = result.files.find(file => file.id === id); if (linked) { setFolderId(linked.folderId); setExpandedFolders(previous => new Set([...previous, ...folderPath(result.folders, linked.folderId).map(folder => folder.id)])); setSelected(id); if (linked.ready) { setReaderPage(Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1))); setReader(linked); } } url.searchParams.delete("file"); url.searchParams.delete("page"); history.replaceState(null, "", url); }
        consumedLink.current = true;
      }
    }
    return result;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => { void reload().catch(error => { if (mounted.current) setError(error.message); }); }, 0);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => { void reload().catch(() => {}); }, data?.sync.status === "running" || data?.files.some(file => file.tempoScan && ["queued", "scanning"].includes(file.tempoScan.state)) ? 3000 : 15_000);
    const focus = () => { void reload().catch(() => {}); };
    window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [reload, data?.sync.status, data?.files]);
  const openFolder = (id: string | null) => { setFolderId(id); setScope("folder"); setQuery(""); setSelected(null); setMobileFolders(false); setExpandedFolders(previous => new Set([...previous, ...folderPath(data?.folders ?? [], id).map(folder => folder.id)])); };
  const openReader = (file: LibraryFile) => { setReaderPage(1); setReader(file); };
  const folders = data?.folders ?? [], files = data?.files ?? [];
  const currentFolder = folders.find(row => row.id === folderId);
  const managed = !!currentFolder?.managed;
  const searching = !!query.trim(), needle = normalized(query.trim());
  const currentFiles = files.filter(file => {
    if (filter !== "all" && file.kind !== filter) return false;
    if (searching) return normalized(`${file.name} ${file.source?.module ?? ""} ${folderPath(folders, file.folderId).map(row => row.name).join(" ")}`).includes(needle);
    return scope !== "folder" || file.folderId === folderId;
  }).sort((a, b) => sort === "date" || scope === "recent" ? b.updatedAt.localeCompare(a.updatedAt) : a.name.localeCompare(b.name, "fr", { numeric: true }));
  const shownFiles = scope === "recent" && !searching ? currentFiles.slice(0, 30) : currentFiles;
  const currentFolders = (searching ? folders.filter(folder => normalized(folder.name).includes(needle)) : scope === "folder" && filter === "all" ? folders.filter(folder => folder.parentId === folderId) : []).sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }));
  const selectedFile = files.find(row => row.id === selected);
  const selectedFolder = folders.find(row => row.id === selected);
  const path = folderPath(folders, folderId);
  const sidebarPath = new Set(scope === "folder" ? path.map(folder => folder.id) : []);
  useEffect(() => {
    const current = folderTree.current?.querySelector<HTMLButtonElement>("button[aria-current='page']");
    if (current?.getClientRects().length) current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [folderId, scope, mobileFolders, expandedFolders]);
  const title = searching ? "Résultats de recherche" : scope === "recent" ? "Récents" : scope === "all" ? "Tous les fichiers" : currentFolder?.name ?? "Mes documents";
  const readyFiles = files.filter(file => file.ready);
  const proposedFiles = files.filter(file => file.tempoScan?.state === "ready" && file.tempoScan.proposals.some(row => row.decision === "pending"));
  const proposedCount = proposedFiles.reduce((sum, file) => sum + file.tempoScan!.proposals.filter(row => row.decision === "pending").length, 0);
  const scanFile = async (file: LibraryFile) => {
    try { await libraryRequest(`/files/${file.id}/scan`, "POST", {}); await reload(); return null; }
    catch (error) { const message = error instanceof Error ? error.message : "Le scan n’a pas pu être lancé."; setError(message); return message; }
  };
  const scanLabel = (file: LibraryFile) => file.tempoScan?.state === "queued" ? (data?.aiAvailable ? "Scan Tempo en attente…" : "En attente de Gemini…") : file.tempoScan?.state === "scanning" ? "Scan Tempo en cours…" : file.tempoScan ? "Relancer le scan Tempo" : "Scanner pour Tempo";
  const syncing = syncBusy || data?.sync.status === "running";
  const countInFolder = (folder: LibraryFolder) => { const ids = descendants(folders, folder.id); return files.filter(file => file.folderId && ids.has(file.folderId)).length; };
  const sync = async () => {
    setSyncBusy(true); setError("");
    try { await libraryRequest("/sync", "POST", {}); await reload(); } catch (error) { setError(error instanceof Error ? error.message : "Moodle est indisponible."); }
    finally { if (mounted.current) setSyncBusy(false); }
  };
  const upload = async (list: FileList | File[]) => {
    const target = folderId, pending = [...list];
    if (managed || uploads.length) return;
    setUploads(pending.map(file => file.name)); setError(""); const errors: string[] = [];
    for (const file of pending) {
      try {
        if (!/\.(pdf|pptx?)$/i.test(file.name)) throw new Error(`${file.name} : seuls PDF, PPT et PPTX sont acceptés.`);
        if (file.size > (data?.maxFileBytes ?? 25 * 1024 * 1024)) throw new Error(`${file.name} : la limite est de 25 Mo.`);
        await libraryRequest("/files", "POST", file, { "X-File-Id": crypto.randomUUID(), "X-File-Name": encodeURIComponent(file.name), "X-File-Folder": target ?? "" });
      } catch (error) { errors.push(error instanceof Error ? error.message : `L’import de ${file.name} a échoué.`); }
      if (mounted.current) setUploads(previous => previous.slice(1));
    }
    if (mounted.current) setError(errors.join(" "));
    await reload().catch(() => {});
    if (mounted.current && errors.length) setError(errors.join(" "));
    if (uploadInput.current) uploadInput.current.value = "";
  };
  const submitAction = async (value: string) => {
    if (!action) return;
    if (action.type === "create") await libraryRequest("/folders", "POST", { id: crypto.randomUUID(), name: value, parentId: folderId });
    else {
      const path = `/${action.isFolder ? "folders" : "files"}/${action.entry.id}`;
      await libraryRequest(path, action.type === "delete" ? "DELETE" : "PATCH", action.type === "delete" ? {} : action.type === "rename" ? { name: value } : action.isFolder ? { parentId: value || null } : { folderId: value || null });
      if (action.type === "delete") setSelected(null);
    }
    await reload();
  };
  const folderMenu = (entry: LibraryFolder) => {
    return <details className="library-entry-menu" onClick={event => event.stopPropagation()} onToggle={event => { if (event.currentTarget.open) document.querySelectorAll<HTMLDetailsElement>(".library-entry-menu[open]").forEach(menu => { if (menu !== event.currentTarget) menu.open = false; }); }}><summary aria-label={`Actions pour ${entry.name}`} title="Actions"><MoreHorizontal size={18} /></summary><div>
      <button onClick={event => { event.currentTarget.closest("details")!.open = false; setSelected(entry.id); }}>Informations</button>
      {!entry.managed && <><button onClick={event => { event.currentTarget.closest("details")!.open = false; setAction({ type: "rename", entry, isFolder: true }); }}>Renommer</button><button onClick={event => { event.currentTarget.closest("details")!.open = false; setAction({ type: "move", entry, isFolder: true }); }}>Déplacer</button><button className="library-menu-danger" onClick={event => { event.currentTarget.closest("details")!.open = false; setAction({ type: "delete", entry, isFolder: true }); }}>Supprimer</button></>}
      {entry.managed && <span>Géré par Moodle</span>}
    </div></details>;
  };
  const fileActions = (file: LibraryFile) => <div className="library-file-actions" role="group" aria-label={`Actions pour ${file.name}`}>
    {file.ready && <>
      <a href={`/api/library/files/${file.id}/original`} download title="Télécharger" aria-label={`Télécharger ${file.name}`}><Download size={14} /><span className="library-file-action-label">Télécharger</span></a>
      <button type="button" title={scanLabel(file)} aria-label={`${scanLabel(file)} : ${file.name}`} disabled={!!file.tempoScan && ["queued", "scanning"].includes(file.tempoScan.state)} onClick={() => void scanFile(file)}><CalendarSearch size={14} /><span className="library-file-action-label">{scanLabel(file)}</span></button>
    </>}
    {!file.source && <>
      <button type="button" title="Renommer" aria-label={`Renommer ${file.name}`} onClick={() => setAction({ type: "rename", entry: file, isFolder: false })}><Pencil size={14} /><span className="library-file-action-label">Renommer</span></button>
      <button type="button" title="Déplacer" aria-label={`Déplacer ${file.name}`} onClick={() => setAction({ type: "move", entry: file, isFolder: false })}><FolderInput size={14} /><span className="library-file-action-label">Déplacer</span></button>
      <button type="button" className="library-file-action-danger" title="Supprimer" aria-label={`Supprimer ${file.name}`} onClick={() => setAction({ type: "delete", entry: file, isFolder: false })}><Trash2 size={14} /><span className="library-file-action-label">Supprimer</span></button>
    </>}
    <button type="button" className="library-file-action-info" title="Informations" aria-label={`Informations sur ${file.name}`} onClick={() => setSelected(file.id)}><Info size={14} /></button>
  </div>;
  const sidebarFolders = new Map<string | null, LibraryFolder[]>();
  [...folders].sort((a, b) => Number(b.id === "moodle") - Number(a.id === "moodle") || a.name.localeCompare(b.name, "fr", { numeric: true })).forEach(folder => {
    const siblings = sidebarFolders.get(folder.parentId) ?? [];
    siblings.push(folder); sidebarFolders.set(folder.parentId, siblings);
  });
  const renderFolderTree = (parentId: string | null): ReactNode => (sidebarFolders.get(parentId) ?? []).map(folder => {
    const hasChildren = !!sidebarFolders.get(folder.id)?.length;
    const expanded = hasChildren && expandedFolders.has(folder.id);
    const active = scope === "folder" && folderId === folder.id;
    const onPath = sidebarPath.has(folder.id);
    const Icon = expanded || active ? FolderOpen : Folder;
    return <li key={folder.id}>
      <div className={`library-tree-row ${active ? "active" : onPath ? "is-in-path" : ""}`}>
        {hasChildren ? <button type="button" className="library-tree-toggle" aria-label={`${expanded ? "Replier" : "Développer"} ${folder.name}`} aria-expanded={expanded} onClick={() => setExpandedFolders(previous => { const next = new Set(previous); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="library-tree-spacer" />}
        <button type="button" className="library-tree-open" title={folder.name} aria-current={active ? "page" : undefined} onClick={() => openFolder(folder.id)}>{folder.id === "moodle" ? <span className="library-moodle-mark">m</span> : <Icon size={16} />}<span className="library-folder-label">{folder.name}</span>{folder.id === "moodle" && <span className="library-semester">{data?.semester ?? "A26"}</span>}</button>
      </div>
      {expanded && <ul className="library-tree-group">{renderFolderTree(folder.id)}</ul>}
    </li>;
  });
  return <section className="library-app" lang="fr" aria-label="Bibliothèque de documents">
    <aside className={`library-sidebar ${mobileFolders ? "is-open" : ""}`}>
      <div className="library-brand"><span><FolderOpen size={24} /></span><div><strong>Bibliothèque</strong><small>Tout, au même endroit.</small></div><button className="library-mobile-close" aria-label="Fermer les dossiers" onClick={() => setMobileFolders(false)}><X size={20} /></button></div>
      <p className="library-sidebar-label">BIBLIOTHÈQUE</p>
      <nav aria-label="Navigation de la bibliothèque"><button className={scope === "folder" && folderId === null ? "active" : ""} onClick={() => openFolder(null)}><HardDrive size={18} />Mes documents</button><button className={scope === "all" ? "active" : ""} onClick={() => { setScope("all"); setQuery(""); setSelected(null); setMobileFolders(false); }}><FileText size={18} />Tous les fichiers<span>{files.length}</span></button><button className={scope === "recent" ? "active" : ""} onClick={() => { setScope("recent"); setQuery(""); setSelected(null); setMobileFolders(false); }}><Clock3 size={18} />Récents</button></nav>
      <p className="library-sidebar-label">DOSSIERS</p>
      <nav className="library-folder-tree" aria-label="Dossiers" ref={folderTree}><ul className="library-tree-root">{renderFolderTree(null)}</ul></nav>
      <div className="library-sidebar-bottom"><span className="library-storage-icon"><CloudDownload size={18} /></span><strong>Conservés dans HomeLab</strong><p>Les fichiers enregistrés restent accessibles quand Moodle est indisponible.</p><div><span>{readyFiles.length} fichiers</span><span>{fileSize(readyFiles.reduce((sum, file) => sum + file.size, 0))}</span></div></div>
    </aside>
    {mobileFolders && <button className="library-sidebar-backdrop" aria-label="Fermer les dossiers" onClick={() => setMobileFolders(false)} />}
    <div className="library-workspace">
      <header className="library-topbar"><div className="library-navigation"><button aria-label="Dossier parent" title="Dossier parent" disabled={scope === "folder" && !folderId && !searching} onClick={() => searching || scope !== "folder" ? openFolder(null) : openFolder(currentFolder?.parentId ?? null)}><ArrowLeft size={19} /></button><button className="library-folder-toggle" aria-label="Afficher les dossiers" onClick={() => setMobileFolders(true)}><FolderOpen size={19} /></button><nav aria-label="Fil d’Ariane"><button onClick={() => openFolder(null)}>Bibliothèque</button>{scope === "folder" && path.map(folder => <span key={folder.id}><ChevronRight size={13} /><button onClick={() => openFolder(folder.id)} aria-current={folder.id === folderId ? "page" : undefined}>{folder.name}</button></span>)}{scope !== "folder" && <span><ChevronRight size={13} /><span>{scope === "recent" ? "Récents" : "Tous les fichiers"}</span></span>}</nav></div><label className="library-search"><Search size={17} /><input type="search" aria-label="Rechercher dans la bibliothèque" placeholder="Rechercher dans la bibliothèque" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" aria-label="Effacer la recherche" onClick={() => setQuery("")}><X size={14} /></button>}</label></header>
      <div className="library-heading"><div><p className="library-eyebrow">TON ESPACE DOCUMENTAIRE</p><h1 title={title}>{title}</h1><p>{searching ? `Recherche dans toute la bibliothèque pour « ${query} »` : folderId === "moodle" ? `Tes cours d’automne ${data?.semester.replace("A", "20") ?? "2026"}, organisés automatiquement.` : currentFolder?.managed ? "Les documents de ton cours, conservés et actualisés automatiquement." : scope === "recent" ? "Les derniers documents ajoutés ou mis à jour." : "Tes idées, tes cours et tes références. Bien rangés."}</p></div><div className="library-heading-actions"><button disabled={!data || managed || uploads.length > 0} onClick={() => setAction({ type: "create" })}><FolderPlus size={17} /><span>Nouveau dossier</span></button><button className="library-primary" disabled={!data || managed || uploads.length > 0} aria-busy={uploads.length > 0} title={uploads.length ? `Import de ${uploads[0]}` : undefined} onClick={() => uploadInput.current?.click()}>{uploads.length ? <RefreshCw size={17} className="is-spinning" /> : <Upload size={17} />}<span>{uploads.length ? "Import en cours…" : "Importer"}</span></button></div></div>
      <input ref={uploadInput} type="file" accept=".pdf,.ppt,.pptx" multiple className="library-file-input" aria-label="Importer des PDF ou PowerPoint" onChange={event => { if (event.target.files?.length) void upload(event.target.files); }} />
      {error && <div className="library-feedback"><p className="library-error" role="alert">{error}<button aria-label="Masquer l’erreur" onClick={() => setError("")}><X size={16} /></button></p></div>}
      {proposedCount > 0 && <div className="library-tempo-notification"><Bell size={18} /><div><strong>{proposedCount} événement{proposedCount > 1 ? "s" : ""} à vérifier dans Tempo</strong><p>Les propositions restent disponibles jusqu’à ta décision.</p></div><button onClick={() => setReviewFiles(proposedFiles)}>Vérifier les propositions</button></div>}
      <div className="library-toolbar"><div className="library-filters" role="group" aria-label="Filtrer par format">{([['all', 'Tout'], ['pdf', 'PDF'], ['powerpoint', 'PowerPoint']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="library-view-controls"><label className="library-sort"><ArrowDownAZ size={15} /><select aria-label="Trier les fichiers" value={sort} onChange={event => setSort(event.target.value as "name" | "date")}><option value="name">Nom</option><option value="date">Date de modification</option></select><ChevronDown size={12} /></label><div role="group" aria-label="Présentation des fichiers"><button aria-label="Vue en liste" aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={17} /></button><button aria-label="Vue en grille" aria-pressed={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid2X2 size={16} /></button></div><button aria-label="Actualiser la bibliothèque" title="Actualiser" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await reload(); } catch (error) { setError((error as Error).message); } finally { setRefreshing(false); } }}><RefreshCw size={15} className={refreshing ? "is-spinning" : ""} /></button></div></div>
      <div className="library-body"><div className="library-content" onDragOver={event => { if (!managed && !uploads.length && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={event => { event.preventDefault(); if (data && !managed && !uploads.length && event.dataTransfer.files.length) void upload(event.dataTransfer.files); }}>
        {!data ? <div className="library-empty">{error ? <><CloudDownload size={38} /><h2>La bibliothèque est indisponible</h2><p>{error}</p><button onClick={() => void reload().catch(error => setError(error.message))}>Réessayer</button></> : <><span className="library-spinner" /><p>Ouverture de la bibliothèque…</p></>}</div> : <>
          {currentFolders.length > 0 && <section className="library-folders-section" aria-label="Dossiers"><h2>Dossiers <span>{currentFolders.length}</span></h2><div className="library-folder-grid">{currentFolders.map(folder => <article className={`library-folder-card ${selected === folder.id ? "is-selected" : ""}`} key={folder.id}><button className="library-folder-card-open" onClick={() => openFolder(folder.id)}><span className={`library-folder-art ${folder.id === "moodle" ? "moodle" : ""}`}><Folder size={48} strokeWidth={1.25} />{folder.id === "moodle" && <b>m</b>}</span><strong title={folder.name}>{folder.name}</strong><small>{countInFolder(folder)} fichier{countInFolder(folder) !== 1 ? "s" : ""}{folder.managed ? " · Moodle" : ""}</small></button>{folder.id === "moodle" && <button type="button" className="library-folder-sync" aria-label={syncing ? "Synchronisation Moodle en cours" : "Synchroniser Moodle"} title={syncing ? "Synchronisation en cours…" : !data.moodleAvailable ? "La connexion Moodle doit être activée pour ton compte HomeLab." : "Synchroniser Moodle"} disabled={!data.moodleAvailable || syncing} onClick={() => void sync()}><RefreshCw size={15} className={syncing ? "is-spinning" : ""} /></button>}{folderMenu(folder)}</article>)}</div></section>}
          {shownFiles.length > 0 && <section className="library-files-section" aria-label="Fichiers"><h2>{scope === "recent" ? "Derniers documents" : searching ? "Fichiers trouvés" : "Fichiers"}<span>{shownFiles.length}</span></h2><div className={`library-files library-${view}`}>
            {view === "list" && <div className="library-table-heading"><span>Nom</span><span>Modifié le</span><span>Taille</span><span>Actions</span></div>}
            {shownFiles.map(file => { const Icon = file.kind === "pdf" ? FileText : Presentation; return <article key={file.id} className={`library-file-entry ${selected === file.id ? "is-selected" : ""}`}>
              <button className="library-file-open" onClick={() => { setSelected(file.id); if (file.ready) openReader(file); }} title={file.ready ? `Ouvrir ${file.name}` : "En attente de téléchargement"}><span className={`library-type-icon ${file.kind}`}><Icon size={view === "grid" ? 34 : 22} strokeWidth={1.5} />{view === "grid" && <b>{file.kind === "pdf" ? "PDF" : "PPT"}</b>}</span><span className="library-file-name"><strong>{file.name}</strong><small>{!file.ready ? file.error || "En attente de téléchargement" : file.source && !file.source.available ? "Conservé · retiré de Moodle" : file.error ? "Mise à jour à reprendre" : searching || scope !== "folder" ? folderPath(folders, file.folderId).map(row => row.name).join(" / ") || "Mes documents" : file.source?.module || (file.kind === "pdf" ? "Document PDF" : "Présentation PowerPoint")}</small></span></button>
              <span className="library-file-date">{date(file.updatedAt)}</span><span className="library-file-size">{fileSize(file.size)}</span>{fileActions(file)}
            </article>; })}
          </div></section>}
          {!shownFiles.length && !currentFolders.length && <div className="library-empty"><span className="library-empty-icon">{searching ? <Search size={35} /> : <FolderOpen size={39} />}</span><h2>{searching ? "Aucun résultat" : filter !== "all" ? "Aucun fichier de ce format" : managed ? "Les documents arrivent ici" : "Un peu d’espace pour tes idées"}</h2><p>{searching ? "Essaie un autre nom, un cours ou un mot-clé." : managed ? "La synchronisation ajoutera les fichiers disponibles sur Moodle." : "Crée un dossier ou dépose tes PDF et PowerPoint ici."}</p>{!managed && !searching && filter === "all" && <button onClick={() => uploadInput.current?.click()}><Upload size={17} />Importer des fichiers</button>}</div>}
        </>}
      </div>
      {(selectedFile || selectedFolder) && <aside className="library-inspector" aria-label="Informations"><header><strong>Informations</strong><button aria-label="Fermer les informations" onClick={() => setSelected(null)}><X size={18} /></button></header>{selectedFile ? <LibraryFileInfo key={selectedFile.id} file={selectedFile} folders={folders} aiAvailable={data?.aiAvailable} onOpen={() => openReader(selectedFile)} onScan={scanFile} /> : selectedFolder && <><Folder className="library-inspector-folder" size={70} strokeWidth={1} /><h2>{selectedFolder.name}</h2><p>Dossier{selectedFolder.managed ? " Moodle" : " personnel"}</p><dl><dt>Fichiers</dt><dd>{countInFolder(selectedFolder)}</dd><dt>Ajouté le</dt><dd>{date(selectedFolder.createdAt)}</dd><dt>Emplacement</dt><dd>{folderPath(folders, selectedFolder.parentId).map(row => row.name).join(" / ") || "Mes documents"}</dd></dl>{selectedFolder.managed && <p className="library-inspector-tip"><Info size={16} />Ce dossier suit l’organisation de Moodle et se met à jour automatiquement.</p>}<button className="library-primary" onClick={() => openFolder(selectedFolder.id)}>Ouvrir le dossier</button></>}</aside>}
      </div><footer className="library-footer"><span>{currentFolders.length} dossier{currentFolders.length !== 1 ? "s" : ""} · {shownFiles.length} fichier{shownFiles.length !== 1 ? "s" : ""}</span><span><span className="library-footer-dot" />PDF & PowerPoint <span>· 25 Mo par fichier</span></span></footer>
    </div>
    {action && <LibraryDialog action={action} folders={folders} location={folderId} onClose={() => setAction(null)} onSubmit={submitAction} />}
    {reviewFiles && <TempoReviewDialog files={reviewFiles} onClose={() => setReviewFiles(null)} onSaved={reload} />}
    {reader && <LibraryReader key={reader.id} file={files.find(file => file.id === reader.id) ?? reader} folders={folders} aiAvailable={data?.aiAvailable} onScan={scanFile} initialPage={readerPage} onClose={() => setReader(null)} />}
  </section>;
}
