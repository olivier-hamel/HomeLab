import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, FileText, Folder, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import Dialog from './Dialog'
import { readLibrary } from './libraryApi'
import type { ReferenceDocument } from './types'

type FolderRow = { id: string; name: string; parentId: string | null }
type FileRow = { id: string; name: string; folderId: string | null; kind: 'pdf' | 'powerpoint'; size: number; ready: boolean }
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export default function LibraryDocumentPicker({ attached, onAdd, onClose, onBusy }: {
  attached: ReferenceDocument[]; onAdd: (files: ReferenceDocument[]) => void; onClose: () => void; onBusy: (busy: boolean) => void
}) {
  const [data, setData] = useState<{ files: FileRow[]; folders: FolderRow[] } | null>(null)
  const [location, setLocation] = useState<string | null>(null), [query, setQuery] = useState(''), [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { let active = true; void readLibrary<{ files: FileRow[]; folders: FolderRow[] }>('library-documents').then(result => { if (active) { setData(result); setError('') } }).catch(error => { if (active) setError(error.message) }); return () => { active = false } }, [revision])
  const existing = new Set(attached.map(file => file.id)), limit = 20 - attached.length
  const folders = data?.folders ?? [], files = (data?.files ?? []).filter(file => query ? normalize(file.name).includes(normalize(query)) : file.folderId === location)
  const choices = query ? [] : folders.filter(folder => folder.parentId === location)
  const current = folders.find(folder => folder.id === location)
  return <Dialog title="Choisir dans Bibliothèque" onClose={() => { if (!busy) onClose() }}>
    <p className="modal-description">Ajoute les documents de ta bibliothèque à cet ensemble. Leurs originaux restent au même endroit.</p>
    <div className="memo-library-search"><Search size={17} /><input type="search" aria-label="Rechercher un document dans Bibliothèque" placeholder="Rechercher un document" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" className="icon-button" aria-label="Actualiser Bibliothèque" disabled={busy} onClick={() => setRevision(n => n + 1)}><RefreshCw size={16} /></button></div>
    <div className="memo-library-location"><button type="button" disabled={!location || busy} onClick={() => { setLocation(current?.parentId ?? null); setQuery('') }}><ChevronLeft size={17} />Retour</button><strong>{query ? 'Résultats dans toute la bibliothèque' : current?.name || 'Mes documents'}</strong></div>
    <div className="memo-library-choices">
      {choices.map(folder => <button key={folder.id} type="button" className="memo-library-folder" disabled={busy} onClick={() => setLocation(folder.id)}><Folder size={22} /><span>{folder.name}</span></button>)}
      {files.map(file => <label key={file.id} className={`memo-library-file ${existing.has(file.id) ? 'is-attached' : ''}`}><input type="checkbox" checked={selected.includes(file.id)} disabled={busy || existing.has(file.id) || !file.ready || !selected.includes(file.id) && selected.length >= limit} onChange={event => setSelected(previous => event.target.checked ? [...previous, file.id] : previous.filter(id => id !== file.id))} /><FileText size={22} /><span><strong>{file.name}</strong><small>{existing.has(file.id) ? 'Déjà ajouté à cet ensemble' : !file.ready ? 'Téléchargement en cours' : file.kind === 'pdf' ? 'PDF' : 'PowerPoint'}</small></span></label>)}
      {!data && !error && <p role="status"><LoaderCircle className="import-spinner" size={20} />Chargement de Bibliothèque…</p>}
      {data && !choices.length && !files.length && <p>Aucun document à cet emplacement.</p>}
    </div>
    {error && <p className="detail-error" role="alert">{error}</p>}
    <div className="reference-picker-footer"><a className="secondary-button" href="/?section=library" target="_blank" rel="noreferrer">Ouvrir Bibliothèque</a><button type="button" className="primary-button" disabled={busy || !selected.length} onClick={async () => {
      setBusy(true); onBusy(true); setError('')
      try { const result = await readLibrary<{ documents: ReferenceDocument[] }>('library-documents/attach', { document_ids: selected }); if (alive.current) { onAdd(result.documents); onClose() } }
      catch (error) { if (alive.current) setError((error as Error).message) }
      finally { onBusy(false); if (alive.current) setBusy(false) }
    }}>{busy ? <><LoaderCircle size={16} className="import-spinner" />Préparation du lecteur…</> : `Ajouter ${selected.length || ''} document${selected.length !== 1 ? 's' : ''}`}</button></div>
    <p className="modal-footnote">PDF & PowerPoint · {limit} emplacement{limit !== 1 ? 's' : ''} disponible{limit !== 1 ? 's' : ''}. Importe les nouveaux fichiers dans Bibliothèque.</p>
  </Dialog>
}
