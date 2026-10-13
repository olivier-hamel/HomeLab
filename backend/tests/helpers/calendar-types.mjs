import {CalendarEventTypeStore} from '../../src/lib/calendar/event-types.ts';

export function eventTypeFixture() {
  const rows = new Map();
  const collection = {
    async findOne({username}) {return structuredClone(rows.get(username) || null);},
    async insertOne(row) {
      if (rows.has(row.username)) throw Object.assign(new Error('duplicate'), {code:11000});
      rows.set(row.username, structuredClone(row));
    },
    async findOneAndUpdate({username, updatedAt}, {$set}) {
      const row = rows.get(username);
      if (!row || row.updatedAt !== updatedAt) return null;
      const previous = structuredClone(row); Object.assign(row, structuredClone($set)); return previous;
    },
  };
  return {rows, types:new CalendarEventTypeStore(async () => collection)};
}
