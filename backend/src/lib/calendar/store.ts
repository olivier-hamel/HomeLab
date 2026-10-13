import { type Collection } from "mongodb";
import { database } from "../database.ts";
import { MediaError } from "../media/core.ts";
import { DEFAULT_EVENT_TYPE_ID, eventId, validateEvent, type CalendarEvent, type EventInput, type EventSource } from "./events.ts";
import { CalendarEventTypeStore, assertEventType, resolveEventType } from "./event-types.ts";

export type StoredEvent = CalendarEvent & { username: string };
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
  return { ...validateEvent(event), id: event.id, createdAt: event.createdAt, updatedAt: event.updatedAt, ...(event.source ? { source: event.source } : {}) };
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
    return events.map(event => ({ ...publicEvent(event), typeId: resolveEventType(event.typeId, types) }));
  }
  async create(username: string, input: EventInput, requestId: string, source?: EventSource) {
    const id = eventId(requestId);
    input = { ...validateEvent(input), typeId: assertEventType(input.typeId, await this.types.list(username)) };
    const now = new Date().toISOString();
    const collection = await this.collection();
    const filter = { username: owner(username), id };
    // The unique compound index and setOnInsert make interrupted retries safe.
    try {
      await collection.updateOne(filter, { $setOnInsert: { ...input, ...filter, ...(source ? { source } : {}), createdAt: now, updatedAt: now } }, { upsert: true });
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
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
    const event = await collection.findOneAndUpdate({ username: owner(username), id, updatedAt: version }, { $set: { ...input, updatedAt } }, { returnDocument: "after" });
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
    const result = await collection.deleteOne({ username: owner(username), id, updatedAt: version });
    if (!result.deletedCount && await collection.findOne({ username, id })) throw new MediaError("conflict", "Cet événement a changé. Ferme cette fenêtre et actualise le calendrier.", 409);
  }
  private async explainMissing(collection: Collection<StoredEvent>, username: string, id: string): Promise<never> {
    if (await collection.findOne({ username, id })) throw new MediaError("conflict", "Cet événement a changé. Ferme cette fenêtre et actualise le calendrier.", 409);
    throw new MediaError("not_found", "Cet événement n’existe plus. Actualise le calendrier.", 404);
  }
}
