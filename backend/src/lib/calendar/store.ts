import { type Collection } from "mongodb";
import { database } from "../database.ts";
import { MediaError } from "../media/core.ts";
import { DEFAULT_EVENT_TYPE_ID, eventId, validateEvent, type CalendarEvent, type EventInput, type EventSource, type MoodleSource } from "./events.ts";
import { CalendarEventTypeStore, assertEventType, resolveEventType } from "./event-types.ts";
import { isOccurrenceDate } from "./occurrences.ts";

export type StoredEvent = CalendarEvent & { username: string; removedAt?: string };
let collectionPromise: Promise<Collection<StoredEvent>> | null = null;
async function eventCollection() {
  collectionPromise ??= (async () => {
    const collection = (await database()).collection<StoredEvent>("calendar_events");
    await collection.createIndex({ username: 1, id: 1 }, { unique: true });
    await collection.createIndex({ username: 1, date: 1, endDate: 1 });
    return collection;
  })().catch(error => { collectionPromise = null; throw error; });
  return collectionPromise;
}
function publicEvent(event: StoredEvent): CalendarEvent {
  const completedOccurrences = event.completedOccurrences || {};
  return { ...validateEvent(event), id: event.id, createdAt: event.createdAt, updatedAt: event.updatedAt, ...(event.source ? { source: event.source } : {}), ...(event.moodle ? { moodle: event.moodle } : {}),
    ...(event.kind === "task" && event.recurrence ? { completedOccurrences, completed: !!completedOccurrences[event.date], completedAt: completedOccurrences[event.date] || null } : {}) };
}
function owner(username: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username)) throw new MediaError("account", "Compte invalide.", 403);
  return username;
}
export class CalendarEventStore {
  private collection: () => Promise<Collection<StoredEvent>>;
  readonly types: CalendarEventTypeStore;
  constructor(collection = eventCollection, types = new CalendarEventTypeStore()) { this.collection = collection; this.types = types; }
  async list(username: string): Promise<CalendarEvent[]> {
    const events = await (await this.collection()).find({ username: owner(username) }).sort({ date: 1, startTime: 1, id: 1 }).toArray();
    const types = await this.types.list(username);
    return events.filter(event => !event.removedAt && event.moodle?.available !== false).map(event => ({ ...publicEvent(event), typeId: resolveEventType(event.typeId, types) }));
  }
  async create(username: string, input: EventInput, requestId: string, source?: EventSource) {
    const id = eventId(requestId);
    input = { ...validateEvent(input), typeId: assertEventType(input.typeId, await this.types.list(username)) };
    if (input.kind === "task") input.completedAt = input.completed ? new Date().toISOString() : null;
    const now = new Date().toISOString();
    const completedOccurrences = input.kind === "task" && input.recurrence && input.completed ? { [input.date]: input.completedAt! } : {};
    const collection = await this.collection();
    const filter = { username: owner(username), id };
    // The unique compound index and setOnInsert make interrupted retries safe.
    try {
      await collection.updateOne(filter, { $setOnInsert: { ...input, ...filter, completedOccurrences, ...(source ? { source } : {}), createdAt: now, updatedAt: now } }, { upsert: true });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const event = await collection.findOne(filter);
    if (!event) throw new Error("Event was not saved");
    return { ...publicEvent(event), typeId: resolveEventType(event.typeId, await this.types.list(username)) };
  }
  async update(username: string, id: string, input: EventInput, version: string) {
    input = { ...validateEvent(input), typeId: assertEventType(input.typeId, await this.types.list(username)) };
    const collection = await this.collection();
    const current = await collection.findOne({ username: owner(username), id });
    if (current?.removedAt || current?.moodle?.available === false) throw new MediaError("not_found", "Cet élément n’est plus disponible.", 404);
    const completedOccurrences = input.kind === "task" && input.recurrence ? { ...current?.completedOccurrences } : {};
    if (input.kind === "task") {
      input.completedAt = input.completed ? completedOccurrences[input.date] || (current?.date === input.date ? current.completedAt : null) || new Date().toISOString() : null;
      if (input.recurrence) {
        if (input.completed) completedOccurrences[input.date] = input.completedAt!;
        else delete completedOccurrences[input.date];
      }
    }
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
    const event = await collection.findOneAndUpdate({ username: owner(username), id, updatedAt: version }, { $set: { ...input, completedOccurrences, updatedAt } }, { returnDocument: "after" });
    if (!event) await this.explainMissing(collection, username, id);
    return { ...publicEvent(event!), typeId: resolveEventType(event!.typeId, await this.types.list(username)) };
  }
  async clearType(username: string, id: string) {
    const collection = await this.collection();
    const filter = { username: owner(username), typeId: id };
    const affected = await collection.find(filter).sort({ id: 1 }).toArray();
    const updatedAt = new Date(affected.reduce((latest, event) => Math.max(latest, Date.parse(event.updatedAt) + 1), Date.now())).toISOString();
    await collection.updateMany(filter, { $set: { typeId: DEFAULT_EVENT_TYPE_ID, updatedAt } });
  }
  async remove(username: string, id: string, version: string) {
    const collection = await this.collection();
    const current = await collection.findOne({ username: owner(username), id });
    if (current?.removedAt) return;
    // The imported row itself is a durable tombstone, including after restarts.
    // An import only ever inserts this stable ID once, so deletion races are safe.
    if (current?.moodle) {
      const removedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
      const result = await collection.findOneAndUpdate({ username, id, updatedAt: version }, { $set: { removedAt, updatedAt: removedAt } }, { returnDocument: "after" });
      if (!result) await this.explainMissing(collection, username, id);
      return;
    }
    const result = await collection.deleteOne({ username: owner(username), id, updatedAt: version });
    if (!result.deletedCount && await collection.findOne({ username, id })) throw new MediaError("conflict", "Cet événement a changé. Ferme cette fenêtre et actualise le calendrier.", 409);
  }
  async complete(username: string, id: string, completed: boolean, version: string, occurrenceDate?: unknown) {
    const collection = await this.collection();
    const current = await collection.findOne({ username: owner(username), id });
    if (!current || current.removedAt || current.moodle?.available === false) throw new MediaError("not_found", "Cette tâche n’existe plus.", 404);
    if (current.kind !== "task") throw new MediaError("input", "Seule une tâche peut être cochée.", 400);
    if (current.recurrence ? !isOccurrenceDate(current, occurrenceDate) : occurrenceDate !== undefined && occurrenceDate !== current.date) throw new MediaError("input", "Choisis une occurrence valide de cette tâche.", 400);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
    const completedOccurrences = { ...current.completedOccurrences };
    if (current.recurrence) {
      if (completed) completedOccurrences[occurrenceDate as string] = updatedAt;
      else delete completedOccurrences[occurrenceDate as string];
    }
    const state = current.recurrence ? { completedOccurrences, completed: !!completedOccurrences[current.date], completedAt: completedOccurrences[current.date] || null } : { completed, completedAt: completed ? updatedAt : null };
    const event = await collection.findOneAndUpdate({ username, id, updatedAt: version }, { $set: { ...state, updatedAt } }, { returnDocument: "after" });
    if (!event) await this.explainMissing(collection, username, id);
    return publicEvent(event!);
  }
  async importMoodle(username: string, id: string, input: EventInput, moodle: MoodleSource) {
    input = validateEvent(input); owner(username); eventId(id);
    const collection = await this.collection();
    const filter = { username, id };
    const now = new Date().toISOString();
    try {
      await collection.updateOne(filter, { $setOnInsert: { ...input, ...filter, moodle, createdAt: now, updatedAt: now } }, { upsert: true });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    // Re-read on optimistic conflicts so a checkmark, note or deletion cannot
    // be overwritten by a concurrently running Moodle refresh.
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await collection.findOne(filter);
      if (!current || current.removedAt || !current.moodle) return;
      if (current.moodle.fingerprint === moodle.fingerprint && current.moodle.available) return;
      const remote = { title: input.title, description: input.description, date: input.date, endDate: input.endDate, startTime: input.startTime, endTime: input.endTime, allDay: input.allDay, recurrence: input.recurrence,
        ...(input.kind ? { kind: input.kind } : {}), ...(input.deadline !== undefined ? { deadline: input.deadline } : {}), context: input.context };
      // Keep a project, manually named course or intentionally empty context.
      // Only the original Moodle course association follows remote renames.
      if (current.context?.kind !== "course" || current.context.courseId !== current.moodle.courseId) remote.context = current.context;
      if (current.kind === "task" && current.moodle.personalDeadlineChecked && !moodle.personalDeadlineChecked) {
        Object.assign(remote, { deadline: current.deadline, date: current.date, endDate: current.endDate, startTime: current.startTime, endTime: current.endTime, allDay: current.allDay });
      }
      // A manually configured task series keeps its schedule across Moodle
      // refreshes; source details and availability still follow Moodle.
      if (current.kind === "task" && current.recurrence) Object.assign(remote, { recurrence: current.recurrence, deadline: current.deadline, date: current.date, endDate: current.endDate, startTime: current.startTime, endTime: current.endTime, allDay: current.allDay });
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
      const changed = await collection.findOneAndUpdate({ ...filter, updatedAt: current.updatedAt }, { $set: { ...remote, moodle, updatedAt } }, { returnDocument: "after" });
      if (changed) return;
    }
    throw new MediaError("conflict", "La synchronisation sera reprise au prochain passage.", 409);
  }
  async reconcileMoodle(username: string, keys: Set<string>, semester: string) {
    const collection = await this.collection();
    const rows = await collection.find({ username: owner(username) }).sort({ id: 1 }).toArray();
    for (const event of rows) {
      if (!event.moodle || event.removedAt || event.moodle.semester !== semester || keys.has(event.moodle.key) || !event.moodle.available) continue;
      await collection.findOneAndUpdate({ username, id: event.id, updatedAt: event.updatedAt }, { $set: { moodle: { ...event.moodle, available: false }, updatedAt: new Date(Math.max(Date.now(), Date.parse(event.updatedAt) + 1)).toISOString() } });
    }
  }
  private async explainMissing(collection: Collection<StoredEvent>, username: string, id: string): Promise<never> {
    if (await collection.findOne({ username, id })) throw new MediaError("conflict", "Cet événement a changé. Ferme cette fenêtre et actualise le calendrier.", 409);
    throw new MediaError("not_found", "Cet événement n’existe plus. Actualise le calendrier.", 404);
  }
}
