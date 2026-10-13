import {createDocumentRepository, MAX_PDF_BYTES, pendingProposals, folderDescendants} from "./documents.js";
import {reviewDocumentsDialog, deleteDocumentDialog, folderNameDialog, moveItemDialog, moveDialogContent, deleteFolderDialog} from "./components/documents.js";
import {parseDate} from "./date.js";

export function createDocumentController(store, dialogRoot, eventController) {
  const repository = createDocumentRepository();
  const jobs = [], reviewQueue = new Set(), drafts = new Map();
  let processing = false, current = null, loadId = 0, dragDepth = 0;
  const lookup = id => store.getState().documents.find(document => document.id === id);
  const publishJobs = () => store.setDocuments(store.getState().documents, {documentJobs: jobs.map(({file: _file, ...job}) => job)});
  function upsert(document) {
    ++loadId;
    const documents = store.getState().documents.filter(row => row.id !== document.id);
    store.setDocuments([...documents, document].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), {documentsStatus: "ready", documentsError: "", selectedDocumentId: store.getState().selectedDocumentId || ((document.folderId ?? null) === store.getState().currentFolderId ? document.id : null)});
  }
  async function loadDocuments() {
    const id = ++loadId;
    try {
      const result = await repository.list();
      if (id === loadId) {
        const folders = result.folders || [];
        const currentFolderId = folders.some(folder => folder.id === store.getState().currentFolderId) ? store.getState().currentFolderId : null;
        store.setDocuments(result.documents, {documentFolders: folders, currentFolderId, documentsStatus: "ready", documentsError: "", aiAvailable: result.aiAvailable, selectedDocumentId: result.documents.some(document => document.id === store.getState().selectedDocumentId) ? store.getState().selectedDocumentId : result.documents.find(document => (document.folderId ?? null) === currentFolderId)?.id || null});
      }
    } catch (error) {if (id === loadId) store.setDocuments(store.getState().documents, {documentsStatus: "error", documentsError: error.message});}
  }
  function readRow(row, original) {
    const field = name => row.querySelector(`[name="${name}"]`);
    const allDay = field("allDay").checked;
    const date = field("date").value;
    let recurrence = original.recurrence || null;
    if (recurrence?.frequency === "weekly" && date !== original.date) {
      const previous = parseDate(original.date)?.getUTCDay(), next = parseDate(date)?.getUTCDay();
      if (next !== undefined) recurrence = {...recurrence, weekdays: [...new Set(recurrence.weekdays.map(day => day === previous ? next : day))].sort()};
    }
    return {...original, title: field("title").value.trim(), description: field("description").value.trim(), date, endDate: field("endDate").value,
      allDay, startTime: allDay ? null : field("startTime").value, endTime: allDay ? null : field("endTime").value, recurrence};
  }
  function captureDrafts() {
    if (current?.type !== "review") return;
    for (const row of current.dialog.querySelectorAll(".document-proposal:not(.is-added)")) {
      const original = current.documents.flatMap(document => document.proposals).find(proposal => proposal.id === row.dataset.proposalId)?.event;
      if (original) drafts.set(row.dataset.proposalId, {event: readRow(row, original), checked: row.querySelector(".proposal-checkbox").checked});
    }
  }
  function syncSelection() {
    if (current?.type !== "review") return;
    const boxes = [...current.dialog.querySelectorAll(".proposal-checkbox:not(:disabled)")];
    const count = boxes.filter(input => input.checked).length;
    const all = current.dialog.querySelector("#proposal-select-all");
    all.checked = !!count && count === boxes.length; all.indeterminate = count > 0 && count < boxes.length; all.disabled = !boxes.length;
    const submit = current.dialog.querySelector("#document-import-events");
    submit.disabled = !count || current.busy;
    if (!current.busy) submit.textContent = count ? `Ajouter ${count} événement${count > 1 ? "s" : ""}` : "Choisis des événements";
  }
  function error(message) {
    const element = current?.dialog.querySelector("#document-dialog-error");
    if (element) {element.textContent = message; element.hidden = !message; if (message) element.focus();}
  }
  function busy(value) {
    if (!current) return;
    current.busy = value;
    current.dialog.setAttribute("aria-busy", String(value));
    for (const element of current.dialog.querySelectorAll("button, input, textarea, select")) {
      if (value) {element.dataset.wasDisabled = String(element.disabled); element.disabled = true;}
      else if (element.dataset.wasDisabled !== undefined) {element.disabled = element.dataset.wasDisabled === "true"; delete element.dataset.wasDisabled;}
    }
    const submit = current.dialog.querySelector("#document-import-events");
    if (submit && value) submit.textContent = "Ajout au calendrier…";
    if (!value) syncSelection();
  }
  function close() {if (current && !current.busy) {captureDrafts(); current.dialog.close();}}
  function openDialog(html, context) {
    if (dialogRoot.querySelector("dialog[open]")) return false;
    const opener = document.activeElement;
    dialogRoot.innerHTML = html;
    const dialog = dialogRoot.querySelector("dialog");
    current = {...context, dialog, busy: false};
    dialog.addEventListener("cancel", event => {event.preventDefault(); close();});
    dialog.addEventListener("click", event => {if (event.target === dialog) {const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();}});
    dialog.addEventListener("close", () => {
      if (current?.dialog !== dialog) return;
      current = null; dialogRoot.replaceChildren();
      (document.contains(opener) ? opener : document.querySelector('[data-action="document-add"]') || document.querySelector('[data-action="documents"]'))?.focus({preventScroll: true});
    });
    dialog.showModal();
    const input = dialog.querySelector("#folder-name");
    (input || dialog.querySelector('[data-action="document-dialog-close"]'))?.focus();
    input?.select();
    return true;
  }
  function review(ids) {
    const state = store.getState();
    const documents = ids.map(lookup).filter(document => document && document.analysisState === "ready" && pendingProposals(document, state.events).length);
    if (!documents.length) return false;
    const withDrafts = documents.map(document => ({...document, proposals: document.proposals.map(proposal => ({...proposal, event: drafts.get(proposal.id)?.event || proposal.event}))}));
    if (!openDialog(reviewDocumentsDialog(withDrafts, state), {type: "review", documents})) return false;
    for (const id of ids) reviewQueue.delete(id);
    for (const row of current.dialog.querySelectorAll(".document-proposal:not(.is-added)")) {
      const draft = drafts.get(row.dataset.proposalId);
      if (draft) row.querySelector(".proposal-checkbox").checked = draft.checked;
    }
    syncSelection();
    return true;
  }
  function showQueuedReview() {
    if (processing || dialogRoot.querySelector("dialog[open]") || !reviewQueue.size) return;
    const ids = [...reviewQueue];
    reviewQueue.clear();
    review(ids);
  }
  async function processJobs() {
    if (processing) return;
    processing = true;
    const processed = [];
    for (;;) {
      const job = jobs.find(job => job.status === "waiting");
      if (!job) break;
      processed.push(job);
      try {
        let document = job.documentId ? lookup(job.documentId) : null;
        if (!document) {
          job.status = "uploading"; publishJobs();
          const result = await repository.upload(job.file, job.id, job.folderId);
          document = result.document; job.documentId = document.id; job.file = null; upsert(document);
          job.existing = result.existing;
          job.folderUnavailable = result.folderUnavailable;
        }
        if (document.analysisState !== "ready" && store.getState().aiAvailable) {
          job.status = "analysing"; job.message = ""; publishJobs();
          upsert({...document, analysisState: "analysing", analysisError: ""});
          document = (await repository.analyze(document.id)).document; upsert(document);
        }
        job.status = "done";
        job.message = document.analysisState === "ready" ? document.proposals.length ? `${document.proposals.length} événement${document.proposals.length > 1 ? "s" : ""} détecté${document.proposals.length > 1 ? "s" : ""} · PDF enregistré` : "PDF enregistré · aucun événement détecté" : "PDF enregistré · analyse disponible";
        if (job.existing) job.message += " · Déjà présent, emplacement conservé";
        if (job.folderUnavailable) job.message += " · Dossier supprimé, PDF conservé dans Documents";
        if (pendingProposals(document, store.getState().events).length) reviewQueue.add(document.id);
      } catch (err) {
        job.status = "error"; job.message = err.message;
        if (job.documentId) {
          try {upsert((await repository.get(job.documentId)).document);}
          catch {const previous = lookup(job.documentId); if (previous) upsert({...previous, analysisState: "error", analysisError: err.message});}
        }
      }
      publishJobs();
    }
    processing = false;
    const ready = processed.filter(job => job.status === "done").length;
    eventController.toast(!processed.length || processed.some(job => job.status === "error") ? "Import terminé. Certains documents demandent une nouvelle tentative." : `${ready} PDF conservé${ready > 1 ? "s" : ""} dans Documents.`);
    showQueuedReview();
  }
  function addFiles(files) {
    if (!files.length) return;
    store.goDocuments();
    for (const file of files) {
      const message = !/\.pdf$/i.test(file.name) ? "Choisis un fichier PDF." : file.size > MAX_PDF_BYTES ? "Ce PDF dépasse la limite de 10 Mo." : !file.size ? "Ce fichier est vide." : "";
      jobs.push({id: crypto.randomUUID(), name: file.name, file, folderId: store.getState().currentFolderId, status: message ? "error" : "waiting", message, retryable: !message});
    }
    publishJobs(); void processJobs();
  }
  async function addEvents() {
    const context = current;
    if (context?.type !== "review" || context.busy) return;
    captureDrafts(); error("");
    const groups = [];
    for (const document of context.documents) {
      const selection = [];
      for (const row of context.dialog.querySelectorAll(`.document-proposal[data-document-id="${document.id}"]`)) {
        if (!row.querySelector(".proposal-checkbox:checked:not(:disabled)")) continue;
        const proposal = document.proposals.find(proposal => proposal.id === row.dataset.proposalId);
        const event = readRow(row, proposal.event);
        const invalid = [...row.querySelectorAll("input:not(:disabled), textarea")].find(input => !input.checkValidity());
        if (invalid) {row.querySelector("details").open = true; invalid.reportValidity(); return;}
        if (!event.title || !parseDate(event.date) || !parseDate(event.endDate) || event.endDate < event.date || !event.allDay && `${event.endDate}T${event.endTime}` <= `${event.date}T${event.startTime}` || event.recurrence?.until && event.recurrence.until < event.date) {
          row.querySelector("details").open = true; error(`Vérifie les dates et l’horaire de « ${event.title} ».`); return;
        }
        selection.push({proposalId: proposal.id, event});
      }
      if (selection.length) groups.push({document, selection});
    }
    if (!groups.length) return;
    busy(true);
    try {
      let addedCount = 0;
      for (const {document, selection} of groups) {
        const result = await repository.addEvents(document.id, selection);
        eventController.acceptEvents(result.events); addedCount += result.events.length;
        for (const {proposalId} of selection) {
          drafts.delete(proposalId);
          const row = context.dialog.querySelector(`[data-proposal-id="${proposalId}"]`);
          row.classList.add("is-added");
          const checkbox = row.querySelector(".proposal-checkbox"); checkbox.checked = false; checkbox.dataset.wasDisabled = "true";
        }
      }
      context.busy = false; context.dialog.close();
      eventController.toast(`${addedCount} événement${addedCount > 1 ? "s" : ""} ajouté${addedCount > 1 ? "s" : ""} au calendrier.`, groups[0].selection[0].event.date);
    } catch (err) {error(err.message); busy(false); void eventController.loadEvents();}
  }
  async function remove() {
    const context = current;
    if (context?.type !== "delete" || context.busy) return;
    error(""); busy(true);
    try {
      await repository.remove(context.document);
      ++loadId;
      store.setDocuments(store.getState().documents.filter(document => document.id !== context.document.id), {selectedDocumentId: null, documentDetailsOpen: false});
      reviewQueue.delete(context.document.id);
      for (const proposal of context.document.proposals) drafts.delete(proposal.id);
      context.busy = false; context.dialog.close(); eventController.toast("PDF supprimé. Les événements restent au calendrier.");
    } catch (err) {error(err.message); busy(false); if (["conflict", "not_found"].includes(err.code)) {await loadDocuments(); context.document = lookup(context.document.id) || context.document;}}
  }
  const lookupFolder = id => store.getState().documentFolders.find(folder => folder.id === id);
  function acceptFolder(folder) {
    ++loadId;
    const state = store.getState();
    store.setDocuments(state.documents, {documentFolders: [...state.documentFolders.filter(row => row.id !== folder.id), folder]});
  }
  function openMove(item, itemType) {
    if (!item) return;
    openDialog(moveItemDialog(item, itemType, store.getState().documentFolders, null), {type: "move", item, itemType, destinationId: null});
  }
  async function saveFolder() {
    const context = current;
    if (context?.type !== "folder-name" || context.busy) return;
    const input = context.dialog.querySelector("#folder-name");
    if (!input.value.trim()) {input.setCustomValidity("Donne un nom à ce dossier."); input.reportValidity(); return;}
    if (!input.reportValidity()) return;
    const name = input.value.trim();
    error(""); busy(true);
    try {
      const result = context.folder ? await repository.updateFolder(context.folder, {name}) : await repository.createFolder(name, context.parentId, context.requestId);
      acceptFolder(result.folder);
      context.busy = false; context.dialog.close(); eventController.toast(context.folder ? "Dossier renommé." : "Dossier créé.");
    } catch (err) {error(err.message); busy(false); if (["conflict", "not_found"].includes(err.code)) {await loadDocuments(); if (context.folder) context.folder = lookupFolder(context.folder.id) || context.folder;}}
  }
  async function moveItem() {
    const context = current;
    if (context?.type !== "move" || context.busy) return;
    error(""); busy(true);
    try {
      if (context.itemType === "folder") acceptFolder((await repository.updateFolder(context.item, {parentId: context.destinationId})).folder);
      else {
        const result = await repository.move(context.item, context.destinationId);
        upsert(result.document);
        store.setDocuments(store.getState().documents, {selectedDocumentId: null, documentDetailsOpen: false});
      }
      context.busy = false; context.dialog.close(); eventController.toast(context.itemType === "folder" ? "Dossier déplacé avec son contenu." : "PDF déplacé.");
    } catch (err) {
      error(err.message); busy(false);
      if (["conflict", "not_found"].includes(err.code)) {await loadDocuments(); context.item = (context.itemType === "folder" ? lookupFolder(context.item.id) : lookup(context.item.id)) || context.item;}
    }
  }
  async function removeFolder() {
    const context = current;
    if (context?.type !== "folder-delete" || context.busy) return;
    error(""); busy(true);
    try {
      await repository.removeFolder(context.folder);
      ++loadId;
      const state = store.getState();
      store.setDocuments(state.documents, {documentFolders: state.documentFolders.filter(folder => folder.id !== context.folder.id), ...(state.currentFolderId === context.folder.id ? {currentFolderId: context.folder.parentId, selectedDocumentId: null, documentDetailsOpen: false} : {})});
      context.busy = false; context.dialog.close(); eventController.toast("Dossier supprimé.");
    } catch (err) {error(err.message); busy(false); if (["conflict", "not_found", "not_empty"].includes(err.code)) {await loadDocuments(); context.folder = lookupFolder(context.folder.id) || context.folder;}}
  }
  const actions = {
    documents: () => {store.goDocuments(); if (store.getState().documentsStatus !== "ready") void loadDocuments();},
    "documents-retry": loadDocuments,
    "document-add": () => document.getElementById("document-input").click(),
    "document-select": element => store.selectDocument(element.dataset.documentId, window.matchMedia("(max-width:620px)").matches),
    "document-back": () => store.closeDocumentDetails(),
    "document-filter-all": () => store.setDocumentFilter("all"), "document-filter-pending": () => store.setDocumentFilter("pending"),
    "document-review": element => review([element.dataset.documentId]),
    "document-dialog-close": close, "document-delete-confirm": remove,
    "document-delete": element => {const document = lookup(element.dataset.documentId); if (document) openDialog(deleteDocumentDialog(document, store.getState().events.filter(event => event.source?.documentId === document.id).length), {type: "delete", document});},
    "document-analyze": element => {const document = lookup(element.dataset.documentId); if (!document || jobs.some(job => job.documentId === document.id && ["waiting", "uploading", "analysing"].includes(job.status))) return; jobs.push({id: crypto.randomUUID(), documentId: document.id, name: document.name, status: "waiting", retryable: true}); publishJobs(); void processJobs();},
    "document-job-retry": element => {const job = jobs.find(job => job.id === element.dataset.jobId); if (job?.status === "error" && job.retryable) {job.status = "waiting"; job.message = ""; publishJobs(); void processJobs();}},
    "document-jobs-dismiss": () => {for (let i = jobs.length - 1; i >= 0; i--) if (["done", "error"].includes(jobs[i].status)) jobs.splice(i, 1); publishJobs();},
    "folder-open": element => store.openDocumentFolder(element.dataset.folderId || null),
    "folder-create": () => {const state = store.getState(); openDialog(folderNameDialog(null, state.documentFolders, state.currentFolderId), {type: "folder-name", folder: null, parentId: state.currentFolderId, requestId: crypto.randomUUID()});},
    "folder-rename": element => {const folder = lookupFolder(element.dataset.folderId); if (folder) openDialog(folderNameDialog(folder, store.getState().documentFolders, folder.parentId), {type: "folder-name", folder});},
    "folder-delete": element => {const folder = lookupFolder(element.dataset.folderId); if (folder) openDialog(deleteFolderDialog(folder), {type: "folder-delete", folder});},
    "folder-delete-confirm": removeFolder,
    "folder-move": element => openMove(lookupFolder(element.dataset.folderId), "folder"),
    "document-move": element => openMove(lookup(element.dataset.documentId), "document"),
    "folder-move-browse": element => {
      if (current?.type !== "move" || current.busy) return;
      const id = element.dataset.folderId || null, folders = store.getState().documentFolders;
      if (id && (!lookupFolder(id) || current.itemType === "folder" && folderDescendants(folders, current.item.id).has(id))) return;
      current.destinationId = id;
      current.dialog.innerHTML = moveDialogContent(current.item, current.itemType, folders, id);
      current.dialog.querySelector("#move-destination").focus({preventScroll: true});
    },
    "folder-move-confirm": moveItem,
  };
  document.addEventListener("click", event => {const element = event.target.closest("[data-action]"); if (element && !element.disabled && actions[element.dataset.action]) {event.preventDefault(); void actions[element.dataset.action](element);}});
  document.addEventListener("submit", event => {if (event.target.id === "document-review-form") {event.preventDefault(); void addEvents();} if (event.target.id === "folder-name-form") {event.preventDefault(); void saveFolder();}});
  document.addEventListener("input", event => {if (event.target.id === "document-search") store.setDocumentQuery(event.target.value); if (event.target.id === "folder-name") event.target.setCustomValidity(""); if (event.target.closest(".document-proposal")) captureDrafts();});
  document.addEventListener("click", event => {for (const menu of document.querySelectorAll(".folder-menu[open]")) if (!menu.contains(event.target)) menu.open = false;});
  document.addEventListener("keydown", event => {if (event.key === "Escape") for (const menu of document.querySelectorAll(".folder-menu[open]")) {menu.open = false; menu.querySelector("summary").focus();}});
  document.addEventListener("change", event => {
    if (event.target.id === "document-input") {addFiles([...event.target.files]); event.target.value = "";}
    if (current?.type !== "review") return;
    if (event.target.id === "proposal-select-all") for (const input of current.dialog.querySelectorAll(".proposal-checkbox:not(:disabled)")) input.checked = event.target.checked;
    const row = event.target.closest(".document-proposal");
    if (row && event.target.name === "allDay") for (const field of row.querySelectorAll(".proposal-time")) {field.hidden = event.target.checked; const input = field.querySelector("input"); input.disabled = event.target.checked; input.required = !event.target.checked;}
    if (row && event.target.name === "date") {const end = row.querySelector('[name="endDate"]'); end.min = event.target.value; if (end.value < end.min) end.value = end.min;}
    captureDrafts(); syncSelection();
  });
  document.addEventListener("close", () => queueMicrotask(showQueuedReview), true);
  function drag(event) {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    if (store.getState().page !== "documents" || dialogRoot.querySelector("dialog[open]")) return;
    if (event.type === "dragenter") dragDepth++;
    if (event.type === "dragleave") dragDepth = Math.max(0, dragDepth - 1);
    if (event.type === "drop") {dragDepth = 0; addFiles([...event.dataTransfer.files]);}
    document.querySelector(".documents-page")?.classList.toggle("is-dragging", dragDepth > 0 && event.type !== "drop");
  }
  for (const type of ["dragenter", "dragleave", "dragover", "drop"]) document.addEventListener(type, drag);
  document.addEventListener("visibilitychange", () => {if (!document.hidden) void loadDocuments();});
  setInterval(() => {if (!document.hidden && !processing && store.getState().documents.some(document => document.analysisState === "analysing")) void loadDocuments();}, 15000);
  return {loadDocuments};
}
