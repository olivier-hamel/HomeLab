import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CalendarDocumentStore, MAX_PDF_BYTES} from '../src/lib/calendar/documents.ts';
import {CalendarEventStore} from '../src/lib/calendar/store.ts';
import {createCalendarApi} from '../src/lib/calendar/api.ts';
import {MediaError} from '../src/lib/media/core.ts';

const origin='https://homelab.test';
const pdf=Buffer.from('%PDF-1.4\nfixture\n%%EOF');
const draft={title:'Examen',description:'Salle 204',date:'2026-10-20',endDate:'2026-10-20',startTime:'09:00',endTime:'11:00',allDay:false,recurrence:null};
function collectionFixture() {
 const rows=[];
 const matches=(row,filter)=>Object.entries(filter).every(([key,value])=>row[key]===value);
 return {rows,collection:{
  find:filter=>({sort:()=>({toArray:async()=>rows.filter(row=>matches(row,filter)).map(row=>({...row}))})}),
  findOne:async filter=>rows.find(row=>matches(row,filter))||null,
  insertOne:async row=>{if(rows.some(previous=>previous.username===row.username&&(previous.id===row.id||previous.hash===row.hash))) throw Object.assign(new Error('duplicate'),{code:11000});rows.push({...row});},
  updateOne:async(filter,update)=>{if(!rows.some(row=>matches(row,filter)))rows.push({...update.$setOnInsert});},
  findOneAndUpdate:async(filter,update)=>{const row=rows.find(row=>matches(row,filter));if(!row)return null;Object.assign(row,update.$set);return {...row};},
  deleteOne:async filter=>{const i=rows.findIndex(row=>matches(row,filter));if(i<0)return{deletedCount:0};rows.splice(i,1);return{deletedCount:1};},
 }};
}
function fixture(fetcher=async()=>{throw new Error('unexpected provider request');}) {
 const df=collectionFixture(),ef=collectionFixture();
 const documents=new CalendarDocumentStore(async()=>df.collection),events=new CalendarEventStore(async()=>ef.collection);
 const authenticate=async request=>{const username=request.headers.get('x-test-account');if(!username)throw new MediaError('account_session','Connexion requise',401);return{user:{username},accounts:[]};};
 const api=createCalendarApi(fetcher,events,authenticate,documents);
 const call=(path='',method='GET',body,username='oli',headers={})=>api(new Request(`${origin}/api/calendar/documents${path}`,{method,headers:{Origin:origin,'X-Test-Account':username,...(body!==undefined?{'X-Calendar-Request':'1','Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})}));
 const upload=(bytes=pdf,name='Horaire été.pdf',username='oli',id=randomUUID())=>call('','POST',bytes,username,{'Content-Type':'application/pdf','X-Document-Name':encodeURIComponent(name),'X-Document-Id':id});
 return {df,ef,documents,events,api,call,upload};
}
const provider=events=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({summary:'Horaire de cours',events})}]}}]});
const withKey=async work=>{const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='document-test-canary';try{await work();}finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}};

