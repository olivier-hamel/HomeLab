// Calendar days are UTC civil dates. This keeps day arithmetic independent of DST.
export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const VIEW_LABELS = {month: "Mois", week: "Semaine", day: "Jour"};
const LOCALE = "fr-CA";
export const DEFAULT_TIMEZONE = "America/Toronto";

export function civilDate(year, month, day = 1) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}
export function todayInZone(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat(LOCALE, {timeZone, year: "numeric", month: "numeric", day: "numeric"}).formatToParts(now);
  const part = name => Number(parts.find(item => item.type === name).value);
  return civilDate(part("year"), part("month") - 1, part("day"));
}
export function dateKey(date) {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = civilDate(year, month - 1, day);
  return year >= 1 && dateKey(date) === value ? date : null;
}
export function sameDay(a, b) { return dateKey(a) === dateKey(b); }
export function sameMonth(a, b) { return a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear(); }
export function addDays(date, count) { return civilDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + count); }
export function addMonths(date, count) {
  const target = civilDate(date.getUTCFullYear(), date.getUTCMonth() + count);
  const last = civilDate(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate();
  return civilDate(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), last));
}
export function startOfWeek(date, weekStart = 1) { return addDays(date, -((date.getUTCDay() - weekStart + 7) % 7)); }
export function weekDates(date, weekStart = 1) {
  const start = startOfWeek(date, weekStart);
  return Array.from({length: 7}, (_, index) => addDays(start, index));
}
export function monthDates(date, weekStart = 1, fixed = false) {
  const first = civilDate(date.getUTCFullYear(), date.getUTCMonth());
  const start = startOfWeek(first, weekStart);
  const offset = (first.getUTCDay() - weekStart + 7) % 7;
  const count = civilDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 0).getUTCDate();
  const length = fixed ? 42 : Math.ceil((offset + count) / 7) * 7;
  return Array.from({length}, (_, index) => addDays(start, index));
}
export function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat(LOCALE, {timeZone: "UTC", ...options}).format(date);
}
export function fullDate(date) { return formatDate(date, {weekday: "long", month: "long", day: "numeric", year: "numeric"}); }
export function periodTitle(state) {
  const date = state.date;
  if (state.view === "day") return {primary: formatDate(date, {day: "numeric", month: "long"}), secondary: String(date.getUTCFullYear())};
  if (state.view === "week") {
    const days = weekDates(date, state.preferences.weekStart);
    const first = days[0], last = days[6];
    const primary = sameMonth(first, last)
      ? `${first.getUTCDate()}–${last.getUTCDate()} ${MONTHS[first.getUTCMonth()]}`
      : `${formatDate(first, {day: "numeric", month: "short"})} – ${formatDate(last, {day: "numeric", month: "short"})}`;
    const secondary = first.getUTCFullYear() === last.getUTCFullYear() ? String(last.getUTCFullYear()) : `${first.getUTCFullYear()}–${last.getUTCFullYear()}`;
    return {primary, secondary};
  }
  return {primary: MONTHS[date.getUTCMonth()], secondary: String(date.getUTCFullYear())};
}
export function hourLabel(hour, format = "12") {
  return format === "24" ? `${hour} h` : `${hour % 12 || 12} ${hour < 12 ? "a.m." : "p.m."}`;
}
export function zoneOffset(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat(LOCALE, {timeZone, timeZoneName: "shortOffset"}).formatToParts(now).find(part => part.type === "timeZoneName").value;
}
export function currentMinutes(timeZone = DEFAULT_TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(now);
  return Number(parts.find(part => part.type === "hour").value) * 60 + Number(parts.find(part => part.type === "minute").value);
}
