import {dateKey} from "./date.js";

export const eventCount = count => `${count} événement${count > 1 ? "s" : ""}`;
export function eventsOnDate(events = [], date) {
  const key = typeof date === "string" ? date : dateKey(date);
  return events.filter(event => event.date <= key && event.endDate >= key && (event.allDay || event.endDate !== key || event.endTime !== "00:00"))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startTime || "").localeCompare(b.startTime || "") || a.title.localeCompare(b.title));
}
export function timeLabel(time, format = "24") {
  if (!time) return "Toute la journée";
  const [hour, minute] = time.split(":").map(Number);
  return format === "24" ? `${hour} h${minute ? ` ${String(minute).padStart(2, "0")}` : ""}` : `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "a.m." : "p.m."}`;
}
export function eventTime(event, format = "24") {
  return event.allDay ? "Toute la journée" : `${timeLabel(event.startTime, format)} – ${timeLabel(event.endTime, format)}`;
}
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export function layoutTimedEvents(events, date) {
  const key = dateKey(date);
  const rows = eventsOnDate(events, key).filter(event => !event.allDay).map(event => ({event,
    start: event.date === key ? minutes(event.startTime) : 0,
    end: event.endDate === key ? minutes(event.endTime) : 1440,
  })).sort((a, b) => a.start - b.start || b.end - a.end);
  // Assign lanes to intersecting groups so no event obscures another event.
  let group = [], groupEnd = -1;
  function finish() {
    const lanes = [];
    for (const row of group) {
      let lane = lanes.findIndex(end => end <= row.start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = row.end;
      row.lane = lane;
    }
    for (const row of group) row.lanes = lanes.length;
  }
  for (const row of rows) {
    if (row.start >= groupEnd) {finish(); group = []; groupEnd = -1;}
    group.push(row); groupEnd = Math.max(groupEnd, row.end);
  }
  finish();
  return rows;
}
export function createEventRepository(fetcher = fetch) {
  async function request(path, method = "GET", body, signal) {
    let response;
    try {
      response = await fetcher(`/api/calendar/${path}`, {method, credentials: "same-origin", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        ...(body ? {headers: {"Content-Type": "application/json", "X-Calendar-Request": "1"}, body: JSON.stringify(body)} : {})});
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("La connexion a été interrompue. Réessaie; tes détails sont conservés.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "L’action n’a pas pu être effectuée. Réessaie.");
      error.code = result.code;
      throw error;
    }
    return result;
  }
  return {
    list: signal => request("events", "GET", null, signal),
    interpret: (text, selectedDate, signal) => request("interpret", "POST", {text, selectedDate}, signal),
    addEvent: (event, requestId, signal) => request("events", "POST", {event, requestId}, signal),
    updateEvent: (event, input, signal) => request(`events/${event.id}`, "PATCH", {event: input, updatedAt: event.updatedAt}, signal),
    deleteEvent: (event, signal) => request(`events/${event.id}`, "DELETE", {updatedAt: event.updatedAt}, signal),
  };
}