test('PDFs persist, deduplicate by account, hide storage fields, and serve authenticated originals',async()=>{
 const f=fixture();
 const first=await f.upload();assert.equal(first.status,201);
 const {document}=await first.json();assert.equal(document.analysisState,'pending');assert.equal(f.df.rows.length,1);
 const repeated=await f.upload();assert.equal(repeated.status,200);assert.equal((await repeated.json()).document.id,document.id);assert.equal(f.df.rows.length,1);
 assert.equal((await f.upload(pdf,'Même contenu.pdf','max')).status,201);
 const listing=await(await f.call()).json();assert.equal(listing.documents.length,1);for(const field of ['pdf','hash','username','analysisToken'])assert.equal(listing.documents[0][field],undefined);
 const content=await f.call(`/${document.id}/file`);assert.equal(content.status,200);assert.equal(content.headers.get('content-type'),'application/pdf');assert.match(content.headers.get('content-disposition'),/filename\*=UTF-8/);assert.deepEqual(Buffer.from(await content.arrayBuffer()),pdf);
 assert.equal((await f.call(`/${document.id}/file`,'GET',undefined,'max')).status,404);
 assert.equal((await f.call(`/${document.id}`,'GET',undefined,'max')).status,404);
 assert.equal((await f.call(`/${document.id}/file`,'GET',undefined,'')).status,401);
});
test('upload rejects cross-origin changes, spoofed file types, invalid names and oversized streams',async()=>{
 const f=fixture();
 assert.equal((await f.call('','POST',pdf,'oli',{'Content-Type':'application/pdf',Origin:'https://evil.test'})).status,403);
 assert.equal((await f.upload(Buffer.from('<html>invalid</html>'))).status,400);
 assert.equal((await f.upload(pdf,'../../evil.pdf')).status,400);
 assert.equal((await f.upload(pdf,'file\n.pdf')).status,400);
 assert.equal((await f.upload(pdf,'file.txt')).status,400);
 const large=Buffer.alloc(MAX_PDF_BYTES+1);pdf.copy(large);assert.equal((await f.upload(large)).status,413);
 assert.equal((await f.call('','POST',{event:draft})).status,403);assert.equal(f.df.rows.length,0);
});
test('Gemini receives the PDF, keeps multiple proposals without adding them, and successful analysis is reusable',async()=>withKey(async()=>{
 let calls=0;
 const f=fixture(async(url,init)=>{
  calls++;assert(!String(url).includes('document-test-canary'));assert(!init.body.includes('document-test-canary'));const body=JSON.parse(init.body);
  const parts=body.contents[0].parts;assert.deepEqual(Buffer.from(parts[1].inlineData.data,'base64'),pdf);assert.equal(parts[1].inlineData.mimeType,'application/pdf');
  // The bounded nested array was rejected by the live provider with HTTP 400.
  assert.equal(body.generationConfig.responseJsonSchema.properties.events.maxItems,undefined);
  assert.equal(JSON.parse(parts[0].text).username,undefined);assert.match(body.systemInstruction.parts[0].text,/untrusted/);
  return provider([{event:draft,page:2,note:''},{event:{...draft,title:'Remise du travail',allDay:true,startTime:null,endTime:null},page:3,note:'Vérifier la date'}]);
 });
 const {document}=await(await f.upload()).json();
 const response=await f.call(`/${document.id}/analyze`,'POST',{});assert.equal(response.status,200);
 const analyzed=(await response.json()).document;assert.equal(analyzed.proposals.length,2);assert.equal(analyzed.analysisState,'ready');assert.equal(f.ef.rows.length,0);
 assert(analyzed.updatedAt>document.updatedAt);assert.equal((await f.call(`/${document.id}/analyze`,'POST',{})).status,200);assert.equal(calls,1);
 assert.equal((await f.call(`/${document.id}`,'DELETE',{updatedAt:document.updatedAt})).status,409);
}));
test('selected edits create idempotent events with immutable document links; PDF deletion preserves events',async()=>withKey(async()=>{
 const f=fixture(async()=>provider([{event:draft,page:2,note:''},{event:{...draft,title:'Atelier'},page:4,note:''}]));
 const uploaded=(await(await f.upload()).json()).document;
 const document=(await(await f.call(`/${uploaded.id}/analyze`,'POST',{})).json()).document;
 const first=document.proposals[0],second=document.proposals[1];
 // Invalid second entry must not leave a first event behind.
 assert.equal((await f.call(`/${document.id}/events`,'POST',{events:[{proposalId:first.id,event:draft},{proposalId:second.id,event:{...draft,date:'bad'}}]})).status,400);assert.equal(f.ef.rows.length,0);
 assert.equal((await f.call(`/${document.id}/events`,'POST',{events:[{proposalId:randomUUID(),event:draft}]})).status,400);
 assert.equal((await f.call(`/${document.id}/events`,'POST',{events:[{proposalId:first.id,event:draft}]} ,'max')).status,404);
 const selection={events:[{proposalId:first.id,event:{...draft,title:'Examen corrigé',source:{documentId:'forged'}}}]};
 const result=(await(await f.call(`/${document.id}/events`,'POST',selection)).json()).events[0];
 assert.equal(result.title,'Examen corrigé');assert.deepEqual(result.source,{documentId:document.id,documentName:document.name,proposalId:first.id,page:2});assert.equal(f.ef.rows.length,1);
 await f.call(`/${document.id}/events`,'POST',selection);assert.equal(f.ef.rows.length,1);
 const edited=await f.events.update('oli',result.id,{...draft,title:'Modifié'},result.updatedAt);assert.deepEqual(edited.source,result.source);
 assert.equal((await f.call(`/${document.id}`,'DELETE',{updatedAt:document.updatedAt})).status,200);assert.equal(f.df.rows.length,0);assert.equal((await f.events.list('oli')).length,1);assert.deepEqual((await f.events.list('oli'))[0].source,result.source);
 assert.equal((await f.call(`/${document.id}/file`)).status,404);
}));
test('analysis failure, malformed output and missing key retain PDFs for retry',async()=>withKey(async()=>{
 for(const answer of [new Response('private-error-with-credentials',{status:500}),provider([{event:{...draft,date:'bad'},page:1,note:''}]),Response.json({candidates:[{finishReason:'MAX_TOKENS'}]})]){
  const f=fixture(async()=>answer);const {document}=await(await f.upload()).json();const result=await f.call(`/${document.id}/analyze`,'POST',{});
  assert.equal(result.status,502);assert(!(await result.text()).includes('private-error'));assert.equal(f.df.rows.length,1);assert.equal((await f.documents.get('oli',document.id)).analysisState,'error');assert.equal(f.ef.rows.length,0);
 }
 const f=fixture();const {document}=await(await f.upload()).json();delete process.env.GEMINI_API_KEY;
 assert.equal((await f.call(`/${document.id}/analyze`,'POST',{})).status,503);assert.equal(f.df.rows.length,1);assert.equal((await f.documents.get('oli',document.id)).analysisState,'pending');
}));
test('analysis leases prevent simultaneous extraction and recover an interrupted request',async()=>{
 const f=fixture();const {document}=await(await f.upload()).json();const first=await f.documents.claimAnalysis('oli',document.id);
 await assert.rejects(f.documents.claimAnalysis('oli',document.id),error=>error.status===409);
 f.df.rows[0].analysisStartedAt=new Date(Date.now()-121000).toISOString();const next=await f.documents.claimAnalysis('oli',document.id);assert.notEqual(next.token,first.token);
 await assert.rejects(f.documents.finishAnalysis('oli',document.id,first.token,{analysisState:'ready'}),error=>error.status===404);
 await f.documents.finishAnalysis('oli',document.id,next.token,{analysisState:'ready',summary:'Aucun événement',proposals:[]});assert.equal((await f.documents.get('oli',document.id)).analysisState,'ready');
});
test('retrying a partially written selection creates the missing events without duplicating saved entries',async()=>withKey(async()=>{
 const f=fixture(async()=>provider([{event:draft,page:1,note:''},{event:{...draft,title:'Atelier'},page:1,note:''}]));
 const uploaded=(await(await f.upload(pdf,'Horaire.pdf','partial')).json()).document;
 const document=(await(await f.call(`/${uploaded.id}/analyze`,'POST',{},'partial')).json()).document;
 const body={events:document.proposals.map(proposal=>({proposalId:proposal.id,event:proposal.event}))};
 const create=f.events.create.bind(f.events);let writes=0;
 f.events.create=async(...args)=>{if(++writes===2)throw new Error('temporary database failure');return create(...args);};
 assert.equal((await f.call(`/${document.id}/events`,'POST',body,'partial')).status,503);assert.equal(f.ef.rows.length,1);
 const retry=await f.call(`/${document.id}/events`,'POST',body,'partial');assert.equal(retry.status,201);assert.equal((await retry.json()).events.length,2);assert.equal(f.ef.rows.length,2);
 assert(f.ef.rows.every(row=>row.source.documentId===document.id));
}));
test('an aborted provider request marks the analysis retryable while preserving the PDF',async()=>withKey(async()=>{
 const f=fixture(async(_url,init)=>{init.signal.throwIfAborted();throw new Error('unexpected live provider request');});
 const {document}=await(await f.upload(pdf,'Horaire.pdf','cancel')).json();
 const controller=new AbortController();controller.abort();
 const request=new Request(`${origin}/api/calendar/documents/${document.id}/analyze`,{method:'POST',signal:controller.signal,headers:{Origin:origin,'X-Test-Account':'cancel','X-Calendar-Request':'1','Content-Type':'application/json'},body:'{}'});
 const response=await f.api(request);assert.equal(response.status,499);assert.equal(f.df.rows.length,1);assert.equal((await f.documents.get('cancel',document.id)).analysisState,'error');assert.equal(f.ef.rows.length,0);
}));
test('the server still rejects more than 100 proposals with an unbounded provider schema',async()=>withKey(async()=>{
 const f=fixture(async()=>provider(Array.from({length:101},()=>({event:draft,page:1,note:''}))));
 const {document}=await(await f.upload(pdf,'Horaire.pdf','schema_limit')).json();
 const response=await f.call(`/${document.id}/analyze`,'POST',{},'schema_limit');assert.equal(response.status,502);assert.equal(f.ef.rows.length,0);assert.equal((await f.documents.get('schema_limit',document.id)).analysisState,'error');
}));
