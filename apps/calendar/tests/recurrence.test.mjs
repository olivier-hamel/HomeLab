import test from 'node:test';
import assert from 'node:assert/strict';
import {eventsOnDate,eventsInRange,layoutTimedEvents} from '../dist/js/events.js';
import {civilDate} from '../dist/js/date.js';
import {eventDialog} from '../dist/js/components/event-dialog.js';

const base={id:'series-one',title:'Souper',description:'',date:'2026-10-18',endDate:'2026-10-18',startTime:'19:00',endTime:'21:00',allDay:false,recurrence:{frequency:'weekly',interval:2,weekdays:[0],until:null,count:null}};
const dates=(event,start,end)=>eventsInRange([event],start,end).map(row=>row.date);

test('biweekly Sundays keep Toronto wall-clock times across DST and distant navigation',()=>{
  assert.deepEqual(dates(base,'2026-10-01','2026-11-30'),['2026-10-18','2026-11-01','2026-11-15','2026-11-29']);
  assert.equal(eventsOnDate([base],'2026-10-25').length,0);
  const occurrence=eventsOnDate([base],'2026-11-01')[0];
  assert.equal(occurrence.startTime,'19:00');assert.equal(occurrence.endTime,'21:00');assert.equal(occurrence.seriesDate,base.date);assert.equal(occurrence.id,base.id);
  assert.equal(layoutTimedEvents([base],civilDate(2026,10,1))[0].start,19*60);
  assert(dates(base,'2090-01-01','2090-12-31').length>=26);
});

test('weekly count includes the partial first week and all selected weekdays',()=>{
  const event={...base,date:'2026-10-14',endDate:'2026-10-14',recurrence:{...base.recurrence,weekdays:[1,3,0],count:5}};
  assert.deepEqual(dates(event,'2026-10-01','2026-12-01'),['2026-10-14','2026-10-18','2026-10-26','2026-10-28','2026-11-01']);
  assert.equal(eventsOnDate([event],'2026-11-09').length,0);
  assert.equal(eventsOnDate([event],'2090-01-01').length,0);
});

test('end dates include starts on the final date and occurrence counts include the first',()=>{
  const daily={...base,recurrence:{frequency:'daily',interval:2,weekdays:[],until:'2026-10-22',count:null}};
  assert.deepEqual(dates(daily,'2026-10-01','2026-10-30'),['2026-10-18','2026-10-20','2026-10-22']);
  assert.deepEqual(dates({...daily,recurrence:{...daily.recurrence,until:null,count:1}},'2026-10-01','2026-12-30'),['2026-10-18']);
});

test('recurring overnight and all-day events preserve duration and midnight exclusivity',()=>{
  const overnight={...base,endDate:'2026-10-19',startTime:'23:00',endTime:'01:00'};
  assert.equal(eventsOnDate([overnight],'2026-11-02')[0].date,'2026-11-01');
  assert.equal(eventsOnDate([{...overnight,endTime:'00:00'}],'2026-11-02').length,0);
  const allDay={...overnight,allDay:true,startTime:null,endTime:null,recurrence:{...base.recurrence,until:base.date}};
  assert.equal(eventsOnDate([allDay],'2026-10-19').length,1);
  assert.equal(eventsInRange([allDay],'2026-10-18','2026-10-19').length,1);
  const overlapping={...allDay,endDate:'2026-10-20',recurrence:{frequency:'daily',interval:1,weekdays:[],until:null,count:3}};
  assert.equal(eventsOnDate([overlapping],'2026-10-20').length,3);
});

test('monthly rules skip missing dates and yearly rules skip non-leap years without counting them',()=>{
  const month={...base,date:'2026-01-31',endDate:'2026-01-31',recurrence:{frequency:'monthly',interval:1,weekdays:[],until:null,count:4}};
  assert.deepEqual(dates(month,'2026-01-01','2026-12-31'),['2026-01-31','2026-03-31','2026-05-31','2026-07-31']);
  assert.deepEqual(dates({...month,recurrence:{...month.recurrence,count:null}},'2090-02-01','2090-03-31'),['2090-03-31']);
  const leap={...month,date:'2028-02-29',endDate:'2028-02-29',recurrence:{...month.recurrence,frequency:'yearly',count:3}};
  assert.deepEqual(dates(leap,'2028-01-01','2040-12-31'),['2028-02-29','2032-02-29','2036-02-29']);
  assert.deepEqual(dates({...leap,recurrence:{...leap.recurrence,count:null}},'2100-01-01','2104-12-31'),['2104-02-29']);
});

test('series stop at the maximum supported date and work at year 1',()=>{
  const event={...base,date:'9999-12-30',endDate:'9999-12-30',recurrence:{frequency:'daily',interval:1,weekdays:[],until:null,count:null}};
  assert.deepEqual(dates(event,'9999-12-30','9999-12-31'),['9999-12-30','9999-12-31']);
  assert.deepEqual(dates({...event,date:'0001-01-01',endDate:'0001-01-01'},'0001-01-01','0001-01-03'),['0001-01-01','0001-01-02','0001-01-03']);
  const weekly={...event,recurrence:{...base.recurrence,interval:1,weekdays:[4]}};
  assert.deepEqual(dates(weekly,'9999-12-30','9999-12-31'),['9999-12-30']);
});

test('upcoming counts actual occurrences and editing clearly targets the whole series',()=>{
  const upcoming=eventsInRange([base],'2026-11-02','2026-11-15');
  assert.equal(upcoming.length,1);assert.equal(upcoming[0].id,'series-one');
  const dialog=eventDialog({event:base,date:base.date,aiAvailable:true});
  assert(dialog.includes('Tu modifies toute la série'));assert(dialog.includes('Supprimer toute la série?'));assert(dialog.includes('Toutes les 2 semaines'));
});
