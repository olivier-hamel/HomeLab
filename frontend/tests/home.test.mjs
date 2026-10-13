import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHomeStore, dayAfter, todayKey, visibleTasks, plannerTasks, homeTaskInput, migrateHomeTasks } from '../src/lib/home.ts';
import { calendarFrameUrl, sectionUrl } from '../src/lib/navigation.ts';

function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test('Accueil restores Tempo tasks and preferences without altering other accounts or calendar settings', () => {
  const storage = memoryStorage();
  const task = { id: 'existing', title: 'Lire vingt minutes', completedDate: null };
  storage.setItem('tempo:tasks:v1:oli', JSON.stringify([task]));
  storage.setItem('clear-calendar:preferences:v1:oli', JSON.stringify({ weekStart: 0, timeFormat: '24', timezone: 'America/Toronto', searchEngine: 'duckduckgo' }));
  const store = createHomeStore('oli', storage);
  assert.deepEqual(store.getSnapshot().tasks, [task]);
  assert.equal(store.getSnapshot().preferences.searchEngine, 'duckduckgo');
  assert.equal(store.getSnapshot().preferences.timeFormat, '24');
  assert.deepEqual(createHomeStore('max', storage).getSnapshot().tasks, []);
  store.setSearchEngine('google');
  const preferences = JSON.parse(storage.getItem('clear-calendar:preferences:v1:oli'));
  assert.equal(preferences.weekStart, 0);
  assert.equal(preferences.timezone, 'America/Toronto');
  assert.equal(preferences.timeFormat, '24');
  assert.equal(preferences.searchEngine, 'google');
});

test('Tasks persist, carry unfinished work forward, reopen and delete', () => {
  const storage = memoryStorage(), store = createHomeStore('oli', storage);
  assert.equal(store.add('   '), false);
  assert.equal(store.add('x'.repeat(161)), false);
  assert.equal(store.add('  Lire  '), true);
  store.add('Réviser');
  const id = store.getSnapshot().tasks[0].id;
  store.toggle(id, '2026-10-12');
  assert.equal(visibleTasks(store.getSnapshot().tasks, '2026-10-12').length, 2);
  assert.deepEqual(visibleTasks(store.getSnapshot().tasks, '2026-10-13').map(task => task.title), ['Réviser']);
  assert.deepEqual(createHomeStore('oli', storage).getSnapshot().tasks, store.getSnapshot().tasks);
  store.toggle(id, '2026-10-13');
  assert.equal(store.getSnapshot().tasks[0].completedDate, null);
  store.remove(id);
  assert.deepEqual(createHomeStore('oli', storage).getSnapshot().tasks.map(task => task.title), ['Réviser']);
});

test('Corrupt records are ignored, cross-tab changes sync, and blocked storage keeps tasks usable', () => {
  const storage = memoryStorage();
  storage.setItem('tempo:tasks:v1:oli', JSON.stringify([
    { id: 'valid', title: '<script>safe text</script>', completedDate: null },
    { id: 'valid', title: 'Duplicate', completedDate: null },
    { id: 'bad-date', title: 'Invalid date', completedDate: '2026-02-30' },
    { id: 'bad"id', title: 'Invalid id', completedDate: null }, null,
  ]));
  const first = createHomeStore('oli', storage), second = createHomeStore('oli', storage);
  assert.equal(first.getSnapshot().tasks.length, 1);
  second.add('Depuis un autre onglet');
  first.sync('tempo:tasks:v1:max');
  assert.equal(first.getSnapshot().tasks.length, 1);
  first.sync('tempo:tasks:v1:oli');
  assert.equal(first.getSnapshot().tasks.length, 2);
  const blocked = createHomeStore('oli', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.equal(blocked.add('Keep working'), true);
  assert.equal(blocked.getSnapshot().saved, false);
  blocked.sync();
  assert.equal(blocked.getSnapshot().tasks.length, 1);
});

test('Civil dates follow Toronto across midnight, month boundaries and daylight saving time', () => {
  assert.equal(todayKey(new Date('2026-10-13T02:00:00Z')), '2026-10-12');
  assert.equal(todayKey(new Date('2026-10-13T05:00:00Z')), '2026-10-13');
  assert.equal(dayAfter('2026-10-31', 1), '2026-11-01');
  assert.equal(dayAfter('2026-03-07', 2), '2026-03-09');
});

test('Calendar handoff preserves a selected occurrence and removes stale targets when switching apps', () => {
  assert.equal(calendarFrameUrl('?section=calendar&date=2026-10-13&view=day&event=event-id'), '/calendar/?date=2026-10-13&view=day&event=event-id');
  assert.equal(calendarFrameUrl('?view=invalid&event=https://unsafe.example&create=1'), '/calendar/?create=1');
  const previous = globalThis.location;
  globalThis.location = { href: 'https://homelab.test/?section=calendar&date=2026-10-13&event=old&view=day&create=1' };
  try {
    assert.equal(sectionUrl('home').search, '?section=home');
    assert.equal(sectionUrl('calendar', { date: '2026-10-18', view: 'day', event: 'series-id' }).search, '?section=calendar&date=2026-10-18&view=day&event=series-id');
  } finally { globalThis.location = previous; }
});

test('shared tasks sort unfinished deadlines first, retain overdue and undated work and optionally show old completed work', () => {
  const input = homeTaskInput(' Projet ', '2026-10-13');
  assert.equal(input.kind, 'task'); assert.equal(input.title, 'Projet'); assert.equal(input.deadline.date, '2026-10-13');
  const events = [{ ...input, id: 'due' }, { ...input, id: 'overdue', deadline: { date: '2026-10-12', time: null } }, { ...input, id: 'undated', deadline: null }, { ...input, id: 'old', completed: true, completedAt: '2026-10-12T12:00:00Z' }, { ...input, id: 'today', completed: true, completedAt: '2026-10-13T12:00:00Z' }, { ...input, id: 'appointment', kind: 'event' }];
  assert.deepEqual(plannerTasks(events, '2026-10-13').map(row => row.id), ['overdue', 'due', 'undated', 'today']);
  assert.equal(plannerTasks(events, '2026-10-13', true).length, 5);
});

test('legacy task migration resumes after an interrupted write with the same request ID and removes local tasks only after saving', async () => {
  const store = createHomeStore('oli', memoryStorage()); store.add('Ancienne tâche');
  const original = globalThis.fetch; const calls = [];
  try {
    globalThis.fetch = async (_url, init) => { calls.push(JSON.parse(init.body)); throw new Error('Interrupted'); };
    await assert.rejects(migrateHomeTasks(store, 'oli', '2026-10-13'));
    assert.equal(store.getSnapshot().tasks.length, 1);
    globalThis.fetch = async (_url, init) => { const body = JSON.parse(init.body); calls.push(body); return Response.json({ event: { ...body.event, id: body.requestId } }); };
    assert.equal((await migrateHomeTasks(store, 'oli', '2026-10-13')).length, 1);
    assert.equal(calls[0].requestId, calls[1].requestId); assert.equal(store.getSnapshot().tasks.length, 0);
  } finally { globalThis.fetch = original; }
});
