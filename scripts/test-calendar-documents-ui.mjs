// Exercise the real Tempo UI with local PDF/API fixtures; no Gemini or MongoDB access.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(resolve(root,'apps/memo/web-app/frontend/package.json'));
const {chromium}=require('playwright');const {expect}=require('@playwright/test');
const output=resolve(root,'artifacts/calendar-documents');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'fr-CA'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
let documents=[],folders=[],events=[],aiAvailable=true,failAnalysis=false,failSave=false,imports=0,analyses=0;
let holdUpload=false,releaseUpload;
const date='2026-10-20',now='2026-10-12T12:00:00Z';
const draft={title:'Examen de biologie',description:'Salle 204, pavillon des sciences',date,endDate:date,startTime:'09:00',endTime:'11:00',allDay:false,recurrence:null};
function pdfFixture(title='Horaire de la session') {
 const stream=`BT /F1 22 Tf 45 750 Td (${title}) Tj 0 -50 Td /F1 12 Tf (Examen de biologie - 20 octobre 2026, 9 h) Tj 0 -30 Td (Remise du travail - 23 octobre 2026) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
 const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
 return Buffer.from(pdf);
}
const pdf=pdfFixture(),secondPdf=pdfFixture('Itineraire de voyage');
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const routeHandler=async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 if(path==='/memo/api/auth/me')return json(route,{enabled:true,user:{username:'oli',display_name:'Oli',must_change_password:false}});
 if(path==='/api/calendar/events'&&request.method()==='GET')return json(route,{events,aiAvailable});
 if(path.startsWith('/api/calendar/events/')){
  const event=events.find(event=>event.id===path.split('/').pop());
  if(request.method()==='PATCH'){Object.assign(event,request.postDataJSON().event,{updatedAt:new Date().toISOString()});return json(route,{event});}
 }
 if(path==='/api/calendar/documents'){
  if(request.method()==='GET')return json(route,{documents:documents.map(({bytes:_bytes,hash:_hash,...document})=>document),folders,aiAvailable});
  if(request.method()==='POST'){
   if(holdUpload)await new Promise(resolve=>{releaseUpload=resolve;});
   const bytes=request.postDataBuffer(),hash=createHash('sha256').update(bytes).digest('hex');
   let document=documents.find(document=>document.hash===hash);const existing=!!document;
   if(!document){document={id:request.headers()['x-document-id'],folderId:request.headers()['x-document-folder']||null,name:decodeURIComponent(request.headers()['x-document-name']),size:bytes.length,bytes,hash,createdAt:now,updatedAt:now,analysisState:'pending',analysisError:'',summary:'',proposals:[]};documents.push(document);}
   const {bytes:_bytes,hash:_hash,...publicDocument}=document;return json(route,{document:publicDocument,existing},existing?200:201);
  }
 }
 if(path.startsWith('/api/calendar/documents/folders')){
  const body=request.postDataJSON(),id=path.split('/')[5];
  if(request.method()==='POST'){
   if(folders.some(folder=>folder.parentId===body.parentId&&folder.name.toLowerCase()===body.name.toLowerCase()))return json(route,{error:'Un dossier porte déjà ce nom à cet emplacement.',code:'conflict'},409);
   const folder={id:body.requestId,name:body.name,parentId:body.parentId,createdAt:now,updatedAt:now};folders.push(folder);return json(route,{folder},201);
  }
  const folder=folders.find(folder=>folder.id===id);if(!folder)return json(route,{error:'Dossier supprimé',code:'not_found'},404);
  if(request.method()==='DELETE'){
   if(folders.some(row=>row.parentId===id)||documents.some(row=>row.folderId===id))return json(route,{error:'Déplace les documents et les sous-dossiers avant de supprimer ce dossier.',code:'not_empty'},409);
   folders=folders.filter(row=>row.id!==id);return json(route,{removed:true});
  }
  Object.assign(folder,body,{updatedAt:new Date(Date.parse(folder.updatedAt)+1).toISOString()});return json(route,{folder});
 }
 if(path.startsWith('/api/calendar/documents/')){
  const [id,action]=path.slice('/api/calendar/documents/'.length).split('/');const document=documents.find(document=>document.id===id);
  if(!document)return json(route,{error:'Document supprimé',code:'not_found'},404);
  if(action==='file')return route.fulfill({contentType:'application/pdf',body:document.bytes});
  if(action==='analyze'){
   analyses++;
   if(failAnalysis){document.analysisState='error';document.analysisError='L’analyse est occupée. Le PDF est conservé.';return json(route,{error:document.analysisError},429);}
   document.analysisState='ready';document.analysisError='';document.summary=document.name.includes('Horaire')?'Les dates importantes de ta session : un examen et une remise de travail.':'Deux moments repérés dans ton itinéraire.';
   document.proposals=[{id:randomUUID(),event:{...draft,title:document.name.includes('Horaire')?draft.title:'Départ pour Montréal'},page:1,note:''},{id:randomUUID(),event:{...draft,title:document.name.includes('Horaire')?'Remise du travail':'Visite du musée',date:'2026-10-23',endDate:'2026-10-23',allDay:true,startTime:null,endTime:null},page:1,note:'Aucune heure indiquée : proposé pour toute la journée.'}];
  }
  if(action==='events'){
   imports++;if(failSave)return json(route,{error:'Enregistrement interrompu. Réessaie.'},503);
   const added=request.postDataJSON().events.map(row=>{let event=events.find(event=>event.id===row.proposalId);if(!event){const proposal=document.proposals.find(proposal=>proposal.id===row.proposalId);event={...row.event,id:proposal.id,createdAt:now,updatedAt:now,source:{documentId:id,documentName:document.name,proposalId:proposal.id,page:proposal.page}};events.push(event);}return event;});return json(route,{events:added},201);
  }
  if(request.method()==='DELETE'){documents=documents.filter(document=>document.id!==id);return json(route,{removed:true});}
  if(request.method()==='PATCH')document.folderId=request.postDataJSON().folderId;
  const {bytes:_bytes,hash:_hash,...publicDocument}=document;return json(route,{document:publicDocument});
 }
 if(path.startsWith('/calendar/')){
  const file=resolve(root,'apps/calendar/dist',path.slice('/calendar/'.length)||'index.html');
  if(!file.startsWith(resolve(root,'apps/calendar/dist')+'/'))return route.abort();
  try{return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml'})[extname(file)],body:await readFile(file)});}catch{return route.fulfill({status:404,body:'Not found'});}
 }
 return route.abort();
};
await page.route('**/*',routeHandler);
const shot=name=>page.screenshot({animations:'disabled',path:resolve(output,`${name}.png`)});
const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page must fit the viewport');
async function openDocuments(){if(await page.locator('.menu-button').isVisible())await page.locator('.menu-button').click();await page.locator('.calendar-nav[data-action="documents"]').click();await expect(page.locator('#documents-title')).toBeVisible();}
try{
 await page.goto('https://tempo.test/calendar/');await openDocuments();await expect(page.locator('.document-empty')).toBeVisible();await shot('empty-desktop');
 await page.locator('#document-input').setInputFiles([{name:'Horaire — automne 2026.pdf',mimeType:'application/pdf',buffer:pdf},{name:'Itinéraire Montréal.pdf',mimeType:'application/pdf',buffer:secondPdf}]);
 await expect(page.locator('.document-review-dialog')).toBeVisible();await expect(page.locator('.document-proposal')).toHaveCount(4);assert.equal(events.length,0,'Analysis must never add events');assert.equal(analyses,2);await shot('review-desktop');
 const first=page.locator('.document-proposal').first();await first.locator('.proposal-editor summary').click();await first.locator('[name="title"]').fill('Examen final de biologie');
 await page.locator('.document-proposal').nth(1).locator('.proposal-checkbox').uncheck();
 await page.locator('#document-import-events').evaluate(button=>{button.click();button.click();});await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events.length,3);assert.equal(imports,2);assert.equal(events[0].title,'Examen final de biologie');assert(events.every(event=>event.source.page===1));
 await page.locator('[data-action="document-jobs-dismiss"]').click();await page.locator('[data-action="document-select"]').filter({hasText:'Horaire'}).click();await expect(page.locator('.document-review-button')).toBeVisible();await expect(page.locator('.pdf-preview-image')).toBeVisible();await shot('library-desktop');
 await page.locator('[data-action="document-filter-pending"]').click();await expect(page.locator('.document-row')).toHaveCount(1);
 await page.locator('.document-review-button').click();await expect(page.locator('.document-proposal.is-added')).toHaveCount(1);
 const pending=page.locator('.document-proposal:not(.is-added)');await pending.locator('.proposal-editor summary').click();await pending.locator('[name="title"]').fill('Remise du projet final');
 await page.locator('.document-review-footer [data-action="document-dialog-close"]').click();await expect(page.locator('dialog')).toHaveCount(0);
 await page.locator('.document-review-button').click();await page.locator('.document-proposal:not(.is-added) .proposal-editor summary').click();await expect(page.locator('.document-proposal:not(.is-added) [name="title"]')).toHaveValue('Remise du projet final');
 await page.locator('.document-proposal:not(.is-added) .proposal-checkbox').check();failSave=true;await page.locator('#document-import-events').click();await expect(page.locator('#document-dialog-error')).toContainText('interrompu');assert.equal(events.length,3);
 failSave=false;await page.locator('#document-import-events').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events.length,4);
 await page.locator('[data-action="document-filter-all"]').click();await page.locator('.document-linked-events button').first().click();await expect(page.locator('.event-document-source a')).toContainText('Horaire');await expect(page.locator('.event-document-source a')).toHaveAttribute('href',/\/file#page=1$/);
 const source={...events[0].source};await page.locator('#event-title').fill('Examen reporté');await page.locator('#event-save-form button[type="submit"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.deepEqual(events[0].source,source);
 await page.locator('#document-search').fill('montreal');await expect(page.locator('.document-row')).toHaveCount(1);await expect(page.locator('#document-search')).toBeFocused();await page.locator('#document-search').fill('');
 // Reimporting the same PDF preserves the stored file and never re-runs successful extraction.
 await page.locator('#document-input').setInputFiles({name:'Horaire renommé.pdf',mimeType:'application/pdf',buffer:pdf});await expect(page.locator('.import-job')).toContainText('2 événements');assert.equal(documents.length,2);assert.equal(analyses,2);await expect(page.locator('dialog')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await noOverflow();await shot('library-mobile');
 // Failed analysis keeps a usable PDF and can be retried from the inspector.
 failAnalysis=true;await page.locator('#document-input').setInputFiles({name:'Invitation.pdf',mimeType:'application/pdf',buffer:pdfFixture('Invitation')});await expect(page.locator('.import-job').last()).toContainText('PDF est conservé');assert.equal(documents.length,3);
 await page.locator('[data-action="document-select"]').filter({hasText:'Invitation'}).click();await expect(page.locator('.document-analysis-error')).toBeVisible();failAnalysis=false;await page.locator('[data-action="document-analyze"]').click();await expect(page.locator('.document-review-dialog')).toBeVisible();await noOverflow();assert(await page.locator('dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1));await shot('review-mobile');
 await page.locator('#proposal-select-all').uncheck();await expect(page.locator('#document-import-events')).toBeDisabled();await page.locator('.document-review-footer [data-action="document-dialog-close"]').click();
 await page.locator('[data-action="document-back"]').click();
 // Deletion confirms the effect, preserves calendar entries and shows a removed source.
 await page.locator('[data-action="document-select"]').filter({hasText:'Horaire'}).click();await page.locator('[data-action="document-delete"]').click();await expect(page.locator('.document-delete-dialog')).toContainText('resteront au calendrier');await shot('delete-mobile');await page.locator('[data-action="document-delete-confirm"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(documents.length,2);assert.equal(events.length,4);
 await page.locator('[data-action="create-event"]').first().evaluate((button,id)=>{button.dataset.action='open-event';button.dataset.eventId=id;button.click();button.dataset.action='create-event';delete button.dataset.eventId;},events[0].id);
 await expect(page.locator('.event-document-source')).toContainText('Document supprimé');await expect(page.locator('.event-document-source a')).toHaveCount(0);await page.locator('[data-action="close-event-dialog"]').first().click();
 for(const width of [320,768,1024]){await page.setViewportSize({width,height:844});await noOverflow();}
 // Manual storage remains useful with no Gemini key.
 aiAvailable=false;await page.reload();await openDocuments();await page.locator('#document-input').setInputFiles({name:'Notes.pdf',mimeType:'application/pdf',buffer:pdfFixture('Notes')});await expect(page.locator('.import-job')).toContainText('analyse disponible');await expect(page.locator('dialog')).toHaveCount(0);assert.equal(documents.length,3);
 const touch=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'fr-CA'});touch.on('pageerror',error=>errors.push(error.message));await touch.route('**/*',routeHandler);
 await touch.goto('https://tempo.test/calendar/');await touch.locator('.menu-button').tap();await touch.locator('.calendar-nav[data-action="documents"]').tap();await expect(touch.locator('.document-row')).toHaveCount(3);
 await touch.screenshot({animations:'disabled',path:resolve(output,'library-touch.png')});await touch.locator('.document-row').filter({hasText:'Invitation'}).tap();await expect(touch.locator('.inspector-back')).toBeVisible();await expect(touch.locator('.pdf-preview-image')).toBeVisible();await touch.screenshot({animations:'disabled',path:resolve(output,'detail-touch.png')});
 await touch.locator('.document-review-button').tap();const touchFirst=touch.locator('.document-proposal').first();await touchFirst.locator('.proposal-heading > label').tap();await expect(touchFirst.locator('.proposal-checkbox')).not.toBeChecked();await touchFirst.locator('.proposal-heading > label').tap();await expect(touchFirst.locator('.proposal-checkbox')).toBeChecked();await touchFirst.locator('summary').tap();
 assert(await touch.locator('dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1));await touch.screenshot({animations:'disabled',path:resolve(output,'review-touch.png')});await touch.close();
 // Organize an existing library with nested folders and persistent moves.
 await page.setViewportSize({width:1440,height:1000});
 if(await page.locator('[data-action="document-back"]').isVisible())await page.locator('[data-action="document-back"]').click();
 const createFolder=async name=>{await page.locator('[data-action="folder-create"]').click();await expect(page.locator('#folder-name')).toBeFocused();await page.locator('#folder-name').fill(name);await page.locator('#folder-name').press('Enter');await expect(page.locator('.document-folder-dialog')).toHaveCount(0);};
 const folderCard=name=>page.locator('.document-folder-card').filter({has:page.locator('.document-folder-open strong',{hasText:name})});
 const folderAction=async(name,action)=>{const card=folderCard(name);await card.locator('summary').click();await card.locator(`[data-action="folder-${action}"]`).click();};
 const openFolder=async name=>{await folderCard(name).locator('.document-folder-open').click();await expect(page.locator('#document-location-title')).toHaveText(name);};
 const goRoot=async()=>page.locator('.document-location-bar [data-action="folder-open"]').first().click();
 for(const name of ['Cours','Personnel','Voyages','Archives'])await createFolder(name);
 await page.locator('[data-action="folder-create"]').click();await page.locator('#folder-name').fill('Cours');await page.locator('#folder-name').press('Enter');await expect(page.locator('#document-dialog-error')).toContainText('déjà');await page.locator('.document-folder-dialog [data-action="document-dialog-close"]').first().click();
 await page.locator('[data-action="document-jobs-dismiss"]').click();await noOverflow();await shot('folders-desktop');
 await openFolder('Cours');await createFolder('Automne 2026');await openFolder('Automne 2026');await createFolder('Physique');
 await folderAction('Physique','rename');await expect(page.locator('#folder-name')).toHaveValue('Physique');await page.locator('#folder-name').fill('Physique générale');await page.locator('#folder-name').press('Enter');await expect(page.locator('dialog')).toHaveCount(0);
 await openFolder('Physique générale');holdUpload=true;await page.locator('#document-input').setInputFiles({name:'Plan de cours — physique.pdf',mimeType:'application/pdf',buffer:pdfFixture('Physique')});await expect.poll(()=>!!releaseUpload).toBe(true);await goRoot();holdUpload=false;releaseUpload();await expect(page.locator('.import-job')).toContainText('analyse disponible');await openFolder('Cours');await openFolder('Automne 2026');await openFolder('Physique générale');
 const coursePdf=documents.find(row=>row.name.startsWith('Plan de cours'));const physics=folders.find(row=>row.name==='Physique générale');assert.equal(coursePdf.folderId,physics.id);
 await page.locator('[data-action="document-jobs-dismiss"]').click();await page.locator('.document-row').click();await expect(page.locator('.inspector-location')).toContainText('Cours / Automne 2026 / Physique générale');await expect(page.locator('.pdf-preview-image')).toBeVisible();await shot('nested-folder-desktop');
 // Search includes documents and folders outside the currently opened folder.
 await goRoot();await page.locator('#document-search').fill('physique');await expect(page.locator('.document-row')).toHaveCount(1);await expect(page.locator('.document-folder-card')).toHaveCount(1);await expect(page.locator('.document-meta').first()).toContainText('Cours / Automne 2026');await page.locator('#document-search').fill('');
 await page.locator('.document-row').filter({hasText:'Itinéraire'}).click();await page.locator('[data-action="document-move"]').click();await expect(page.locator('[data-action="folder-move-confirm"]')).toBeDisabled();
 await page.locator('.folder-destination-list button').filter({hasText:'Cours'}).click();await page.locator('.folder-destination-list button').filter({hasText:'Automne 2026'}).click();await page.locator('.folder-destination-list button').filter({hasText:'Physique générale'}).click();await shot('move-pdf-desktop');await page.locator('[data-action="folder-move-confirm"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(documents.find(row=>row.name.includes('Itinéraire')).folderId,physics.id);assert.equal(events.length,4);
 // Move the complete subtree; the destination browser excludes the source and its descendants.
 await folderAction('Cours','move');await expect(page.locator('.folder-destination-list')).not.toContainText('Cours');await page.locator('.folder-destination-list button').filter({hasText:'Archives'}).click();await page.locator('[data-action="folder-move-confirm"]').click();await expect(page.locator('dialog')).toHaveCount(0);
 const courses=folders.find(row=>row.name==='Cours'),archives=folders.find(row=>row.name==='Archives');assert.equal(courses.parentId,archives.id);assert.equal(coursePdf.folderId,physics.id);
 await openFolder('Archives');await folderAction('Cours','delete');await page.locator('[data-action="folder-delete-confirm"]').click();await expect(page.locator('#document-dialog-error')).toContainText('sous-dossiers');await page.locator('.document-folder-dialog [data-action="document-dialog-close"]').first().click();
 await createFolder('Dossier temporaire');await folderAction('Dossier temporaire','delete');await page.locator('[data-action="folder-delete-confirm"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert(!folders.some(row=>row.name==='Dossier temporaire'));
 await page.reload();await openDocuments();await expect(page.locator('.document-folder-card')).toHaveCount(3);await openFolder('Archives');await openFolder('Cours');await openFolder('Automne 2026');await openFolder('Physique générale');await expect(page.locator('.document-row')).toHaveCount(2);
 // Mobile navigation and move controls remain usable at narrow widths.
 await page.setViewportSize({width:390,height:844});await noOverflow();await shot('nested-folder-mobile');await page.locator('.document-row').filter({hasText:'Plan de cours'}).click();await expect(page.locator('.inspector-back')).toBeVisible();await page.locator('[data-action="document-move"]').click();await shot('move-pdf-mobile');await page.locator('[data-action="folder-move-confirm"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(coursePdf.folderId,null);
 for(const width of [320,390,768,1024,1440]){await page.setViewportSize({width,height:900});await noOverflow();await page.locator('[data-action="folder-create"]').click();await noOverflow();assert(await page.locator('dialog').evaluate(dialog=>dialog.scrollWidth<=dialog.clientWidth+1));await page.locator('[data-action="document-dialog-close"]').first().click();}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'passed',checks:['multiple PDFs','review before save','editable selections','duplicate click prevention','reopen drafts','save retry','search and pending filter','persistent source links','duplicate files','desktop and mobile layout','analysis retry','PDF deletion preserves events','missing Gemini','touch selection and PDF detail','nested folders and breadcrumbs','folder rename and duplicate names','imports into current folder','global folder and PDF search','PDF moves','folder subtree moves','empty-only deletion','folder persistence','responsive folder dialogs'],screenshots:output}));
}finally{await browser.close();}
