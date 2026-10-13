import {eventTypeFixture} from "./helpers/calendar-types.mjs";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { LibraryStore } from '../src/lib/library/store.ts';
import { TempoScans, proposalId } from '../src/lib/library/scans.ts';
import { mergeManifest } from '../src/lib/library/sync.ts';
import { importTempoArchive } from '../src/lib/library/imports.ts';
import { analyseCalendarPdf } from '../src/lib/calendar/pdf-analysis.ts';
import { validateAnalysis } from '../src/lib/calendar/documents.ts';
import { eventsOnDate, eventsInRange } from '../../apps/calendar/dist/js/events.js';
import { MediaError } from '../src/lib/media/core.ts';

process.env.GEMINI_API_KEY='scan-test-key';process.env.MOODLE_ALLOWED_USERS='oli';
const pdf=new Uint8Array(Buffer.from('%PDF-1.7\nscan test'));
const event={title:'Examen final',description:'Salle 204',date:'2026-12-10',endDate:'2026-12-10',allDay:false,startTime:'09:00',endTime:'11:00',recurrence:null,typeId:"none"};
const course={...event,title:'Cours du lundi',description:'',date:'2026-08-03',endDate:'2026-08-03',startTime:'13:30',endTime:'14:30',recurrence:{frequency:'weekly',interval:1,weekdays:[1],until:'2026-12-14',count:null}};
const provider=event=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({summary:'Cours du 1er août au 14 décembre 2026, chaque lundi à 13 h 30.',events:[{event,page:1,note:'Durée supposée : une heure.'}]})}]}}]});
function fixture(analyse=async()=>({summary:'Un examen repéré.',proposals:[{id:randomUUID(),event,page:1,note:''}]}), types=eventTypeFixture().types){
 const libraries=new Map(),blobs=new Map();
 const rows={async findOne({username}){return structuredClone(libraries.get(username)||null);},async insertOne(data){if(libraries.has(data.username))throw Object.assign(new Error('duplicate'),{code:11000});libraries.set(data.username,structuredClone(data));},async updateOne({username,version},{$set}){if(libraries.get(username)?.version!==version)return{modifiedCount:0};libraries.set(username,structuredClone({username,...$set}));return{modifiedCount:1};}};
 const bytes={async put(value){const id=randomUUID();blobs.set(id,new Uint8Array(value));return id;},async get(id){return blobs.get(id);},async remove(id){blobs.delete(id);}};
 const store=new LibraryStore(async()=>rows,bytes);let analyses=0;
 const scans=new TempoScans(store,async input=>{analyses++;return analyse(input);},undefined,types);
 return{store,scans,types,analyses:()=>analyses};
}
test('scans receive account types, persist classification, and accept old proposals after their type is deleted',async()=>{
 const {types}=eventTypeFixture(),type=await types.create('oli',randomUUID(),{name:'Examen',importance:5});
 const f=fixture(async input=>{
  assert.deepEqual(input.eventTypes,await types.list('oli'));
  return{summary:'Un examen.',proposals:[{id:randomUUID(),event:{...event,typeId:type.id},page:1,note:''}]};
 },types);
 await f.store.upload('oli','typed','examen.pdf',null,pdf);await f.scans.kick('oli');await f.scans.wait();
 const file=await f.store.get('oli','typed'),proposal=file.tempoScan.proposals[0];assert.equal(proposal.event.typeId,type.id);
 const saved=[],events={async create(_username,input,id){const row={...input,id};saved.push(row);return row;}};
 await assert.rejects(f.scans.decide('oli',file.id,file.tempoScan.id,[{proposalId:proposal.id,event:{...proposal.event,typeId:randomUUID()}}],[],events),error=>error.code==='event_type');assert.equal(saved.length,0);
 await types.remove('oli',type.id);
 await f.scans.decide('oli',file.id,file.tempoScan.id,[{proposalId:proposal.id,event:proposal.event}],[],events);
 assert.equal(saved.length,1);assert.equal(saved[0].typeId,'none');assert.equal(saved[0].title,event.title);
});
test('a scanned semester schedule saves one series and appears only on Mondays at 13:30',async()=>{
 const f=fixture(input=>analyseCalendarPdf({...input,fetcher:async(_url,init)=>{
  const body=JSON.parse(init.body),instruction=body.systemInstruction.parts[0].text;
  assert.match(instruction,/date\/endDate describe only the FIRST occurrence/);
  assert.match(instruction,/Mondays at 13:30/);
  const schema=body.generationConfig.responseJsonSchema.properties.events.items.properties.event;
  assert.match(schema.properties.endDate.description,/first occurrence/i);
  return provider(course);
 }}));
 await f.store.upload('oli','semester','horaire.pdf',null,pdf);await f.scans.kick('oli');await f.scans.wait();
 const file=await f.store.get('oli','semester'),scan=file.tempoScan;
 assert.equal(scan.state,'ready');assert.equal(scan.proposals.length,1);assert.deepEqual(scan.proposals[0].event,course);
 const saved=new Map(),events={async create(_username,input,id,source){saved.set(id,{...input,id,source});return saved.get(id);}};
 await f.scans.decide('oli',file.id,scan.id,[{proposalId:scan.proposals[0].id,event:scan.proposals[0].event}],[],events);
 assert.equal(saved.size,1);const series=[...saved.values()];
 for(let date=new Date('2026-08-01T12:00:00Z');date<=new Date('2026-12-20T12:00:00Z');date.setUTCDate(date.getUTCDate()+1)){
  const key=date.toISOString().slice(0,10),rows=eventsOnDate(series,key);
  const expected=date.getUTCDay()===1&&key>=course.date&&key<=course.recurrence.until;
  assert.equal(rows.length,Number(expected),key);
  if(expected){assert.equal(rows[0].date,rows[0].endDate);assert.equal(rows[0].startTime,'13:30');assert.equal(rows[0].endTime,'14:30');}
 }
 assert.equal(eventsInRange(series,'2026-08-01','2026-12-31').length,20);
});
test('a scan cannot use the semester ending as the duration of each weekly session',async()=>{
 let answer={...course,endDate:course.recurrence.until};
 const f=fixture(input=>analyseCalendarPdf({...input,fetcher:async()=>provider(answer)}));
 await f.store.upload('oli','semester','horaire.pdf',null,pdf);await f.scans.kick('oli');await f.scans.wait();
 const failed=await f.store.get('oli','semester');assert.equal(failed.tempoScan.state,'error');assert.equal(failed.tempoScan.proposals.length,0);assert(failed.blobId);
 assert.match(failed.tempoScan.error,/fin d’une séance.*fin de sa répétition/);
 answer=course;await f.scans.request('oli','semester');await f.scans.wait();
 const recovered=await f.store.get('oli','semester');assert.equal(recovered.tempoScan.state,'ready');assert.deepEqual(recovered.tempoScan.proposals[0].event,course);assert.equal(recovered.blobId,failed.blobId);
});
test('PDF extraction preserves overnight, multi-day and all-day durations apart from the series ending',()=>{
 const events=[{...course,startTime:'23:30',endTime:'01:00',endDate:'2026-08-04'},
  {...course,allDay:true,startTime:null,endTime:null,endDate:'2026-08-05'},
  {...course,endDate:'2026-08-05',recurrence:{...course.recurrence,until:'2026-08-05'}},
  {...course,recurrence:null,endDate:'2026-12-14'}];
 const analysis=validateAnalysis({summary:'Durées explicites',events:events.map(event=>({event,page:1,note:''}))});
 assert.deepEqual(analysis.proposals.map(proposal=>proposal.event),events);
});
test('new manual and Moodle documents queue scans; existing documents and imported archives are never scanned automatically',async()=>{
 const f=fixture();await f.store.upload('oli','old','ancien.pdf',null,pdf,true);await f.store.upload('oli','new','nouveau.pdf',null,pdf);
 await f.scans.kick('oli');await f.scans.wait();assert.equal(f.analyses(),1);assert.equal((await f.store.get('oli','old')).tempoScan,undefined);assert.equal((await f.store.get('oli','new')).tempoScan.state,'ready');
 const course={id:42,shortname:'TEST (20263)',fullname:'TEST - Cours'};const remote={id:'7:0',filename:'moodle.pdf',mimetype:'application/pdf',filesize:pdf.length,section:'Cours',module:'Plan'};
 await f.store.mutate('oli',library=>mergeManifest(library,[{course,files:[remote]}],new Date().toISOString()));
 const moodle=(await f.store.snapshot('oli')).files.find(file=>file.source);assert.equal(moodle.tempoScan.state,'queued');
 await f.scans.kick('oli');await f.scans.wait();assert.equal(f.analyses(),1,'no scan before original download');
 await f.store.mutate('oli',library=>{library.files.find(file=>file.id===moodle.id).blobId='downloaded';});await f.scans.kick('oli');await f.scans.wait();assert.equal(f.analyses(),2);
 await f.scans.kick('oli');await f.scans.wait();assert.equal(f.analyses(),2,'completed jobs do not rescan on polling');
 await f.scans.request('oli','old');await f.scans.wait();assert.equal(f.analyses(),3,'manual scan explicitly includes an existing document');
});
test('proposals remain persistent until an explicit decision; rescans preserve decisions and additions retry without duplicates',async()=>{
 const f=fixture();await f.store.upload('oli','new','cours.pdf',null,pdf);await f.scans.kick('oli');await f.scans.wait();
 let scan=(await f.store.get('oli','new')).tempoScan;const id=scan.proposals[0].id;assert.equal((await f.scans.notifications('oli')).documents.length,1);
 const saved=new Map();let writes=0;const events={async create(username,input,eventId,source){writes++;if(!saved.has(eventId))saved.set(eventId,{...input,id:eventId,source});return saved.get(eventId);}};
 const body=[{proposalId:id,event}];await f.scans.decide('oli','new',scan.id,body,[],events);await f.scans.decide('oli','new',scan.id,body,[],events);assert.equal(saved.size,1);assert.equal(writes,2);assert.equal((await f.scans.notifications('oli')).documents.length,0);assert.equal([...saved.values()][0].source.origin,'library');
 await f.scans.request('oli','new');await f.scans.wait();scan=(await f.store.get('oli','new')).tempoScan;assert.equal(scan.proposals[0].id,id);assert.equal(scan.proposals[0].decision,'added');assert.equal((await f.scans.notifications('oli')).documents.length,0);
 await f.store.upload('oli','decline','cours2.pdf',null,pdf);await f.scans.kick('oli');await f.scans.wait();scan=(await f.store.get('oli','decline')).tempoScan;
 await f.scans.decide('oli','decline',scan.id,[],[scan.proposals[0].id],events);assert.equal(saved.size,1);await f.scans.request('oli','decline');await f.scans.wait();assert.equal((await f.store.get('oli','decline')).tempoScan.proposals[0].decision,'ignored');
 assert.equal(proposalId('new',{...event,title:'Examen FINAL!'}),id);
});
test('interrupted scans recover after lease expiry, errors retain the original, and stale/foreign proposals cannot add events',async()=>{
 const f=fixture();await f.store.upload('oli','new','cours.pdf',null,pdf);
 await f.store.mutate('oli',library=>Object.assign(library.files[0].tempoScan,{state:'scanning',leaseUntil:'2000-01-01T00:00:00Z'}));await f.scans.kick('oli');await f.scans.wait();
 const file=await f.store.get('oli','new');let writes=0;const events={async create(){writes++;}};
 await assert.rejects(()=>f.scans.decide('oli','new','stale',[{proposalId:file.tempoScan.proposals[0].id,event}],[],events));
 await assert.rejects(()=>f.scans.decide('max','new',file.tempoScan.id,[],[],events));
 await assert.rejects(()=>f.scans.decide('oli','new',file.tempoScan.id,[{proposalId:randomUUID(),event}],[],events));assert.equal(writes,0);
 await f.store.mutate('oli',library=>{library.files[0].source={courseId:42,fileId:'7:0',module:'',fingerprint:'',checkedAt:'',available:true};});process.env.MOODLE_ALLOWED_USERS='';
 try{assert.equal((await f.scans.notifications('oli')).documents.length,0);await assert.rejects(()=>f.scans.request('oli','new'),/accès/);}finally{process.env.MOODLE_ALLOWED_USERS='oli';}
 const errors=new TempoScans(f.store,async()=>{throw new MediaError('ai_output','Analyse invalide.',502);},undefined,eventTypeFixture().types);await errors.request('oli','new');await errors.wait();assert.equal((await f.store.get('oli','new')).tempoScan.state,'error');assert.equal((await f.store.get('oli','new')).blobId,file.blobId);
});
test('Tempo archives migrate folders, originals and already-reviewed proposals without scanning',async()=>{
 const f=fixture(),id=randomUUID(),folder=randomUUID(),proposal=randomUUID();
 const archive={async library(){return{folders:[{id:folder,name:'Cours',parentId:null}],documents:[{id,name:'archives.pdf',folderId:folder,analysisState:'ready',updatedAt:'2026-01-01T00:00:00Z',summary:'Ancien scan',proposals:[{id:proposal,event,page:1,note:''}]}]};},async stored(){return{pdf:{value:()=>pdf}};}};
 await importTempoArchive('oli',[{source:{documentId:id,proposalId:proposal}}],archive,f.store);await f.scans.kick('oli');await f.scans.wait();assert.equal(f.analyses(),0);assert.equal((await f.store.get('oli',id)).tempoScan.proposals[0].decision,'added');await importTempoArchive('oli',[],archive,f.store);assert.equal((await f.store.snapshot('oli')).files.length,1);
 await f.scans.request('oli',id);await f.scans.wait();assert.equal((await f.store.get('oli',id)).tempoScan.proposals[0].decision,'added','a rescan preserves reviewed legacy decisions');
 await f.store.removeFile('oli',id);await importTempoArchive('oli',[],archive,f.store);assert.equal((await f.store.snapshot('oli')).files.length,0,'a removed archive is not imported again');
});
test('PowerPoint scans use a cached PDF while retaining exact original bytes',async()=>{
 const f=fixture(),ppt=new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
 await f.store.upload('oli','slides','Cours.ppt',null,ppt,true);let conversions=0,analyses=0;
 const scans=new TempoScans(f.store,async input=>{analyses++;assert.equal(input.name,'Cours.pdf');assert.deepEqual(input.pdf,pdf);return{summary:'Aucune date explicite.',proposals:[]};},async(name,bytes)=>{conversions++;assert.equal(name,'Cours.ppt');assert.deepEqual(bytes,ppt);return pdf;},eventTypeFixture().types);
 await scans.request('oli','slides');await scans.wait();await scans.request('oli','slides');await scans.wait();
 const file=await f.store.get('oli','slides');assert.equal(conversions,1);assert.equal(analyses,2);assert.deepEqual(await f.store.blobs.get(file.blobId),ppt);assert(file.previewId);assert.equal(file.tempoScan.state,'ready');assert.equal((await scans.notifications('oli')).documents.length,0);
});
