import { createHash } from "node:crypto";
import { MediaError } from "../media/core.ts";
import type { MoodleCourse, MoodleFile } from "../moodle/client.ts";
import type { EventInput } from "../calendar/events.ts";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const SYNC_INTERVAL = 30 * 60 * 1000;
export const MOODLE_FOLDER = "moodle";
export type FileKind = "pdf" | "powerpoint";
export type LibraryFolder = { id: string; name: string; parentId: string | null; managed: boolean; createdAt: string };
export type LibraryFile = {
  id: string; name: string; folderId: string | null; kind: FileKind; size: number;
  createdAt: string; updatedAt: string; blobId: string | null; previewId: string | null; error: string;
  source: null | { courseId: number; fileId: string; module: string; fingerprint: string; checkedAt: string; available: boolean };
  tempoScan?: TempoScan;
  tempoDecisions?: Record<string, "added" | "ignored">;
};
export type TempoProposal = { id: string; event: EventInput; page: number | null; note: string; decision: "pending" | "added" | "ignored" };
export type TempoScan = { id: string; state: "queued" | "scanning" | "ready" | "error"; automatic: boolean;
  requestedAt: string; completedAt: string | null; retryAt: string; token: string; leaseUntil: string;
  blobId: string | null; summary: string; error: string; proposals: TempoProposal[] };
