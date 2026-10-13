import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarStore} from '../dist/js/state.js';
import {renderHome} from '../dist/js/components/home.js';
import {civilDate, dateKey, addDays} from '../dist/js/date.js';

const account = {username: 'oli', display_name: 'Oli'};
function memoryStorage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)};
}

test('Search engines persist per account without losing existing calendar preferences', () => {
  const storage = memoryStorage();
  storage.setItem('clear-calendar:preferences:v1:oli', JSON.stringify({weekStart: 0, timeFormat: '24'}));
  const store = createCalendarStore(storage, account);
  assert.equal(store.getState().preferences.searchEngine, 'google');
  store.setPreferences({searchEngine: 'duckduckgo'});
  const reloaded = createCalendarStore(storage, account).getState();
  assert.equal(reloaded.preferences.searchEngine, 'duckduckgo');
  assert.equal(reloaded.preferences.weekStart, 0);
  assert.equal(reloaded.preferences.timeFormat, '24');
  assert.equal(createCalendarStore(storage, {username: 'max'}).getState().preferences.searchEngine, 'google');
  assert.match(renderHome(reloaded), /action="https:\/\/duckduckgo.com\/" method="get" target="_top"/);
  store.setPreferences({searchEngine: 'https://untrusted.example'});
  assert.equal(store.getState().preferences.searchEngine, 'duckduckgo');
});

test('Upcoming events span future weeks and exclude past or today-only events', () => {
  const store = createCalendarStore();
  const today = civilDate(2026, 9, 18); // Sunday, last day of the calendar week.
  const base = {description: '', endTime: '15:00', startTime: '14:00', allDay: false};
  store.setEvents([
    {...base, id: 'past', title: 'Past event', date: '2026-10-17', endDate: '2026-10-17'},
    {...base, id: 'today', title: 'Today event', date: '2026-10-18', endDate: '2026-10-18'},
    {...base, id: 'tomorrow', title: 'Monday event', date: '2026-10-19', endDate: '2026-10-19'},
    {...base, id: 'ongoing', title: 'Ongoing event', date: '2026-10-17', endDate: '2026-10-20'},
    {...base, id: 'series', title: 'Recurring event', date: '2026-10-12', endDate: '2026-10-12', recurrence: {frequency: 'weekly', interval: 1, weekdays: [1], count: null, until: null}},
    {...base, id: 'outside', title: 'Outside range', date: '2026-11-02', endDate: '2026-11-02'},
  ], {eventsStatus: 'ready'});
  const html = renderHome({...store.getState(), today});
  const upcoming = html.slice(html.indexOf('<section class="home-card upcoming-card"'));
  assert(!upcoming.includes('Past event'));
  assert(!upcoming.includes('Today event'));
  assert(!upcoming.includes('Outside range'));
  assert(upcoming.includes('Monday event'));
  assert(upcoming.includes('Ongoing event'));
  assert(upcoming.includes('Se poursuit'));
  assert.equal((upcoming.match(/data-event-id="series"/g) || []).length, 1);
  assert(upcoming.includes('4 événements dans les 14 prochains jours'));
  assert(upcoming.includes('data-date="2026-10-24"'));
});

test('Tasks support add, completion, reopening, removal and persistence per account', () => {
  const storage = memoryStorage();
  const store = createCalendarStore(storage, account);
  assert.equal(store.addTask('   '), false);
  assert.equal(store.addTask('x'.repeat(161)), false);
  assert.equal(store.addTask('  Lire vingt minutes  '), true);
  const task = store.getState().tasks[0];
  assert.equal(task.title, 'Lire vingt minutes');
  store.toggleTask(task.id);
  assert.equal(store.getState().tasks[0].completedDate, dateKey(store.getState().today));
  assert.deepEqual(createCalendarStore(storage, account).getState().tasks, store.getState().tasks);
  assert.deepEqual(createCalendarStore(storage, {username: 'max'}).getState().tasks, []);
  store.toggleTask(task.id);
  assert.equal(store.getState().tasks[0].completedDate, null);
  store.removeTask(task.id);
  assert.deepEqual(store.getState().tasks, []);
  assert.deepEqual(createCalendarStore(storage, account).getState().tasks, []);
});

test('Unfinished tasks carry forward while completed tasks stay on their completion date', () => {
  const store = createCalendarStore();
  store.addTask('Already completed');
  store.addTask('Still to do');
  store.toggleTask(store.getState().tasks[0].id);
  const state = store.getState();
  assert(renderHome(state).includes('Already completed'));
  const tomorrow = renderHome({...state, today: addDays(state.today, 1)});
  assert(!tomorrow.includes('Already completed'));
  assert(tomorrow.includes('Still to do'));
});

test('Damaged storage and unavailable writes keep the start page and task controls usable', () => {
  const storage = memoryStorage();
  storage.setItem('clear-calendar:preferences:v1:oli', '{broken');
  storage.setItem('tempo:tasks:v1:oli', JSON.stringify([
    {id: 'valid', title: '<script>safe text</script>', completedDate: null},
    {id: 'invalid"', title: 'Bad identifier', completedDate: null},
    {id: 'bad-date', title: 'Invalid completion', completedDate: 'yesterday'},
    {id: 'valid', title: 'Duplicate', completedDate: null},
    null,
  ]));
  const store = createCalendarStore(storage, account);
  assert.equal(store.getState().tasks.length, 1);
  const html = renderHome(store.getState());
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;script&gt;safe text&lt;/script&gt;'));
  const blocked = createCalendarStore({getItem: () => {throw new Error('blocked');}, setItem: () => {throw new Error('blocked');}}, account);
  assert.equal(blocked.addTask('Keep working'), true);
  assert.equal(blocked.getState().tasks.length, 1);
  assert.equal(blocked.getState().tasksSaved, false);
  assert(renderHome(blocked.getState()).includes('Conservées pour cette session'));
});
