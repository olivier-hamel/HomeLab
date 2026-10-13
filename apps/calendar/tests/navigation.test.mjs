import test from "node:test";
import assert from "node:assert/strict";
import {createCalendarStore} from "../dist/js/state.js";
import {civilDate, dateKey, weekDates} from "../dist/js/date.js";
import {renderCalendar} from "../dist/js/components/views.js";
import {renderBreadcrumb} from "../dist/js/components/shell.js";

test("Month → week → day preserves the chosen date across a month boundary", () => {
  const store = createCalendarStore();
  store.openDate(civilDate(2026, 9, 31), "month");
  const html = renderCalendar(store.getState());
  assert.match(html, /data-action="open-week" data-date="2026-10-31"/);
  const updates = [];
  store.subscribe(state => updates.push({view: state.view, date: dateKey(state.date)}));
  store.openDate(civilDate(2026, 9, 31), "week");
  assert.equal(store.getState().page, "calendar");
  assert.deepEqual(updates, [{view: "week", date: "2026-10-31"}]);
  assert.equal(dateKey(weekDates(store.getState().date)[6]), "2026-11-01");
  const weekHtml = renderCalendar(store.getState());
  assert.match(weekHtml, /data-action="open-day" data-date="2026-11-01"/);
  assert.equal((weekHtml.match(/class="time-column-hitarea"/g) || []).length, 7);
  store.openDate(civilDate(2026, 10, 1), "day");
  assert.equal(store.getState().view, "day");
  assert.equal(dateKey(store.getState().date), "2026-11-01");
  store.setView("week");
  store.setView("month");
  assert.equal(dateKey(store.getState().date), "2026-11-01");
});

test("Tempo opens directly on the month calendar", () => {
  const state = createCalendarStore().getState();
  assert.equal(state.page, "calendar");
  assert.equal(state.view, "month");
  assert.equal(dateKey(state.date), dateKey(state.today));
  assert.match(renderCalendar(state), /class="month-view calendar-panel" role="grid"/);
});

test("Every level has a clear breadcrumb back to the wider calendar", () => {
  const store = createCalendarStore();
  assert.match(renderBreadcrumb(store.getState()), /aria-current="page">Calendrier/);
  store.openDate(civilDate(2026, 9, 12), "day");
  const html = renderBreadcrumb(store.getState());
  assert(!html.includes("Accueil"));
  assert.match(html, /data-action="month"/);
  assert.match(html, /data-action="week"/);
  assert.match(html, /aria-current="page">Jour/);
});

test("Invalid drilldown dates and views do not disturb the current page", () => {
  const store = createCalendarStore();
  const before = store.getState();
  store.openDate(new Date("invalid"), "week");
  store.openDate(civilDate(2026, 9, 12), "year");
  store.openDate(null, "day");
  assert.equal(store.getState(), before);
});

test("Calendar uses the HomeLab account and isolates preferences between accounts", () => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)};
  const oli = {username: "oli", display_name: "Oli"};
  const max = {username: "max", display_name: "Max"};
  createCalendarStore(storage, oli).setPreferences({weekStart: 0, timeFormat: "24"});
  assert.equal(createCalendarStore(storage, max).getState().preferences.weekStart, 1);
  assert.equal(createCalendarStore(storage, oli).getState().preferences.timeFormat, "24");
});