export function queuedScan(automatic: boolean): TempoScan {
  return { id: stableId(`scan:${Date.now()}:${Math.random()}`), state: "queued", automatic, requestedAt: new Date().toISOString(),
    completedAt: null, retryAt: "", token: "", leaseUntil: "", blobId: null, summary: "", error: "", proposals: [] };
}
export type SyncState = {
  status: "idle" | "running" | "warning" | "error"; lastAttempt: string | null; lastSuccess: string | null;
  message: string; saved: number; total: number; token: string; leaseUntil: string;
};
export type Library = { username: string; folders: LibraryFolder[]; files: LibraryFile[]; sync: SyncState; version: number };
export const emptySync = (): SyncState => ({ status: "idle", lastAttempt: null, lastSuccess: null, message: "", saved: 0, total: 0, token: "", leaseUntil: "" });
export function emptyLibrary(username: string): Library {
  return { username, version: 0, folders: [{ id: MOODLE_FOLDER, name: "Moodle", parentId: null, managed: true, createdAt: new Date().toISOString() }], files: [], sync: emptySync() };
}
export function owner(username: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username)) throw new MediaError("account", "Compte invalide.", 403);
  return username;
}
export function entryId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new MediaError("input", "Identifiant invalide.", 400);
  return value;
}
export function folderName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120 || /[\p{Cc}/\\]/u.test(value) || [".", ".."].includes(value.trim())) throw new MediaError("input", "Choisis un nom de 1 à 120 caractères, sans barre oblique.", 400);
  return value.trim().normalize("NFC");
}
export function fileKind(name: string): FileKind | null { return /\.pdf$/i.test(name) ? "pdf" : /\.pptx?$/i.test(name) ? "powerpoint" : null; }
export function validateFile(name: unknown, bytes: Uint8Array) {
  if (typeof name !== "string" || !name.trim() || name.length > 240 || /[\p{Cc}/\\]/u.test(name) || !fileKind(name)) throw new MediaError("format", "Seuls les fichiers PDF, PPT et PPTX sont acceptés.", 400);
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new MediaError("too_large", "Chaque fichier doit faire entre 1 octet et 25 Mo.", 413);
  const buffer = Buffer.from(bytes);
  const kind = fileKind(name)!;
  if (kind === "pdf" ? !buffer.subarray(0, 1024).includes(Buffer.from("%PDF-")) : /\.pptx$/i.test(name)
    ? !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || !buffer.includes(Buffer.from("ppt/presentation.xml"))
    : !buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw new MediaError("format", "Le contenu du fichier ne correspond pas à son format.", 400);
  }
  return { name: name.trim().normalize("NFC"), kind };
}
export function destination(library: Library, parentId: string | null, manual = true) {
  if (parentId === null) return;
  const folder = library.folders.find(row => row.id === entryId(parentId));
  if (!folder) throw new MediaError("not_found", "Ce dossier n’est plus disponible.", 404);
  if (manual && folder.managed) throw new MediaError("managed", "Les dossiers Moodle sont organisés automatiquement. Utilise un dossier personnel.", 409);
}
export function uniqueFolder(library: Library, name: string, parentId: string | null, except?: string) {
  if (library.folders.some(row => row.id !== except && row.parentId === parentId && row.name.toLocaleLowerCase("fr-CA") === name.toLocaleLowerCase("fr-CA"))) throw new MediaError("conflict", "Un dossier porte déjà ce nom ici.", 409);
}
export function moveFolder(library: Library, id: string, parentId: string | null) {
  destination(library, parentId);
  let next = parentId; const seen = new Set<string>(); let depth = 0;
  while (next) {
    if (next === id || seen.has(next)) throw new MediaError("cycle", "Un dossier ne peut pas contenir lui-même ou un de ses parents.", 400);
    if (++depth > 24) throw new MediaError("depth", "La bibliothèque accepte jusqu’à 24 niveaux de dossiers.", 400);
    seen.add(next); next = library.folders.find(row => row.id === next)?.parentId ?? null;
  }
  // Include the subtree depth, not only the destination ancestry.
  const subtreeDepth = (node: string, level: number): number => Math.max(level, ...library.folders.filter(row => row.parentId === node).map(row => subtreeDepth(row.id, level + 1)));
  if (depth + subtreeDepth(id, 1) > 24) throw new MediaError("depth", "La bibliothèque accepte jusqu’à 24 niveaux de dossiers.", 400);
}
export function moodleUsers() { return (process.env.MOODLE_ALLOWED_USERS || "").split(",").map(v => v.trim()).filter(v => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v)); }
export function moodleAuthorized(username: string) { return moodleUsers().includes(username); }
export function semesterCourses(courses: MoodleCourse[], semester = "A26") {
  const match = /^A(\d{2})$/.exec(semester);
  if (!match) throw new MediaError("semester", "Configure un semestre d’automne au format A26.", 503);
  const year = `20${match[1]}`;
  const pattern = new RegExp(`(?:\\b${year}3\\b|\\bA${year}\\b|\\bA${match[1]}\\b|Automne\\s+${year}\\b)`, "i");
  return courses.filter(course => pattern.test(`${course.shortname} ${course.fullname}`));
}
export function stableId(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
export function sourceFingerprint(file: MoodleFile) { return stableId(JSON.stringify([file.filename, file.filesize, file.modified ?? null, file.contenthash ?? null])); }
export function fileMime(file: Pick<LibraryFile, "kind" | "name">) { return file.kind === "pdf" ? "application/pdf" : /\.pptx$/i.test(file.name) ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/vnd.ms-powerpoint"; }
export function publicLibrary(library: Library, allowed: boolean) {
  const folders = library.folders.filter(folder => allowed || !folder.managed || folder.id === MOODLE_FOLDER);
  const files = library.files.filter(file => allowed || !file.source).map(({ blobId, previewId, tempoScan, ...file }) => ({ ...file, ready: !!blobId, hasPreview: !!previewId || file.kind === "pdf" && !!blobId,
    tempoScan: tempoScan ? { id: tempoScan.id, state: tempoScan.state, automatic: tempoScan.automatic, requestedAt: tempoScan.requestedAt, completedAt: tempoScan.completedAt,
      summary: tempoScan.summary, error: tempoScan.error, changed: !!tempoScan.blobId && tempoScan.blobId !== blobId,
      proposals: tempoScan.proposals.map(proposal => ({ ...proposal, decision: file.tempoDecisions?.[proposal.id] ?? proposal.decision })) } : null }));
  const privateSync = allowed ? library.sync : emptySync();
  const sync = { status: privateSync.status, lastAttempt: privateSync.lastAttempt, lastSuccess: privateSync.lastSuccess, message: privateSync.message, saved: privateSync.saved, total: privateSync.total };
  const leaseUntil = privateSync.leaseUntil;
  if (sync.status === "running" && Date.parse(leaseUntil) < Date.now()) { sync.status = "warning"; sync.message = "La synchronisation a été interrompue. Elle reprendra automatiquement."; }
  return { folders, files, sync, moodleAvailable: allowed && !!process.env.MOODLE_MCP_URL, semester: process.env.LIBRARY_MOODLE_SEMESTER || "A26", intervalMinutes: 30, maxFileBytes: MAX_FILE_BYTES };
}
