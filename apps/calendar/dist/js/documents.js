export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const documentUrl = (id, page, download = false) => `/api/calendar/documents/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}${page ? `#page=${page}` : ""}`;
export const fileSize = size => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} Ko` : `${(size / 1024 / 1024).toLocaleString("fr-CA", {maximumFractionDigits: 1})} Mo`;
export function pendingProposals(document, events = []) {
  const added = new Set(events.filter(event => event.source?.documentId === document.id).map(event => event.source.proposalId));
  return document.proposals.filter(proposal => !added.has(proposal.id));
}
export function folderPath(folders, id) {
  const path = [], seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find(folder => folder.id === id);
    if (!folder) break;
    path.unshift(folder); id = folder.parentId;
  }
  return path;
}
export function folderDescendants(folders, id) {
  const ids = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of folders) if (ids.has(folder.parentId) && !ids.has(folder.id)) {ids.add(folder.id); changed = true;}
  }
  return ids;
}
export function createDocumentRepository(fetcher = fetch) {
  async function request(path = "", method = "GET", body, headers = {}) {
    let response;
    try {
      response = await fetcher(`/api/calendar/documents${path}`, {method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(method === "POST" && path.endsWith("/analyze") ? 105000 : 60000),
        ...(body !== undefined ? {headers: {"X-Calendar-Request": "1", "Content-Type": "application/json", ...headers}, body: body instanceof Blob ? body : JSON.stringify(body)} : {})});
    } catch {throw new Error("La connexion a été interrompue. Réessaie; les PDF déjà enregistrés sont conservés.");}
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {const error = new Error(result.error || "L’action n’a pas pu être effectuée. Réessaie."); error.code = result.code; throw error;}
    return result;
  }
  return {
    list: () => request(),
    get: id => request(`/${id}`),
    upload: (file, id, folderId = null) => request("", "POST", file, {"Content-Type": "application/pdf", "X-Document-Name": encodeURIComponent(file.name), "X-Document-Id": id, ...(folderId ? {"X-Document-Folder": folderId} : {})}),
    analyze: id => request(`/${id}/analyze`, "POST", {}),
    addEvents: (id, events) => request(`/${id}/events`, "POST", {events}),
    remove: document => request(`/${document.id}`, "DELETE", {updatedAt: document.updatedAt}),
    move: (document, folderId) => request(`/${document.id}`, "PATCH", {folderId, previousFolderId: document.folderId ?? null}),
    createFolder: (name, parentId, requestId) => request("/folders", "POST", {name, parentId, requestId}),
    updateFolder: (folder, patch) => request(`/folders/${folder.id}`, "PATCH", {...patch, updatedAt: folder.updatedAt}),
    removeFolder: folder => request(`/folders/${folder.id}`, "DELETE", {updatedAt: folder.updatedAt}),
  };
}
