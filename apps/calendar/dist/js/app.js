import {createEventController} from "./event-controller.js";
import {createDocumentController} from "./document-controller.js";
import {renderDocuments} from "./components/documents.js";
import {renderPdfPreview} from "./pdf-preview.js";
import {eventsOnDate, eventCount} from "./events.js";
import {createCalendarStore} from "./state.js";
import {calendarAccount, escapeHtml} from "./account.js";
import {dateKey, parseDate, addDays, fullDate, periodTitle, zoneOffset, VIEW_LABELS} from "./date.js";
import {renderSidebar} from "./components/sidebar.js";
import {renderCalendar} from "./components/views.js";
import {renderHome} from "./components/home.js";
import {renderShell, renderBreadcrumb} from "./components/shell.js";
import {jumpDialog, preferencesDialog, shortcutsDialog} from "./components/dialogs.js";

async function startCalendar() {
const account = await calendarAccount();
let storage = null;
try {storage = window.localStorage;} catch { /* All calendar controls still work without storage. */ }
const store = createCalendarStore(storage, account);
const app = document.getElementById("app");
const dialogRoot = document.getElementById("dialog-root");
let dialogOpener = null;
let renderedPeriod = null;
let renderedView = null;
let renderedPage = null;
let renderedToday = null;
let homeSearchQuery = "";
let homeTaskDraft = "";

app.innerHTML = renderShell();
const eventController = createEventController(store, dialogRoot);
const documentController = createDocumentController(store, dialogRoot, eventController);

function render(state, reason = "initial") {
  const active = document.activeElement;
  const focusAction = active?.closest("[data-action]")?.dataset.action;
  const focusDate = active?.dataset.date;
  const focusWasMonth = active?.classList.contains("month-date");
  const focusWasMini = active?.classList.contains("mini-day");
  const focusDocumentId = active?.closest("[data-document-id]")?.dataset.documentId;
  const focusTaskId = active?.dataset.taskId;
  const taskFocusIndex = focusTaskId ? Array.from(app.querySelectorAll('.home-task')).findIndex(row => row.contains(active)) : -1;
  const homeControlId = ["home-search-input", "home-task-title", "search-google", "search-duckduckgo"].includes(active?.id) ? active.id : null;
  const homeSelection = homeControlId && active.type !== "radio" ? [active.selectionStart, active.selectionEnd] : null;
  homeSearchQuery = document.getElementById("home-search-input")?.value ?? homeSearchQuery;
  homeTaskDraft = document.getElementById("home-task-title")?.value ?? homeTaskDraft;
  const searchFocused = active?.id === "document-search";
  const searchSelection = searchFocused ? [active.selectionStart, active.selectionEnd] : null;
  const content = document.getElementById("calendar-content");
  const oldScroll = document.querySelector(".time-scroll")?.scrollTop;
  const oldTaskScroll = app.querySelector(".home-task-list")?.scrollTop;
  const previousPage = renderedPage;
  if (reason !== "clock" || renderedToday !== dateKey(state.today)) document.getElementById("sidebar").innerHTML = renderSidebar(state);
  renderedToday = dateKey(state.today);
  app.querySelector(".app-shell").classList.toggle("sidebar-is-open", state.sidebarOpen);
  app.querySelector(".menu-button").setAttribute("aria-expanded", String(state.sidebarOpen));
  syncSidebarAccess(state);
  if (reason === "sidebar") {
    (state.sidebarOpen ? app.querySelector(".sidebar-close") : app.querySelector(".menu-button"))?.focus();
    return;
  }
  if (reason === "mini") {
    if (focusAction) app.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll: true});
    return;
  }
  const isHome = state.page === "home";
  const isDocuments = state.page === "documents";
  app.querySelector("main").classList.toggle("is-home-page", isHome);
  document.getElementById("workspace-breadcrumb").innerHTML = renderBreadcrumb(state);
  app.querySelector(".calendar-workspace").classList.toggle("is-home", isHome);
  app.querySelector(".calendar-workspace").classList.toggle("is-documents", isDocuments);
  app.querySelector(".calendar-toolbar").hidden = isHome || isDocuments;
  app.querySelector('.jump-button').hidden = isDocuments;
  const status = document.getElementById("events-status");
  status.hidden = isDocuments || state.eventsStatus === "ready";
  status.innerHTML = state.eventsStatus === "error" ? `<span>${escapeHtml(state.eventsError)}</span><button data-action="events-retry">Réessayer</button>` : "Chargement de tes événements…";
  status.classList.toggle("has-error", state.eventsStatus === "error");
  const title = periodTitle(state);
  if (!isHome && !isDocuments) {
    document.getElementById("period-title").innerHTML = `<span class="period-primary">${title.primary}</span><span class="period-year">${title.secondary}</span>`;
    app.querySelector('[data-action="prev"]').setAttribute("aria-label", `${VIEW_LABELS[state.view]} ${state.view === "week" ? "précédente" : "précédent"}`);
    app.querySelector('[data-action="next"]').setAttribute("aria-label", `${VIEW_LABELS[state.view]} ${state.view === "week" ? "suivante" : "suivant"}`);
    for (const button of app.querySelectorAll(".view-switch button")) button.setAttribute("aria-pressed", String(button.dataset.action === state.view));
  }
  const monthKey = dateKey(state.date).slice(0, 7);
  const retainMonth = !isHome && renderedPage === "calendar" && state.view === "month" && renderedView === "month" && renderedPeriod === monthKey && ["date", "keyboard-date"].includes(reason);
  if (isDocuments) {content.innerHTML = renderDocuments(state); void renderPdfPreview(content);}
  else if (isHome) {
    content.innerHTML = renderHome(state);
    document.getElementById("home-search-input").value = homeSearchQuery;
    document.getElementById("home-task-title").value = homeTaskDraft;
    const taskList = content.querySelector(".home-task-list");
    if (taskList) taskList.scrollTop = reason === "task-add" ? taskList.scrollHeight : oldTaskScroll || 0;
    content.querySelector(".home-page").classList.toggle("entering", previousPage !== "home");
  }
  else if (retainMonth) {
    for (const cell of app.querySelectorAll(".month-cell")) {
      const button = cell.querySelector(".month-date");
      const selected = button.dataset.date === dateKey(state.date);
      cell.classList.toggle("selected", selected);
      cell.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  } else content.innerHTML = renderCalendar(state);
  renderedPeriod = monthKey;
  renderedView = state.view;
  renderedPage = state.page;
  const hints = {month: "Clique sur une date pour voir sa semaine", week: "Clique sur un jour pour voir son horaire", day: "Ta journée, heure par heure"};
  document.getElementById("view-hint").innerHTML = `<span class="hint-dot"></span>${isDocuments ? "Tes documents, liés à ton calendrier" : isHome ? "Ta journée en un coup d’œil" : hints[state.view]}`;
  document.getElementById("timezone-offset").textContent = zoneOffset(state.preferences.timezone, isHome ? state.today : state.date);
  if (previousPage !== state.page) content.scrollTop = 0;
  const scroll = app.querySelector(".time-scroll");
  if (scroll) scroll.scrollTop = oldScroll !== undefined && !["view", "drilldown"].includes(reason) ? oldScroll : 7 * 64 - 16;
  if (isHome && homeControlId) {const input = document.getElementById(homeControlId); input?.focus({preventScroll: true}); if (input && homeSelection) input.setSelectionRange(...homeSelection);}
  else if (isHome && focusTaskId) {
    const taskControls = Array.from(app.querySelectorAll('[data-task-id]'));
    const target = taskControls.find(element => element.dataset.taskId === focusTaskId && element.tagName === active.tagName)
      || app.querySelectorAll('.home-task input')[Math.max(0, taskFocusIndex - 1)] || document.getElementById("home-task-title");
    target?.focus({preventScroll: true});
  }
  else if (isHome && reason === "initial" && window.matchMedia("(pointer: fine)").matches) document.getElementById("home-search-input").focus({preventScroll: true});
  else if (isDocuments && searchFocused) {const input = document.getElementById("document-search"); input?.focus({preventScroll: true}); if (input && searchSelection) input.setSelectionRange(...searchSelection);}
  else if (reason === "documents-open") document.getElementById("documents-title")?.focus({preventScroll: true});
  else if (isDocuments && reason === "document-select" && state.documentDetailsOpen) {content.scrollTop = 0; app.querySelector('.inspector-back')?.focus({preventScroll: true});}
  else if (isDocuments && reason === "document-back") app.querySelector(`[data-action="document-select"][data-document-id="${state.selectedDocumentId}"]`)?.focus();
  else if (isDocuments && focusDocumentId && !document.contains(active)) app.querySelector(`[data-action="${focusAction}"][data-document-id="${focusDocumentId}"]`)?.focus({preventScroll: true});
  else if (reason === "home") document.getElementById("home-title")?.focus({preventScroll: true});
  else if (reason === "drilldown" || (reason === "view" && previousPage === "home")) (app.querySelector(`.time-day-heading[data-date="${dateKey(state.date)}"]`) || app.querySelector(".month-date[tabindex='0']") || content)?.focus({preventScroll: true});
  else if ((focusWasMonth || reason === "keyboard-date") && !isHome && state.view === "month") app.querySelector(`.month-date[data-date="${dateKey(state.date)}"]`)?.focus({preventScroll: true});
  else if (focusWasMini) {
    if (window.matchMedia("(max-width: 760px)").matches) (app.querySelector(".month-date[tabindex='0']") || document.getElementById("calendar-content"))?.focus({preventScroll: true});
    else app.querySelector(`.mini-day[data-date="${focusDate}"]`)?.focus({preventScroll: true});
  }
  else if (focusAction && !document.contains(active)) app.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll: true});
  if (["navigate", "view", "today", "date", "keyboard-date", "drilldown", "home"].includes(reason)) document.getElementById("announcement").textContent = isHome ? `Accueil. Aujourd’hui, ${fullDate(state.today)}. ${state.eventsStatus === "ready" ? eventCount(eventsOnDate(state.events, state.today).length) + " aujourd’hui." : "Chargement du calendrier."}` : `${title.primary} ${title.secondary}. Vue ${VIEW_LABELS[state.view].toLowerCase()}. Date sélectionnée : ${fullDate(state.date)}.`;
}

