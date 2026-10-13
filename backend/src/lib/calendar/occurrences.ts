import { validDate, type EventInput } from "./events.ts";

const DAY = 86_400_000;
const dayNumber = (date: Date) => Math.floor(date.getTime() / DAY);
const mondayOffset = (date: Date) => (date.getUTCDay() + 6) % 7;
function civilDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

// Validate the requested checkmark against the stored rule, including the
// occurrence count. Calendar rendering is cross-checked against this in tests.
export function isOccurrenceDate(event: EventInput, value: unknown): value is string {
  if (!validDate(value) || value < event.date) return false;
  const rule = event.recurrence;
  if (!rule) return value === event.date;
  if (rule.until && value > rule.until) return false;
  const anchor = new Date(`${event.date}T12:00:00Z`), date = new Date(`${value}T12:00:00Z`);
  let ordinal: number;
  if (rule.frequency === "daily") {
    const difference = dayNumber(date) - dayNumber(anchor);
    if (difference % rule.interval) return false;
    ordinal = difference / rule.interval;
  } else if (rule.frequency === "weekly") {
    const week = Math.floor((dayNumber(date) - dayNumber(anchor) + mondayOffset(anchor)) / 7);
    if (week % rule.interval || !rule.weekdays.includes(date.getUTCDay())) return false;
    const offsets = rule.weekdays.map(day => (day + 6) % 7).sort((a, b) => a - b);
    const initial = offsets.filter(offset => offset >= mondayOffset(anchor));
    const index = week / rule.interval;
    ordinal = index === 0 ? initial.indexOf(mondayOffset(date)) : initial.length + (index - 1) * offsets.length + offsets.indexOf(mondayOffset(date));
  } else {
    const monthly = rule.frequency === "monthly";
    const difference = monthly ? (date.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + date.getUTCMonth() - anchor.getUTCMonth() : date.getUTCFullYear() - anchor.getUTCFullYear();
    if (difference % rule.interval || date.getUTCDate() !== anchor.getUTCDate() || !monthly && date.getUTCMonth() !== anchor.getUTCMonth()) return false;
    if (rule.count === null) return true;
    // Missing month days and non-leap February 29 dates don't consume a count.
    ordinal = -1;
    for (let index = 0; index <= difference / rule.interval; index++) {
      const period = monthly ? civilDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + index * rule.interval, 1) : civilDate(anchor.getUTCFullYear() + index * rule.interval, anchor.getUTCMonth(), 1);
      const candidate = civilDate(period.getUTCFullYear(), period.getUTCMonth(), anchor.getUTCDate());
      if (candidate.getUTCMonth() === period.getUTCMonth() && ++ordinal >= rule.count) return false;
    }
  }
  return ordinal >= 0 && (rule.count === null || ordinal < rule.count);
}
