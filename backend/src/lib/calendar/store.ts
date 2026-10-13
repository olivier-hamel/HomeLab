import { type Collection } from "mongodb";
import { database } from "../database.ts";
import { MediaError } from "../media/core.ts";
import { eventId, validateEvent, type CalendarEvent, type EventInput, type EventSource } from "./events.ts";

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
  constructor(collection = eventCollection) { this.collection = collection; }
  async list(username: string): Promise<CalendarEvent[]> {
    const events = await (await this.collection()).find({ username: owner(username) }).sort({ date: 1, startTime: 1, id: 1 }).toArray();
    return events.map(publicEvent);
  }
  async create(username: string, input: EventInput, requestId: string, source?: EventSource) {
    const id = eventId(requestId);
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
    return publicEvent(event);
  }
  async update(username: string, id: string, input: EventInput, version: string) {
    const collection = await this.collection();
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
    const event = await collection.findOneAndUpdate({ username: owner(username), id, updatedAt: version }, { $set: { ...input, updatedAt } }, { returnDocument: "after" });
    if (!event) await this.explainMissing(collection, username, id);
    return publicEvent(event!);
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
