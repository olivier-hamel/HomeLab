export type Task = { id: string; title: string; completedDate: string | null };
export type HomePreferences = { searchEngine: "google" | "duckduckgo"; timeFormat: "12" | "24" };
export type CalendarEvent = {
  id: string; title: string; description: string; date: string; endDate: string;
  allDay: boolean; startTime: string; endTime: string; occurrenceDate?: string;
};
export type CalendarModel = {
  eventsOnDate: (events: CalendarEvent[], date: string) => CalendarEvent[];
  eventsInRange: (events: CalendarEvent[], start: string, end: string) => CalendarEvent[];
  eventTime: (event: CalendarEvent, format: string) => string;
};

export const HOME_TIMEZONE = "America/Toronto";
export function todayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function dayAfter(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function dateLabel(key: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("fr-CA", { ...options, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
}
function validDate(key: unknown): key is string {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key.startsWith("0000")) return false;
  const date = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
}
export function visibleTasks(tasks: Task[], today: string) {
  return tasks.filter(task => !task.completedDate || task.completedDate === today);
}
function restoreTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.filter((task): task is Task => {
    if (!task || typeof task.id !== "string" || !/^[\w-]{1,80}$/.test(task.id) || ids.has(task.id)) return false;
    if (typeof task.title !== "string" || !task.title.trim() || task.title.length > 160) return false;
    if (task.completedDate !== null && !validDate(task.completedDate)) return false;
    ids.add(task.id);
    return true;
  }).map(task => ({ id: task.id, title: task.title.trim(), completedDate: task.completedDate }));
}

export function createHomeStore(username: string, storage: Pick<Storage, "getItem" | "setItem"> | null) {
  // Existing Tempo keys keep every account's tasks and preferences available.
  const tasksKey = `tempo:tasks:v1:${username}`;
  const preferencesKey = `clear-calendar:preferences:v1:${username}`;
  const listeners = new Set<() => void>();
  let state: { tasks: Task[]; saved: boolean; preferences: HomePreferences } = {
    tasks: [], saved: !!storage, preferences: { searchEngine: "google", timeFormat: "12" },
  };
  function sync(key: string | null = null) {
    if (!storage || (key !== null && key !== tasksKey && key !== preferencesKey)) return;
    if (key === null || key === tasksKey) {
      try { state = { ...state, tasks: restoreTasks(JSON.parse(storage.getItem(tasksKey) || "null")), saved: true }; }
      catch { state = { ...state, saved: false }; }
    }
    if (key === null || key === preferencesKey) {
      try {
        const value = JSON.parse(storage.getItem(preferencesKey) || "null");
        state = { ...state, preferences: { searchEngine: value?.searchEngine === "duckduckgo" ? "duckduckgo" : "google", timeFormat: value?.timeFormat === "24" ? "24" : "12" } };
      } catch { /* Keep session preferences when storage is unavailable. */ }
    }
    for (const listener of listeners) listener();
  }
  sync();
  function save(tasks: Task[]) {
    let saved = false;
    try { if (storage) { storage.setItem(tasksKey, JSON.stringify(tasks)); saved = true; } } catch { /* Keep working for this session. */ }
    state = { ...state, tasks, saved };
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    sync,
    add(title: string) {
      if (!title.trim() || title.trim().length > 160) return false;
      save([...state.tasks, { id: crypto.randomUUID(), title: title.trim(), completedDate: null }]);
      return true;
    },
    toggle(id: string, today: string) {
      save(state.tasks.map(task => task.id === id ? { ...task, completedDate: task.completedDate ? null : today } : task));
    },
    remove(id: string) { save(state.tasks.filter(task => task.id !== id)); },
    setSearchEngine(searchEngine: HomePreferences["searchEngine"]) {
      state = { ...state, preferences: { ...state.preferences, searchEngine } };
      try {
        let previous = {};
        try { previous = JSON.parse(storage?.getItem(preferencesKey) || "null") || {}; } catch { /* Repair damaged preferences. */ }
        storage?.setItem(preferencesKey, JSON.stringify({ ...previous, ...state.preferences }));
      } catch { /* Keep the search engine for this session. */ }
      for (const listener of listeners) listener();
    },
  };
}

const sessionStores = new Map<string, ReturnType<typeof createHomeStore>>();
export function homeStoreFor(username: string) {
  let store = sessionStores.get(username);
  if (!store) {
    let storage: Storage | null = null;
    try { storage = localStorage; } catch { /* Storage is optional. */ }
    store = createHomeStore(username, storage);
    sessionStores.set(username, store);
  } else store.sync();
  return store;
}

export async function loadHomeAgenda(signal: AbortSignal): Promise<{ events: CalendarEvent[]; model: CalendarModel }> {
  // Use Tempo's exact recurrence and multi-day rules without copying that logic.
  const moduleUrl = "/calendar/js/events.js";
  const [model, response] = await Promise.all([
    import(/* @vite-ignore */ moduleUrl) as Promise<CalendarModel>,
    fetch("/api/calendar/events", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }),
  ]);
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.events)) throw new Error("Ton agenda est momentanément indisponible.");
  return { model, events: data.events };
}
