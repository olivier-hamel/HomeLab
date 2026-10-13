import test from "node:test";
import assert from "node:assert/strict";
import {civilDate, dateKey, parseDate, addDays, addMonths, monthDates, weekDates, todayInZone, periodTitle} from "../dist/js/date.js";
import {createCalendarStore} from "../dist/js/state.js";

test("Month ranges cover every date once and align to the configured week", () => {
  for (const year of [2024, 2025, 2026]) for (let month = 0; month < 12; month++) for (const weekStart of [0, 1]) {
    const dates = monthDates(civilDate(year, month), weekStart);
    assert.equal(dates[0].getUTCDay(), weekStart);
    assert.equal(dates.length % 7, 0);
    const inside = dates.filter(date => date.getUTCMonth() === month && date.getUTCFullYear() === year);
    assert.equal(inside.length, civilDate(year, month + 1, 0).getUTCDate());
    assert.equal(new Set(dates.map(dateKey)).size, dates.length);
    assert.equal(monthDates(civilDate(year, month), weekStart, true).length, 42);
  }
});
test("Month navigation clamps dates at month ends and crosses years", () => {
  assert.equal(dateKey(addMonths(civilDate(2024, 0, 31), 1)), "2024-02-29");
  assert.equal(dateKey(addMonths(civilDate(2025, 0, 31), 1)), "2025-02-28");
  assert.equal(dateKey(addMonths(civilDate(2026, 11, 12), 1)), "2027-01-12");
  assert.equal(dateKey(addDays(civilDate(2026, 2, 8), 1)), "2026-03-09");
});
test("Date parsing rejects invalid dates and preserves small years", () => {
  assert.equal(parseDate("2026-02-29"), null);
  assert.equal(parseDate("2026-13-01"), null);
  assert.equal(parseDate("0000-01-01"), null);
  assert.equal(dateKey(parseDate("0001-01-01")), "0001-01-01");
  assert.equal(dateKey(parseDate("2024-02-29")), "2024-02-29");
});
test("Toronto calendar days follow the local day through midnight and DST", () => {
  assert.equal(dateKey(todayInZone("America/Toronto", new Date("2026-10-13T02:00:00Z"))), "2026-10-12");
  assert.equal(dateKey(todayInZone("America/Toronto", new Date("2026-03-08T07:30:00Z"))), "2026-03-08");
});
test("Weeks and titles handle year boundaries", () => {
  const date = civilDate(2026, 11, 31);
  const days = weekDates(date, 1);
  assert.equal(dateKey(days[0]), "2026-12-28");
  assert.equal(dateKey(days[6]), "2027-01-03");
  assert.deepEqual(periodTitle({date, view: "week", preferences: {weekStart: 1}}), {primary: "28 déc. – 3 janv.", secondary: "2026–2027"});
});
test("Views keep the selected date; each navigates its own period", () => {
  const store = createCalendarStore();
  store.selectDate(civilDate(2026, 9, 12));
  store.setView("week");
  assert.equal(dateKey(store.getState().date), "2026-10-12");
  store.navigate(1);
  assert.equal(dateKey(store.getState().date), "2026-10-19");
  store.setView("day");
  store.navigate(-1);
  assert.equal(dateKey(store.getState().date), "2026-10-18");
  store.setView("month");
  store.navigate(1);
  assert.equal(dateKey(store.getState().date), "2026-11-18");
  store.setView("invalid");
  assert.equal(store.getState().view, "month");
});
test("Preferences persist without requiring storage, and corrupted values are ignored", () => {
  let saved = '{"weekStart":4,"timeFormat":"unexpected"}';
  const storage = {getItem: () => saved, setItem: (_, value) => {saved = value;}};
  const store = createCalendarStore(storage);
  assert.equal(store.getState().preferences.weekStart, 1);
  store.setPreferences({weekStart: 0, timeFormat: "24"});
  assert.equal(createCalendarStore(storage).getState().preferences.weekStart, 0);
  assert.equal(createCalendarStore(storage).getState().preferences.timeFormat, "24");
  assert.doesNotThrow(() => createCalendarStore({getItem() {throw new Error("blocked");}}));
});
