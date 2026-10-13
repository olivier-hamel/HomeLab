import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {eventTypeFixture} from './helpers/calendar-types.mjs';
import {DEFAULT_EVENT_TYPE, validateEventType} from '../src/lib/calendar/event-types.ts';
import {validateEvent} from '../src/lib/calendar/events.ts';
import {CalendarEventStore} from '../src/lib/calendar/store.ts';
import {createCalendarApi} from '../src/lib/calendar/api.ts';
import {analyseCalendarPdf} from '../src/lib/calendar/pdf-analysis.ts';

const draft = {title:'Examen de physique', description:'Salle 204', date:'2026-10-13', endDate:'2026-10-13', startTime:'14:00', endTime:'16:00', allDay:false, recurrence:null, typeId:'none'};
const origin = 'https://homelab.test';
function fixture(fetcher = async () => {throw new Error('Unexpected provider call');}) {
  const {types, rows:catalogs} = eventTypeFixture(), rows = [];
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  const collection = {
    find: filter => ({sort: () => ({toArray: async () => rows.filter(row => match(row, filter)).map(row => ({...row}))})}),
    findOne: async filter => rows.find(row => match(row, filter)) || null,
    updateOne: async (filter, update) => {if (!rows.some(row => match(row, filter))) rows.push({...update.$setOnInsert});},
    updateMany: async (filter, {$set}) => {for (const row of rows.filter(row => match(row, filter))) Object.assign(row, $set);},
    findOneAndUpdate: async (filter, {$set}) => {const row = rows.find(row => match(row, filter)); if (!row) return null; Object.assign(row, $set); return {...row};},
    deleteOne: async filter => {const i = rows.findIndex(row => match(row, filter)); if (i < 0) return {deletedCount:0}; rows.splice(i, 1); return {deletedCount:1};},
  };
  const store = new CalendarEventStore(async () => collection, types);
  const api = createCalendarApi(fetcher, store, async req => ({user:{username:req.headers.get('X-Test-Account') || 'oli'}, accounts:[]}));
  const call = (path, method = 'GET', body, username = 'oli', extra = {}) => api(new Request(`${origin}/api/calendar/${path}`, {method, headers:{Origin:origin, 'X-Test-Account':username, ...(body ? {'Content-Type':'application/json', 'X-Calendar-Request':'1'} : {}), ...extra}, ...(body ? {body:JSON.stringify(body)} : {})}));
  return {types, catalogs, store, rows, call};
}
const provider = data => Response.json({status:'completed', output:[{type:'message', role:'assistant', status:'completed', content:[{type:'output_text', text:JSON.stringify(data)}]}]});
async function withKey(work, variable = 'OPENAI_API_KEY') {
  const previous = process.env[variable]; process.env[variable] = 'type-test-canary';
  try {await work();} finally {if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;}
}

test('hidden default is persisted per account, legacy events use it, and it cannot be created or deleted by the user', async () => {
  const {types, rows} = eventTypeFixture();
  assert.deepEqual(await types.list('oli'), [DEFAULT_EVENT_TYPE]);
  assert.deepEqual(await types.list('max'), [DEFAULT_EVENT_TYPE]);
  assert.equal(rows.size, 2);
  assert.equal(validateEvent({...draft, typeId:undefined}).typeId, 'none');
  await assert.rejects(types.remove('oli', 'none'), error => error.status === 400);
  for (const name of ['aucun', ' Aucun ', 'AUCUN']) assert.throws(() => validateEventType({name, importance:3}));
  for (const importance of [undefined, null, 0, 6, 2.5, '3']) assert.throws(() => validateEventType({name:'Cours', importance}));
  for (const name of ['', '  ', 'x'.repeat(81), 'Deux\nlignes', 'Null\u0000']) assert.throws(() => validateEventType({name, importance:3}));
  for (let importance = 1; importance <= 5; importance++) assert.equal(validateEventType({name:'  Cours  ', importance}).importance, importance);
});

test('type creation is idempotent, names are unique under concurrent creation, and deleted request IDs never resurrect a type', async () => {
  const {types} = eventTypeFixture(), id = randomUUID();
  const created = await types.create('oli', id, {name:'Examen', importance:5});
  assert.deepEqual(await types.create('oli', id, {name:'Examen', importance:5}), created);
  const attempts = await Promise.allSettled(['Cours', 'cours'].map(name => types.create('oli', randomUUID(), {name, importance:2})));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await types.list('max')).length, 1);
  await types.remove('max', id); assert((await types.list('oli')).some(type => type.id === id));
  await types.remove('oli', id); await types.remove('oli', id);
  await assert.rejects(types.create('oli', id, {name:'Examen', importance:5}), error => error.status === 409);
});

