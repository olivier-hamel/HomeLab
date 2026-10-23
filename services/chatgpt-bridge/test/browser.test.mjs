import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir } from '../dist/config.js';
import { generateWebTurn, readCompletedAnswer } from '../dist/web-turn.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = join(projectDir, '.local-data/browsers');
const { chromium } = await import('playwright');
const available = existsSync(chromium.executablePath());

test('interface actuelle : un seul formulaire soumis, aucun clic ni Entrée, message accepté et réponse lue', { skip: !available }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<form><div contenteditable="true" data-virtualkeyboard="true"></div><button type="button" aria-label="Stop response" style="display:none">Stop</button><button type="submit" aria-label="Send">Send</button></form>
    <script>window.enters=0;window.stops=0;window.submits=0;window.clicks=0;document.querySelector('[aria-label="Stop response"]').onclick=()=>window.stops++;document.querySelector('[aria-label="Send"]').onclick=()=>window.clicks++;
    document.querySelector('[contenteditable]').addEventListener('keydown',()=>window.enters++);
    document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submits++;const user=document.createElement('div');user.dataset.chatgptSearchUnitKey='test:1:user';user.innerText=document.querySelector('[contenteditable]').innerText;document.body.append(user);const node=document.createElement('div');node.dataset.markdownTextStyle='assistant-message';node.innerText='\u0060\u0060\u0060json\\n{"type":"final","text":"OK"}\\n\u0060\u0060\u0060';document.body.append(node);});</script>`);
  page.goto = async () => null; // Test-only local DOM; no request goes to ChatGPT.com.
  page.url = () => 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111';
  let beforeClose;
  const close = page.close.bind(page);
  page.close = async () => { beforeClose = await page.evaluate(() => ({ enters: window.enters, stops: window.stops, submits: window.submits, clicks: window.clicks })); await close(); };
  const observations = [];
  const result = await generateWebTurn(page, { prompt: 'Question locale', signal: AbortSignal.timeout(5000), requestId: 'local-browser-test' }, value => observations.push(value));
  assert.deepEqual(beforeClose, { enters: 0, stops: 0, submits: 1, clicks: 0 });
  assert.match(result.text, /"text":"OK"/);
  assert.equal(result.conversationId, '11111111-1111-4111-8111-111111111111');
  assert.equal(observations.at(-1).phase, 'completed');
});

test('une génération déjà active interdit toute nouvelle soumission', { skip: !available }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<form><div contenteditable="true" data-virtualkeyboard="true"></div><button aria-label="Stop response">Stop</button></form>');
  page.goto = async () => null;
  page.url = () => 'https://chatgpt.com/';
  const observations = [];
  await assert.rejects(() => generateWebTurn(page, { prompt: 'Ne pas envoyer', signal: AbortSignal.timeout(5000), requestId: 'busy' }, value => observations.push(value)), error => error.code === 'ui_changed' && error.message.includes('already in progress'));
  assert.equal(observations.some(item => item.phase === 'submitted'), false);
});

test('texte stable pendant une génération : attendre la disparition du bouton Stop', { skip: !available }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div data-markdown-text-style="assistant-message">partiel</div><form><button aria-label="Stop response">Stop</button></form>');
  setTimeout(() => { void page.evaluate(() => { document.querySelector('[data-markdown-text-style]').innerText='complet';document.querySelector('button').remove(); }); }, 1200);
  const text = await readCompletedAnswer(page, 0, AbortSignal.timeout(5000));
  assert.equal(text, 'complet');
});

async function documentPage(browser, { fail = false, wait = true, delayed = false } = {}) {
  const page = await browser.newPage();
  await page.setContent(`<form><div contenteditable="true" data-virtualkeyboard="true"></div><input type="file" accept="image/*" style="display:none"><input type="file" multiple style="display:none"><button type="submit" aria-label="Send">Send</button></form>
    <script>
    window.submits=0;window.uploads=[];window.uploadReady=false;window.sentBeforeReady=false;
    document.querySelector('input[multiple]').onchange=async event=>{
      const form=document.querySelector('form'),send=form.querySelector('button');
      for(const file of event.target.files){window.uploads.push({name:file.name,type:file.type,text:await file.text()});const card=document.createElement('span');card.textContent=file.name;form.append(card);}
      const busy=document.createElement('span');busy.setAttribute('role','progressbar');
      const progress=()=>{send.disabled=true;form.append(busy);};
      if(${delayed})setTimeout(progress,300);else progress();
      if(${fail}){const alert=document.createElement('div');alert.setAttribute('role','alert');alert.textContent='Upload failed: unsupported file';document.body.append(alert);}
      else if(${wait})setTimeout(()=>{busy.remove();send.disabled=false;window.uploadReady=true;},700);
    };
    document.querySelector('form').onsubmit=event=>{event.preventDefault();window.submits++;window.sentBeforeReady=!window.uploadReady;const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.innerText=document.querySelector('[contenteditable]').innerText;document.body.append(user);const answer=document.createElement('div');answer.dataset.messageAuthorRole='assistant';answer.innerText='{"type":"final","text":"Read documents"}';document.body.append(answer);};
    </script>`);
  page.goto = async () => null;
  page.url = () => 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111';
  let state;
  const close = page.close.bind(page);
  page.close = async () => {
    state = await page.evaluate(() => ({ submits: window.submits, uploads: window.uploads, sentBeforeReady: window.sentBeforeReady }));
    await close();
  };
  return { page, state: () => state };
}

const localDocuments = [
  { filename: 'rapport.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.7 local test') },
  { filename: 'notes.txt', mimeType: 'text/plain', data: Buffer.from('Local notes') },
];

test('documents : vrais fichiers chargés, attente du téléversement puis une seule soumission', { skip: !available }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const fixture = await documentPage(browser, { delayed: true }), observations = [];
  const result = await generateWebTurn(fixture.page, { prompt: 'Read files', attachments: localDocuments, signal: AbortSignal.timeout(5000), requestId: 'files' }, value => observations.push(value));
  assert.equal(fixture.state().submits, 1);
  assert.equal(fixture.state().sentBeforeReady, false);
  assert.deepEqual(fixture.state().uploads, localDocuments.map(file => ({ name: file.filename, type: file.mimeType, text: file.data.toString() })));
  assert.match(result.text, /Read documents/);
  assert.ok(observations.find(item => item.phase === 'documents_ready'));
});

test('documents : échec ou annulation du téléversement interdit toute soumission', { skip: !available }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const options of [{ fail: true }, { wait: false }]) {
    const fixture = await documentPage(browser, options);
    await assert.rejects(generateWebTurn(fixture.page, { prompt: 'Read files', attachments: localDocuments, signal: AbortSignal.timeout(options.fail ? 5000 : 700), requestId: 'failed-files' }, () => {}));
    assert.equal(fixture.state().submits, 0);
  }
});

test('documents : entrée de fichier absente, aucun repli en texte ni soumission', { skip: !available }, async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const fixture = await documentPage(browser);
  await fixture.page.locator('input[multiple]').evaluate(element => element.remove());
  await assert.rejects(generateWebTurn(fixture.page, { prompt: 'Read', attachments: localDocuments, signal: AbortSignal.timeout(5000), requestId: 'missing-input' }, () => {}), error => error.code === 'ui_changed');
  assert.equal(fixture.state().submits, 0);
});
