import {addDays, addMonths, civilDate, dateKey, todayInZone, DEFAULT_TIMEZONE} from "./date.js";

// Keep the original key so Tempo preserves existing account preferences.
const STORAGE_KEY = "clear-calendar:preferences:v1";
const DEFAULT_PREFERENCES = {weekStart: 1, timeFormat: "12", timezone: DEFAULT_TIMEZONE, searchEngine: "google"};

function restorePreferences(saved) {
  const preferences = {...DEFAULT_PREFERENCES};
  if (saved?.weekStart === 0 || saved?.weekStart === 1) preferences.weekStart = saved.weekStart;
  if (saved?.timeFormat === "12" || saved?.timeFormat === "24") preferences.timeFormat = saved.timeFormat;
  if (saved?.searchEngine === "google" || saved?.searchEngine === "duckduckgo") preferences.searchEngine = saved.searchEngine;
  return preferences;
}

export function createCalendarStore(storage = null, account = null) {
  const storageKey = account ? `${STORAGE_KEY}:${account.username}` : STORAGE_KEY;
  let preferences = {...DEFAULT_PREFERENCES};
  try {
    preferences = restorePreferences(JSON.parse(storage?.getItem(storageKey) || "null"));
  } catch { /* Storage is optional, including in private browsing. */ }
  const today = todayInZone(preferences.timezone);
  let state = {page: "calendar", view: "month", date: today, today, miniDate: today, preferences, account, sidebarOpen: false, events: [], eventsStatus: "loading", eventsError: "", aiAvailable: true, documents: [], documentFolders: [], currentFolderId: null, documentsStatus: "loading", documentsError: "", documentJobs: [], documentQuery: "", documentFilter: "all", selectedDocumentId: null, documentDetailsOpen: false};
  const subscribers = new Set();
  function update(patch, reason) {
    state = {...state, ...patch};
    for (const subscriber of subscribers) subscriber(state, reason);
  }
  function selectDate(date, reason = "date") {
    if (!validDate(date)) return;
    update({page: "calendar", date, miniDate: date, sidebarOpen: false}, reason);
  }
  function validDate(date) { return date instanceof Date && Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999; }
  return {
    getState: () => state,
    subscribe(callback) {subscribers.add(callback); return () => subscribers.delete(callback);},
    selectDate,
    setEvents(events, patch = {}) {update({events, ...patch}, "events");},
    setDocuments(documents, patch = {}) {update({documents, ...patch}, "documents");},
    openDocumentFolder(id = null) {
      if (id && !state.documentFolders.some(folder => folder.id === id)) return;
      update({page: "documents", currentFolderId: id, documentQuery: "", documentFilter: "all", selectedDocumentId: null, documentDetailsOpen: false, sidebarOpen: false}, "folder-open");
    },
    goDocuments(id = null) {update({page: "documents", selectedDocumentId: id || state.selectedDocumentId, documentDetailsOpen: !!id, sidebarOpen: false}, "documents-open");},
    selectDocument(id, documentDetailsOpen = false) {update({selectedDocumentId: id, documentDetailsOpen}, "document-select");},
    closeDocumentDetails() {update({documentDetailsOpen: false}, "document-back");},
    setDocumentQuery(documentQuery) {update({documentQuery}, "documents-search");},
    setDocumentFilter(documentFilter) {update({documentFilter}, "documents-filter");},
    syncLocalStorage(key) {
      if (!storage || (key !== null && key !== storageKey)) return;
      const patch = {};
      try {
        if (key === null || key === storageKey) patch.preferences = restorePreferences(JSON.parse(storage.getItem(storageKey) || "null"));
      } catch { /* A storage error in another tab must not interrupt this one. */ }
      if (Object.keys(patch).length) update(patch, "storage");
    },
    openDate(date, view) {
      if (!validDate(date) || !["month", "week", "day"].includes(view)) return;
      update({page: "calendar", date, miniDate: date, view, sidebarOpen: false}, "drilldown");
    },
    setView(view) {
      if (["month", "week", "day"].includes(view)) {
        const date = state.page !== "calendar" ? state.today : state.date;
        update({page: "calendar", date, miniDate: date, view, sidebarOpen: false}, "view");
      }
    },
    navigate(direction) {
      if (state.page !== "calendar") return;
      const next = state.view === "month" ? addMonths(state.date, direction) : addDays(state.date, direction * (state.view === "week" ? 7 : 1));
      selectDate(next, "navigate");
    },
    navigateMini(direction) {
      const next = addMonths(state.miniDate, direction);
      if (next.getUTCFullYear() >= 1 && next.getUTCFullYear() <= 9999) update({miniDate: civilDate(next.getUTCFullYear(), next.getUTCMonth())}, "mini");
    },
    goToday() {
      const today = todayInZone(state.preferences.timezone);
      update({today, date: today, miniDate: today, sidebarOpen: false}, "today");
    },
    toggleSidebar() {update({sidebarOpen: !state.sidebarOpen}, "sidebar");},
    closeSidebar() {if (state.sidebarOpen) update({sidebarOpen: false}, "sidebar");},
    setPreferences(patch) {
      const preferences = {...state.preferences};
      if (patch.weekStart === 0 || patch.weekStart === 1) preferences.weekStart = patch.weekStart;
      if (patch.timeFormat === "12" || patch.timeFormat === "24") preferences.timeFormat = patch.timeFormat;
      if (patch.searchEngine === "google" || patch.searchEngine === "duckduckgo") preferences.searchEngine = patch.searchEngine;
      try {storage?.setItem(storageKey, JSON.stringify(preferences));} catch { /* Keep working without persistence. */ }
      update({preferences}, "preferences");
    },
    refreshClock() {update({today: todayInZone(state.preferences.timezone)}, "clock");}
  };
}
