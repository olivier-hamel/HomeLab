import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(resolve(root,'apps/memo/web-app/frontend/package.json'));
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const temporary=await mkdtemp(resolve(tmpdir(),'homelab-library-ui-'));
Object.assign(process.env,{LIBRARY_STORAGE_PATH:temporary,MOODLE_ALLOWED_USERS:'oli',MOODLE_MCP_URL:'http://127.0.0.1:18000/mcp'});
const {LibraryStore}=await import('../backend/src/lib/library/store.ts');
const {createLibraryApi}=await import('../backend/src/lib/library/api.ts');
const {mergeManifest}=await import('../backend/src/lib/library/sync.ts');
const store=new LibraryStore();
const account={enabled:true,user:{username:'oli',display_name:'Oli',must_change_password:false},accounts:[{username:'oli',display_name:'Oli'}]};
function pdfFixture(){const stream='BT /F1 25 Tf 50 750 Td (Bibliotheque - HomeLab) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,o] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;}const start=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return new Uint8Array(Buffer.from(pdf));}
const pdf=pdfFixture();let syncCalls=0;
const api=createLibraryApi(async()=>account,store,{start:async()=>{syncCalls++;return true;}},async()=>pdf);
await store.mutate('oli',library=>{
  mergeManifest(library,[['INF2705','Infographie'],['INF3610','Systèmes embarqués'],['INF3710','Fichiers et bases de données'],['PHS1101','Mécanique pour ingénieurs'],['SSH3501','Éthique appliquée à l’ingénierie']].map(([code,title],i)=>({course:{id:5300+i,shortname:`${code} (20263)`,fullname:`${code} (A2026) - ${title}`},files:[{id:'1:0',filename:`${code}-Plan-de-cours-A2026.pdf`,filesize:pdf.length,mimetype:'application/pdf',section:'Information générale',module:'Plan de cours'},{id:'2:0',filename:`${code}-Introduction.pdf`,filesize:pdf.length,mimetype:'application/pdf',section:'Cours 01 - Introduction',module:'Introduction'}]})),new Date().toISOString());
  library.sync={...library.sync,lastSuccess:new Date().toISOString(),lastAttempt:new Date().toISOString(),message:'Tous les fichiers sont à jour.',saved:10,total:10};
});
for(const file of (await store.snapshot('oli')).files){const id=await store.blobs.put(pdf);await store.mutate('oli',library=>{library.files.find(row=>row.id===file.id).blobId=id;});}
await store.createFolder('oli',{id:'notes',name:'Notes personnelles',parentId:null});
await store.upload('oli','personal','Synthèse — mécanique.pdf','notes',pdf);
const output=resolve(root,'artifacts/library');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'fr-CA'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/memo/api/auth/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(account)}));
await page.route('**/api/library**',async route=>{
  const r=route.request(),headers={...r.headers()};
  if(r.method()!=='GET')headers.origin=new URL(r.url()).origin;
  const response=await api(new Request(r.url(),{method:r.method(),headers,...(r.method()==='GET'?{}:{body:r.postDataBuffer()})}));
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
});
const shot=name=>page.screenshot({animations:'disabled',path:resolve(output,`${name}.png`)});
const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Viewport overflow');
const folder=name=>page.locator('.library-folder-card').filter({has:page.locator('strong',{hasText:name})});
const createFolder=async name=>{await page.getByRole('button',{name:'Nouveau dossier'}).click();await expect(page.getByLabel('Nom du dossier')).toBeFocused();await page.getByLabel('Nom du dossier').fill(name);await page.getByLabel('Nom du dossier').press('Enter');await expect(page.locator('.library-dialog')).toHaveCount(0);};
try{
  await page.goto(process.env.HOMELAB_UI_URL||'http://localhost:3000/?section=library');
  await expect(page.locator('.library-app')).toBeVisible();await expect(page.locator('.library-folder-card')).toHaveCount(2);await noOverflow();await shot('desktop-home');
  await folder('Moodle').locator('.library-folder-card-open').click();await expect(page.locator('.library-folder-card')).toHaveCount(5);await expect(page.getByRole('button',{name:'Importer',exact:true})).toBeDisabled();await shot('desktop-moodle');
  await folder('INF2705').locator('.library-folder-card-open').click();await folder('Information générale').locator('.library-folder-card-open').click();await expect(page.locator('.library-file-entry')).toHaveCount(1);await page.locator('.library-file-open').click();await expect(page.locator('.library-reader canvas.is-rendered')).toBeVisible();await page.getByRole('button',{name:'Fermer l’aperçu'}).click();
  await page.locator('.library-sidebar').getByRole('button',{name:'Mes documents',exact:true}).click();await createFolder('Cours');await folder('Cours').locator('.library-folder-card-open').click();await createFolder('Automne 2026');await folder('Automne 2026').locator('.library-folder-card-open').click();
  await page.locator('.library-file-input').setInputFiles({name:'Résumé.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});await expect(page.locator('.library-file-entry')).toHaveCount(1);await expect(page.locator('.library-notice')).toContainText('importé');
  const entry=page.locator('.library-file-entry');await entry.locator('summary').click();await entry.getByRole('button',{name:'Renommer',exact:true}).click();await page.getByLabel('Nouveau nom').fill('Résumé de cours.pdf');await page.getByLabel('Nouveau nom').press('Enter');await expect(page.locator('.library-dialog')).toHaveCount(0);await expect(entry).toContainText('Résumé de cours.pdf');
  await entry.locator('summary').click();await entry.getByRole('button',{name:'Déplacer',exact:true}).click();await page.getByLabel('Dossier de destination').selectOption('notes');await page.getByRole('button',{name:'Déplacer ici'}).click();await expect(page.locator('.library-dialog')).toHaveCount(0);await expect(page.locator('.library-file-entry')).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Rechercher dans la bibliothèque'}).fill('resume');await expect(page.locator('.library-file-entry')).toHaveCount(1);await expect(page.getByRole('searchbox')).toBeFocused();await page.getByRole('button',{name:'Effacer la recherche'}).click();
  await page.locator('.library-sidebar').getByRole('button',{name:'Tous les fichiers'}).click();await expect(page.locator('.library-file-entry')).toHaveCount(12);await page.getByRole('button',{name:'Vue en grille'}).click();await shot('desktop-grid');
  await page.getByRole('button',{name:'Vue en liste'}).click();await shot('desktop-files');
  await page.locator('.library-sidebar').getByRole('button',{name:'Mes documents',exact:true}).click();
  await page.locator('.library-file-input').setInputFiles({name:'document.docx',mimeType:'application/octet-stream',buffer:Buffer.from('invalid')});await expect(page.locator('.library-error')).toContainText('seuls PDF');
  const ppt=Buffer.concat([Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]),Buffer.from('fixture')]);await page.locator('.library-file-input').setInputFiles({name:'Présentation.ppt',mimeType:'application/vnd.ms-powerpoint',buffer:ppt});await expect(page.locator('.library-file-entry')).toHaveCount(1);await page.getByRole('button',{name:'PowerPoint',exact:true}).click();await expect(page.locator('.library-file-entry')).toHaveCount(1);await page.locator('.library-file-open').click();await expect(page.locator('.library-reader canvas.is-rendered')).toBeVisible();await expect(page.locator('.library-reader-footer')).toContainText('original PowerPoint conservé');await page.getByRole('button',{name:'Fermer l’aperçu'}).click();
  await page.getByRole('button',{name:'Tout',exact:true}).click();await page.locator('.library-file-entry summary').click();await page.getByRole('button',{name:'Supprimer',exact:true}).click();await expect(page.locator('.library-dialog')).toContainText('Présentation.ppt');await page.locator('.library-dialog').getByRole('button',{name:'Supprimer',exact:true}).click();await expect(page.locator('.library-dialog')).toHaveCount(0);await expect(page.locator('.library-file-entry')).toHaveCount(0);
  await page.getByRole('button',{name:'Synchroniser',exact:true}).click();assert.equal(syncCalls,1);
  // Empty-folder deletion fails visibly while preserving all contents.
  await folder('Notes personnelles').locator('summary').click();await folder('Notes personnelles').getByRole('button',{name:'Supprimer',exact:true}).click();await page.locator('.library-dialog').getByRole('button',{name:'Supprimer',exact:true}).click();await expect(page.locator('.library-dialog .library-error')).toContainText('sous-dossiers');await page.locator('.library-dialog').getByRole('button',{name:'Annuler'}).click();
  await page.locator('.library-sidebar').getByRole('button',{name:'Moodle'}).click();
  for(const width of [1024,768,390,320]){await page.setViewportSize({width,height:844});await noOverflow();if(width===390)await shot('mobile-moodle');}
  await page.setViewportSize({width:390,height:844});await folder('INF2705').locator('.library-folder-card-open').click();await folder('Information générale').locator('.library-folder-card-open').click();await expect(page.locator('.library-file-entry')).toHaveCount(1);await shot('mobile-files');await page.locator('.library-file-open').click();await expect(page.locator('.library-reader canvas.is-rendered')).toBeVisible();await noOverflow();await shot('mobile-reader');await page.getByRole('button',{name:'Fermer l’aperçu'}).click();await page.getByRole('button',{name:'Fermer les informations'}).click();
  await page.getByRole('button',{name:'Afficher les dossiers'}).click();await expect(page.locator('.library-sidebar')).toBeVisible();await shot('mobile-navigation');await page.getByRole('button',{name:'Fermer les dossiers',exact:true}).first().click();
  assert.deepEqual(errors,[]);console.log('Library UI: folders, uploads, search, moves, validation, sync, PDF/PPT previews and responsive layouts passed.');
}finally{await browser.close();await rm(temporary,{recursive:true,force:true});}
