// Exercise the continuous reader with real PDFs and isolated API fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(resolve(root,'apps/memo/web-app/frontend/package.json'));
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
function pdfFixture(count=35){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(let number=1;number<=count;number++){
    const pageId=objects.length+1,landscape=number%2===0,width=landscape?842:595,height=landscape?595:842;
    const stream=`BT /F1 25 Tf 50 ${height-70} Td (HomeLab - Page ${number}) Tj 0 -50 Td /F1 14 Tf (Lecture continue du document) Tj ET`;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId+1} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(const [index,object]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}
const pdf=pdfFixture(),now='2026-10-13T12:00:00Z';
const file={id:'course',name:'6b-Revision-INF2705.pdf',kind:'pdf',folderId:'exam',size:1363149,createdAt:now,updatedAt:now,error:'',ready:true,hasPreview:true,source:{courseId:5300,fileId:'1',module:'Révision intra',available:true},tempoScan:null};
const files=[file,{...file,id:'slides',name:'Présentation.pptx',kind:'powerpoint',source:null},{...file,id:'broken',name:'Indisponible.pdf',source:null},{...file,id:'invalid',name:'Corrompu.pdf',source:null}];
const folders=[{id:'moodle',name:'Moodle',parentId:null,managed:true,createdAt:now},{id:'course-folder',name:'INF2705 - Infographie',parentId:'moodle',managed:true,createdAt:now},{id:'exam',name:'Examen Intra',parentId:'course-folder',managed:true,createdAt:now}];
const account={enabled:true,user:{username:'oli',display_name:'Oli',must_change_password:false}};
let scanCalls=0,failScan=true;
const output=resolve(root,'artifacts/library-reader');await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'fr-CA'}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/memo/api/auth/**',route=>route.fulfill({json:account}));
await page.route('**/api/library**',route=>{
  const {pathname}=new URL(route.request().url());
  if(pathname==='/api/library')return route.fulfill({json:{folders,files,aiAvailable:true,moodleAvailable:true,semester:'A26',intervalMinutes:30,maxFileBytes:25*1024*1024,sync:{status:'idle',lastAttempt:now,lastSuccess:now,message:'',saved:4,total:4}}});
  if(pathname.endsWith('/scan')){
    scanCalls++;
    if(failScan)return route.fulfill({status:503,json:{error:'Scan temporairement indisponible.'}});
    file.tempoScan={id:'scan',state:'queued',automatic:false,requestedAt:now,completedAt:null,summary:'',error:'',changed:false,proposals:[]};
    return route.fulfill({json:{}});
  }
  if(pathname==='/api/library/files/broken/preview')return route.fulfill({status:503,json:{error:'Conversion indisponible.'}});
  if(pathname==='/api/library/files/invalid/preview')return route.fulfill({contentType:'application/pdf',body:'invalid PDF'});
  if(pathname.endsWith('/preview'))return route.fulfill({contentType:'application/pdf',body:pdf});
  return route.fulfill({status:404,json:{error:'Fixture unavailable'}});
});
const base=process.env.HOMELAB_UI_URL||'http://localhost:3017/';
const reader=page.locator('.library-reader'),stage=reader.locator('.library-pdf-stage'),tools=reader.locator('.library-pdf-tools'),info=reader.locator('.library-reader-info');
const rendered=number=>reader.locator(`[data-page-number="${number}"] canvas.is-rendered`);
const open=async id=>{const url=new URL(base);url.searchParams.set('section','library');url.searchParams.set('file',id);await page.goto(url.href);await expect(reader).toBeVisible();};
const scrollTo=async number=>stage.evaluate((node,number)=>{const page=node.querySelector(`[data-page-number="${number}"]`);node.scrollTop=page.offsetTop-20;},number);
const noOverflow=async()=>{
  assert(await reader.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Reader overflow');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Viewport overflow');
};
try{
  // A normal click opens the document and exposes its details in the same dialog.
  const url=new URL(base);url.searchParams.set('section','library');await page.goto(url.href);
  await expect(page.locator('.library-app')).toBeVisible();await page.locator('.library-sidebar').getByRole('button',{name:'Tous les fichiers'}).click();
  await page.locator('.library-file-entry').filter({hasText:file.name}).locator('.library-file-open').click();
  await expect(rendered(1)).toBeVisible();await expect(reader.locator('.library-pdf-page')).toHaveCount(35);
  for(const value of ['Taille','Ajouté le','Modifié le','Origine','Emplacement','État','Moodle / INF2705 - Infographie / Examen Intra','Enregistré dans HomeLab'])await expect(info).toContainText(value);
  assert((await info.boundingBox()).x>(await stage.boundingBox()).x,'Details must be to the right');
  await expect(info.getByRole('link',{name:'Télécharger l’original'})).toHaveAttribute('href','/api/library/files/course/original');
  await page.screenshot({path:resolve(output,'desktop-reader.png')});
  await stage.hover();await page.mouse.wheel(0,1500);await expect(tools).not.toContainText('Page 1 /');await expect(rendered(2)).toBeVisible();
  await scrollTo(3);await expect(tools).toContainText('Page 3 / 35');await expect(rendered(3)).toBeVisible();
  const infoScroll=await info.evaluate(node=>node.scrollTop);await scrollTo(20);await expect(tools).toContainText('Page 20 / 35');await expect(rendered(20)).toBeVisible();
  assert.equal(await info.evaluate(node=>node.scrollTop),infoScroll,'Reading should not scroll the details');
  await expect(rendered(1)).toHaveCount(0);assert(await reader.locator('canvas').count()<10,'Distant pages should release their canvases');
  await tools.getByRole('button',{name:'Page suivante',exact:true}).click();await expect(tools).toContainText('Page 21 / 35');
  await tools.getByRole('button',{name:'Page précédente',exact:true}).click();await expect(tools).toContainText('Page 20 / 35');
  await tools.getByRole('button',{name:'Augmenter le zoom'}).click();await expect(tools).toContainText('125 %');await expect(rendered(20)).toBeVisible();await noOverflow();
  await tools.getByRole('button',{name:'Ajuster à la largeur'}).click();await expect(tools).toContainText('100 %');await expect(tools).toContainText('Page 20 / 35');
  await tools.getByRole('button',{name:'Augmenter le zoom'}).evaluate(button=>{button.click();button.click();button.click();});await expect(rendered(20)).toBeVisible();await tools.getByRole('button',{name:'Ajuster à la largeur'}).click();
  await info.getByRole('button',{name:'Scanner pour Tempo',exact:true}).click();await expect(info.getByRole('alert')).toContainText('Scan temporairement indisponible');
  failScan=false;await info.getByRole('button',{name:'Scanner pour Tempo',exact:true}).click();await expect(info.getByRole('button',{name:'Scan Tempo en attente…',exact:true})).toBeDisabled();assert.equal(scanCalls,2);
  await reader.getByRole('button',{name:'Fermer l’aperçu'}).click();await expect(reader).toHaveCount(0);
  // Source links land on the requested page, including mixed page orientations.
  const link=new URL(base);link.searchParams.set('section','library');link.searchParams.set('file','course');link.searchParams.set('page','18');await page.goto(link.href);
  await expect(rendered(18)).toBeVisible();await expect(tools).toContainText('Page 18 / 35');
  for(const width of [1024,768,390,320]){
    await page.setViewportSize({width,height:844});await expect(rendered(18)).toBeVisible();await expect(info).toBeVisible();await noOverflow();
    if(width===390)await page.screenshot({path:resolve(output,'mobile-reader.png')});
  }
  await info.getByRole('link',{name:'Télécharger l’original'}).scrollIntoViewIfNeeded();await expect(info.getByRole('link',{name:'Télécharger l’original'})).toBeInViewport();
  await scrollTo(35);await expect(rendered(35)).toBeVisible();await expect(tools).toContainText('Page 35 / 35');await expect(tools.getByRole('button',{name:'Page suivante',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');await expect(reader).toHaveCount(0);
  await page.setViewportSize({width:1440,height:1000});await open('slides');await expect(rendered(1)).toBeVisible();await expect(reader.locator('.library-pdf-page')).toHaveCount(35);await expect(reader.locator('.library-reader-footer')).toContainText('original PowerPoint conservé');
  await open('broken');await expect(reader.getByRole('alert')).toContainText('Conversion indisponible');await expect(info).toContainText('Enregistré dans HomeLab');await expect(info.getByRole('link',{name:'Télécharger l’original'})).toBeVisible();
  await open('invalid');await expect(reader.getByRole('alert')).toContainText('ne peut pas être affiché');await expect(info).toBeVisible();
  assert.deepEqual(errors,[]);console.log('Library reader UI passed: continuous scrolling, lazy canvases, mixed page sizes, navigation, zoom, source links, metadata, scan retry/live status, mobile, PowerPoint and preview errors.');
}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.error('Reader fixture URL:',page.url(),'Page errors:',errors);throw error;}finally{await browser.close();}
