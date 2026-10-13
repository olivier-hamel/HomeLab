import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOnDate, eventsInRange, eventTime, layoutTimedEvents } from '../dist/js/events.js';
import { renderCalendar } from '../dist/js/components/views.js';
import { eventDialog } from '../dist/js/components/event-dialog.js';
import { createCalendarStore } from '../dist/js/state.js';
import { parseDate } from '../dist/js/date.js';

const task = { id: 'task', title: '<Travail>', kind: 'task', completed: false, deadline: { date: '2026-10-13', time: '00:00' }, date: '2026-10-13', endDate: '2026-10-13', startTime: '00:00', endTime: '00:00', allDay: false, description: '', recurrence: null };
test('a deadline at midnight is visible only on its day and undated work is omitted from calendar cells', () => {
  assert.equal(eventsOnDate([task], task.date).length, 1);
  assert.equal(eventsOnDate([task], '2026-10-12').length, 0);
  assert.equal(eventsInRange([task], '2026-10-12', task.date).length, 1);
  assert.equal(eventsOnDate([{ ...task, deadline: null }], task.date).length, 0);
  assert.equal(layoutTimedEvents([task], parseDate(task.date))[0].end, 15);
  assert.match(eventTime(task), /Échéance à 0 h/);
});
test('all calendar views expose independent accessible completion and detail buttons with escaped titles', () => {
  const store = createCalendarStore();
  for (const view of ['month', 'week', 'day']) {
    store.openDate(parseDate(task.date), view); store.setEvents([{ ...task, completed: true }]);
    const html = renderCalendar(store.getState());
    assert.match(html, /data-action="toggle-task"/); assert.match(html, /role="checkbox" aria-checked="true"/);
    assert.match(html, /calendar-task-open/); assert.match(html, /Modifier la tâche/); assert(!html.includes('<Travail>'));
  }
});
test('task dialog retains notes, links, documents, project and Moodle deletion policy', () => {
  const html = eventDialog({ event: { ...task, notes: '<Notes>', links: ['https://example.org/'], documentIds: ['doc'], context: { kind: 'project', name: 'Personnel' }, moodle: { semester: 'A26', url: 'https://moodle.polymtl.ca/', personalDeadlineChecked: false } }, date: task.date, aiAvailable: true, documents: [{ id: 'doc', name: 'Énoncé.pdf' }] });
  for (const value of ['Modifier la tâche', '&lt;Notes&gt;', 'Personnel', 'Énoncé.pdf', 'https://example.org/', 'ne sera pas réimporté', 'prolongation personnelle non vérifiée']) assert(html.includes(value));
});

test('recurring deadlines expand with independent completion, including midnight and all three calendar views', () => {
  const recurring = { ...task, recurrence: { frequency: 'daily', interval: 1, weekdays: [], until: null, count: 3 }, completed: true, completedOccurrences: { '2026-10-14': '2026-10-14T12:00:00Z' } };
  const occurrences = eventsInRange([recurring], '2026-10-12', '2026-10-17');
  assert.deepEqual(occurrences.map(row => [row.deadline.date, row.completed]), [['2026-10-13', false], ['2026-10-14', true], ['2026-10-15', false]]);
  assert.equal(eventsOnDate([recurring], '2026-10-16').length, 0);
  const store = createCalendarStore();
  for (const view of ['month', 'week', 'day']) {
    store.openDate(parseDate('2026-10-14'), view); store.setEvents([recurring]);
    const html = renderCalendar(store.getState());
    assert.match(html, /data-occurrence-date="2026-10-14" role="checkbox" aria-checked="true"/);
    assert.match(html, /Modifier toute la série/);
  }
  const html = eventDialog({ event: recurring, date: task.date, aiAvailable: false });
  assert.match(html, /Première occurrence terminée/); assert.match(html, /Chaque échéance se coche séparément/); assert.match(html, /Supprimer toute la série/);
});

test('completion repository sends the selected recurring occurrence and the current series version', async () => {
  const { createEventRepository } = await import('../dist/js/events.js');
  let body;
  const repository = createEventRepository(async (_url, init) => { body = JSON.parse(init.body); return Response.json({ event: {} }); });
  await repository.completeTask({ ...task, updatedAt: 'version', recurrence: {}, occurrenceDate: '2026-10-14' }, true);
  assert.deepEqual(body, { completed: true, updatedAt: 'version', occurrenceDate: '2026-10-14' });
});