test('API assigns only owned types, deletion preserves events and recurrence, resets the type and invalidates stale editors', async () => {
  const f = fixture(), id = randomUUID();
  const created = await f.call('event-types', 'POST', {requestId:id, type:{name:'Examen', importance:5}});
  assert.equal(created.status, 201); assert.equal((await created.json()).eventType.id, id);
  assert.equal((await f.call('event-types', 'POST', {requestId:randomUUID(), type:{name:'Cours', importance:0}})).status, 400);
  assert.equal((await f.call('event-types', 'POST', {requestId:randomUUID(), type:{name:'Cours', importance:2}}, 'oli', {Origin:'https://evil.test'})).status, 403);
  assert.equal((await f.call('events', 'POST', {requestId:randomUUID(), event:{...draft, typeId:id}}, 'max')).status, 400);
  assert.equal((await f.call('events', 'POST', {requestId:randomUUID(), event:{...draft, typeId:randomUUID()}})).status, 400);
  const recurrence = {frequency:'weekly', interval:1, weekdays:[2], until:null, count:4};
  const result = await f.call('events', 'POST', {requestId:randomUUID(), event:{...draft, typeId:id, recurrence}});
  const {event} = await result.json(); assert.equal(event.typeId, id);
  const other = await f.store.create('max', draft, randomUUID());
  assert.equal((await f.call(`event-types/${id}`, 'DELETE', {}, 'max')).status, 200);
  assert.equal(f.rows.find(row => row.id === event.id).typeId, id);
  const deleted = await f.call(`event-types/${id}`, 'DELETE', {});
  assert.equal(deleted.status, 200); const data = await deleted.json();
  assert.equal(data.events[0].typeId, 'none'); assert.deepEqual(data.events[0].recurrence, recurrence);
  assert(data.events[0].updatedAt > event.updatedAt); assert.equal(f.rows.length, 2);
  assert.equal(f.rows.find(row => row.id === event.id).typeId, 'none');
  assert.equal(f.rows.find(row => row.id === other.id).updatedAt, other.updatedAt);
  assert.deepEqual(data.eventTypes, [DEFAULT_EVENT_TYPE]);
  assert.equal((await f.call(`events/${event.id}`, 'PATCH', {updatedAt:event.updatedAt, event:draft})).status, 409);
  assert.equal((await f.call('event-types/none', 'DELETE', {})).status, 400);
  assert.equal((await f.call(`events/${event.id}`, 'PATCH', {updatedAt:data.events[0].updatedAt, event:{...draft, typeId:id}})).status, 400);
});

test('deleted references from an interrupted concurrent write resolve to the default on reads', async () => {
  const f = fixture(), id = randomUUID();
  await f.types.create('oli', id, {name:'Cours', importance:2});
  const event = await f.store.create('oli', {...draft, typeId:id}, randomUUID());
  await f.types.remove('oli', id);
  assert.equal((await f.store.list('oli'))[0].typeId, 'none');
  assert.equal(f.rows[0].id, event.id);
});

test('OpenAI receives owned type names and enum IDs, assigns a type without saving, and rejects invented or foreign types', async () => withKey(async () => {
  let answer, captured;
  const f = fixture(async (_url, init) => {captured = JSON.parse(init.body); return provider({event:answer, clarification:null});});
  const type = await f.types.create('oli', randomUUID(), {name:'Examen', importance:5});
  const foreign = await f.types.create('max', randomUUID(), {name:'Secret', importance:4});
  answer = {...draft, typeId:type.id};
  const response = await f.call('interpret', 'POST', {text:'Examen de physique demain à 14 h', selectedDate:draft.date});
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).event, answer); assert.equal(f.rows.length, 0);
  const input = JSON.parse(captured.input[0].content);
  assert.deepEqual(input.eventTypes, [DEFAULT_EVENT_TYPE, type]);
  assert(!JSON.stringify(input).includes('type-test-canary')); assert.equal(input.username, undefined);
  assert.match(captured.instructions, /best matches the event title/);
  assert.deepEqual(captured.text.format.schema.properties.event.anyOf[0].properties.typeId.enum, ['none', type.id]);
  for (const typeId of [randomUUID(), foreign.id, '<script>']) {
    answer = {...draft, typeId};
    assert.equal((await f.call('interpret', 'POST', {text:'Examen', selectedDate:draft.date})).status, 502);
  }
}));

test('PDF extraction supplies the same types and validates each proposed classification', async () => withKey(async () => {
  const {types} = eventTypeFixture(), type = await types.create('oli', randomUUID(), {name:'Examen', importance:5});
  const eventTypes = await types.list('oli'); let typeId = type.id;
  const options = {name:'examens.pdf', pdf:new Uint8Array(Buffer.from('%PDF-1.7\nfixture')), signal:new AbortController().signal, eventTypes,
    fetcher:async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(JSON.parse(body.input[0].content[0].text).eventTypes, eventTypes);
      assert.deepEqual(body.text.format.schema.properties.events.items.properties.event.properties.typeId.enum, ['none', type.id]);
      return provider({summary:'Un examen.', events:[{event:{...draft, typeId}, page:1, note:''}]});
    }};
  assert.equal((await analyseCalendarPdf(options)).proposals[0].event.typeId, type.id);
  typeId = randomUUID(); await assert.rejects(analyseCalendarPdf(options), error => error.code === 'ai_output');
}));
