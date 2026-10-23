import test from 'node:test';
import assert from 'node:assert/strict';
import {civilDate} from '../dist/js/date.js';
import {createCalendarStore} from '../dist/js/state.js';
import {layoutTimedEvents} from '../dist/js/events.js';
import {renderCalendar} from '../dist/js/components/views.js';
import {eventDialog} from '../dist/js/components/event-dialog.js';
import {eventTypesDialog} from '../dist/js/components/event-types-dialog.js';
import {eventImportance, eventTypeOptions} from '../dist/js/event-types.js';

const date = '2026-10-12', day = civilDate(2026, 9, 12);
const base = {id:'event', title:'Examen', description:'', date, endDate:date, startTime:'09:00', endTime:'10:00', allDay:false, recurrence:null};
const types = [{id:'none', name:'aucun', importance:3, hidden:true}, ...Array.from({length:5}, (_, i) => ({id:`type-${i + 1}`, name:`Niveau ${i + 1}`, importance:i + 1, hidden:false}))];
function render(events, view) {
  const store = createCalendarStore(); store.setEventTypes(types); store.setEvents(events, {eventsStatus:'ready'}); store.openDate(day, view); return renderCalendar(store.getState());
}
const button = (html, id) => html.match(new RegExp(`<button\\b[^>]*data-event-id="${id}"[^>]*>[\\s\\S]*?</button>`))?.[0];

test('default stays hidden in management and selection, legacy or deleted types use normal importance, and names are escaped', () => {
  assert(!eventTypesDialog(types).includes('aucun')); assert(!eventTypeOptions(types).includes('aucun'));
  assert.equal(eventImportance(base, types), 3); assert.equal(eventImportance({...base, typeId:'deleted'}, types), 3);
  const unsafe = [...types, {id:'unsafe', name:'<img src=x onerror=alert(1)>', importance:4}];
  for (const html of [eventTypesDialog(unsafe), eventTypeOptions(unsafe), eventDialog({event:base, date, aiAvailable:true, eventTypes:unsafe})]) {
    assert(!html.includes('<img')); assert(html.includes('&lt;img'));
  }
  assert.match(eventTypeOptions(types, 'deleted'), /value="none" selected/);
  assert.match(eventTypesDialog(types), /name="importance" required/);
});

test('importance controls markers and cards in every view, including important frequent series', () => {
  const recurrence = {frequency:'weekly', interval:1, weekdays:[1], until:null, count:1};
  for (let importance = 1; importance <= 5; importance++) {
    const event = {...base, typeId:`type-${importance}`, recurrence};
    for (const view of ['month','week','day']) {
      const html = button(render([event], view), event.id);
      assert(html.includes(`importance-${importance}`));
      assert.equal(html.includes('recurring-event-marker'), view !== 'week' && importance <= (view === 'month' ? 1 : 2));
      assert(html.includes(`importance ${['très faible','faible','normale','élevée','très élevée'][importance - 1]}`));
    }
  }
});

test('high importance gets more width when timed events overlap without changing dates or durations', () => {
  const events = [{...base, id:'normal', typeId:'type-3'}, {...base, id:'high', typeId:'type-4'}, {...base, id:'highest', typeId:'type-5'}];
  const rows = layoutTimedEvents(events, day, types);
  assert(rows[2].width > rows[1].width); assert(rows[1].width > rows[0].width);
  assert.equal(rows.reduce((sum, row) => sum + row.width, 0), 1);
  for (const row of rows) {assert.equal(row.start, 540); assert.equal(row.end, 600);}
  assert(rows.every((row, i) => !i || row.offset >= rows[i - 1].offset + rows[i - 1].width));
});

test('month prioritizes important cards and preserves discreet event access outside the two-card limit', () => {
  const events = [{...base, id:'low', typeId:'type-1'}, {...base, id:'normal', typeId:'type-3'}, {...base, id:'high', typeId:'type-4'}, {...base, id:'highest', typeId:'type-5'}];
  const html = render(events, 'month');
  assert(button(html, 'low').includes('recurring-event-marker'));
  assert(button(html, 'highest').includes('event-chip-title')); assert(button(html, 'high').includes('event-chip-title'));
  assert.equal(button(html, 'normal'), undefined); assert.match(html, /\+ 1 autres/);
  assert(html.indexOf('data-event-id="highest"') < html.indexOf('data-event-id="high"'));
  assert.equal(render(events, 'day').match(/data-event-id=/g).length, 4);
});
