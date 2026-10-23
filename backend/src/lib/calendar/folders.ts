import type { Collection } from "mongodb";
import { database } from "../database.ts";
import { MediaError } from "../media/core.ts";
import { eventId } from "./events.ts";

export type CalendarFolder = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt: string };
type Library = { username: string; folders: CalendarFolder[]; locations: Record<string, string>; updatedAt: string };
let collectionPromise: Promise<Collection<Library>> | null = null;
async function libraryCollection() {
  collectionPromise ??= (async () => {
    const collection = (await database()).collection<Library>("calendar_document_libraries");
    await collection.createIndex({ username: 1 }, { unique: true });
    return collection;
  })().catch(error => { collectionPromise = null; throw error; });
  return collectionPromise;
}
export function folderId(value: unknown): string | null {
  return value === null ? null : eventId(value);
}
export function folderName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\") || [".", ".."].includes(value.trim())) {
    throw new MediaError("input", "Choisis un nom de dossier de 1 à 120 caractères, sans barre oblique.", 400);
  }
  return value.trim().normalize("NFC");
}
function owner(username: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username)) throw new MediaError("account", "Compte invalide.", 403);
  return username;
}
const notFound = () => new MediaError("not_found", "Ce dossier a été supprimé ou n’est pas accessible.", 404);
const conflict = () => new MediaError("conflict", "Ce dossier a changé. Actualise la bibliothèque avant de réessayer.", 409);
function destination(library: Library, id: string | null) {
  if (id !== null && !library.folders.some(folder => folder.id === id)) throw notFound();
}
function uniqueName(library: Library, name: string, parentId: string | null, except?: string) {
  if (library.folders.some(folder => folder.id !== except && folder.parentId === parentId && folder.name.toLocaleLowerCase("fr-CA") === name.toLocaleLowerCase("fr-CA"))) {
    throw new MediaError("conflict", "Un dossier porte déjà ce nom à cet emplacement.", 409);
  }
}

// One atomic snapshot per account keeps concurrent folder moves from creating cycles.
// PDF locations live with the tree so removing an empty folder cannot strand a file.
export class CalendarFolderStore {
  private collection: () => Promise<Collection<Library>>;
  constructor(collection = libraryCollection) { this.collection = collection; }
  async snapshot(username: string): Promise<Library> {
    return await (await this.collection()).findOne({ username: owner(username) })
      ?? { username, folders: [], locations: {}, updatedAt: "" };
  }
  private async mutate<T>(username: string, change: (library: Library, now: string) => T | Promise<T>): Promise<T> {
    const collection = await this.collection();
    for (let attempt = 0; attempt < 8; attempt++) {
      const library = structuredClone(await this.snapshot(username));
      const version = library.updatedAt;
      const now = new Date(Math.max(Date.now(), Date.parse(version) + 1 || 0)).toISOString();
      const result = await change(library, now);
      library.updatedAt = now;
      if (!version) {
        try { await collection.insertOne(library); return result; }
        catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
      } else {
        const saved = await collection.findOneAndUpdate({ username, updatedAt: version }, { $set: { folders: library.folders, locations: library.locations, updatedAt: now } });
        if (saved) return result;
      }
    }
    throw conflict();
  }
  async list(username: string) { return (await this.snapshot(username)).folders; }
  async assertDestination(username: string, id: string | null) { destination(await this.snapshot(username), id); }
  async create(username: string, id: string, name: unknown, parentId: string | null) {
    id = eventId(id); const validatedName = folderName(name); parentId = folderId(parentId);
    return this.mutate(username, (library, now) => {
      const previous = library.folders.find(folder => folder.id === id);
      if (previous) {
        if (previous.name === validatedName && previous.parentId === parentId) return previous;
        throw conflict();
      }
      destination(library, parentId);
      if (library.folders.length >= 1000) throw new MediaError("input", "La bibliothèque peut contenir jusqu’à 1 000 dossiers.", 400);
      uniqueName(library, validatedName, parentId);
      const folder = { id, name: validatedName, parentId, createdAt: now, updatedAt: now };
      library.folders.push(folder);
      return folder;
    });
  }
  async update(username: string, id: string, patch: { name?: unknown; parentId?: string | null }, version: string) {
    id = eventId(id);
    return this.mutate(username, (library, now) => {
      const folder = library.folders.find(folder => folder.id === id);
      if (!folder) throw notFound();
      if (folder.updatedAt !== version) throw conflict();
      const name = patch.name === undefined ? folder.name : folderName(patch.name);
      const parentId = patch.parentId === undefined ? folder.parentId : folderId(patch.parentId);
      destination(library, parentId);
      let ancestor = parentId;
      const seen = new Set<string>();
      while (ancestor) {
        if (ancestor === id || seen.has(ancestor)) throw new MediaError("input", "Un dossier ne peut pas être déplacé dans lui-même ou dans un de ses sous-dossiers.", 400);
        seen.add(ancestor);
        ancestor = library.folders.find(row => row.id === ancestor)?.parentId ?? null;
      }
      uniqueName(library, name, parentId, id);
      Object.assign(folder, { name, parentId, updatedAt: now });
      return folder;
    });
  }
  async remove(username: string, id: string, version: string, hasDocuments: (ids: string[]) => Promise<boolean> = async ids => !!ids.length) {
    id = eventId(id);
    await this.mutate(username, async library => {
      const folder = library.folders.find(folder => folder.id === id);
      if (!folder) return;
      if (folder.updatedAt !== version) throw conflict();
      const documents = Object.keys(library.locations).filter(documentId => library.locations[documentId] === id);
      if (library.folders.some(row => row.parentId === id) || documents.length && await hasDocuments(documents)) {
        throw new MediaError("not_empty", "Déplace les documents et les sous-dossiers avant de supprimer ce dossier.", 409);
      }
      library.folders = library.folders.filter(row => row.id !== id);
      for (const documentId of documents) delete library.locations[documentId];
    });
  }
  async locate(username: string, documentId: string, targetId: string | null, previousId?: string | null) {
    documentId = eventId(documentId); targetId = folderId(targetId);
    await this.mutate(username, library => {
      destination(library, targetId);
      const currentId = library.locations[documentId] ?? null;
      if (previousId !== undefined && currentId !== previousId && currentId !== targetId) {
        throw new MediaError("conflict", "Ce PDF a été déplacé ailleurs. Actualise la bibliothèque.", 409);
      }
      if (targetId) library.locations[documentId] = targetId;
      else delete library.locations[documentId];
    });
  }
}
