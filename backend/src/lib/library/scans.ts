import { randomUUID } from "node:crypto";
import { geminiApiKey } from "../ai/gemini.ts";
import { analyseCalendarPdf } from "../calendar/pdf-analysis.ts";
import { validateEvent } from "../calendar/events.ts";
import { CalendarEventStore } from "../calendar/store.ts";
import { CalendarEventTypeStore, assertEventType, resolveEventType } from "../calendar/event-types.ts";
import { MediaError, record } from "../media/core.ts";
import { entryId, moodleAuthorized, proposalId, publicLibrary, queuedScan, type LibraryFile, type TempoProposal } from "./model.ts";
import { libraryRows } from "./storage.ts";
import { libraryStore, type LibraryStore } from "./store.ts";
import { powerpointPreview } from "./preview.ts";

export { proposalId } from "./model.ts";
function accessible(username: string, file: LibraryFile) {
  if (file.source && !moodleAuthorized(username)) throw new MediaError("moodle_access", "Ton compte n’a plus accès à ce document Moodle.", 403);
  if (!file.blobId) throw new MediaError("pending", "Le téléchargement de ce document n’est pas terminé.", 409);
}
export class TempoScans {
  private active = new Map<string, Promise<void>>();
  private store: LibraryStore;
  private analyse: typeof analyseCalendarPdf;
  private convert: typeof powerpointPreview;
  private types: CalendarEventTypeStore;
  constructor(store: LibraryStore = libraryStore, analyse = analyseCalendarPdf, convert = powerpointPreview, types = new CalendarEventTypeStore()) { this.store = store; this.analyse = analyse; this.convert = convert; this.types = types; }
  async request(username: string, id: string) {
    const file = await this.store.get(username, id); accessible(username, file);
    if (!geminiApiKey()) throw new MediaError("ai_setup", "Configure Gemini pour rechercher des événements dans ce document.", 503);
    await this.store.mutate(username, library => {
      const current = library.files.find(row => row.id === id)!;
      if (current.tempoScan?.state === "scanning" && Date.parse(current.tempoScan.leaseUntil) > Date.now()) return;
      current.tempoScan = queuedScan(false);
    });
    await this.kick(username);
  }
  async kick(username: string) {
    if (!geminiApiKey()) return;
    const library = await this.store.snapshot(username);
    for (const file of library.files) {
      if (this.active.size >= 2) break;
      const scan = file.tempoScan;
      // Missing scan metadata is an existing document, never an automatic job.
      if (!scan || !file.blobId || file.source && !moodleAuthorized(username) || scan.state !== "queued" && !(scan.state === "scanning" && Date.parse(scan.leaseUntil) < Date.now()) || Date.parse(scan.retryAt || "1970-01-01") > Date.now()) continue;
      const key = `${username}:${file.id}`; if (this.active.has(key)) continue;
      const token = randomUUID();
      const claimed = await this.store.mutate(username, library => {
        const row = library.files.find(row => row.id === file.id), current = row?.tempoScan;
        if (!current || current.id !== scan.id || current.state !== "queued" && !(current.state === "scanning" && Date.parse(current.leaseUntil) < Date.now())) return false;
        Object.assign(current, { state: "scanning", token, leaseUntil: new Date(Date.now() + 5 * 60_000).toISOString(), blobId: row!.blobId, error: "" }); return true;
      });
      if (!claimed) continue;
      const work = this.run(username, file.id, token).finally(() => this.active.delete(key));
      this.active.set(key, work); void work.catch(() => {});
    }
  }
  async wait() { await Promise.all(this.active.values()); }
  private async run(username: string, id: string, token: string) {
    try {
      const file = await this.store.get(username, id); accessible(username, file);
      let pdf: Uint8Array<ArrayBuffer>;
      if (file.kind === "pdf") pdf = await this.store.blobs.get(file.blobId!);
      else {
        const preview = file.previewId || await this.store.savePreview(username, file, await this.convert(file.name, await this.store.blobs.get(file.blobId!)));
        pdf = await this.store.blobs.get(preview);
      }
      const result = await this.analyse({ name: file.name.replace(/\.pptx?$/i, ".pdf"), pdf, signal: AbortSignal.timeout(105_000), library: true, eventTypes: await this.types.list(username) });
      await this.store.mutate(username, library => {
        const row = library.files.find(row => row.id === id), scan = row?.tempoScan;
        if (!scan || scan.token !== token) return;
        if (row!.blobId !== file.blobId) { row!.tempoScan = queuedScan(scan.automatic); return; }
        const seen = new Set<string>();
        const proposals: TempoProposal[] = [];
        for (const proposal of result.proposals) {
          const proposalKey = proposalId(id, proposal.event); if (seen.has(proposalKey)) continue;
          seen.add(proposalKey); proposals.push({ ...proposal, id: proposalKey, decision: row!.tempoDecisions?.[proposalKey] ?? "pending" });
        }
        Object.assign(scan, { state: "ready", completedAt: new Date().toISOString(), summary: result.summary, proposals, token: "", leaseUntil: "", error: "" });
      });
    } catch (error) {
      await this.store.mutate(username, library => {
        const scan = library.files.find(row => row.id === id)?.tempoScan;
        if (!scan || scan.token !== token) return;
        Object.assign(scan, { state: "error", token: "", leaseUntil: "", error: error instanceof MediaError ? error.message : "Le scan n’a pas pu être terminé. Relance-le depuis Bibliothèque." });
      }).catch(() => {});
    }
  }
  async notifications(username: string) {
    const data = publicLibrary(await this.store.snapshot(username), moodleAuthorized(username));
    return { documents: data.files.filter(file => file.tempoScan?.state === "ready" && file.tempoScan.proposals.some(row => row.decision === "pending")),
      files: data.files.map(file => ({ id: file.id, name: file.name, ready: file.ready })),
      scanning: data.files.filter(file => file.tempoScan && ["queued", "scanning"].includes(file.tempoScan.state)).length,
      failures: data.files.filter(file => file.tempoScan?.state === "error"), aiAvailable: !!geminiApiKey() };
  }
  async decide(username: string, id: string, scanId: unknown, selection: unknown, ignored: unknown, events = new CalendarEventStore()) {
    const file = await this.store.get(username, id); accessible(username, file);
    const scan = file.tempoScan;
    if (!scan || scan.id !== scanId || scan.state !== "ready" || scan.blobId !== file.blobId) throw new MediaError("conflict", "Ce scan a changé. Actualise les propositions ou relance le scan.", 409);
    if (!Array.isArray(selection) || !Array.isArray(ignored) || selection.length + ignored.length > 100 || !selection.length && !ignored.length) throw new MediaError("input", "Choisis les propositions à ajouter ou à ignorer.", 400);
    const proposals = new Map(scan.proposals.map(row => [row.id, row])), seen = new Set<string>();
    const types = await this.types.list(username);
    const accepts = selection.map(value => {
      const row = record(value), proposal = proposals.get(entryId(row.proposalId));
      if (!proposal || seen.has(proposal.id) || file.tempoDecisions?.[proposal.id] === "ignored") throw new MediaError("input", "Cette proposition n’est pas disponible.", 400);
      seen.add(proposal.id);
      const event = validateEvent(row.event);
      // A stored proposal may outlive its type; newly selected types must exist.
      event.typeId = event.typeId === proposal.event.typeId ? resolveEventType(event.typeId, types) : assertEventType(event.typeId, types);
      return { proposal, event };
    });
    const rejects = ignored.map(value => {
      const proposal = proposals.get(entryId(value));
      if (!proposal || seen.has(proposal.id) || file.tempoDecisions?.[proposal.id] === "added") throw new MediaError("input", "Cette proposition n’est pas disponible.", 400);
      seen.add(proposal.id); return proposal;
    });
    const added = [];
    // Stable IDs make a failed/partial calendar write safe to retry.
    for (const { proposal, event } of accepts) {
      added.push(await events.create(username, event, proposal.id, { documentId: id, documentName: file.name, proposalId: proposal.id, page: proposal.page, origin: "library" }));
      await this.store.mutate(username, library => { const row = library.files.find(row => row.id === id); if (row) { row.tempoDecisions ??= {}; row.tempoDecisions[proposal.id] = "added"; row.tempoDecisions[proposalId(id, proposal.event)] = "added"; } });
    }
    await this.store.mutate(username, library => {
      const row = library.files.find(row => row.id === id); if (!row) return;
      row.tempoDecisions ??= {}; for (const proposal of rejects) { row.tempoDecisions[proposal.id] = "ignored"; row.tempoDecisions[proposalId(id, proposal.event)] = "ignored"; }
    });
    return { events: added };
  }
}
export const tempoScans = new TempoScans();
let scheduler: ReturnType<typeof setInterval> | undefined;
export function startTempoScanScheduler() {
  if (scheduler) return;
  const tick = async () => { if (!geminiApiKey()) return; for (const username of await libraryRows.usernames()) await tempoScans.kick(username).catch(() => {}); };
  scheduler = setInterval(() => { void tick().catch(() => {}); }, 5000); scheduler.unref();
}
