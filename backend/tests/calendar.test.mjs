import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CalendarEventStore} from '../src/lib/calendar/store.ts';
import {createCalendarApi} from '../src/lib/calendar/api.ts';
import {validateEvent} from '../src/lib/calendar/events.ts';
import {MediaError} from '../src/lib/media/core.ts';

const draft = {title:'Dentiste', description:'Apporter les documents', date:'2026-10-13', endDate:'2026-10-13', startTime:'14:00', endTime:'14:45', allDay:false, recurrence:null};
function collectionFixture() {
  const rows = [];
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
  return {rows, collection: {
    find: filter => ({sort: () => ({toArray: async () => rows.filter(row => match(row, filter)).map(row => ({...row}))})}),
    findOne: async filter => rows.find(row => match(row, filter)) || null,
    updateOne: async (filter, update) => {if (!rows.some(row => match(row, filter))) rows.push({...update.$setOnInsert});},
    findOneAndUpdate: async (filter, update) => {const row = rows.find(row => match(row, filter)); if (!row) return null; Object.assign(row, update.$set); return {...row};},
    deleteOne: async filter => {const i = rows.findIndex(row => match(row, filter)); if (i < 0) return {deletedCount:0}; rows.splice(i,1); return {deletedCount:1};},
  }};
}
const origin = 'https://homelab.test';
function request(path='events', method='GET', body, headers={}) {
  return new Request(`${origin}/api/calendar/${path}`, {method, headers:{Origin:origin, ...(body ? {'Content-Type':'application/json','X-Calendar-Request':'1'} : {}), ...headers}, ...(body ? {body:JSON.stringify(body)} : {})});
}
function fixture(fetcher=async () => {throw new Error('unexpected provider request');}) {
  const f = collectionFixture();
  const store = new CalendarEventStore(async () => f.collection);
  const authenticate = async req => {
    const username = req.headers.get('X-Test-Account');
    if (!username) throw new MediaError('account_session','Connexion requise',401);
    return {user:{username,display_name:username,must_change_password:false},accounts:[]};
  };
  const api = createCalendarApi(fetcher,store,authenticate);
  return {...f,store,api,call:(path,method,body,username='oli') => api(request(path,method,body,{'X-Test-Account':username}))};
}

test('events are isolated by account, retries are idempotent and simultaneous editors cannot overwrite each other', async () => {
  const {store,rows} = fixture();
  const id = randomUUID();
  const event = await store.create('oli',draft,id);
  assert.equal((await store.create('oli',draft,id)).id,event.id);
  assert.equal(rows.length,1);
  assert.deepEqual(await store.list('max'),[]);
  assert.equal((await store.list('oli'))[0].username,undefined);
  await assert.rejects(store.update('max',id,draft,event.updatedAt),e => e.status===404);
  await store.remove('max',id,event.updatedAt);
  assert.equal(rows.length,1);
  const edits = await Promise.allSettled([
    store.update('oli',id,{...draft,title:'Premier changement'},event.updatedAt),
    store.update('oli',id,{...draft,title:'Deuxième changement'},event.updatedAt),
  ]);
  assert.equal(edits.filter(edit => edit.status==='fulfilled').length,1);
  assert.equal(edits.find(edit => edit.status==='rejected').reason.status,409);
  await assert.rejects(store.remove('oli',id,event.updatedAt),e => e.status===409);
  const latest = (await store.list('oli'))[0];
  await store.remove('oli',id,latest.updatedAt);
  assert.deepEqual(await store.list('oli'),[]);
});

test('API validates writes, rejects cross-origin requests and uses the session owner', async () => {
  const f = fixture();
  assert.equal((await f.api(request())).status,401);
  assert.equal((await f.api(request('events','GET',null,{Origin:'https://evil.test','X-Test-Account':'oli'}))).status,403);
  const missingHeader = request('events','POST',{event:draft,requestId:randomUUID()},{'X-Test-Account':'oli'});
  missingHeader.headers.delete('X-Calendar-Request');
  assert.equal((await f.api(missingHeader)).status,403);
  const invalid = await f.call('events','POST',{event:{...draft,date:'2026-02-30'},requestId:randomUUID()});
  assert.equal(invalid.status,400);
  const response = await f.call('events','POST',{event:{...draft,username:'max'},requestId:randomUUID()});
  assert.equal(response.status,201);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const {event} = await response.json();
  assert.equal(f.rows[0].username,'oli');
  assert.deepEqual((await (await f.call('events','GET',null,'max')).json()).events,[]);
  const edited = await f.call(`events/${event.id}`,'PATCH',{event:{...draft,title:'Nouveau titre'},updatedAt:event.updatedAt});
  assert.equal(edited.status,200);
  const latest = (await edited.json()).event;
  assert.equal((await f.call(`events/${event.id}`,'DELETE',{updatedAt:latest.updatedAt})).status,200);
  assert.equal(f.rows.length,0);
});

