import test from 'node:test';
import assert from 'node:assert/strict';
import {eventsOnDate,layoutTimedEvents} from '../dist/js/events.js';
import {civilDate} from '../dist/js/date.js';
import {createCalendarStore} from '../dist/js/state.js';
import {renderCalendar} from '../dist/js/components/views.js';
const base={id:'event-one',title:'Dentiste',description:'Note',date:'2026-10-12',endDate:'2026-10-12',startTime:'14:00',endTime:'15:00',allDay:false};

test('overnight events appear on the correct days, with midnight end exclusive and all-day end inclusive',()=>{
 const overnight={...base,startTime:'23:00',endTime:'01:00',endDate:'2026-10-13'};
 assert.equal(eventsOnDate([overnight],'2026-10-12').length,1);
 assert.equal(eventsOnDate([overnight],'2026-10-13').length,1);
 assert.equal(eventsOnDate([{...overnight,endTime:'00:00'}],'2026-10-13').length,0);
 assert.equal(eventsOnDate([{...overnight,allDay:true,startTime:null,endTime:null}],'2026-10-13').length,1);
 assert.equal(layoutTimedEvents([overnight],civilDate(2026,9,13))[0].start,0);
});
test('overlapping events get separate lanes and back-to-back events use full width',()=>{
 const rows=layoutTimedEvents([base,{...base,id:'two',startTime:'14:30',endTime:'15:30'},{...base,id:'three',startTime:'16:00',endTime:'17:00'}],civilDate(2026,9,12));
 assert.equal(rows[0].lanes,2); assert.equal(rows[1].lanes,2); assert.notEqual(rows[0].lane,rows[1].lane); assert.equal(rows[2].lanes,1);
});
test('events render safely in all calendar views',()=>{
 const store=createCalendarStore(); store.setEvents([{...base,title:'<img src=x onerror=alert(1)>',description:'<script>bad</script>'}],{eventsStatus:'ready'});
 for(const view of ['month','week','day']) {
  store.openDate(civilDate(2026,9,12),view); const html=renderCalendar(store.getState());
  assert(html.includes('data-event-id="event-one"')); assert(!html.includes('<img')); assert(html.includes('&lt;img'));
 }
});
