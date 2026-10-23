import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CalendarEventStore } from '../src/lib/calendar/store.ts';
import { validateEvent, plannerSchemaForTypes } from '../src/lib/calendar/events.ts';
import { createCalendarApi } from '../src/lib/calendar/api.ts';
import { CalendarMoodleSync, currentSemester, currentCourses, moodleImports, torontoCivil } from '../src/lib/calendar/moodle-sync.ts';
import { parseMoodleEvents, parseMoodleAssignments } from '../src/lib/moodle/client.ts';
import { eventTypeFixture } from './helpers/calendar-types.mjs';

const course = { id: 5301, shortname: 'INF2705 (20263)', fullname: 'INF2705 (A2026) - Infographie' };
const assignment = { id: 71595, name: 'TP2', course_id: course.id, due_at: '2026-10-26T03:59:00Z', effective_due_at: '2026-10-27T03:59:00Z', personal_deadline_checked: true, submitted: false, url: 'https://moodle.polymtl.ca/mod/assign/view.php?id=937934' };
const remoteEvent = { id: 414433, name: 'TP2 doit être rendu', course_id: course.id, start_at: assignment.due_at, duration_seconds: 0, module: 'assign', instance_id: assignment.id, event_type: 'due', url: 'https://moodle.polymtl.ca/calendar/view.php?view=day&time=1790567940' };
const task = validateEvent({ title: 'Finir le projet', description: '', date: '2026-10-13', endDate: '2026-10-13', startTime: null, endTime: null, allDay: true, kind: 'task', completed: false, deadline: { date: '2026-10-18', time: '23:59' }, notes: 'Détails privés', links: ['https://example.org/'], documentIds: ['file-id'], context: { kind: 'project', name: 'Projet personnel' } });

function memoryCollection() {
  const rows = [];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const collection = {
    find: filter => ({ sort: () => ({ toArray: async () => structuredClone(rows.filter(row => matches(row, filter))) }) }),
    findOne: async filter => structuredClone(rows.find(row => matches(row, filter)) || null),
    updateOne: async (filter, { $setOnInsert, $set }, options) => {
      const row = rows.find(row => matches(row, filter));
      if (row) Object.assign(row, structuredClone($set || {}));
      else if (options?.upsert) rows.push(structuredClone({ ...filter, ...$setOnInsert, ...$set }));
    },
    findOneAndUpdate: async (filter, { $set }) => { const row = rows.find(row => matches(row, filter)); if (!row) return null; Object.assign(row, structuredClone($set)); return structuredClone(row); },
    deleteOne: async filter => { const index = rows.findIndex(row => matches(row, filter)); if (index < 0) return { deletedCount: 0 }; rows.splice(index, 1); return { deletedCount: 1 }; },
  };
  return { rows, collection, store: new CalendarEventStore(async () => collection, eventTypeFixture().types) };
}

test('tasks have point deadlines, optional course/project, validated resources and no reserved duration', () => {
  assert.equal(task.date, '2026-10-18'); assert.equal(task.endTime, '23:59'); assert.equal(task.startTime, task.endTime);
  assert.equal(validateEvent({ ...task, deadline: null }).allDay, true);
  assert.equal(validateEvent({ ...task, context: null }).context, null);
  for (const patch of [{ completed: 'yes' }, { deadline: { date: '2026-02-30', time: null } }, { deadline: { date: '2026-10-18', time: '24:00' } }, { links: ['javascript:alert(1)'] }, { links: ['https://user:password@example.org'] }, { documentIds: ['../file'] }, { notes: 'x'.repeat(8001) }, { context: { kind: 'other', name: 'Test' } }, { recurrence: { frequency: 'daily' } }]) assert.throws(() => validateEvent({ ...task, ...patch }));
  const schema = plannerSchemaForTypes([{ id: 'none' }]);
  assert.deepEqual(schema.properties.kind.enum, ['event', 'task']); assert(schema.required.includes('deadline'));
});

test('completion updates only the state, survives reload, reopens and rejects stale versions and other accounts', async () => {
  const { store } = memoryCollection();
  const saved = await store.create('oli', task, randomUUID());
  const done = await store.complete('oli', saved.id, true, saved.updatedAt);
  for (const field of ['notes', 'links', 'documentIds', 'deadline', 'context']) assert.deepEqual(done[field], saved[field]);
  assert.equal((await store.list('oli'))[0].completed, true); assert(done.completedAt);
  await assert.rejects(store.complete('oli', saved.id, false, saved.updatedAt), error => error.status === 409);
  await assert.rejects(store.complete('max', saved.id, false, done.updatedAt), error => error.status === 404);
  const reopened = await store.complete('oli', saved.id, false, done.updatedAt); assert.equal(reopened.completedAt, null);
});

