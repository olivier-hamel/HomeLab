import test from 'node:test';
import assert from 'node:assert/strict';
import { isOccurrenceDate } from '../src/lib/calendar/occurrences.ts';
import { validateEvent } from '../src/lib/calendar/events.ts';
import { occurrencesBetween } from '../../apps/calendar/dist/js/recurrence.js';
import { addDays, parseDate, dateKey } from '../../apps/calendar/dist/js/date.js';

// The UI and write API must agree on exactly which dates can be checked.
test('server membership matches rendered recurrence across counts, intervals, weekday order, missing month days, leap centuries and DST', () => {
  const cases = [
    ['2026-10-13', '2027-02-01', 'daily', 2, [], 20, null],
    ['2026-10-13', '2027-02-01', 'weekly', 2, [0, 2, 4], 8, null],
    ['2026-10-13', '2027-02-01', 'weekly', 1, [0, 2, 4], null, '2026-11-01'],
    ['2026-01-31', '2027-02-01', 'monthly', 1, [], 6, null],
    ['2026-01-31', '2028-02-01', 'monthly', 3, [], null, null],
    ['2096-02-29', '2110-03-01', 'yearly', 1, [], 3, null],
    ['2096-02-29', '2110-03-01', 'yearly', 4, [], null, null],
    ['0004-02-29', '0010-03-01', 'yearly', 1, [], 2, null],
  ];
  for (const [anchor, end, frequency, interval, weekdays, count, until] of cases) {
    const event = validateEvent({ title: 'Routine', description: '', date: anchor, endDate: anchor, kind: 'task', completed: false, deadline: { date: anchor, time: '00:00' }, recurrence: { frequency, interval, weekdays, count, until } });
    const expected = new Set(occurrencesBetween(event, anchor, end).map(row => row.date));
    for (let date = parseDate(anchor); dateKey(date) <= end; date = addDays(date, 1)) assert.equal(isOccurrenceDate(event, dateKey(date)), expected.has(dateKey(date)), `${frequency}/${interval} ${anchor} → ${dateKey(date)}`);
  }
});
