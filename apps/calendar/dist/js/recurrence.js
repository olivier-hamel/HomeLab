import {addDays, civilDate, dateKey, parseDate, WEEKDAYS} from "./date.js";

const DAY = 86_400_000;
const dayNumber = date => Math.floor(date.getTime() / DAY);
const mondayOffset = date => (date.getUTCDay() + 6) % 7;

export function isFrequentRecurrence(rule) {
  return Boolean(rule && ((rule.frequency === "daily" && rule.interval <= 21) || (rule.frequency === "weekly" && rule.interval <= 3)));
}

export function firstOccurrenceDate(value, rule) {
  let date = parseDate(value);
  if (!date) return null;
  if (rule?.frequency === "weekly") {
    if (!rule.weekdays.length) return null;
    const offset = Math.min(...rule.weekdays.map(day => (day - date.getUTCDay() + 7) % 7));
    date = addDays(date, offset);
  }
  return date.getUTCFullYear() <= 9999 ? date : null;
}

// Expand only the requested civil-date window. A series stays one stored event;
// occurrence dates never depend on browser time zone or daylight saving time.
export function occurrencesBetween(event, start, end) {
  const rule = event.recurrence;
  if (!rule) return intersects(event, start, end) ? [event] : [];
  const anchor = parseDate(event.date), last = parseDate(event.endDate);
  const duration = dayNumber(last) - dayNumber(anchor);
  const earliest = addDays(parseDate(start), -duration);
  const limit = rule.until && rule.until < end ? rule.until : end;
  if (limit < event.date || (rule.until && rule.until < dateKey(earliest))) return [];
  const results = [];
  function append(date, index) {
    if (date.getUTCFullYear() > 9999) return false;
    const key = dateKey(date);
    if (key > limit || (rule.count !== null && index >= rule.count)) return false;
    if (key < event.date || dayNumber(date) < dayNumber(earliest)) return true;
    const finish = addDays(date, duration);
    if (finish.getUTCFullYear() > 9999) return false;
    const endDate = dateKey(finish);
    const occurrence = {...event, date: key, endDate, occurrenceDate: key, seriesDate: event.date};
    if (intersects(occurrence, start, end)) results.push(occurrence);
    return true;
  }
  if (rule.frequency === "daily") {
    const first = Math.max(0, Math.floor((dayNumber(earliest) - dayNumber(anchor)) / rule.interval));
    for (let index = first; append(addDays(anchor, index * rule.interval), index); index++);
  } else if (rule.frequency === "weekly") {
    const offsets = rule.weekdays.map(day => (day + 6) % 7).sort((a, b) => a - b);
    const week = addDays(anchor, -mondayOffset(anchor));
    const initial = offsets.filter(offset => offset >= mondayOffset(anchor));
    const first = Math.max(0, Math.floor((dayNumber(earliest) - dayNumber(week)) / (7 * rule.interval)));
    let done = false;
    for (let index = first; !done; index++) {
      const selected = index === 0 ? initial : offsets;
      for (let day = 0; day < selected.length; day++) {
        const ordinal = index === 0 ? day : initial.length + (index - 1) * offsets.length + day;
        if (!append(addDays(week, index * 7 * rule.interval + selected[day]), ordinal)) {done = true; break;}
      }
    }
  } else {
    const monthly = rule.frequency === "monthly";
    const difference = monthly
      ? (earliest.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + earliest.getUTCMonth() - anchor.getUTCMonth()
      : earliest.getUTCFullYear() - anchor.getUTCFullYear();
    // With a count, skipped dates must not count as occurrences. At most 1000
    // valid dates are visited. Unbounded series jump directly to the window.
    const first = rule.count === null ? Math.max(0, Math.floor(difference / rule.interval)) : 0;
    let ordinal = 0;
    for (let index = first; ; index++) {
      const period = monthly
        ? civilDate(anchor.getUTCFullYear(), anchor.getUTCMonth() + index * rule.interval)
        : civilDate(anchor.getUTCFullYear() + index * rule.interval, anchor.getUTCMonth());
      if (dateKey(period) > limit || period.getUTCFullYear() > 9999) break;
      const candidate = civilDate(period.getUTCFullYear(), period.getUTCMonth(), anchor.getUTCDate());
      if (candidate.getUTCMonth() !== period.getUTCMonth()) continue;
      if (!append(candidate, ordinal++)) break;
    }
  }
  return results;
}

function intersects(event, start, end) {
  return event.date <= end && event.endDate >= start && (event.allDay || event.endDate !== start || event.endTime !== "00:00");
}

export function recurrenceLabel(rule) {
  if (!rule) return "Ne se répète pas";
  const units = {daily: "jours", weekly: "semaines", monthly: "mois", yearly: "ans"};
  const single = {daily: "Tous les jours", weekly: "Toutes les semaines", monthly: "Tous les mois", yearly: "Tous les ans"};
  const cadence = rule.interval === 1 ? single[rule.frequency] : `${rule.frequency === "weekly" ? "Toutes les" : "Tous les"} ${rule.interval} ${units[rule.frequency]}`;
  const days = rule.frequency === "weekly" ? ` · ${rule.weekdays.map(day => WEEKDAYS[day]).join(", ")}` : "";
  const ending = rule.until ? ` · jusqu’au ${rule.until}` : rule.count ? ` · ${rule.count} occurrence${rule.count > 1 ? "s" : ""}` : " · sans date de fin";
  return `${cadence}${days}${ending}`;
}