test('session filtering and Toronto conversion include DST, personal extensions, undated assignments, global events and deduplication', () => {
  assert.equal(currentSemester(new Date('2026-10-13T12:00:00Z')), 'A26');
  assert.equal(currentSemester(new Date('2027-01-01T06:00:00Z')), 'H27');
  assert.equal(currentSemester(new Date('2027-06-01T12:00:00Z')), 'E27');
  assert.equal(currentCourses([course, { ...course, id: 1, shortname: 'INF2705 (20253)', fullname: 'Automne 2025' }], 'A26').length, 1);
  assert.deepEqual(torontoCivil('2026-11-01T05:30:00Z'), { date: '2026-11-01', time: '01:30' });
  assert.deepEqual(torontoCivil('2026-11-01T06:30:00Z'), { date: '2026-11-01', time: '01:30' });
  const holiday = { ...remoteEvent, id: 2, name: 'Congé', course_id: 1, module: null, instance_id: null, event_type: 'site', start_at: '2026-10-12T04:00:00Z' };
  const rows = moodleImports([course], [remoteEvent, holiday, { ...holiday, id: 3, course_id: 99 }, { ...holiday, id: 4, start_at: '2025-10-12T04:00:00Z' }], [assignment, { ...assignment, id: 123, due_at: null, effective_due_at: null }], 'A26');
  assert.equal(rows.length, 3); assert.equal(rows[0].input.deadline.date, '2026-10-26'); assert.equal(rows[0].input.deadline.time, '23:59');
  assert.equal(rows[1].input.deadline, null); assert.equal(rows[2].input.allDay, true);
  assert.equal(moodleImports([course], [remoteEvent], [], 'A26')[0].id, rows[0].id, 'fallback due event and submission box use one identity');
  const startOfFall = { ...holiday, id: 10, name: "Début du trimestre d'automne", start_at: '2026-08-24T04:00:00Z' };
  assert.equal(moodleImports([course], [startOfFall, { ...holiday, id: 11, name: '[Été long] Examens', start_at: '2026-08-15T04:00:00Z' }], [], 'A26').length, 1);
});

test('Moodle updates preserve local completion, notes, links, documents and durable deletions even after restarting a store', async () => {
  const { store, collection } = memoryCollection();
  let imported = moodleImports([course], [], [assignment], 'A26')[0];
  await store.importMoodle('oli', imported.id, imported.input, imported.moodle);
  let saved = (await store.list('oli'))[0];
  saved = await store.update('oli', saved.id, { ...saved, notes: 'À conserver', links: ['https://example.org/'], documentIds: ['doc'], completed: true, context: { kind: 'project', name: 'Mon projet' } }, saved.updatedAt);
  imported = moodleImports([course], [], [{ ...assignment, effective_due_at: '2026-10-29T03:59:00Z' }], 'A26')[0];
  await store.importMoodle('oli', imported.id, imported.input, imported.moodle);
  saved = (await store.list('oli'))[0];
  assert.equal(saved.deadline.date, '2026-10-28'); assert.equal(saved.completed, true); assert.equal(saved.notes, 'À conserver'); assert.deepEqual(saved.documentIds, ['doc']);
  assert.equal(saved.context.kind, 'project');
  await store.remove('oli', saved.id, saved.updatedAt);
  const restarted = new CalendarEventStore(async () => collection, store.types);
  await restarted.importMoodle('oli', imported.id, imported.input, { ...imported.moodle, fingerprint: 'changed-again' });
  assert.deepEqual(await restarted.list('oli'), []);
  await restarted.importMoodle('max', imported.id, imported.input, imported.moodle);
  assert.equal((await restarted.list('max')).length, 1);
});

