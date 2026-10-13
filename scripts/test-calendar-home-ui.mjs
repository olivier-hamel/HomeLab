// Real Tempo UI, local assets and simulated APIs; no external search or account calls.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/memo/web-app/frontend/package.json'));
const {chromium} = require('playwright');
const {expect} = require('@playwright/test');
const output = resolve(root, 'artifacts/calendar-home');
await mkdir(output, {recursive: true});
const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox']});
const errors = [];
const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'fr-CA'});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
await page.clock.install({time: new Date('2026-10-12T15:15:00Z')});
let events = [], failEvents = false;
let account = {username: 'oli', display_name: 'Oli', must_change_password: false};
const json = (route, data, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});
await page.context().route('**/*', async route => {
  const url = new URL(route.request().url());
  if (['www.google.com', 'duckduckgo.com'].includes(url.hostname)) return route.fulfill({contentType: 'text/html', body: '<title>Recherche simulée</title>Recherche'});
  if (url.pathname === '/memo/api/auth/me') return json(route, {enabled: true, user: account});
  if (url.pathname === '/api/calendar/events') return failEvents ? json(route, {error: 'Connexion indisponible. Réessaie.'}, 503) : json(route, {events, aiAvailable: true});
  if (url.pathname === '/api/calendar/documents') return json(route, {documents: [], aiAvailable: true});
  if (url.pathname === '/frame-test') return route.fulfill({contentType: 'text/html', body: '<iframe title="Tempo" src="/calendar/" style="width:100%;height:95vh;border:0"></iframe>'});
  if (url.pathname.startsWith('/calendar/')) {
    const file = resolve(root, 'apps/calendar/dist', url.pathname.slice('/calendar/'.length) || 'index.html');
    if (!file.startsWith(resolve(root, 'apps/calendar/dist') + '/')) return route.abort();
    try {return route.fulfill({contentType: ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'})[extname(file)], body: await readFile(file)});} catch {return route.fulfill({status: 404, body: 'Not found'});}
  }
  return route.abort();
});
const event = (id, title, date, startTime = '14:00', endTime = '15:00', extra = {}) => ({id, title, description: '', date, endDate: date, startTime, endTime, allDay: false, createdAt: '2026-10-12T12:00:00Z', updatedAt: '2026-10-12T12:00:00Z', ...extra});
const loadHome = async () => {await page.goto('https://tempo.test/calendar/'); await expect(page.locator('#events-status')).toBeHidden();};
const fits = async () => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal page overflow');
  assert.equal(await page.locator('#calendar-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'No horizontal content overflow');
};
try {
  await loadHome();
  await expect(page.locator('#home-title')).toHaveText('Bonjour, Oli.');
  await expect(page.locator('.home-agenda')).toContainText('Tu n’as aucun événement prévu aujourd’hui.');
  await expect(page.locator('#home-search-input')).toBeFocused();
  await fits();
  await page.locator('#home-search-input').blur();
  await page.screenshot({animations: 'disabled', path: resolve(output, 'home-empty-desktop.png')});
  // Engine changes preserve the query, the selection and the saved preference.
  await page.locator('#home-search-input').fill('  café & idées / demain?  ');
  await page.locator('#search-duckduckgo').check();
  await expect(page.locator('#home-search-input')).toHaveValue('  café & idées / demain?  ');
  await expect(page.locator('#search-duckduckgo')).toBeChecked();
  await expect(page.locator('#home-search-form')).toHaveAttribute('action', 'https://duckduckgo.com/');
  await page.locator('.home-search-submit').click();
  await page.waitForURL('https://duckduckgo.com/**');
  assert.equal(new URL(page.url()).searchParams.get('q'), 'café & idées / demain?');
  await loadHome();
  await expect(page.locator('#search-duckduckgo')).toBeChecked();
  await page.locator('#search-google').check();
  await page.locator('#home-search-input').fill('Tempo Montréal');
  await page.locator('#home-search-input').press('Enter');
  await page.waitForURL('https://www.google.com/search?**');
  assert.equal(new URL(page.url()).searchParams.get('q'), 'Tempo Montréal');
  await loadHome();
  // Whitespace never sends an empty query or creates an empty task.
  await page.locator('#home-search-input').fill('   ');
  await page.locator('#home-search-input').press('Enter');
  assert.equal(page.url(), 'https://tempo.test/calendar/');
  assert.equal(await page.locator('#home-search-input').evaluate(input => input.validity.valid), false);
  await page.locator('#home-search-input').fill('Un brouillon à garder');
  await page.locator('#home-task-title').fill('   ');
  await page.locator('#home-task-title').press('Enter');
  await expect(page.locator('.home-task')).toHaveCount(0);
  for (const title of ['Faire les courses', 'Lire vingt minutes', '<img src=x onerror=alert(1)>']) {
    await page.locator('#home-task-title').fill(title);
    await page.locator('#home-task-title').press('Enter');
    await expect(page.locator('#home-task-title')).toBeFocused();
  }
  await expect(page.locator('.home-task')).toHaveCount(3);
  await expect(page.locator('.home-task img')).toHaveCount(0);
  await page.locator('.home-task input').first().check();
  await expect(page.locator('.task-progress')).toHaveText('1 sur 3 terminée');
  await expect(page.locator('.home-task input').first()).toBeFocused();
  await page.locator('.home-task input').first().uncheck();
  await page.locator('.home-task .task-remove').last().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.home-task')).toHaveCount(2);
  // Async event refresh and navigation retain both drafts and the text cursor.
  await page.locator('#home-task-title').fill('Appeler le dentiste');
  await page.locator('#home-task-title').evaluate(input => input.setSelectionRange(3, 9));
  await page.clock.runFor(60_000);
  await expect(page.locator('#home-task-title')).toHaveValue('Appeler le dentiste');
  assert.deepEqual(await page.locator('#home-task-title').evaluate(input => [input.selectionStart, input.selectionEnd]), [3, 9]);
  await expect(page.locator('#home-search-input')).toHaveValue('Un brouillon à garder');
  await page.locator('.browse-calendar').click();
  await page.locator('.sidebar [data-action="home"]').first().click();
  await expect(page.locator('#home-search-input')).toHaveValue('Un brouillon à garder');
  await expect(page.locator('#home-task-title')).toHaveValue('Appeler le dentiste');
  await page.reload();
  await expect(page.locator('#events-status')).toBeHidden();
  await expect(page.locator('.home-task')).toHaveCount(2);
  // Several new tabs stay in sync without discarding a query being written.
  const sibling = await page.context().newPage();
  sibling.on('pageerror', error => errors.push(error.message));
  await sibling.clock.install({time: new Date('2026-10-12T15:15:00Z')});
  await sibling.goto('https://tempo.test/calendar/');
  await expect(sibling.locator('#events-status')).toBeHidden();
  await page.locator('#home-search-input').fill('Une recherche en cours');
  await sibling.locator('#home-task-title').fill('Planifier la semaine');
  await sibling.locator('#home-task-title').press('Enter');
  await expect(page.locator('.home-task')).toHaveCount(3);
  await sibling.locator('.home-task input').first().check();
  await expect(page.locator('.home-task input').first()).toBeChecked();
  await page.locator('.home-task input').first().uncheck();
  await expect(sibling.locator('.home-task input').first()).not.toBeChecked();
  await sibling.locator('#search-duckduckgo').check();
  await expect(page.locator('#search-duckduckgo')).toBeChecked();
  await expect(page.locator('#home-search-input')).toHaveValue('Une recherche en cours');
  await page.locator('#search-google').check();
  await expect(sibling.locator('#search-google')).toBeChecked();
  await page.locator('.home-task .task-remove').last().focus();
  await page.keyboard.press('Enter');
  await expect(sibling.locator('.home-task')).toHaveCount(2);
  await sibling.close();
  // A Sunday start shows Monday and later events across the week boundary.
  events = [
    event('past', 'Rendez-vous déjà passé', '2026-10-11'),
    event('morning', 'Lecture du matin', '2026-10-12', '09:00', '10:00'),
    event('next', 'Pause pour marcher', '2026-10-12', '12:00', '12:30'),
    event('dinner', 'Souper avec Camille', '2026-10-12', '19:00', '21:00', {description: 'Au restaurant du quartier'}),
    event('tomorrow', 'Dentiste', '2026-10-13', '10:00', '11:00'),
    event('weekend', 'Souper du dimanche', '2026-10-18', '19:00', '21:00', {recurrence: {frequency: 'weekly', interval: 1, weekdays: [0], count: null, until: null}}),
    event('next-week', 'Remettre le projet', '2026-10-20', null, null, {allDay: true}),
  ];
  await loadHome();
  await expect(page.locator('.today-event')).toHaveCount(3);
  await expect(page.locator('.today-event.is-past')).toHaveCount(1);
  await expect(page.locator('.today-event-status')).toHaveText('À suivre');
  await expect(page.locator('.upcoming-event')).toHaveCount(3);
  await expect(page.locator('.upcoming-event-list')).not.toContainText('Rendez-vous déjà passé');
  await expect(page.locator('.upcoming-event-list')).toContainText('Remettre le projet');
  await page.locator('.home-task input').first().check();
  await page.locator('#home-search-input').blur();
  await page.screenshot({animations: 'disabled', path: resolve(output, 'home-desktop.png')});
  // Agenda rows continue to open the existing event editor.
  await page.locator('.today-event').last().click();
  await expect(page.locator('#event-title')).toHaveValue('Souper avec Camille');
  await page.locator('[data-action="close-event-dialog"]').first().click();
  await expect(page.locator('dialog')).toHaveCount(0);
  for (const [width, height] of [[1280, 800], [1024, 768], [768, 1024], [720, 900], [390, 844], [320, 667]]) {
    await page.setViewportSize({width, height});
    await fits();
    await page.locator('#calendar-content').evaluate(element => element.scrollTop = 0);
    await page.screenshot({animations: 'disabled', path: resolve(output, `home-${width}.png`)});
    if (width === 1280) {
      const formBounds = await page.locator('.home-task-form').boundingBox();
      const contentBounds = await page.locator('#calendar-content').boundingBox();
      assert(formBounds.y + formBounds.height <= contentBounds.y + contentBounds.height, 'Task entry stays visible on a 1280 × 800 desktop');
    }
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('.home-tasks').scrollIntoViewIfNeeded();
  await page.screenshot({animations: 'disabled', path: resolve(output, 'home-tasks-mobile.png')});
  await page.locator('.upcoming-card').scrollIntoViewIfNeeded();
  await page.screenshot({animations: 'disabled', path: resolve(output, 'home-upcoming-mobile.png')});
  // Long content, large text and reduced motion stay usable.
  await page.setViewportSize({width: 1440, height: 1000});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.locator('html').evaluate(element => element.style.zoom = '2');
  await fits();
  await page.locator('html').evaluate(element => element.style.zoom = '1');
  await page.locator('#home-search-input').blur();
  await page.locator('.home-card-link').first().focus();
  await page.keyboard.press('/');
  await expect(page.locator('#home-search-input')).toBeFocused();
  await page.locator('#home-task-title').fill('x'.repeat(160));
  await page.locator('#home-task-title').press('Enter');
  await page.setViewportSize({width: 320, height: 667});
  await fits();
  // Unfinished tasks carry forward; yesterday's completed tasks leave today's list.
  await page.clock.setSystemTime(new Date('2026-10-13T15:15:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.home-date')).toContainText('mardi 13 octobre');
  await expect(page.locator('.home-task')).toHaveCount(2);
  await expect(page.locator('.home-task-list')).not.toContainText('Faire les courses');
  // Account isolation and storage failure do not compromise the search or agenda.
  account = {username: 'max', display_name: 'Max', must_change_password: false};
  await loadHome();
  await expect(page.locator('.home-task')).toHaveCount(0);
  await expect(page.locator('#search-google')).toBeChecked();
  failEvents = true;
  await page.reload();
  await expect(page.locator('#events-status')).toContainText('Connexion indisponible');
  await expect(page.locator('.home-agenda')).not.toContainText('Ta journée est libre');
  await expect(page.locator('.upcoming-card')).not.toContainText('Aucun événement');
  failEvents = false;
  await page.locator('#events-status [data-action="events-retry"]').click();
  await expect(page.locator('#events-status')).toBeHidden();
  await page.addInitScript(() => {Storage.prototype.setItem = () => {throw new Error('Storage disabled');};});
  await loadHome();
  await page.locator('#home-task-title').fill('Une tâche pour cette session');
  await page.locator('#home-task-title').press('Enter');
  await expect(page.locator('.home-tasks-note')).toHaveText('Conservées pour cette session');
  // A form inside HomeLab's iframe navigates the complete tab, not the embedded frame.
  await page.goto('https://tempo.test/frame-test');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#home-search-input')).toBeVisible();
  await frame.locator('#search-duckduckgo').check();
  await frame.locator('#home-search-input').fill('Une recherche depuis HomeLab');
  await frame.locator('#home-search-input').press('Enter');
  await page.waitForURL('https://duckduckgo.com/**');
  assert.equal(new URL(page.url()).searchParams.get('q'), 'Une recherche depuis HomeLab');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({result: 'passed', checks: ['Google and DuckDuckGo searches', 'query encoding and validation', 'saved engine per account', 'multiple tab synchronization', 'task add/check/remove/reload', 'safe text rendering', 'draft and cursor preservation', 'future events across weeks', 'event editing', 'six responsive sizes', '200% zoom', 'keyboard shortcuts', 'task rollover', 'account isolation', 'API error recovery', 'storage failure', 'iframe search navigation'], screenshots: output}));
} finally {await browser.close();}