function syncSidebarAccess(state = store.getState()) {
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const sidebar = document.getElementById("sidebar");
  sidebar.inert = mobile && !state.sidebarOpen;
  app.querySelector("main").inert = mobile && state.sidebarOpen;
  if (mobile && state.sidebarOpen) {sidebar.setAttribute("role", "dialog"); sidebar.setAttribute("aria-modal", "true");}
  else {sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal");}
}
window.matchMedia("(max-width: 760px)").addEventListener("change", () => {store.closeSidebar(); syncSidebarAccess();});

function closeDialog() {dialogRoot.querySelector("dialog")?.close();}
function openDialog(type) {
  closeDialog();
  dialogOpener = document.activeElement;
  const state = store.getState();
  dialogRoot.innerHTML = type === "jump" ? jumpDialog(state) : type === "settings" ? preferencesDialog(state) : shortcutsDialog();
  const dialog = dialogRoot.querySelector("dialog");
  const opener = dialogOpener;
  const openerAction = opener?.dataset.action;
  dialog.addEventListener("close", () => {
    if (dialogRoot.firstElementChild !== dialog) return;
    dialogRoot.innerHTML = "";
    const target = document.contains(opener) ? opener : openerAction ? app.querySelector(`[data-action="${openerAction}"]`) : null;
    target?.focus({preventScroll: true});
  });
  dialog.addEventListener("click", event => {if (event.target === dialog) {const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();}});
  dialog.showModal();
  if (type === "jump") dialog.querySelector("input").focus();
}

const actions = {
  prev: () => store.navigate(-1), next: () => store.navigate(1), today: () => store.goToday(),
  month: () => store.setView("month"), week: () => store.setView("week"), day: () => store.setView("day"),
  "mini-prev": () => store.navigateMini(-1), "mini-next": () => store.navigateMini(1),
  home: () => store.goHome(),
  "open-week": element => store.openDate(parseDate(element.dataset.date), "week"),
  "open-day": element => store.openDate(parseDate(element.dataset.date), "day"),
  "today-day": () => store.openDate(store.getState().today, "day"),
  "today-week": () => store.openDate(store.getState().today, "week"),
  "remove-task": element => {store.removeTask(element.dataset.taskId); document.getElementById("announcement").textContent = "Tâche supprimée.";},
  jump: () => openDialog("jump"), settings: () => openDialog("settings"), shortcuts: () => openDialog("shortcuts"),
  "close-dialog": closeDialog, "jump-today": () => {closeDialog(); store.goToday();},
  "toggle-sidebar": () => store.toggleSidebar(), "close-sidebar": () => store.closeSidebar(),
  "calendar-home": () => store.setView(store.getState().view)
};
document.addEventListener("click", event => {const element = event.target.closest("[data-action]"); if (element) {event.preventDefault(); actions[element.dataset.action]?.(element);}});
document.addEventListener("change", event => {
  if (event.target.matches('.search-engines input')) store.setPreferences({searchEngine: event.target.value});
  if (event.target.matches('.home-task input')) {
    const completed = event.target.checked;
    store.toggleTask(event.target.dataset.taskId);
    document.getElementById("announcement").textContent = completed ? "Tâche terminée." : "Tâche remise à faire.";
  }
});
document.addEventListener("input", event => {
  if (["home-search-input", "home-task-title"].includes(event.target.id)) event.target.setCustomValidity("");
});
document.addEventListener("submit", event => {
  if (event.target.id === "home-search-form") {
    const input = event.target.elements.q;
    input.value = input.value.trim();
    if (!input.value) {event.preventDefault(); input.setCustomValidity("Écris quelque chose à rechercher."); input.reportValidity();}
  }
  if (event.target.id === "home-task-form") {
    event.preventDefault();
    const input = event.target.elements.title;
    const title = input.value.trim();
    if (!title) {input.setCustomValidity("Écris le titre de ta tâche."); input.reportValidity(); return;}
    input.value = "";
    homeTaskDraft = "";
    store.addTask(title);
    document.getElementById("home-task-title").focus({preventScroll: true});
    document.getElementById("announcement").textContent = "Tâche ajoutée.";
  }
  if (event.target.id === "jump-form") {
    event.preventDefault();
    const date = parseDate(new FormData(event.target).get("date"));
    if (date) {closeDialog(); if (store.getState().page === "home") store.openDate(date, "week"); else store.selectDate(date);}
  }
  if (event.target.id === "preferences-form") {
    event.preventDefault();
    const fields = new FormData(event.target);
    store.setPreferences({weekStart: Number(fields.get("weekStart")), timeFormat: fields.get("timeFormat"), searchEngine: fields.get("searchEngine")});
    closeDialog();
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && store.getState().sidebarOpen) {event.preventDefault(); store.closeSidebar();}
  if (event.key === "Tab" && store.getState().sidebarOpen && window.matchMedia("(max-width: 760px)").matches) {
    const buttons = Array.from(app.querySelectorAll(".sidebar a, .sidebar button")).filter(element => element.getClientRects().length);
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  }
  if (dialogRoot.querySelector("dialog[open]") || event.ctrlKey || event.metaKey || event.altKey || event.target.matches("input, select, textarea, [contenteditable=true]")) return;
  const dateButton = event.target.closest(".month-date");
  if (dateButton && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    const delta = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[event.key];
    store.selectDate(addDays(parseDate(dateButton.dataset.date), delta), "keyboard-date");
    return;
  }
  const shortcuts = {n: eventController.openCreate, h: actions.home, m: actions.month, w: actions.week, d: actions.day, t: actions.today, g: actions.jump, "/": () => {store.goHome(); document.getElementById("home-search-input").focus();}, "?": actions.shortcuts, ArrowLeft: actions.prev, ArrowRight: actions.next};
  const action = shortcuts[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (action) {event.preventDefault(); action();}
});
store.subscribe(render);
window.addEventListener("storage", event => {if (event.storageArea === storage) store.syncLocalStorage(event.key);});
render(store.getState());
void eventController.loadEvents();
void documentController.loadDocuments();
setInterval(() => {if (!document.hidden) store.refreshClock();}, 60_000);
document.addEventListener("visibilitychange", () => {if (!document.hidden) store.refreshClock();});

}
void startCalendar().catch(error => {
  document.getElementById("app").innerHTML = `<main style="padding:40px"><h1>Tempo</h1><p>${escapeHtml(error.message)}</p><a href="/?section=calendar">Ouvrir HomeLab</a></main>`;
});
