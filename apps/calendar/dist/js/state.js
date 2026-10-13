import {addDays, addMonths, civilDate, dateKey, parseDate, todayInZone, DEFAULT_TIMEZONE} from "./date.js";

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

function restoreTasks(saved) {
  if (!Array.isArray(saved)) return [];
  const ids = new Set();
  return saved.filter(task => {
    if (!task || typeof task.id !== "string" || !/^[\w-]{1,80}$/.test(task.id) || ids.has(task.id)) return false;
    if (typeof task.title !== "string" || !task.title.trim() || task.title.length > 160) return false;
    if (task.completedDate !== null && (typeof task.completedDate !== "string" || !parseDate(task.completedDate))) return false;
    ids.add(task.id);
    return true;
  }).map(task => ({id: task.id, title: task.title.trim(), completedDate: task.completedDate}));
}

export function createCalendarStore(storage = null, account = null) {
  const storageKey = account ? `${STORAGE_KEY}:${account.username}` : STORAGE_KEY;
  const tasksKey = account ? `tempo:tasks:v1:${account.username}` : "tempo:tasks:v1";
  let preferences = {...DEFAULT_PREFERENCES};
  try {
    preferences = restorePreferences(JSON.parse(storage?.getItem(storageKey) || "null"));
  } catch { /* Storage is optional, including in private browsing. */ }
  let tasks = [], tasksSaved = !!storage;
  try {
    tasks = restoreTasks(JSON.parse(storage?.getItem(tasksKey) || "null"));
  } catch { /* A damaged or unavailable task list must not prevent startup. */ }
  const today = todayInZone(preferences.timezone);
  let state = {page: "home", view: "month", date: today, today, miniDate: today, preferences, account, tasks, tasksSaved, sidebarOpen: false, events: [], eventsStatus: "loading", eventsError: "", aiAvailable: true, documents: [], documentsStatus: "loading", documentsError: "", documentJobs: [], documentQuery: "", documentFilter: "all", selectedDocumentId: null, documentDetailsOpen: false};
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
  function saveTasks(tasks, reason) {
    let tasksSaved = false;
    try {if (storage) {storage.setItem(tasksKey, JSON.stringify(tasks)); tasksSaved = true;}} catch { /* Tasks remain usable for the current session. */ }
    update({tasks, tasksSaved}, reason);
  }
  return {
    getState: () => state,
    subscribe(callback) {subscribers.add(callback); return () => subscribers.delete(callback);},
    selectDate,
    setEvents(events, patch = {}) {update({events, ...patch}, "events");},
    setDocuments(documents, patch = {}) {update({documents, ...patch}, "documents");},
    goDocuments(id = null) {update({page: "documents", selectedDocumentId: id || state.selectedDocumentId, documentDetailsOpen: !!id, sidebarOpen: false}, "documents-open");},
    selectDocument(id, documentDetailsOpen = false) {update({selectedDocumentId: id, documentDetailsOpen}, "document-select");},
    closeDocumentDetails() {update({documentDetailsOpen: false}, "document-back");},
    setDocumentQuery(documentQuery) {update({documentQuery}, "documents-search");},
    setDocumentFilter(documentFilter) {update({documentFilter}, "documents-filter");},
    addTask(title) {
      if (typeof title !== "string" || !title.trim() || title.trim().length > 160) return false;
      saveTasks([...state.tasks, {id: globalThis.crypto.randomUUID(), title: title.trim(), completedDate: null}], "task-add");
      return true;
    },
    toggleTask(id) {
      if (!state.tasks.some(task => task.id === id)) return;
      saveTasks(state.tasks.map(task => task.id === id ? {...task, completedDate: task.completedDate ? null : dateKey(state.today)} : task), "task-toggle");
    },
    removeTask(id) {
      if (state.tasks.some(task => task.id === id)) saveTasks(state.tasks.filter(task => task.id !== id), "task-remove");
    },
    syncLocalStorage(key) {
      if (!storage || (key !== null && key !== storageKey && key !== tasksKey)) return;
      const patch = {};
      try {
        if (key === null || key === storageKey) patch.preferences = restorePreferences(JSON.parse(storage.getItem(storageKey) || "null"));
        if (key === null || key === tasksKey) {patch.tasks = restoreTasks(JSON.parse(storage.getItem(tasksKey) || "null")); patch.tasksSaved = true;}
      } catch { /* A storage error in another tab must not interrupt this one. */ }
      if (Object.keys(patch).length) update(patch, "storage");
    },
    openDate(date, view) {
      if (!validDate(date) || !["month", "week", "day"].includes(view)) return;
      update({page: "calendar", date, miniDate: date, view, sidebarOpen: false}, "drilldown");
    },
    goHome() {
      const today = todayInZone(state.preferences.timezone);
      update({page: "home", today, miniDate: today, sidebarOpen: false}, "home");
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
