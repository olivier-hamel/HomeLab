// Browser checks use the real Calendar modules and mock APIs, without external services.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(resolve(root,'apps/memo/web-app/frontend/package.json'));
const {chromium}=require('playwright');
const {expect}=require('@playwright/test');
const output=resolve(root,'artifacts/calendar'); await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
let saved=0, interpreted=0, failAi=false, failSave=false, aiAvailable=true;
let events=[];
const errors=[];
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'fr-CA'});
page.on('pageerror',error => errors.push(error.message));
const date='2026-10-12';
const draft={title:'Souper avec Camille',description:'Au restaurant du quartier',date,endDate:date,startTime:'19:00',endTime:'21:00',allDay:false};
let aiDraft=draft;
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
await page.route('**/*',async route=>{
 const req=route.request(); const url=new URL(req.url()); const path=url.pathname;
 if(path==='/memo/api/auth/me') return json(route,{enabled:true,user:{username:'oli',display_name:'Oli',must_change_password:false}});
 if(path==='/api/calendar/events' && req.method()==='GET') return json(route,{events,aiAvailable});
 if(path==='/api/calendar/interpret') {
  interpreted++; if(failAi) return json(route,{error:'Gemini est occupé. Réessaie ou saisis les détails manuellement.'},429);
  return json(route,{event:aiDraft,clarification:null});
 }
 if(path==='/api/calendar/events' && req.method()==='POST') {
  saved++; if(failSave) return json(route,{error:'La connexion a été interrompue. Réessaie; tes détails sont conservés.'},503);
  const body=req.postDataJSON(); const event={...body.event,id:body.requestId,createdAt:'2026-10-12T12:00:00Z',updatedAt:'2026-10-12T12:00:00Z'};
  if(!events.some(row=>row.id===event.id)) events.push(event);
  return json(route,{event},201);
 }
 if(path.startsWith('/api/calendar/events/')) {
  const id=path.split('/').pop();const body=req.postDataJSON();const event=events.find(row=>row.id===id);
  if(req.method()==='PATCH') {Object.assign(event,body.event,{updatedAt:'2026-10-12T13:00:00Z'});return json(route,{event});}
  if(req.method()==='DELETE') {events=events.filter(row=>row.id!==id);return json(route,{removed:true});}
 }
 if(path.startsWith('/calendar/')) {
  const relative=path.slice('/calendar/'.length)||'index.html';
  const file=resolve(root,'apps/calendar/dist',relative);
  if(!file.startsWith(resolve(root,'apps/calendar/dist')+'/')) return route.abort();
  try {return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)],body:await readFile(file)});} catch {return route.fulfill({status:404,body:'Not found'});}
 }
 return route.abort();
});
async function closeClean(){await page.locator('[data-action="close-event-dialog"]').first().click();await expect(page.locator('dialog')).toHaveCount(0);}
async function discard(){await page.locator('[data-action="close-event-dialog"]').first().click();await page.locator('[data-action="event-discard-confirm"]').click();await expect(page.locator('dialog')).toHaveCount(0);}
async function jump(date){await page.locator('[data-action="jump"]').click();await page.locator('#jump-date').fill(date);await page.locator('#jump-form button[type="submit"]').click();await expect(page.locator('dialog')).toHaveCount(0);}
try {
 await page.goto('https://tempo.test/calendar/');
 await expect(page.locator('#events-status')).toBeHidden();
 await page.locator('[data-action="create-event"]').first().click();
 await expect(page.locator('#event-prompt')).toBeFocused();
 await page.locator('#event-prompt').fill('Souper avec Camille ce soir à 19 h pendant deux heures, au restaurant du quartier');
 await page.screenshot({animations:"disabled",path:resolve(output,'create-desktop.png')});
 await page.locator('#event-interpret-form button[type="submit"]').click();
 await expect(page.locator('#event-review')).toBeVisible();
 await expect(page.locator('#event-title')).toHaveValue(draft.title);
 assert.equal(saved,0,'Interpretation must not save an event');
 await page.screenshot({animations:"disabled",path:resolve(output,'review-desktop.png')});
 await page.locator('#event-save-form button[type="submit"]').evaluate(button=>{button.click();button.click();});
 await expect(page.locator('dialog')).toHaveCount(0);
 assert.equal(saved,1);assert.equal(events.length,1);
 await expect(page.locator('#event-toast')).toContainText('Événement ajouté');
 await page.locator('#event-toast button').click();
 await expect(page.locator('.time-event')).toHaveCount(1);
 await page.locator('.time-event').click();
 await page.locator('#event-title').fill('Souper reporté');
 await page.locator('[name="startTime"]').fill('20:00');await page.locator('[name="endTime"]').fill('22:00');
 await page.locator('#event-save-form button[type="submit"]').click();
 await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events[0].title,'Souper reporté');
 await page.locator('[data-action="month"]').first().click();
 await expect(page.locator('.month-events [data-event-id]')).toHaveCount(1);
 await page.screenshot({animations:"disabled",path:resolve(output,'month-desktop.png')});
 await page.locator('.month-events [data-event-id]').click();
 await page.locator('[data-action="event-delete"]').click();
 await expect(page.locator('#event-delete-confirm')).toBeVisible();assert.equal(events.length,1);
 await page.locator('[data-action="event-delete-cancel"]').click();
 await page.locator('[data-action="event-delete"]').click();
 await page.locator('[data-action="event-delete-confirm"]').click();
 await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events.length,0);
 // Error recovery retains the user's text and allows a manual fallback.
 failAi=true;await page.locator('[data-action="create-event"]').first().click();
 await page.locator('#event-prompt').fill('Dentiste demain à 14 h');
 await page.locator('#event-interpret-form button[type="submit"]').click();
 await expect(page.locator('#event-error')).toContainText('Gemini est occupé');
 await expect(page.locator('#event-prompt')).toHaveValue('Dentiste demain à 14 h');
 await page.locator('[data-action="event-manual"]').click();
 await page.locator('#event-title').fill('Dentiste');await page.locator('[name="allDay"]').check();
 await expect(page.locator('[name="startTime"]')).toBeDisabled();
 failSave=true;await page.locator('#event-save-form button[type="submit"]').click();
 await expect(page.locator('#event-error')).toContainText('connexion');await expect(page.locator('#event-title')).toHaveValue('Dentiste');
 failSave=false;await page.locator('#event-save-form button[type="submit"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events[0].allDay,true);
 // Mobile: no horizontal overflow; natural language, review, edit and confirmation fit.
 failAi=false;await page.setViewportSize({width:390,height:844});
 await page.locator('[data-action="create-event"]').first().click();
 await page.screenshot({animations:"disabled",path:resolve(output,'create-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#event-prompt').fill('Souper avec Camille ce soir à 19 h');
 await page.locator('#event-interpret-form button[type="submit"]').click();await expect(page.locator('#event-review')).toBeVisible();
 assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
 await page.screenshot({animations:"disabled",path:resolve(output,'review-mobile.png')});
 await discard();
 await page.locator('[data-action="create-event"]').first().click();await closeClean();
 // Keyboard shortcut and unsaved-change protection.
 await page.keyboard.press('n');await expect(page.locator('#event-prompt')).toBeFocused();await page.locator('#event-prompt').fill('Un moment à garder');
 await page.keyboard.press('Escape');await expect(page.locator('#event-discard-confirm')).toBeVisible();
 await page.locator('[data-action="event-discard-cancel"]').click();await expect(page.locator('#event-prompt')).toHaveValue('Un moment à garder');await discard();
 // Missing Gemini configuration opens the fully functional manual editor.
 aiAvailable=false;await page.reload();await expect(page.locator('#events-status')).toBeHidden();
 await page.locator('[data-action="create-event"]').first().click();await expect(page.locator('#event-title')).toBeFocused();await expect(page.locator('#manual-panel')).toBeVisible();await closeClean();
 // Compact months expose every event through a visible overflow action.
 await page.setViewportSize({width:390,height:667});
 const now='2026-10-12T14:00:00Z';
 events=Array.from({length:5},(_,index)=>({...draft,id:`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,title:`Rendez-vous ${index+1}`,startTime:`${14+index}:00`,endTime:`${15+index}:00`,createdAt:now,updatedAt:now}));
 await page.reload();await expect(page.locator('#events-status')).toBeHidden();await page.locator('.browse-calendar').click();
 await expect(page.locator('.month-events .more-events')).toBeVisible();
 await page.screenshot({animations:'disabled',path:resolve(output,'month-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Seven readable day columns scroll together in the mobile week view.
 await page.locator('.more-events').click();await page.locator('.view-switch [data-action="week"]').click();
 const week=page.locator('.week-view');
 assert.equal(await week.evaluate(panel=>panel.scrollWidth>panel.clientWidth),true);
 assert.equal(await page.locator('.time-day-heading').first().evaluate(day=>day.getBoundingClientRect().width>=80),true);
 await page.screenshot({animations:'disabled',path:resolve(output,'week-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // Create a biweekly Sunday series manually, retaining one stored event.
 events=[]; aiAvailable=true;await page.setViewportSize({width:1440,height:1000});await page.reload();
 await expect(page.locator('#events-status')).toBeHidden();await page.locator('[data-action="create-event"]').first().click();
 await page.locator('[data-action="event-manual"]').click();await page.locator('#event-title').fill('Souper du dimanche');
 await page.locator('#event-date').fill('2026-10-18');await page.locator('#event-end-date').fill('2026-10-18');
 await page.locator('#event-start').fill('19:00');await page.locator('#event-end').fill('21:00');
 await page.locator('#event-frequency').selectOption('weekly');await page.locator('#event-interval').fill('2');
 await expect(page.getByRole('checkbox',{name:'dimanche',exact:true})).toBeChecked();
 await expect(page.locator('#event-recurrence-summary')).toContainText('Toutes les 2 semaines');
 await page.locator('#event-recurrence-end').selectOption('until');await page.locator('#event-until').fill('2026-11-29');
 await page.screenshot({animations:'disabled',path:resolve(output,'recurrence-desktop.png')});
 await page.locator('#event-save-form button[type="submit"]').click();await expect(page.locator('dialog')).toHaveCount(0);
 assert.equal(events.length,1);assert.deepEqual(events[0].recurrence,{frequency:'weekly',interval:2,weekdays:[0],until:'2026-11-29',count:null});
 await page.locator('#event-toast button').click();await expect(page.locator('.time-event')).toHaveCount(1);
 await jump('2026-10-25');await expect(page.locator('.time-event')).toHaveCount(0);
 await jump('2026-11-01');await expect(page.locator('.time-event')).toHaveCount(1);
 await page.reload();await expect(page.locator('#events-status')).toBeHidden();await page.locator('.browse-calendar').click();
 await jump('2026-11-01');await expect(page.locator('.month-events [data-event-id]')).toHaveCount(3);
 // Future occurrences edit the first occurrence and clearly target the series.
 await page.locator('.month-events [data-event-id]').first().click();await expect(page.locator('#event-dialog-description')).toContainText('toute la série');
 await expect(page.locator('#event-date')).toHaveValue('2026-10-18');await expect(page.locator('#event-interval')).toHaveValue('2');
 await page.locator('#event-recurrence-end').selectOption('count');await page.locator('#event-count').fill('2');
 await page.locator('#event-save-form button[type="submit"]').click();await expect(page.locator('dialog')).toHaveCount(0);
 await expect(page.locator('.month-events [data-event-id]')).toHaveCount(1);
 await page.locator('.month-events [data-event-id]').click();await page.locator('[data-action="event-delete"]').click();
 await expect(page.locator('#event-delete-confirm')).toContainText('Supprimer toute la série');
 await page.locator('[data-action="event-delete-confirm"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events.length,0);
 // Gemini populates the recurrence editor for review; mobile controls fit.
 aiDraft={...draft,date:'2026-10-18',endDate:'2026-10-18',recurrence:{frequency:'weekly',interval:2,weekdays:[0],until:null,count:6}};
 await page.setViewportSize({width:390,height:844});await page.locator('[data-action="create-event"]').first().click();
 await page.locator('#event-prompt').fill('Souper un dimanche sur deux à 19 h pendant deux heures, six fois');
 const savesBeforePreview=saved;
 await page.locator('#event-interpret-form button[type="submit"]').click();await expect(page.locator('#event-review')).toBeVisible();
 assert.equal(saved,savesBeforePreview);await expect(page.locator('#event-frequency')).toHaveValue('weekly');await expect(page.locator('#event-interval')).toHaveValue('2');
 await expect(page.getByRole('checkbox',{name:'dimanche',exact:true})).toBeChecked();await expect(page.locator('#event-count')).toHaveValue('6');
 await page.locator('#event-recurrence-summary').scrollIntoViewIfNeeded();
 await page.screenshot({animations:'disabled',path:resolve(output,'recurrence-mobile.png')});
 assert.equal(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
 // Validate weekday selection, change frequency and save the reviewed series.
 await page.getByRole('checkbox',{name:'dimanche',exact:true}).uncheck();await page.locator('#event-save-form button[type="submit"]').click();
 await expect(page.locator('#event-error')).toContainText('jour de la date de début');assert.equal(events.length,0);
 await page.getByRole('checkbox',{name:'dimanche',exact:true}).check();
 await page.locator('#event-save-form button[type="submit"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events.length,1);
 assert.deepEqual(events[0].recurrence,aiDraft.recurrence);
 // Turning recurrence off removes all future instances; hidden fields do not block saving.
 await page.locator('#event-toast button').click();await page.locator('.time-event').click();
 await page.locator('#event-frequency').selectOption('none');await expect(page.locator('#event-recurrence-options')).toBeHidden();
 await page.locator('#event-save-form button[type="submit"]').click();await expect(page.locator('dialog')).toHaveCount(0);assert.equal(events[0].recurrence,null);
 await jump('2026-11-01');await expect(page.locator('.time-event')).toHaveCount(0);
 assert.deepEqual(errors,[]);assert.equal(interpreted,4);
 console.log(JSON.stringify({result:'passed',checks:['natural-language preview before save','duplicate-click prevention','edit','delete confirmation','AI error/manual fallback','save error/retry','all-day events','mobile overflow','keyboard/focus','unsaved drafts','missing Gemini configuration','biweekly Sundays','recurrence reload and future navigation','series edit and delete','Gemini recurrence preview','mobile recurrence controls','remove recurrence'],screenshots:output}));
} finally {await browser.close();}
