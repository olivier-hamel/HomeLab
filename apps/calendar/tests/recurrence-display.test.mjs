import test from 'node:test';
import assert from 'node:assert/strict';
import {civilDate} from '../dist/js/date.js';
import {createCalendarStore} from '../dist/js/state.js';
import {renderCalendar} from '../dist/js/components/views.js';

const base = {id:'routine', title:'Rencontre hebdomadaire', description:'', date:'2026-10-12', endDate:'2026-10-12', startTime:'08:00', endTime:'10:00', allDay:false};
const weekly = {frequency:'weekly', interval:1, weekdays:[1], until:null, count:1};
function render(events, view) {
  const store = createCalendarStore();
  store.setEvents(events, {eventsStatus:'ready'});
  store.openDate(civilDate(2026, 9, 12), view);
  return renderCalendar(store.getState());
}
const button = (html, id) => html.match(new RegExp(`<button\\b[^>]*data-event-id="${id}"[^>]*>[\\s\\S]*?</button>`))?.[0];

test('daily and weekly recurrence up to three weeks uses markers in the month and readable cards in week/day views', () => {
  for (const [frequency, interval, compact] of [
    ['daily', 1, true], ['daily', 21, true], ['daily', 22, false],
    ['weekly', 1, true], ['weekly', 2, true], ['weekly', 3, true], ['weekly', 4, false],
    ['monthly', 1, false], ['yearly', 1, false],
  ]) {
    const event = {...base, recurrence:{...weekly, frequency, interval, weekdays:frequency === 'weekly' ? [1] : []}};
    for (const view of ['month', 'week', 'day']) {
      const html = button(render([event], view), event.id);
      assert(html, `${frequency}/${interval}/${view} keeps the event accessible`);
      assert.equal(html.includes('recurring-event-marker'), compact && view === 'month', `${frequency}/${interval}/${view}`);
      assert.equal(html.includes('event-chip-title'), !compact || view !== 'month');
      assert(html.includes('aria-label="Rencontre hebdomadaire'));
      assert(html.includes('Modifier toute la série'));
    }
  }
  assert(button(render([base], 'week'), base.id).includes('event-chip-title'));
});

test('frequent events leave both month event slots and the overflow count for occasional events', () => {
  const events = [
    {...base, recurrence:weekly},
    {...base, id:'appointment-one', title:'Dentiste', startTime:'11:00', endTime:'12:00'},
    {...base, id:'appointment-two', title:'Examen', startTime:'13:00', endTime:'14:00'},
    {...base, id:'appointment-three', title:'Souper', startTime:'18:00', endTime:'19:00'},
  ];
  const html = render(events, 'month');
  assert(button(html, 'routine').includes('recurring-event-marker'));
  assert(button(html, 'appointment-one').includes('event-chip-title'));
  assert(button(html, 'appointment-two').includes('event-chip-title'));
  assert.equal(button(html, 'appointment-three'), undefined);
  assert.match(html, /data-action="open-day" data-date="2026-10-12">\+ 1 autres/);
  assert.match(html, /4 événements/);
  assert(!render(events.slice(0, 3), 'month').includes('more-events'));
});

test('weekly recurring cards share readable overlap lanes with appointments', () => {
  const events = [
    {...base, recurrence:weekly},
    {...base, id:'other-routine', recurrence:weekly},
    {...base, id:'appointment', title:'Rendez-vous ponctuel'},
  ];
  const week = render(events, 'week');
  for (const id of ['routine', 'other-routine', 'appointment']) {
    assert.match(button(week, id), /width:calc\(33\.333/);
    assert(button(week, id).includes('event-chip-title'));
  }
  assert(!week.includes('time-recurring-events'));
  const day = render(events, 'day');
  assert(!day.includes('recurring-event-marker'));
  assert.match(button(day, 'appointment'), /width:calc\(33\.333/);
});

test('all-day and overnight series remain compact with escaped accessible details', () => {
  const event = {...base, title:'<Routine & repos>', recurrence:weekly,
    source:{documentName:'<Document>', documentId:'source'}};
  const allDay = {...event, allDay:true, startTime:null, endTime:null, endDate:'2026-10-13'};
  for (const view of ['month', 'week', 'day']) {
    const html = render([allDay], view);
    const markup = button(html, event.id);
    assert.equal(markup.includes('recurring-event-marker'), view === 'month');
    assert(markup.includes('is-all-day'));
    assert(markup.includes('&lt;Routine &amp; repos&gt;, Toute la journée'));
    assert(markup.includes('document : &lt;Document&gt;'));
    assert(!markup.includes('<Routine'));
  }
  const overnight = {...event, startTime:'23:00', endTime:'01:00', endDate:'2026-10-13'};
  const html = render([overnight], 'week');
  assert.equal((html.match(/data-event-id="routine"/g) || []).length, 2);
  assert.match(html, /top:95\.83333333333334%/);
  assert.match(html, /top:0%;height:min/);
});