test('sync has durable leases, throttles across instances, imports without AI and preserves records on partial responses or outage', async () => {
  const previous = { users: process.env.MOODLE_ALLOWED_USERS, url: process.env.MOODLE_MCP_URL, semester: process.env.CALENDAR_MOODLE_SEMESTER };
  Object.assign(process.env, { MOODLE_ALLOWED_USERS: 'oli', MOODLE_MCP_URL: 'http://127.0.0.1:18000/mcp', CALENDAR_MOODLE_SEMESTER: 'A26' });
  const f = memoryCollection(), state = memoryCollection(); let warnings = [], items = [assignment], unavailable = false, calls = 0;
  const connect = async (_signal, work) => { calls++; if (unavailable) throw new Error('private failure'); return work({ courses: async () => [course], events: async () => ({ items: [], warnings }), assignments: async id => { assert.equal(id, course.id); return { items, warnings }; } }); };
  const sync = new CalendarMoodleSync(f.store, connect, async () => state.collection);
  try {
    await assert.rejects(sync.start('max'), error => error.status === 403); assert.equal(calls, 0);
    assert.equal(await sync.start('oli'), true); await sync.wait('oli'); assert.equal((await f.store.list('oli')).length, 1);
    assert.equal((await sync.status('oli')).status, 'idle');
    const restarted = new CalendarMoodleSync(f.store, connect, async () => state.collection);
    assert.equal(await restarted.start('oli'), false);
    warnings = [{ warningcode: 'partial' }]; items = [];
    await sync.start('oli', true); await sync.wait('oli'); assert.equal((await f.store.list('oli')).length, 1); assert.equal((await sync.status('oli')).status, 'warning');
    unavailable = true; await sync.start('oli', true); await sync.wait('oli'); assert.equal((await sync.status('oli')).status, 'error'); assert.equal((await f.store.list('oli')).length, 1);
    unavailable = false; warnings = []; await sync.start('oli', true); await sync.wait('oli'); assert.equal((await f.store.list('oli')).length, 0);
    items = [assignment]; await sync.start('oli', true); await sync.wait('oli'); assert.equal((await f.store.list('oli')).length, 1);
  } finally { for (const [key, value] of Object.entries({ MOODLE_ALLOWED_USERS: previous.users, MOODLE_MCP_URL: previous.url, CALENDAR_MOODLE_SEMESTER: previous.semester })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('Moodle parsers enforce exact response fields and surface incomplete and unverified dates', () => {
  const warnings = [{ warningcode: 'personal_deadline_unavailable' }];
  const result = parseMoodleAssignments({ assignments: [{ ...assignment, personal_deadline_checked: false, effective_due_at: null, submission_status: 'submitted' }], warnings }, course.id);
  assert.equal(result.items[0].submitted, true); assert.deepEqual(result.warnings, warnings);
  assert.equal(parseMoodleEvents({ events: [remoteEvent], warnings: [] }).items[0].id, remoteEvent.id);
  assert.throws(() => parseMoodleAssignments({ assignments: [{ ...assignment, course_id: 99 }], warnings: [] }, course.id));
  assert.throws(() => parseMoodleEvents({ events: [{ ...remoteEvent, url: 'javascript:alert(1)' }], warnings: [] }));
});

test('API can toggle a task without sending or overwriting all its details', async () => {
  const f = memoryCollection(), saved = await f.store.create('oli', task, randomUUID());
  const api = createCalendarApi(async () => { throw new Error('No AI'); }, f.store, async () => ({ user: { username: 'oli' }, accounts: [] }));
  const request = completed => new Request(`https://homelab.test/api/calendar/events/${saved.id}`, { method: 'PATCH', headers: { Origin: 'https://homelab.test', 'Content-Type': 'application/json', 'X-Calendar-Request': '1' }, body: JSON.stringify({ completed, updatedAt: saved.updatedAt }) });
  assert.equal((await api(request('yes'))).status, 400);
  const response = await api(request(true)); assert.equal(response.status, 200); assert.equal((await response.json()).event.notes, task.notes);
});

const daily = { frequency: 'daily', interval: 1, weekdays: [], until: null, count: 3 };
test('recurring tasks store independent server-owned checkmarks, preserve resources and reopen only the selected occurrence', async () => {
  const { store } = memoryCollection();
  const saved = await store.create('oli', { ...task, recurrence: daily, completed: true, completedOccurrences: { '2026-10-19': 'forged' } }, randomUUID());
  assert.deepEqual(Object.keys(saved.completedOccurrences), ['2026-10-18']);
  await assert.rejects(store.complete('oli', saved.id, true, saved.updatedAt), error => error.status === 400);
  for (const date of ['2026-10-17', '2026-10-21', '2026-02-30', 19]) await assert.rejects(store.complete('oli', saved.id, true, saved.updatedAt, date), error => error.status === 400);
  let done = await store.complete('oli', saved.id, true, saved.updatedAt, '2026-10-19');
  assert.deepEqual(Object.keys(done.completedOccurrences), ['2026-10-18', '2026-10-19']);
  await assert.rejects(store.complete('oli', saved.id, true, saved.updatedAt, '2026-10-20'), error => error.status === 409);
  done = await store.complete('oli', saved.id, false, done.updatedAt, '2026-10-18');
  assert.equal(done.completed, false); assert.equal(done.completedAt, null);
  assert.deepEqual(Object.keys((await store.list('oli'))[0].completedOccurrences), ['2026-10-19']);
  done = await store.update('oli', saved.id, { ...done, title: 'Nouveau titre', completedOccurrences: {} }, done.updatedAt);
  assert(done.completedOccurrences['2026-10-19']);
  for (const field of ['notes', 'links', 'documentIds', 'deadline', 'context']) assert.deepEqual(done[field], saved[field]);
  const changed = await store.update('oli', saved.id, { ...done, recurrence: null, completed: false }, done.updatedAt);
  assert.equal(changed.completedOccurrences, undefined);
  assert.throws(() => validateEvent({ ...task, deadline: null, recurrence: daily }));
});

test('Moodle refresh preserves a manually recurring assignment and its completion dates', async () => {
  const { store } = memoryCollection();
  const imported = moodleImports([course], [], [assignment], 'A26')[0];
  await store.importMoodle('oli', imported.id, imported.input, imported.moodle);
  let saved = (await store.list('oli'))[0];
  saved = await store.update('oli', saved.id, { ...saved, recurrence: daily }, saved.updatedAt);
  saved = await store.complete('oli', saved.id, true, saved.updatedAt, saved.date);
  const changed = moodleImports([course], [], [{ ...assignment, name: 'TP2 mis à jour', effective_due_at: '2026-10-30T03:59:00Z' }], 'A26')[0];
  await store.importMoodle('oli', changed.id, changed.input, changed.moodle);
  const refreshed = (await store.list('oli'))[0];
  assert.equal(refreshed.title, 'TP2 mis à jour'); assert.deepEqual(refreshed.recurrence, daily);
  assert.deepEqual(refreshed.deadline, saved.deadline); assert.deepEqual(refreshed.completedOccurrences, saved.completedOccurrences);
});

test('completion API requires a real occurrence date for a recurring task', async () => {
  const f = memoryCollection(), saved = await f.store.create('oli', { ...task, recurrence: daily }, randomUUID());
  const api = createCalendarApi(async () => { throw new Error('No AI'); }, f.store, async () => ({ user: { username: 'oli' }, accounts: [] }));
  const request = occurrenceDate => new Request(`https://homelab.test/api/calendar/events/${saved.id}`, { method: 'PATCH', headers: { Origin: 'https://homelab.test', 'Content-Type': 'application/json', 'X-Calendar-Request': '1' }, body: JSON.stringify({ completed: true, occurrenceDate, updatedAt: saved.updatedAt }) });
  assert.equal((await api(request())).status, 400);
  assert.equal((await api(request('2026-10-21'))).status, 400);
  const response = await api(request('2026-10-19')); assert.equal(response.status, 200);
  const result = (await response.json()).event; assert.equal(result.completed, false); assert(result.completedOccurrences['2026-10-19']);
});

test('chat prepares a recurring task with a first deadline and never saves the draft', async () => {
  const original = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'recurrence-test-only';
  const f = memoryCollection(); let prompt;
  const expected = { ...task, recurrence: { frequency: 'weekly', interval: 2, weekdays: [0], count: 4, until: null } };
  const fetcher = async (_url, init) => {
    prompt = JSON.parse(init.body).instructions;
    return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ event: expected, clarification: null }) }] }] });
  };
  const api = createCalendarApi(fetcher, f.store, async () => ({ user: { username: 'oli' }, accounts: [] }));
  try {
    const response = await api(new Request('https://homelab.test/api/calendar/interpret', { method: 'POST', headers: { Origin: 'https://homelab.test', 'Content-Type': 'application/json', 'X-Calendar-Request': '1' }, body: JSON.stringify({ text: 'Préparer mon cours un dimanche sur deux à 23 h 59, quatre fois', selectedDate: task.date }) }));
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).event.recurrence, expected.recurrence);
    assert.match(prompt, /Tasks support the same recurrence rules as events/); assert.equal(f.rows.length, 0);
  } finally { if (original === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original; }
});
