import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { LibraryStore } from '../src/lib/library/store.ts';
import { MoodleSync } from '../src/lib/library/sync.ts';
import { createLibraryApi } from '../src/lib/library/api.ts';
import { downloadOriginal } from '../src/lib/moodle/client.ts';
import { emptyLibrary, fileKind, publicLibrary, semesterCourses, validateFile } from '../src/lib/library/model.ts';

const pdf = new Uint8Array(Buffer.from('%PDF-1.7\nTest original'));
Object.assign(process.env, { MOODLE_ALLOWED_USERS: 'oli', MOODLE_MCP_URL: 'http://127.0.0.1:18000/mcp' });
function fixture() {
  const libraries = new Map(), bytes = new Map();
  const rows = {
    async findOne({username}) { return structuredClone(libraries.get(username) ?? null); },
    async insertOne(value) { if (libraries.has(value.username)) throw Object.assign(new Error('duplicate'),{code:11000}); libraries.set(value.username,structuredClone(value)); },
    async updateOne({username,version},{$set}) { if(libraries.get(username)?.version !== version) return {modifiedCount:0}; libraries.set(username,structuredClone({username,...$set})); return {modifiedCount:1}; },
  };
  const blobs = { async put(value) {const id=randomUUID();bytes.set(id,new Uint8Array(value));return id;}, async get(id) {if(!bytes.has(id))throw new Error('missing');return bytes.get(id);},async remove(id){bytes.delete(id);} };
  return {store:new LibraryStore(async()=>rows,blobs),bytes};
}
const origin='https://library.test';
function request(path='',method='GET',body,extra={}) {
  return new Request(`${origin}/api/library${path}`,{method,headers:{Origin:origin,'X-Library-Request':'1',...(body instanceof Uint8Array?{}:{'Content-Type':'application/json'}),...extra},...(method==='GET'?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body??{})})});
}
const user = username => async () => ({ user:{username,display_name:username,must_change_password:false},accounts:[{username,display_name:username}] });

test('only A26 courses are selected, including Moodle term codes; originals are validated',()=>{
  const selected=semesterCourses([{id:1,shortname:'INF2705 (20263)',fullname:'Infographie'},{id:2,shortname:'INF2705 (20262)',fullname:'Été 2026'},{id:3,shortname:'old',fullname:'Automne 2025'},{id:4,shortname:'PHS1101',fullname:'PHS1101 (A2026)'},{id:5,shortname:'SSH3501 A26',fullname:'Éthique'}]);
  assert.deepEqual(selected.map(x=>x.id),[1,4,5]);
  assert.equal(fileKind('cours.PPT'),'powerpoint');assert.equal(fileKind('cours.docx'),null);
  assert.equal(validateFile('cours.PDF',pdf).kind,'pdf');
  assert.throws(()=>validateFile('cours.pdf',new Uint8Array([1,2,3])));
  assert.throws(()=>validateFile('../cours.pdf',pdf));
  assert.throws(()=>validateFile('cours.pptx',pdf));
});

test('nested folders are private, concurrent moves cannot form cycles, and only empty personal folders can be deleted',async()=>{
  const {store}=fixture();
  await store.createFolder('oli',{id:'a',name:'Cours',parentId:null});await store.createFolder('oli',{id:'b',name:'Projets',parentId:'a'});
  assert.equal((await store.snapshot('max')).folders.length,1);
  await assert.rejects(()=>store.createFolder('oli',{id:'x',name:'cours',parentId:null}),/déjà/);
  await assert.rejects(()=>store.createFolder('oli',{id:'x',name:'../secret',parentId:null}));
  await assert.rejects(()=>store.updateFolder('oli','a',{parentId:'b'}),/parents/);
  await assert.rejects(()=>store.removeFolder('oli','a'),/sous-dossiers/);
  await assert.rejects(()=>store.updateFolder('oli','moodle',{name:'Renommé'}),/synchronisation/);
  await store.createFolder('oli',{id:'c',name:'Personnel',parentId:null});
  const moved=await Promise.allSettled([store.updateFolder('oli','a',{parentId:'c'}),store.updateFolder('oli','c',{parentId:'a'})]);
  assert.equal(moved.filter(x=>x.status==='fulfilled').length,1);
  const library=await store.snapshot('oli');
  assert(!(library.folders.find(x=>x.id==='a').parentId==='c'&&library.folders.find(x=>x.id==='c').parentId==='a'));
  await store.removeFolder('oli','b');
});

test('uploads, retries, moves and deletion preserve exact bytes; API never exposes storage identifiers',async()=>{
  const {store,bytes}=fixture();
  await store.createFolder('oli',{id:'a',name:'Notes',parentId:null});
  const file=await store.upload('oli','f','notes.pdf','a',pdf);
  assert.deepEqual(await store.blobs.get(file.blobId),pdf);
  await store.upload('oli','f','notes.pdf','a',pdf);assert.equal(bytes.size,1);
  await store.updateFile('oli','f',{folderId:null,name:'nouveau.pdf'});assert.equal((await store.get('oli','f')).blobId,file.blobId);
  assert.equal(publicLibrary(await store.snapshot('oli'),true).files[0].ready,true);
  assert(!JSON.stringify(publicLibrary(await store.snapshot('oli'),true)).includes(file.blobId));
  await assert.rejects(()=>store.get('max','f'));
  await assert.rejects(()=>store.upload('oli','g','notes.pdf','moodle',pdf));
  await store.removeFile('oli','f');assert.equal(bytes.size,0);
});

