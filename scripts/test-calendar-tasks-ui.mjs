// Built HomeLab and authored Tempo, mocked transport, no remote writes or AI calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, 'apps/memo/web-app/frontend/package.json'));
const { chromium } = require('playwright'), { expect } = require('@playwright/test');
const output = resolve(root, 'artifacts/calendar-tasks'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'fr-CA' });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.clock.install({ time: new Date('2026-10-13T16:00:00Z') });
const date = '2026-10-13';
let events = [], writes = 0, revision = 0, failWrites = false;
const draft = { title: 'Remettre le TP', description: '', kind: 'task', completed: false, deadline: { date, time: '23:59' }, date, endDate: date, startTime: '23:59', endTime: '23:59', allDay: false, recurrence: null, typeId: 'none', notes: '', links: [], documentIds: [], context: { kind: 'course', name: 'INF2705' } };
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  if (path.startsWith('/memo/api/auth/')) return json(route, { enabled: true, user: { username: 'oli', display_name: 'Oli', must_change_password: false }, accounts: [{ username: 'oli', display_name: 'Oli' }] });
  if (path === '/calendar/healthz') return route.fulfill({ body: 'ok' });
  if (path === '/api/library/notifications') return json(route, { documents: [], files: [{ id: 'doc', name: 'Énoncé.pdf' }], scanning: 0, failures: [], aiAvailable: true });
  if (path === '/api/calendar/interpret') return json(route, { event: draft, clarification: null });
  if (path === '/api/calendar/events' && req.method() === 'GET') return json(route, { events, aiAvailable: true, eventTypes: [{ id: 'none', name: 'aucun', importance: 3, hidden: true }] });
  if (path.startsWith('/api/calendar/events') && req.method() !== 'GET') {
    if (failWrites) return json(route, { error: 'Connexion interrompue', code: 'unavailable' }, 503);
    writes++; const body = req.postDataJSON(), id = path.split('/')[4] || body.requestId;
    if (req.method() === 'DELETE') { events = events.filter(event => event.id !== id); return json(route, { removed: true }); }
    const previous = events.find(event => event.id === id);
    const event = { ...previous, ...body.event, id, createdAt: previous?.createdAt || '2026-10-13T12:00:00Z', updatedAt: new Date(Date.parse('2026-10-13T12:00:00Z') + ++revision).toISOString() };
    if (body.completed !== undefined) Object.assign(event, { completed: body.completed, completedAt: body.completed ? '2026-10-13T16:00:00Z' : null });
    events = [...events.filter(row => row.id !== id), event]; return json(route, { event });
  }
  if (path.startsWith('/api/')) return json(route, { error: 'Unused fixture route' }, 503);
  const directory = path.startsWith('/calendar/') ? 'apps/calendar/dist' : 'frontend/dist';
  const relative = path.startsWith('/calendar/') ? path.slice('/calendar/'.length) || 'index.html' : path.slice(1) || 'index.html';
  const file = resolve(root, directory, relative);
  if (!file.startsWith(resolve(root, directory) + '/')) return route.abort();
  try { return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[extname(file)], body: await readFile(file) }); }
  catch { return route.fulfill({ status: 404, body: 'Not found' }); }
});
try {
  await page.goto(`https://planner.test/calendar/?date=${date}`);
  await expect(page.locator('#events-status')).toBeHidden();
  await page.locator('[data-action="create-event"]').first().click();
  await page.locator('#event-prompt').fill('Remettre le TP du cours INF2705 ce soir à 23 h 59');
  await page.locator('#event-interpret-form button[type="submit"]').click();
  await expect(page.locator('#event-kind')).toHaveValue('task'); assert.equal(writes, 0);
  await expect(page.locator('#event-end-datetime')).toBeHidden();
  await expect(page.locator('#event-date-label')).toHaveText('Échéance');
  await page.locator('#task-notes').fill('Relire les résultats');
  await page.locator('#task-links').fill('https://example.org/enonce');
  await page.locator('[name="documentIds"]').check();
  await page.screenshot({ path: resolve(output, 'task-dialog-desktop.png') });
  await page.locator('#event-save-form button[type="submit"]').click();
  await expect(page.locator('dialog')).toHaveCount(0); assert.equal(events.length, 1);
  await page.locator('[data-action="toggle-task"]').first().click();
  await expect(page.locator('[data-action="toggle-task"]').first()).toHaveAttribute('aria-checked', 'true');
  await page.reload(); await expect(page.locator('[data-action="toggle-task"]').first()).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-action="toggle-task"]').first().click();
  await expect(page.locator('[data-action="toggle-task"]').first()).toHaveAttribute('aria-checked', 'false');
  await page.locator('.calendar-task-open').first().click();
  await expect(page.locator('#task-notes')).toHaveValue('Relire les résultats');
  await expect(page.locator('[name="documentIds"]')).toBeChecked();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.locator('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1));
    await page.screenshot({ path: resolve(output, `task-dialog-mobile-${width}.png`) });
  }
  await page.locator('[data-action="close-event-dialog"]').first().click();
  await page.goto('https://planner.test/?section=home');
  await expect(page.locator('.start-task-list')).toContainText('Remettre le TP');
  await page.locator('.start-task-list input[type="checkbox"]').check();
  await expect(page.locator('.start-task-list li')).toHaveClass('is-complete');
  await page.reload(); await expect(page.locator('.start-task-list input[type="checkbox"]')).toBeChecked();
  await page.locator('.start-task-list input[type="checkbox"]').uncheck();
  failWrites = true;
  await page.locator('.start-task-list input[type="checkbox"]').click();
  await expect(page.locator('.start-task-error')).toContainText('Connexion interrompue');
  failWrites = false; await expect(page.locator('.start-task-list input[type="checkbox"]')).not.toBeChecked();
  await page.getByLabel('Ajouter une tâche pour aujourd’hui').fill('Réviser la mécanique');
  await page.getByLabel('Ajouter une tâche pour aujourd’hui').press('Enter');
  await expect(page.locator('.start-task-list li')).toHaveCount(2);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.screenshot({ path: resolve(output, `home-tasks-${width}.png`) });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, class: typeof element.className === 'string' ? element.className : '', right: element.getBoundingClientRect().right })).filter(element => element.right > innerWidth + 1).slice(0, 12) }));
    assert(overflow.scroll <= overflow.width, JSON.stringify(overflow));
  }
  await page.locator('.start-task-details').filter({ hasText: 'Remettre le TP' }).click();
  const frame = page.frameLocator('iframe[title="Tempo — calendrier"]');
  await expect(frame.locator('#event-title')).toHaveValue('Remettre le TP');
  await expect(frame.locator('#task-links')).toHaveValue('https://example.org/enonce');
  await frame.locator('[data-action="event-delete"]').click();
  await frame.locator('[data-action="event-delete-confirm"]').click();
  await expect(frame.locator('dialog')).toHaveCount(0);
  await page.goBack(); await expect(page.locator('.start-task-list li')).toHaveCount(1);
  await page.goto(`https://planner.test/calendar/?date=${date}`);
  await page.locator('[data-action="create-event"]').first().click();
  await page.locator('[data-action="event-manual"]').click();
  await page.locator('#event-kind').selectOption('task');
  await page.locator('#event-title').fill('Organiser les photos');
  await page.locator('[name="hasDeadline"]').uncheck();
  await page.locator('#task-context-kind').selectOption('project');
  await page.locator('#task-context-name').fill('Photos');
  await page.locator('#event-save-form button[type="submit"]').click();
  await expect(page.locator('dialog')).toHaveCount(0);
  const undated = events.find(event => event.title === 'Organiser les photos');
  assert.equal(undated.deadline, null); assert.equal(undated.context.kind, 'project');
  await expect(page.locator('.calendar-task-open').filter({ hasText: 'Organiser les photos' })).toHaveCount(0);
  await page.goto('https://planner.test/?section=home');
  await expect(page.locator('.start-task-details').filter({ hasText: 'Organiser les photos' })).toContainText('Sans échéance');
  assert.deepEqual(errors, []);
  console.log('Task UI passed: chat classification, timed deadline, notes/links/documents/course, save/reload/reopen, HomeLab completion, failed writes, deep links, deletion and desktop/mobile layouts.');
} finally { await browser.close(); }
