import { randomUUID } from "node:crypto";
import { MediaError } from "../media/core.ts";
import { destination, emptyLibrary, entryId, folderName, moveFolder, owner, queuedScan, uniqueFolder, validateFile, type Library, type LibraryFile } from "./model.ts";
import { libraryRows, libraryBlobs } from "./storage.ts";

async function collection() { return libraryRows; }
export type BlobStore = { put(bytes: Uint8Array): Promise<string>; get(id: string): Promise<Uint8Array<ArrayBuffer>>; remove(id: string): Promise<void> };
const missing = () => new MediaError("not_found", "Cet élément n’est plus disponible.", 404);
const managed = () => new MediaError("managed", "Les fichiers et dossiers Moodle sont gérés par la synchronisation.", 409);
export class LibraryStore {
  private rows: typeof collection;
  readonly blobs: BlobStore;
  constructor(rows = collection, blobs: BlobStore = libraryBlobs) { this.rows = rows; this.blobs = blobs; }
  async snapshot(username: string): Promise<Library> {
    return await (await this.rows()).findOne({ username: owner(username) }) ?? emptyLibrary(username);
  }
  async mutate<T>(username: string, change: (library: Library) => T): Promise<T> {
    const rows = await this.rows();
    for (let attempt = 0; attempt < 12; attempt++) {
      const library = structuredClone(await this.snapshot(username));
      const previous = library.version;
      const result = change(library);
      library.version++;
      if (library.folders.length > 1500 || library.files.length > 5000) throw new MediaError("capacity", "La bibliothèque accepte 1 500 dossiers et 5 000 fichiers par compte.", 409);
      if (!previous) {
        try { await rows.insertOne(library); return result; } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
      } else {
        const saved = await rows.updateOne({ username, version: previous }, { $set: { folders: library.folders, files: library.files, sync: library.sync, version: library.version,
          ...(library.tempoArchiveIds ? { tempoArchiveIds: library.tempoArchiveIds } : {}) } });
        if (saved.modifiedCount) return result;
      }
    }
    throw new MediaError("conflict", "La bibliothèque a changé. Actualise-la avant de réessayer.", 409);
  }
  async createFolder(username: string, input: { id: unknown; name: unknown; parentId: string | null }) {
    const id = entryId(input.id), name = folderName(input.name);
    return this.mutate(username, library => {
      const previous = library.folders.find(row => row.id === id);
      if (previous) { if (!previous.managed && previous.name === name && previous.parentId === input.parentId) return previous; throw new MediaError("conflict", "Cet identifiant est déjà utilisé.", 409); }
      destination(library, input.parentId); moveFolder(library, id, input.parentId); uniqueFolder(library, name, input.parentId);
      const folder = { id, name, parentId: input.parentId, managed: false, createdAt: new Date().toISOString() };
      library.folders.push(folder); return folder;
    });
  }
  async updateFolder(username: string, id: string, input: { name?: unknown; parentId?: string | null }) {
    return this.mutate(username, library => {
      const folder = library.folders.find(row => row.id === entryId(id));
      if (!folder) throw missing(); if (folder.managed) throw managed();
      const name = input.name === undefined ? folder.name : folderName(input.name);
      const parentId = input.parentId === undefined ? folder.parentId : input.parentId;
      moveFolder(library, id, parentId); uniqueFolder(library, name, parentId, id);
      Object.assign(folder, { name, parentId }); return folder;
    });
  }
  async removeFolder(username: string, id: string) {
    await this.mutate(username, library => {
      const folder = library.folders.find(row => row.id === entryId(id));
      if (!folder) return; if (folder.managed) throw managed();
      if (library.folders.some(row => row.parentId === id) || library.files.some(row => row.folderId === id)) throw new MediaError("not_empty", "Déplace les fichiers et les sous-dossiers avant de supprimer ce dossier.", 409);
      library.folders = library.folders.filter(row => row.id !== id);
    });
  }
  async upload(username: string, id: string, name: unknown, folderId: string | null, bytes: Uint8Array, legacy = false) {
    id = entryId(id); const validated = validateFile(name, bytes);
    const before = await this.snapshot(username); destination(before, folderId);
    const existing = before.files.find(row => row.id === id);
    if (existing) { if (existing.source) throw managed(); return existing; }
    const blobId = await this.blobs.put(bytes);
    try {
      const result = await this.mutate(username, library => {
        destination(library, folderId);
        const duplicate = library.files.find(row => row.id === id);
        if (duplicate) { if (duplicate.source) throw managed(); return duplicate; }
        const now = new Date().toISOString();
        const file: LibraryFile = { id, ...validated, folderId, size: bytes.length, blobId, previewId: null, createdAt: now, updatedAt: now, error: "", source: null,
          ...(!legacy ? { tempoScan: queuedScan(true) } : {}) };
        library.files.push(file); return file;
      });
      if (result.blobId !== blobId) await this.blobs.remove(blobId);
      return result;
    } catch (error) { await this.blobs.remove(blobId).catch(() => {}); throw error; }
  }
  async get(username: string, id: string) {
    const file = (await this.snapshot(username)).files.find(row => row.id === entryId(id));
    if (!file) throw missing(); return file;
  }
  async updateFile(username: string, id: string, input: { name?: unknown; folderId?: string | null }) {
    return this.mutate(username, library => {
      const file = library.files.find(row => row.id === entryId(id));
      if (!file) throw missing(); if (file.source) throw managed();
      if (input.name !== undefined) {
        if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 240 || /[\p{Cc}/\\]/u.test(input.name)) throw new MediaError("input", "Choisis un nom de fichier valide de 240 caractères maximum.", 400);
        const name = input.name.trim().normalize("NFC");
        if (!/\.(pdf|pptx?)$/i.test(name) || name.split(".").pop()!.toLowerCase() !== file.name.split(".").pop()!.toLowerCase()) throw new MediaError("format", "Conserve l’extension du fichier lors du renommage.", 400);
        file.name = name;
      }
      if (input.folderId !== undefined) { destination(library, input.folderId); file.folderId = input.folderId; }
      file.updatedAt = new Date().toISOString(); return file;
    });
  }
  async removeFile(username: string, id: string) {
    const removed = await this.mutate(username, library => {
      const file = library.files.find(row => row.id === entryId(id));
      if (!file) return null; if (file.source) throw managed();
      library.files = library.files.filter(row => row.id !== id); return file;
    });
    for (const blob of [removed?.blobId, removed?.previewId]) if (blob) await this.blobs.remove(blob).catch(() => {});
  }
  async savePreview(username: string, file: LibraryFile, bytes: Uint8Array) {
    const previewId = await this.blobs.put(bytes);
    try {
      const saved = await this.mutate(username, library => {
        const current = library.files.find(row => row.id === file.id);
        if (!current || current.blobId !== file.blobId) throw new MediaError("conflict", "Le fichier a changé pendant la préparation de l’aperçu.", 409);
        if (current.previewId) return current.previewId;
        current.previewId = previewId; return previewId;
      });
      if (saved !== previewId) await this.blobs.remove(previewId); return saved;
    } catch (error) { await this.blobs.remove(previewId).catch(() => {}); throw error; }
  }
}
export const libraryStore = new LibraryStore();
export const newFileId = () => randomUUID();