test('validation handles leap days, overnight events, invalid times and all-day dates', () => {
  assert.equal(validateEvent({...draft,date:'2028-02-29',endDate:'2028-02-29'}).date,'2028-02-29');
  assert.equal(validateEvent({...draft,startTime:'23:30',endTime:'01:00',endDate:'2026-10-14'}).endDate,'2026-10-14');
  assert.equal(validateEvent({...draft,allDay:true,startTime:null,endTime:null}).allDay,true);
  for (const patch of [{date:'2026-02-29'},{startTime:'24:00'},{endTime:'13:00'},{allDay:true},{title:'   '},{endDate:'2026-10-12'},{description:'x'.repeat(4001)}]) assert.throws(() => validateEvent({...draft,...patch}),e => e.status===400);
});

test('Gemini produces the exact event contract without saving, and receives no account or credentials in its prompt', async () => {
  const previous = process.env.GEMINI_API_KEY;
  const secret = 'calendar-test-secret-canary'; process.env.GEMINI_API_KEY=secret;
  const calls=[];
  const f = fixture(async (url,init) => {
    calls.push(JSON.parse(init.body));
    assert.equal(new Headers(init.headers).get('x-goog-api-key'),secret);
    assert(!String(url).includes(secret)); assert(!init.body.includes(secret));
    const input=JSON.parse(calls[0].contents[0].parts[0].text);
    assert.equal(input.selectedDate,'2030-01-02');
    assert.equal(input.timezone,'America/Toronto');
    assert.match(input.currentDate,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(input.username,undefined);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({event:draft,clarification:null})}]}}]});
  });
  try {
    const result=await f.call('interpret','POST',{text:'Dentiste demain à 14 h pour 45 min',selectedDate:'2030-01-02'});
    assert.equal(result.status,200);
    const body=await result.json(); assert.deepEqual(body.event,draft); assert.equal(f.rows.length,0);
    assert.equal(calls[0].generationConfig.responseMimeType,'application/json');
    assert.equal((await f.call('events','POST',{event:body.event,requestId:randomUUID()})).status,201);
  } finally {if(previous===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=previous;}
});

test('AI failure and clarification keep the calendar unchanged and provider errors private', async () => {
  const previous=process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY='calendar-error-canary';
  try {
    for (const answer of [new Response('private-provider-error',{status:500}), Response.json({candidates:[{finishReason:'MAX_TOKENS'}]}), Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({event:{...draft,endTime:'01:00'},clarification:null})}]}}]})]) {
      const f=fixture(async () => answer);
      const response=await f.call('interpret','POST',{text:'Un événement',selectedDate:draft.date});
      assert.equal(response.status,502); const body=await response.text(); assert(!body.includes('private-provider-error')); assert(!body.includes('calendar-error-canary')); assert.equal(f.rows.length,0);
    }
    const f=fixture(async () => Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({event:null,clarification:'À quelle heure?'})}]}}]}));
    assert.deepEqual(await (await f.call('interpret','POST',{text:'Un rendez-vous',selectedDate:draft.date})).json(),{event:null,clarification:'À quelle heure?'});
    delete process.env.GEMINI_API_KEY;
    assert.equal((await f.call('interpret','POST',{text:'Dentiste',selectedDate:draft.date})).status,503);
    assert.equal((await f.call('events','POST',{event:draft,requestId:randomUUID()})).status,201);
  } finally {if(previous===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=previous;}
});

