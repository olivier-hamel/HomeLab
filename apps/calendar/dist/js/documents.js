export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const documentUrl = (id, page, download = false) => `/api/calendar/documents/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}${page ? `#page=${page}` : ""}`;
export const fileSize = size => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} Ko` : `${(size / 1024 / 1024).toLocaleString("fr-CA", {maximumFractionDigits: 1})} Mo`;
export function pendingProposals(document, events = []) {
  const added = new Set(events.filter(event => event.source?.documentId === document.id).map(event => event.source.proposalId));
  return document.proposals.filter(proposal => !added.has(proposal.id));
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
    upload: (file, id) => request("", "POST", file, {"Content-Type": "application/pdf", "X-Document-Name": encodeURIComponent(file.name), "X-Document-Id": id}),
    analyze: id => request(`/${id}/analyze`, "POST", {}),
    addEvents: (id, events) => request(`/${id}/events`, "POST", {events}),
    remove: document => request(`/${document.id}`, "DELETE", {updatedAt: document.updatedAt}),
  };
}
