import { memoSessionCookie } from "../accounts.ts";
import { CalendarDocumentStore } from "../calendar/documents.ts";
import type { CalendarEvent } from "../calendar/events.ts";
import { MediaError } from "../media/core.ts";
import { readLimited } from "../media/http.ts";
import { entryId, MAX_FILE_BYTES, proposalId, queuedScan } from "./model.ts";
import { libraryStore, type LibraryStore } from "./store.ts";

export async function importTempoArchive(username: string, events: CalendarEvent[], archive = new CalendarDocumentStore(), library: LibraryStore = libraryStore) {
  const legacy = await archive.library(username);
  if (!legacy.documents.length) return;
  const current = await library.snapshot(username);
  const missing = legacy.documents.filter(row => !current.files.some(file => file.id === row.id) && !current.tempoArchiveIds?.includes(row.id));
  if (!missing.length) return;
  const root = "tempo-archive";
  if (!current.folders.some(row => row.id === root)) {
    let name = "Documents Tempo", suffix = 1;
    while (current.folders.some(row => row.parentId === null && row.name.toLowerCase() === name.toLowerCase())) name = `Documents Tempo (${++suffix})`;
    await library.createFolder(username, { id: root, name, parentId: null });
  }
  const folders = new Map(legacy.folders.map(row => [row.id, row]));
  const ensure = async (id: string | null): Promise<string> => {
    if (!id || !folders.has(id)) return root;
    const folder = folders.get(id)!;
    if (!(await library.snapshot(username)).folders.some(row => row.id === id)) await library.createFolder(username, { id, name: folder.name, parentId: await ensure(folder.parentId) });
    return id;
  };
  for (const document of missing) {
    const row = await archive.stored(username, document.id);
    const file = await library.upload(username, document.id, document.name, await ensure(document.folderId), new Uint8Array(row.pdf.value()), true);
    if (document.analysisState === "ready") await library.mutate(username, data => {
      const saved = data.files.find(row => row.id === file.id)!;
      const added = new Set(events.filter(event => event.source?.documentId === document.id).map(event => event.source!.proposalId));
      saved.tempoDecisions = Object.fromEntries(document.proposals.filter(proposal => added.has(proposal.id)).flatMap(proposal => [[proposal.id, "added"], [proposalId(file.id, proposal.event), "added"]]));
      saved.tempoScan = { ...queuedScan(false), state: "ready", blobId: file.blobId, completedAt: document.updatedAt, summary: document.summary,
        proposals: document.proposals.map(proposal => ({ ...proposal, decision: added.has(proposal.id) ? "added" : "pending" })) };
    });
    await library.mutate(username, data => { data.tempoArchiveIds = [...new Set([...(data.tempoArchiveIds ?? []), document.id])]; });
  }
}

export async function importMemoArchive(request: Request, username: string, id: unknown, store: LibraryStore = libraryStore) {
  const identifier = entryId(id);
  const host = request.headers.get("host") || new URL(request.url).host;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || new URL(request.url).protocol.slice(0, -1);
  const read = async (suffix: string, max: number) => {
    const response = await fetch(new URL(`/api/reference-documents/legacy/${identifier}${suffix}`, process.env.MEMO_AUTH_URL || "http://127.0.0.1:8000"), {
      headers: { Cookie: memoSessionCookie(request) || "", Host: host, "X-Forwarded-Proto": protocol },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]), redirect: "error", cache: "no-store",
    });
    if (!response.ok) { await response.body?.cancel(); throw new MediaError("memo_document", "Ce document Mémo n’est pas disponible pour ton compte.", response.status === 404 || response.status === 403 ? 404 : 503); }
    return readLimited(response, max);
  };
  const metadata = JSON.parse(new TextDecoder().decode(await read("", 2 * 1024 * 1024)));
  if (metadata.id !== identifier || typeof metadata.name !== "string") throw new MediaError("memo_document", "Le document Mémo est invalide.", 502);
  const name = metadata.name.replace(/\.pptx?$/i, ".pdf");
  // Only a verified, existing Mémo archive can enter without an automatic scan.
  return store.upload(username, identifier, name, null, await read("/pdf", MAX_FILE_BYTES), true);
}
