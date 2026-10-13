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
