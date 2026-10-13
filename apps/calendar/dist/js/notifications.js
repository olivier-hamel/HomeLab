import {reviewDocumentsDialog} from "./components/documents.js";
import {escapeHtml as esc} from "./account.js";
import {icon} from "./components/icons.js";

export function createNotificationController(store, dialogRoot, events) {
  let documents = [], busy = false, current = null, requestId = 0;
  async function api(path, body) {
    const response = await fetch(`/api/library${path}`, {credentials: "same-origin", cache: "no-store",
      ...(body ? {method: "POST", headers: {"Content-Type": "application/json", "X-Library-Request": "1"}, body: JSON.stringify(body)} : {})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "La demande n’a pas pu être terminée."); return data;
  }
  async function load() {
    const id = ++requestId;
    try {
      const data = await api("/notifications"); if (id !== requestId) return;
      documents = data.documents.map(file => ({id: file.id, name: file.name, summary: file.tempoScan.summary, scanId: file.tempoScan.id, origin: "library", proposals: file.tempoScan.proposals.filter(row => row.decision === "pending")}));
      const count = documents.reduce((sum, file) => sum + file.proposals.length, 0);
      store.setDocuments(data.files || [], {documentsStatus: "ready", libraryNotifications: {count, scanning: data.scanning, failureCount: data.failures.length, aiAvailable: data.aiAvailable}});
    } catch { /* Keep the last persisted notifications visible during an outage. */ }
  }
  function close() { if (!busy) current?.dialog.close(); }
  function syncSelection() {
    if (!current) return;
    const count = current.dialog.querySelectorAll(".proposal-checkbox:checked:not(:disabled)").length;
    current.dialog.querySelector("#document-import-events").textContent = count ? `Ajouter ${count} événement${count > 1 ? "s" : ""}` : "Ne rien ajouter";
  }
  function review() {
    if (busy || !documents.length || dialogRoot.querySelector("dialog[open]")) return;
    const opener = document.activeElement;
    dialogRoot.innerHTML = reviewDocumentsDialog(documents, store.getState());
    const dialog = dialogRoot.querySelector("dialog"); current = {dialog, documents: [...documents]};
    dialog.querySelector(".event-dialog-eyebrow").innerHTML = `${icon("sparkles")}REPÉRÉS DANS BIBLIOTHÈQUE`;
    dialog.querySelector(".document-review-footer > p").innerHTML = "Les propositions non cochées seront ignorées.<br/><span>« Plus tard » conserve cette notification.</span>";
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("close", () => { current = null; dialogRoot.innerHTML = ""; (opener?.isConnected ? opener : document.getElementById("tempo-notifications-button"))?.focus(); void load(); }, {once: true});
    dialog.showModal(); syncSelection();
  }
  async function decide() {
    if (!current || busy) return;
    const context = current, groups = [];
    for (const file of context.documents) {
      const selected = [], ignored = [];
      for (const row of context.dialog.querySelectorAll(`.document-proposal[data-document-id="${file.id}"]`)) {
        const proposal = file.proposals.find(rowData => rowData.id === row.dataset.proposalId);
        const checkbox = row.querySelector(".proposal-checkbox");
        if (checkbox.disabled) continue;
        if (!checkbox.checked) { ignored.push(proposal.id); continue; }
        const invalid = [...row.querySelectorAll("input:not(:disabled), textarea, select")].find(field => !field.checkValidity());
        if (invalid) { row.querySelector("details").open = true; invalid.reportValidity(); return; }
        const value = name => row.querySelector(`[name="${name}"]`).value;
        const allDay = row.querySelector('[name="allDay"]').checked;
        selected.push({proposalId: proposal.id, event: {...proposal.event, typeId: value("typeId"), title: value("title"), description: value("description"), date: value("date"), endDate: value("endDate"), allDay, startTime: allDay ? null : value("startTime"), endTime: allDay ? null : value("endTime")}});
      }
      if (selected.length || ignored.length) groups.push({file, selected, ignored});
    }
    if (!groups.length) { close(); return; }
    busy = true; context.dialog.querySelectorAll("button").forEach(button => {button.disabled = true;});
    const error = context.dialog.querySelector("#document-dialog-error"); error.hidden = true;
    try {
      let count = 0;
      for (const {file, selected, ignored} of groups) {
        const result = await api(`/files/${file.id}/events`, {scanId: file.scanId, events: selected, ignored});
        events.acceptEvents(result.events); count += result.events.length;
        context.dialog.querySelector(`.document-proposal[data-document-id="${file.id}"]`)?.closest(".proposal-document-group").remove();
      }
      busy = false; context.dialog.close();
      events.toast(count ? `${count} événement${count > 1 ? "s ajoutés" : " ajouté"} au calendrier.` : "Propositions ignorées.");
    } catch (caught) { error.innerHTML = esc(caught.message); error.hidden = false; error.focus(); busy = false; context.dialog.querySelectorAll("button").forEach(button => {button.disabled = false;}); void events.loadEvents(); syncSelection(); }
  }
  document.addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "tempo-review") { event.preventDefault(); review(); }
    if (action === "document-dialog-close") { event.preventDefault(); close(); }
  });
  document.addEventListener("submit", event => { if (event.target.id === "document-review-form") { event.preventDefault(); void decide(); } });
  document.addEventListener("change", event => {
    if (!current || !event.target.closest(".document-review-dialog")) return;
    if (event.target.id === "proposal-select-all") current.dialog.querySelectorAll(".proposal-checkbox:not(:disabled)").forEach(input => {input.checked = event.target.checked;});
    const row = event.target.closest(".document-proposal");
    if (row && event.target.name === "allDay") row.querySelectorAll(".proposal-time").forEach(field => {field.hidden = event.target.checked; const input = field.querySelector("input"); input.disabled = event.target.checked; input.required = !event.target.checked;});
    if (row && event.target.name === "date") { const end = row.querySelector('[name="endDate"]'); end.min = event.target.value; if (end.value < end.min) end.value = end.min; }
    syncSelection();
  });
  const timer = setInterval(() => {if (!document.hidden) void load();}, 10_000);
  document.addEventListener("visibilitychange", () => {if (!document.hidden) void load();});
  window.addEventListener("pagehide", () => clearInterval(timer), {once: true});
  return {load};
}