const weekly = {frequency:'weekly',interval:2,weekdays:[2,0],until:null,count:null};
test('recurrence validation accepts bounded series and preserves legacy events', () => {
  const legacy={...draft}; delete legacy.recurrence;
  assert.equal(validateEvent(legacy).recurrence,null);
  assert.deepEqual(validateEvent({...draft,recurrence:weekly}).recurrence,{...weekly,weekdays:[0,2]});
  for (const frequency of ['daily','monthly','yearly']) assert.equal(validateEvent({...draft,recurrence:{...weekly,frequency,weekdays:[],count:5}}).recurrence.count,5);
  assert.equal(validateEvent({...draft,recurrence:{...weekly,until:draft.date}}).recurrence.until,draft.date);
  for (const patch of [{frequency:'fortnightly'},{interval:0},{interval:100},{interval:1.5},{weekdays:[]},{weekdays:[1]},{weekdays:[2,2]},{weekdays:[2,7]},{weekdays:['2']},{until:'2026-10-12'},{until:'2026-02-30'},{count:0},{count:1001},{count:1.5},{count:5,until:'2026-11-01'},{frequency:'daily'}]) {
    assert.throws(()=>validateEvent({...draft,recurrence:{...weekly,...patch}}),error=>error.status===400);
  }
});

test('API stores one series, edits its recurrence, removes it and rejects invalid rules', async () => {
  const f=fixture();
  const response=await f.call('events','POST',{event:{...draft,recurrence:weekly},requestId:randomUUID()});
  assert.equal(response.status,201);
  const {event}=await response.json();
  assert.equal(f.rows.length,1);
  assert.deepEqual((await (await f.call('events','GET')).json()).events[0].recurrence,event.recurrence);
  assert.deepEqual((await (await f.call('events','GET',null,'max')).json()).events,[]);
  const invalid=await f.call(`events/${event.id}`,'PATCH',{event:{...draft,recurrence:{...weekly,interval:-1}},updatedAt:event.updatedAt});
  assert.equal(invalid.status,400); assert.equal(f.rows[0].recurrence.interval,2);
  const updated=await f.call(`events/${event.id}`,'PATCH',{event:{...draft,recurrence:{...weekly,interval:1,count:10}},updatedAt:event.updatedAt});
  assert.equal(updated.status,200);
  const latest=(await updated.json()).event;
  assert.equal(latest.recurrence.interval,1); assert.equal(latest.recurrence.count,10);
  const single=await f.call(`events/${event.id}`,'PATCH',{event:draft,updatedAt:latest.updatedAt});
  assert.equal((await single.clone().json()).event.recurrence,null);
  await f.call(`events/${event.id}`,'DELETE',{updatedAt:(await single.json()).event.updatedAt});
  assert.equal(f.rows.length,0);
});

test('Gemini can draft biweekly Sundays, including a validated ending, without saving', async () => {
  const previous=process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY='recurrence-test-canary';
  const event={...draft,title:'Souper du dimanche',date:'2026-10-18',endDate:'2026-10-18',startTime:'19:00',endTime:'21:00',recurrence:{...weekly,weekdays:[0],count:6}};
  try {
    const f=fixture(async (url,init)=>{
      const prompt=JSON.parse(init.body);
      assert.match(prompt.systemInstruction.parts[0].text,/every other week = weekly, interval=2/);
      const schema=prompt.generationConfig.responseJsonSchema.properties.event.anyOf[0];
      assert(schema.required.includes('recurrence'));
      assert.deepEqual(schema.properties.recurrence.anyOf[1].properties.frequency.enum,['daily','weekly','monthly','yearly']);
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({event,clarification:null})}]}}]});
    });
    const response=await f.call('interpret','POST',{text:'Souper un dimanche sur deux à 19 h pendant 2 h, 6 fois',selectedDate:'2030-01-02'});
    assert.equal(response.status,200); assert.deepEqual((await response.json()).event,event); assert.equal(f.rows.length,0);
    const malformed=fixture(async ()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({event:{...event,recurrence:{...event.recurrence,interval:0}},clarification:null})}]}}]}));
    assert.equal((await malformed.call('interpret','POST',{text:'Chaque dimanche',selectedDate:draft.date})).status,502);
    assert.equal(malformed.rows.length,0);
  } finally {if(previous===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=previous;}
});
