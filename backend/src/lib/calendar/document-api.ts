import { openaiApiKey } from "../ai/openai.ts";
import { BoundedCache, MediaError, record, type Fetcher } from "../media/core.ts";
import { readLimited } from "../media/http.ts";
import { CalendarDocumentStore, MAX_PDF_BYTES, MAX_PROPOSALS } from "./documents.ts";
import { eventId, validateEvent } from "./events.ts";
import { CalendarEventStore } from "./store.ts";
import { analyseCalendarPdf } from "./pdf-analysis.ts";
import { folderId } from "./folders.ts";
import { assertEventType, resolveEventType } from "./event-types.ts";

const rates = new BoundedCache<{ count: number; startedAt: number }>(1024, 60_000);

export async function handleDocumentRequest(request: Request, path: string[], username: string, documents: CalendarDocumentStore, events: CalendarEventStore, fetcher: Fetcher): Promise<Response> {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  if (path.length === 1 && request.method === "GET") {
    return json({ ...await documents.library(username), aiAvailable: !!openaiApiKey() });
  }
  if (path.length === 1 && request.method === "POST") {
    let name: string;
    try { name = decodeURIComponent(request.headers.get("x-document-name") || ""); }
    catch { throw new MediaError("input", "Le nom du PDF est invalide.", 400); }
    let bytes: Uint8Array;
    try { bytes = await readLimited(request, MAX_PDF_BYTES); }
    catch (error) { if (error instanceof MediaError && error.code === "too_large") throw new MediaError("too_large", "Chaque PDF doit faire 10 Mo maximum.", 413); throw error; }
    const result = await documents.upload(username, eventId(request.headers.get("x-document-id")), name, bytes, folderId(request.headers.get("x-document-folder")));
    return json(result, result.existing ? 200 : 201);
  }
  if (path.length < 2) throw new MediaError("method", "Cette action n’est pas disponible.", 405);
  if (path[1] === "folders") {
    const body = record(JSON.parse(new TextDecoder().decode(await readLimited(request, 4096))));
    if (path.length === 2 && request.method === "POST") {
      return json({ folder: await documents.folders.create(username, eventId(body.requestId), body.name, folderId(body.parentId)) }, 201);
    }
    if (path.length === 3 && ["PATCH", "DELETE"].includes(request.method)) {
      const id = eventId(path[2]);
      if (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) throw new MediaError("input", "La version du dossier est manquante.", 400);
      if (request.method === "DELETE") { await documents.removeFolder(username, id, body.updatedAt); return json({ removed: true }); }
      if (body.name === undefined && body.parentId === undefined) throw new MediaError("input", "Choisis un nom ou un emplacement.", 400);
      return json({ folder: await documents.folders.update(username, id, { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.parentId !== undefined ? { parentId: folderId(body.parentId) } : {}) }, body.updatedAt) });
    }
    throw new MediaError("method", "Cette action n’est pas disponible.", 405);
  }
  const id = eventId(path[1]);
  if (request.method === "GET" && path.length === 2) return json({ document: await documents.get(username, id) });
  if (request.method === "GET" && path.length === 3 && path[2] === "file") {
    const row = await documents.stored(username, id);
    const bytes = new Uint8Array(row.pdf.value());
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(row.name).replaceAll("'", "%27")}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; frame-ancestors 'self'", "Referrer-Policy": "no-referrer" } });
  }
  const body = record(JSON.parse(new TextDecoder().decode(await readLimited(request, 768 * 1024))));
  if (request.method === "PATCH" && path.length === 2) return json({ document: await documents.move(username, id, folderId(body.folderId), folderId(body.previousFolderId)) });
  if (request.method === "DELETE" && path.length === 2) {
    if (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) throw new MediaError("input", "La version du document est manquante.", 400);
    await documents.remove(username, id, body.updatedAt);
    return json({ removed: true });
  }
  if (request.method === "POST" && path.length === 3 && path[2] === "analyze") {
    const existing = await documents.get(username, id);
    if (existing.analysisState === "ready") return json({ document: existing });
    if (!openaiApiKey()) throw new MediaError("ai_setup", "Le PDF est conservé. L’analyse doit être configurée sur le serveur pour y rechercher des événements.", 503);
    const key = `documents:${username}`;
    const previous = rates.get(key);
    const window = previous && Date.now() - previous.startedAt < 60_000 ? previous : { count: 0, startedAt: Date.now() };
    if (window.count >= 6) throw new MediaError("rate_limit", "Patiente une minute avant d’analyser d’autres documents. Tes PDF sont conservés.", 429);
    const { row, token } = await documents.claimAnalysis(username, id);
    if (!token) return json({ document: await documents.get(username, id) });
    rates.set(key, { ...window, count: window.count + 1 });
    try {
      const analysis = await analyseCalendarPdf({ name: row.name, pdf: new Uint8Array(row.pdf.value()), signal: request.signal, fetcher, eventTypes: await events.types.list(username) });
      return json({ document: await documents.finishAnalysis(username, id, token, { ...analysis, analysisState: "ready", analysisError: "" }) });
    } catch (error) {
      await documents.finishAnalysis(username, id, token, { analysisState: "error", analysisError: error instanceof MediaError ? error.message : "L’analyse a été interrompue. Réessaie." }).catch(() => {});
      throw error;
    }
  }
  if (request.method === "POST" && path.length === 3 && path[2] === "events") {
    const document = await documents.get(username, id);
    if (document.analysisState !== "ready" || !Array.isArray(body.events) || !body.events.length || body.events.length > MAX_PROPOSALS) throw new MediaError("input", "Choisis les événements proposés par ce document.", 400);
    const proposals = new Map(document.proposals.map(proposal => [proposal.id, proposal]));
    const seen = new Set<string>();
    const types = await events.types.list(username);
    // Validate the whole selection before the first write. Stable proposal IDs make partial retries safe.
    const selection = body.events.map(value => {
      const row = record(value);
      const proposal = proposals.get(eventId(row.proposalId));
      if (!proposal || seen.has(proposal.id)) throw new MediaError("input", "Cette proposition n’appartient pas au document ou est sélectionnée deux fois.", 400);
      seen.add(proposal.id);
      const input = validateEvent(row.event);
      input.typeId = input.typeId === proposal.event.typeId ? resolveEventType(input.typeId, types) : assertEventType(input.typeId, types);
      return { proposal, input };
    });
    const added = [];
    for (const { proposal, input } of selection) added.push(await events.create(username, input, proposal.id, { documentId: id, documentName: document.name, proposalId: proposal.id, page: proposal.page }));
    return json({ events: added }, 201);
  }
  throw new MediaError("not_found", "Page introuvable.", 404);
}
