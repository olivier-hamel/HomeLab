import { MediaError, record } from "../media/core.ts";

export type EventInput = {
  title: string; description: string; date: string; endDate: string;
  startTime: string | null; endTime: string | null; allDay: boolean;
};
export type CalendarEvent = EventInput & { id: string; createdAt: string; updatedAt: string };
export const eventSchema = {
  type: "object", additionalProperties: false,
  properties: {
    title: { type: "string", description: "Short title in the user's language, at most 160 characters." },
    description: { type: "string", description: "Only details supplied by the user; empty if none. At most 4000 characters." },
    date: { type: "string", description: "Start date YYYY-MM-DD in America/Toronto." },
    endDate: { type: "string", description: "End date YYYY-MM-DD, inclusive for all-day events." },
    startTime: { type: ["string", "null"], description: "HH:mm in America/Toronto; null for all-day events." },
    endTime: { type: ["string", "null"], description: "HH:mm in America/Toronto; null for all-day events." },
    allDay: { type: "boolean" },
  }, required: ["title", "description", "date", "endDate", "startTime", "endTime", "allDay"],
};

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function eventId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new MediaError("input", "Identifiant d’événement invalide.", 400);
  return value;
}
export function validateEvent(value: unknown): EventInput {
  const row = record(value);
  if (typeof row.title !== "string" || !row.title.trim() || row.title.length > 160 || (/[\r\n]/.test(row.title) || row.title.includes("\u0000"))) throw new MediaError("input", "Ajoute un titre de 160 caractères maximum.", 400);
  if (typeof row.description !== "string" || row.description.length > 4000 || row.description.includes("\u0000")) throw new MediaError("input", "La description doit contenir au plus 4 000 caractères.", 400);
  if (!validDate(row.date) || !validDate(row.endDate) || row.endDate < row.date) throw new MediaError("input", "Vérifie les dates de début et de fin.", 400);
  if (Date.parse(row.endDate) - Date.parse(row.date) > 366 * 86_400_000) throw new MediaError("input", "Un événement peut couvrir au plus un an.", 400);
  if (typeof row.allDay !== "boolean") throw new MediaError("input", "Indique si l’événement dure toute la journée.", 400);
  if (row.allDay) {
    if (row.startTime !== null || row.endTime !== null) throw new MediaError("input", "Un événement sur toute la journée ne doit pas avoir d’horaire.", 400);
  } else {
    if (typeof row.startTime !== "string" || typeof row.endTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime)) throw new MediaError("input", "Ajoute une heure de début et de fin valides.", 400);
    if (`${row.endDate}T${row.endTime}` <= `${row.date}T${row.startTime}`) throw new MediaError("input", "La fin doit être après le début de l’événement.", 400);
  }
  return { title: row.title.trim(), description: row.description.trim(), date: row.date, endDate: row.endDate, allDay: row.allDay, startTime: row.startTime as string | null, endTime: row.endTime as string | null };
}