test('API verifies accounts and origins before mutation; other users and revoked Moodle permissions cannot fetch originals',async()=>{
  const {store}=fixture();const file=await store.upload('oli','f','notes.pdf',null,pdf);
  const api=createLibraryApi(user('oli'),store,{start:async()=>true});
  const original=await api(request('/files/f/original'));assert.equal(original.status,200);assert.deepEqual(new Uint8Array(await original.arrayBuffer()),pdf);
  assert.equal((await api(request('/folders','POST',{id:'a',name:'X',parentId:null},{Origin:'https://evil.test'}))).status,403);
  assert.equal((await api(request('/folders','POST',{id:'a',name:'X',parentId:null},{'X-Library-Request':''}))).status,403);
  assert.equal((await createLibraryApi(user('max'),store)(request('/files/f/original'))).status,404);
  await store.mutate('oli',library=>{library.files.find(x=>x.id==='f').source={courseId:42,fileId:'7:0',module:'Cours',fingerprint:'',checkedAt:'',available:true};});
  process.env.MOODLE_ALLOWED_USERS='';
  try{assert.equal((await api(request('/files/f/original'))).status,403);assert.equal((await (await api(request())).json()).files.length,0);assert.equal((await api(request('/sync','POST',{}))).status,403);}
  finally{process.env.MOODLE_ALLOWED_USERS='oli';}
  assert.equal(bytesLength(await store.blobs.get(file.blobId)),pdf.length);
});
const bytesLength=bytes=>bytes.length;

test('chunked MCP originals reject bad offsets, mismatched course, corruption, size and content changes',async()=>{
  const checksum=createHash('sha256').update(pdf).digest('hex');
  const row={course_id:42,filename:'cours.pdf',filesize:pdf.length,offset:0,sha256:checksum,data_base64:Buffer.from(pdf).toString('base64'),eof:true};
  assert.deepEqual((await downloadOriginal(async()=>row,42,'7:0')).bytes,pdf);
  for(const patch of [{offset:1},{course_id:43},{sha256:'a'.repeat(64)},{filesize:26*1024*1024},{eof:false},{data_base64:'invalid$$'}])await assert.rejects(()=>downloadOriginal(async()=>({...row,...patch}),42,'7:0'));
});

test('Moodle synchronization is idempotent, detects same-size revisions, preserves removed originals, retries failures and locks concurrent runs',async()=>{
  const {store,bytes}=fixture();let downloads=0,failed=false,modified=10,exists=true;
  const course={id:42,shortname:'INF2705 (20263)',fullname:'INF2705 (A2026) - Infographie'};
  const remote={id:'7:0',filename:'cours.pdf',mimetype:'application/pdf',filesize:pdf.length,section:'Introduction',module:'Cours 1'};
  const connect=async(_signal,work)=>work({courses:async()=>[course,{...course,id:43,shortname:'INF2705 (20262)',fullname:'Ét é 2026'}],files:async id=>{assert.equal(id,42);return exists?[{...remote,modified},{...remote,id:'zip',filename:'code.zip'}]:[];},download:async()=>{downloads++;if(failed)throw new Error('upstream secret');return{filename:'cours.pdf',bytes:pdf};}});
  const sync=new MoodleSync(store,connect);
  await sync.start('oli',true);await sync.wait('oli');assert.equal(downloads,1);assert.equal(bytes.size,1);
  let library=await store.snapshot('oli');assert.equal(library.files.length,1);assert.equal(library.sync.status,'idle');assert.equal(library.folders.length,3);
  await sync.start('oli',true);await sync.wait('oli');assert.equal(downloads,1);
  modified++;await sync.start('oli',true);await sync.wait('oli');assert.equal(downloads,2);assert.equal(bytes.size,1);
  const cached=(await store.snapshot('oli')).files[0].blobId;failed=true;modified++;
  await sync.start('oli',true);await sync.wait('oli');library=await store.snapshot('oli');assert.equal(library.sync.status,'warning');assert.equal(library.files[0].blobId,cached);assert(!library.files[0].error.includes('secret'));
  failed=false;await sync.start('oli',true);await sync.wait('oli');assert.equal((await store.snapshot('oli')).files[0].error,'');
  exists=false;await sync.start('oli',true);await sync.wait('oli');library=await store.snapshot('oli');assert.equal(library.files[0].source.available,false);assert(library.files[0].blobId);
  assert.equal(await sync.start('oli'),false);
  const [a,b]=await Promise.all([sync.start('oli',true),new MoodleSync(store,connect).start('oli',true)]);assert.equal([a,b].filter(Boolean).length,1);await sync.wait('oli');
});

test('PPT preview conversion is cached and original PowerPoint is retained',async()=>{
  const {store}=fixture();
  const ppt=new Uint8Array(Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),Buffer.from('presentation')]));
  await store.upload('oli','ppt','slides.ppt',null,ppt);let conversions=0;
  const api=createLibraryApi(user('oli'),store,{start:async()=>true},async()=>{conversions++;return pdf;});
  for(let i=0;i<2;i++){const r=await api(request('/files/ppt/preview'));assert.equal(r.headers.get('content-type'),'application/pdf');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),pdf);}
  assert.equal(conversions,1);assert.deepEqual(new Uint8Array(await(await api(request('/files/ppt/original'))).arrayBuffer()),ppt);
  assert.equal(emptyLibrary('oli').folders[0].name,'Moodle');
});
