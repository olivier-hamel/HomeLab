import type { Collection } from "mongodb";
import { database } from "../database.ts";
import { MediaError, record } from "../media/core.ts";
import { DEFAULT_EVENT_TYPE_ID, eventId, eventTypeId } from "./events.ts";

export type CalendarEventType = { id: string; name: string; importance: number; hidden: boolean };
export const DEFAULT_EVENT_TYPE: CalendarEventType = { id: DEFAULT_EVENT_TYPE_ID, name: "aucun", importance: 3, hidden: true };
type Catalog = { username: string; types: CalendarEventType[]; deletedIds: string[]; updatedAt: string };
let collectionPromise: Promise<Collection<Catalog>> | null = null;
async function typeCollection() {
  collectionPromise ??= (async () => {
    const collection = (await database()).collection<Catalog>("calendar_event_types");
    await collection.createIndex({ username: 1 }, { unique: true });
    return collection;
  })().catch(error => { collectionPromise = null; throw error; });
  return collectionPromise;
}
export function validateEventType(value: unknown) {
  const row = record(value);
  if (typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 80 || [...row.name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new MediaError("input", "Donne un nom de 1 à 80 caractères au type d’événement.", 400);
  const name = row.name.trim().normalize("NFC");
  if (name.toLocaleLowerCase("fr-CA") === "aucun") throw new MediaError("input", "Ce nom est réservé. Choisis un autre nom.", 400);
  if (!Number.isInteger(row.importance) || (row.importance as number) < 1 || (row.importance as number) > 5) throw new MediaError("input", "Choisis un niveau d’importance de 1 à 5.", 400);
  return { name, importance: row.importance as number };
}
export function resolveEventType(id: string, types: CalendarEventType[]) {
  return types.some(type => type.id === id) ? id : DEFAULT_EVENT_TYPE_ID;
}
export function assertEventType(id: unknown, types: CalendarEventType[]) {
  const validated = eventTypeId(id);
  if (!types.some(type => type.id === validated)) throw new MediaError("event_type", "Ce type d’événement n’est plus disponible. Actualise le calendrier et choisis un type.", 400);
  return validated;
}
// A versioned catalog makes duplicate names and concurrent changes atomic per account.
export class CalendarEventTypeStore {
  private collection: () => Promise<Collection<Catalog>>;
  constructor(collection = typeCollection) { this.collection = collection; }
  private async snapshot(username: string): Promise<Catalog> {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(username)) throw new MediaError("account", "Compte invalide.", 403);
    const collection = await this.collection();
    const previous = await collection.findOne({ username });
    if (previous) return previous;
    const catalog = { username, types: [{ ...DEFAULT_EVENT_TYPE }], deletedIds: [], updatedAt: new Date().toISOString() };
    try { await collection.insertOne(catalog); return catalog; }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    const saved = await collection.findOne({ username });
    if (!saved) throw new Error("Event types were not saved");
    return saved;
  }
  async list(username: string) {
    return (await this.snapshot(username)).types.map(type => ({ id: type.id, name: type.name, importance: type.importance, hidden: type.hidden }));
  }
  private async mutate<T>(username: string, change: (catalog: Catalog) => T): Promise<T> {
    const collection = await this.collection();
    for (let attempt = 0; attempt < 8; attempt++) {
      const catalog = structuredClone(await this.snapshot(username));
      const version = catalog.updatedAt;
      const result = change(catalog);
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(version) + 1)).toISOString();
      const saved = await collection.findOneAndUpdate({ username, updatedAt: version }, { $set: { types: catalog.types, deletedIds: catalog.deletedIds, updatedAt } });
      if (saved) return result;
    }
    throw new MediaError("conflict", "Les types ont changé. Actualise le calendrier avant de réessayer.", 409);
  }
  async create(username: string, requestId: unknown, value: unknown) {
    const id = eventId(requestId), input = validateEventType(value);
    return this.mutate(username, catalog => {
      const previous = catalog.types.find(type => type.id === id);
      if (previous && previous.name === input.name && previous.importance === input.importance) return previous;
      if (previous || catalog.deletedIds.includes(id)) throw new MediaError("conflict", "Cette demande a déjà été utilisée. Actualise les types avant de réessayer.", 409);
      if (catalog.types.some(type => type.name.toLocaleLowerCase("fr-CA") === input.name.toLocaleLowerCase("fr-CA"))) throw new MediaError("conflict", "Un type porte déjà ce nom.", 409);
      if (catalog.types.length >= 101) throw new MediaError("input", "Tu peux créer jusqu’à 100 types d’événement.", 400);
      const type = { id, ...input, hidden: false }; catalog.types.push(type); return type;
    });
  }
  async remove(username: string, value: unknown) {
    if (value === DEFAULT_EVENT_TYPE_ID) throw new MediaError("input", "Le type par défaut ne peut pas être supprimé.", 400);
    const id = eventId(value);
    await this.mutate(username, catalog => {
      if (!catalog.types.some(type => type.id === id)) return;
      catalog.types = catalog.types.filter(type => type.id !== id); catalog.deletedIds.push(id);
    });
  }
}
