import { MediaError, record } from "../media/core.ts";

export const DEFAULT_EVENT_TYPE_ID = "none";
export function eventTypeId(value: unknown): string {
  return value === undefined || value === DEFAULT_EVENT_TYPE_ID ? DEFAULT_EVENT_TYPE_ID : eventId(value);
}

export type Recurrence = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number; weekdays: number[]; until: string | null; count: number | null;
};
export type EventInput = {
  title: string; description: string; date: string; endDate: string;
  startTime: string | null; endTime: string | null; allDay: boolean; recurrence: Recurrence | null; typeId: string;
  kind?: "event" | "task"; completed?: boolean; completedAt?: string | null;
  deadline?: { date: string; time: string | null } | null;
  notes?: string; links?: string[]; documentIds?: string[];
  context?: { kind: "course" | "project"; name: string; courseId?: number } | null;
};
export type MoodleSource = { key: string; entity: "event" | "assignment"; remoteId: number; courseId: number | null; semester: string; url: string; fingerprint: string; available: boolean; personalDeadlineChecked?: boolean };
export type EventSource = { documentId: string; documentName: string; proposalId: string; page: number | null; origin?: "library" };
export type CalendarEvent = EventInput & { id: string; createdAt: string; updatedAt: string; source?: EventSource; moodle?: MoodleSource; completedOccurrences?: Record<string, string> };
export const eventSchema = {
  type: "object", additionalProperties: false,
  properties: {
    typeId: { type: "string", description: "ID of the most appropriate eventTypes entry, based on the event title. Use none only when no named type fits." },
    title: { type: "string", description: "Short title in the user's language, at most 160 characters." },
    description: { type: "string", description: "Only details supplied by the user; empty if none. At most 4000 characters." },
    date: { type: "string", description: "Start date YYYY-MM-DD in America/Toronto of the first occurrence only. For weekly schedules, use the first selected weekday within the schedule's date range." },
    endDate: { type: "string", description: "End date YYYY-MM-DD of the first occurrence only, inclusive for all-day events. Usually equal to date; advance for overnight or explicitly multi-day occurrences. Never use the semester or recurring series ending here; use recurrence.until." },
    startTime: { type: ["string", "null"], description: "HH:mm in America/Toronto; null for all-day events." },
    endTime: { type: ["string", "null"], description: "HH:mm in America/Toronto; null for all-day events." },
    allDay: { type: "boolean" },
    recurrence: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      properties: {
        frequency: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
        interval: { type: "integer", minimum: 1, maximum: 99, description: "Repeat every N days/weeks/months/years; 2 for every other week." },
        weekdays: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, maxItems: 7, description: "For weekly rules only: 0=Sunday through 6=Saturday. Otherwise empty." },
        until: { type: ["string", "null"], description: "Inclusive cutoff YYYY-MM-DD for occurrence start dates, or null. Use the schedule or semester ending here, never in endDate." },
        count: { type: ["integer", "null"], minimum: 1, maximum: 1000, description: "Number of occurrences, including the first, or null. Never set both count and until." },
      }, required: ["frequency", "interval", "weekdays", "until", "count"],
    }] },
  }, required: ["title", "description", "date", "endDate", "startTime", "endTime", "allDay", "recurrence", "typeId"],
};

export function eventSchemaForTypes(types: { id: string }[]) {
  return { ...eventSchema, properties: { ...eventSchema.properties, typeId: { ...eventSchema.properties.typeId, enum: types.map(type => type.id) } } };
}

