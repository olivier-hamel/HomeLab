import {addDays, addMonths, civilDate, todayInZone, DEFAULT_TIMEZONE} from "./date.js";

// Keep the original key so Tempo preserves existing account preferences.
const STORAGE_KEY = "clear-calendar:preferences:v1";
const DEFAULT_PREFERENCES = {weekStart: 1, timeFormat: "12", timezone: DEFAULT_TIMEZONE};

export function createCalendarStore(storage = null, account = null) {
  const storageKey = account ? `${STORAGE_KEY}:${account.username}` : STORAGE_KEY;
  let preferences = {...DEFAULT_PREFERENCES};
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) || "null");
    if (saved?.weekStart === 0 || saved?.weekStart === 1) preferences.weekStart = saved.weekStart;
    if (saved?.timeFormat === "12" || saved?.timeFormat === "24") preferences.timeFormat = saved.timeFormat;
  } catch { /* Storage is optional, including in private browsing. */ }
  const today = todayInZone(preferences.timezone);
  let state = {page: "home", view: "month", date: today, today, miniDate: today, preferences, account, sidebarOpen: false, events: [], eventsStatus: "loading", eventsError: "", aiAvailable: true};
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
        const date = state.page === "home" ? state.today : state.date;
        update({page: "calendar", date, miniDate: date, view, sidebarOpen: false}, "view");
      }
    },
    navigate(direction) {
      if (state.page === "home") return;
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
      try {storage?.setItem(storageKey, JSON.stringify(preferences));} catch { /* Keep working without persistence. */ }
      update({preferences}, "preferences");
    },
    refreshClock() {update({today: todayInZone(state.preferences.timezone)}, "clock");}
  };
}
