import { createHash, randomUUID } from "node:crypto";
import { Binary, type Collection } from "mongodb";
import { database } from "../database.ts";
import { MediaError, record } from "../media/core.ts";
import { eventId, validateEvent, type EventInput } from "./events.ts";
import { CalendarFolderStore } from "./folders.ts";

// Keep PDFs below MongoDB's 16 MiB document limit, including analysis metadata.
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PROPOSALS = 100;
export type Proposal = { id: string; event: EventInput; page: number | null; note: string };
export type CalendarDocument = {
  id: string; name: string; size: number; createdAt: string; updatedAt: string; folderId: string | null;
  analysisState: "pending" | "analysing" | "ready" | "error";
  analysisError: string; summary: string; proposals: Proposal[];
};
type StoredDocument = Omit<CalendarDocument, "folderId"> & { username: string; hash: string; pdf: Binary; analysisToken: string; analysisStartedAt: string };
let collectionPromise: Promise<Collection<StoredDocument>> | null = null;
async function documentCollection() {
  collectionPromise ??= (async () => {
    const collection = (await database()).collection<StoredDocument>("calendar_documents");
    await collection.createIndex({ username: 1, id: 1 }, { unique: true });
    await collection.createIndex({ username: 1, hash: 1 }, { unique: true });
    await collection.createIndex({ username: 1, createdAt: -1 });
    return collection;
  })().catch(error => { collectionPromise = null; throw error; });
  return collectionPromise;
}
function owner(username: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username)) throw new MediaError("account", "Compte invalide.", 403);
  return username;
}
function publicDocument(row: StoredDocument, folderId: string | null = null): CalendarDocument {
  return { id: row.id, name: row.name, size: row.size, createdAt: row.createdAt, updatedAt: row.updatedAt,
    analysisState: row.analysisState, analysisError: row.analysisError, summary: row.summary, proposals: row.proposals, folderId };
}
export function validatePdf(name: unknown, bytes: Uint8Array) {
  if (typeof name !== "string" || !name.trim() || name.length > 240 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === "/" || char === "\\") || !/\.pdf$/i.test(name)) throw new MediaError("input", "Choisis un document PDF avec un nom de 240 caractères maximum.", 400);
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new MediaError("too_large", "Chaque PDF doit faire entre 1 octet et 10 Mo.", 413);
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) throw new MediaError("input", "Ce fichier n’est pas un PDF valide.", 400);
  return name.trim();
}
export function validateAnalysis(value: unknown) {
  const row = record(value);
  if (typeof row.summary !== "string" || row.summary.length > 1000 || !Array.isArray(row.events) || row.events.length > MAX_PROPOSALS) throw new MediaError("ai_output", "L’analyse du PDF est incomplète. Réessaie avec un document plus court.", 502);
  const proposals: Proposal[] = row.events.map(value => {
    const proposal = record(value);
    if (proposal.page !== null && (!Number.isInteger(proposal.page) || (proposal.page as number) < 1 || (proposal.page as number) > 1000)) throw new Error("Invalid source page");
    if (typeof proposal.note !== "string" || proposal.note.length > 500) throw new Error("Invalid note");
    const event = validateEvent(proposal.event);
    // A first session spanning the entire bounded weekly series is ambiguous:
    // Gemini likely put the semester ending in endDate. Do not import it or
    // guess a duration. This check is specific to PDF extraction; manually
    // entered events still support overlapping, multi-day occurrences.
    if (event.recurrence?.frequency === "weekly" && event.endDate === event.recurrence.until &&
      Date.parse(event.endDate) - Date.parse(event.date) >= event.recurrence.interval * 7 * 86_400_000) {
      throw new MediaError("ai_output", "L’analyse confond la fin d’une séance avec la fin de sa répétition. Relance le scan du document.", 502);
    }
    return { id: randomUUID(), event, page: proposal.page as number | null, note: proposal.note.trim() };
  });
  return { summary: row.summary.trim(), proposals };
}
export class CalendarDocumentStore {
  private collection: () => Promise<Collection<StoredDocument>>;
  readonly folders: CalendarFolderStore;
  constructor(collection = documentCollection, folders = new CalendarFolderStore()) { this.collection = collection; this.folders = folders; }
  async library(username: string) {
    const [rows, library] = await Promise.all([
      (await this.collection()).find({ username: owner(username) }, { projection: { pdf: 0, hash: 0, analysisToken: 0 } }).sort({ createdAt: -1 }).toArray(),
      this.folders.snapshot(username),
    ]);
    return { documents: rows.map(row => publicDocument(row, library.locations[row.id] ?? null)), folders: library.folders };
  }
  async list(username: string) { return (await this.library(username)).documents; }
  async get(username: string, id: string) {
    const row = await (await this.collection()).findOne({ username: owner(username), id: eventId(id) }, { projection: { pdf: 0, hash: 0, analysisToken: 0 } });
    if (!row) throw new MediaError("not_found", "Ce document a été supprimé ou n’est pas accessible.", 404);
    return publicDocument(row, (await this.folders.snapshot(username)).locations[id] ?? null);
  }
  async stored(username: string, id: string) {
    const row = await (await this.collection()).findOne({ username: owner(username), id: eventId(id) });
    if (!row) throw new MediaError("not_found", "Ce document a été supprimé ou n’est pas accessible.", 404);
    return row;
  }
  async upload(username: string, id: string, name: string, bytes: Uint8Array, folderId: string | null = null) {
    name = validatePdf(name, bytes);
    await this.folders.assertDestination(username, folderId);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const collection = await this.collection();
    const filter = { username: owner(username), hash };
    const existing = await collection.findOne(filter, { projection: { pdf: 0 } });
    if (existing) return { document: await this.get(username, existing.id), existing: true };
    const now = new Date().toISOString();
    const row: StoredDocument = { ...filter, id: eventId(id), name, size: bytes.length, pdf: new Binary(bytes),
      createdAt: now, updatedAt: now, analysisState: "pending", analysisError: "", summary: "", proposals: [], analysisToken: "", analysisStartedAt: "" };
    try { await collection.insertOne(row); }
    catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const previous = await collection.findOne(filter, { projection: { pdf: 0 } });
      if (previous) return { document: await this.get(username, previous.id), existing: true };
      throw new MediaError("conflict", "Cet import a déjà été utilisé pour un autre fichier. Relance l’import.", 409);
    }
    if (folderId) {
      try { await this.folders.locate(username, row.id, folderId); }
      catch (error) {
        // A folder may be removed while bytes are being saved. Keep the PDF at the root.
        if (!(error instanceof MediaError) || error.code !== "not_found") throw error;
        return { document: publicDocument(row), existing: false, folderUnavailable: true };
      }
    }
    return { document: publicDocument(row, folderId), existing: false };
  }
  async move(username: string, id: string, targetId: string | null, previousId: string | null) {
    await this.get(username, id);
    await this.folders.locate(username, id, targetId, previousId);
    try { return await this.get(username, id); }
    catch (error) {
      if (error instanceof MediaError && error.code === "not_found") await this.folders.locate(username, id, null);
      throw error;
    }
  }
  async removeFolder(username: string, id: string, version: string) {
    await this.folders.remove(username, id, version, async ids => {
      // Recover leftover locations if PDF deletion was interrupted after deleting the bytes.
      const row = await (await this.collection()).findOne({ username: owner(username), id: { $in: ids } }, { projection: { id: 1 } });
      return !!row;
    });
  }
  async claimAnalysis(username: string, id: string) {
    const row = await this.stored(username, id);
    if (row.analysisState === "ready") return { row, token: null };
    if (row.analysisState === "analysing" && Date.now() - Date.parse(row.analysisStartedAt) < 120_000) throw new MediaError("conflict", "Ce document est déjà en cours d’analyse. Réessaie dans un instant.", 409);
    const token = randomUUID();
    const startedAt = new Date().toISOString();
    const claimed = await (await this.collection()).findOneAndUpdate({ username, id, updatedAt: row.updatedAt }, {
      $set: { analysisState: "analysing", analysisError: "", analysisToken: token, analysisStartedAt: startedAt, updatedAt: new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString() },
    }, { returnDocument: "after" });
    if (!claimed) throw new MediaError("conflict", "Ce document a changé. Actualise la bibliothèque.", 409);
    return { row: claimed, token };
  }
  async finishAnalysis(username: string, id: string, token: string, patch: Partial<CalendarDocument>) {
    const collection = await this.collection();
    const filter = { username: owner(username), id: eventId(id), analysisToken: token };
    const previous = await collection.findOne(filter, { projection: { updatedAt: 1 } });
    if (!previous) throw new MediaError("not_found", "Ce document a changé ou a été supprimé.", 404);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString();
    const row = await collection.findOneAndUpdate(filter, { $set: { ...patch, updatedAt, analysisToken: "" } }, { returnDocument: "after" });
    if (!row) throw new MediaError("not_found", "Ce document a changé ou a été supprimé.", 404);
    return publicDocument(row, (await this.folders.snapshot(username)).locations[id] ?? null);
  }
  async remove(username: string, id: string, version: string) {
    const collection = await this.collection();
    const result = await collection.deleteOne({ username: owner(username), id: eventId(id), updatedAt: version });
    if (!result.deletedCount && await collection.findOne({ username, id })) throw new MediaError("conflict", "Ce document a changé. Actualise la bibliothèque avant de le supprimer.", 409);
    await this.folders.locate(username, id, null);
  }
}