// Document scans retain their existing event contract; conversational creation
// can choose between a scheduled moment and work with a deadline.
export function plannerSchemaForTypes(types: { id: string }[]) {
  const schema = eventSchemaForTypes(types);
  return { ...schema, properties: { ...schema.properties,
    kind: { type: "string", enum: ["event", "task"] },
    completed: { type: "boolean", description: "False for a new task unless explicitly already done." },
    deadline: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: { date: { type: "string" }, time: { type: ["string", "null"] } }, required: ["date", "time"] }] },
    notes: { type: "string" }, links: { type: "array", items: { type: "string" }, maxItems: 30 },
    context: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: { kind: { type: "string", enum: ["course", "project"] }, name: { type: "string" } }, required: ["kind", "name"] }] },
  }, required: [...schema.required, "kind", "completed", "deadline", "notes", "links", "context"] };
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function eventId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new MediaError("input", "Identifiant d’événement invalide.", 400);
  return value;
}
function validateRecurrence(value: unknown, date: string): Recurrence | null {
  // Older events and clients have no recurrence field.
  if (value === undefined || value === null) return null;
  const rule = record(value);
  if (!["daily", "weekly", "monthly", "yearly"].includes(rule.frequency as string) || !Number.isInteger(rule.interval) || (rule.interval as number) < 1 || (rule.interval as number) > 99) throw new MediaError("input", "Choisis une fréquence et un intervalle de 1 à 99.", 400);
  if (!Array.isArray(rule.weekdays) || rule.weekdays.length > 7 || rule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(rule.weekdays).size !== rule.weekdays.length) throw new MediaError("input", "Choisis des jours de semaine valides.", 400);
  if (rule.frequency === "weekly" ? !rule.weekdays.length || !rule.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) : rule.weekdays.length) throw new MediaError("input", "Pour une répétition hebdomadaire, sélectionne au moins le jour de la date de début. Pour les autres fréquences, laisse les jours vides.", 400);
  if (rule.until !== null && (!validDate(rule.until) || rule.until < date)) throw new MediaError("input", "La fin de la répétition doit être à partir de la date de début.", 400);
  if (rule.count !== null && (!Number.isInteger(rule.count) || (rule.count as number) < 1 || (rule.count as number) > 1000)) throw new MediaError("input", "Choisis un nombre de répétitions de 1 à 1 000.", 400);
  if (rule.until !== null && rule.count !== null) throw new MediaError("input", "Choisis une date de fin ou un nombre de répétitions.", 400);
  return { frequency: rule.frequency as Recurrence["frequency"], interval: rule.interval as number, weekdays: [...rule.weekdays].sort((a, b) => a - b), until: rule.until as string | null, count: rule.count as number | null };
}
export function validateEvent(value: unknown): EventInput {
  const row = { ...record(value) };
  if (row.kind !== undefined && row.kind !== "event" && row.kind !== "task") throw new MediaError("input", "Choisis un événement ou une tâche.", 400);
  const task = row.kind === "task";
  let deadline: EventInput["deadline"];
  if (task) {
    if (typeof row.completed !== "boolean") throw new MediaError("input", "Indique si la tâche est terminée.", 400);
    if (row.deadline === null) deadline = null;
    else {
      const due = record(row.deadline);
      if (!validDate(due.date) || (due.time !== null && (typeof due.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(due.time)))) throw new MediaError("input", "Vérifie l’échéance de la tâche.", 400);
      deadline = { date: due.date, time: due.time as string | null };
    }
    if (row.recurrence && !deadline) throw new MediaError("input", "Ajoute une première échéance pour répéter la tâche.", 400);
    row.date = deadline?.date ?? row.date;
    row.endDate = row.date;
    row.startTime = row.endTime = deadline?.time ?? null;
    row.allDay = !deadline?.time;
  }
  if (typeof row.title !== "string" || !row.title.trim() || row.title.length > 160 || (/[\r\n]/.test(row.title) || row.title.includes("\u0000"))) throw new MediaError("input", "Ajoute un titre de 160 caractères maximum.", 400);
  if (typeof row.description !== "string" || row.description.length > 4000 || row.description.includes("\u0000")) throw new MediaError("input", "La description doit contenir au plus 4 000 caractères.", 400);
  if (!validDate(row.date) || !validDate(row.endDate) || row.endDate < row.date) throw new MediaError("input", "Vérifie les dates de début et de fin.", 400);
  if (Date.parse(row.endDate) - Date.parse(row.date) > 366 * 86_400_000) throw new MediaError("input", "Un événement peut couvrir au plus un an.", 400);
  if (typeof row.allDay !== "boolean") throw new MediaError("input", "Indique si l’événement dure toute la journée.", 400);
  if (row.allDay) {
    if (row.startTime !== null || row.endTime !== null) throw new MediaError("input", "Un événement sur toute la journée ne doit pas avoir d’horaire.", 400);
  } else {
    if (typeof row.startTime !== "string" || typeof row.endTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime)) throw new MediaError("input", "Ajoute une heure de début et de fin valides.", 400);
    if (!task && `${row.endDate}T${row.endTime}` <= `${row.date}T${row.startTime}`) throw new MediaError("input", "La fin doit être après le début de l’événement.", 400);
  }
  const extra: Partial<EventInput> = {};
  if (row.kind !== undefined) extra.kind = row.kind as EventInput["kind"];
  if (task) Object.assign(extra, { completed: row.completed, deadline, completedAt: typeof row.completedAt === "string" && Number.isFinite(Date.parse(row.completedAt)) ? row.completedAt : null });
  if (row.notes !== undefined) {
    if (typeof row.notes !== "string" || row.notes.length > 8000 || row.notes.includes("\u0000")) throw new MediaError("input", "Les notes doivent contenir au plus 8 000 caractères.", 400);
    extra.notes = row.notes.trim();
  }
  if (row.links !== undefined) {
    if (!Array.isArray(row.links) || row.links.length > 30 || row.links.some(link => {
      if (typeof link !== "string" || link.length > 2048) return true;
      try { const url = new URL(link); return !["https:", "http:"].includes(url.protocol) || !!url.username || !!url.password; } catch { return true; }
    })) throw new MediaError("input", "Ajoute au plus 30 liens HTTP ou HTTPS valides.", 400);
    extra.links = [...new Set(row.links as string[])];
  }
  if (row.documentIds !== undefined) {
    if (!Array.isArray(row.documentIds) || row.documentIds.length > 50 || row.documentIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) throw new MediaError("input", "Choisis des documents valides dans Bibliothèque.", 400);
    extra.documentIds = [...new Set(row.documentIds as string[])];
  }
  if (row.context !== undefined) {
    if (row.context === null) extra.context = null;
    else {
      const context = record(row.context);
      if (!["course", "project"].includes(context.kind as string) || typeof context.name !== "string" || !context.name.trim() || context.name.length > 240 || /[\p{Cc}]/u.test(context.name)) throw new MediaError("input", "Ajoute un nom de cours ou de projet valide.", 400);
      if (context.courseId !== undefined && (!Number.isSafeInteger(context.courseId) || Number(context.courseId) <= 0 || context.kind !== "course")) throw new MediaError("input", "Cours Moodle invalide.", 400);
      extra.context = { kind: context.kind as "course" | "project", name: context.name.trim(), ...(context.courseId !== undefined ? { courseId: Number(context.courseId) } : {}) };
    }
  }
  return { title: row.title.trim(), description: row.description.trim(), date: row.date, endDate: row.endDate, allDay: row.allDay, startTime: row.startTime as string | null, endTime: row.endTime as string | null, recurrence: validateRecurrence(row.recurrence, row.date), typeId: eventTypeId(row.typeId), ...extra };
}
