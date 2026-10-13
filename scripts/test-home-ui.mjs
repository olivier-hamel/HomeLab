// The new native Accueil app, with real Tempo modules and simulated APIs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, 'apps/memo/web-app/frontend/package.json'));
const { chromium } = require('playwright'), { expect } = require('@playwright/test');
const output = resolve(root, 'artifacts/home');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'fr-CA' });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.install({ time: new Date('2026-10-12T15:15:00Z') });
let user = { username: 'oli', display_name: 'Oli', must_change_password: false }, failEvents = false;
const base = { description: '', date: '2026-10-12', endDate: '2026-10-12', startTime: '10:00', endTime: '12:00', allDay: false, createdAt: '2026-10-10T12:00:00Z', updatedAt: '2026-10-10T12:00:00Z' };
let events = [
  { ...base, id: 'current', title: 'Séance de révision', description: 'Préparer les exercices du prochain cours' },
  { ...base, id: 'next', title: 'Cours de mécanique', startTime: '14:00', endTime: '16:00' },
  { ...base, id: 'series', title: 'Révision hebdomadaire', date: '2026-10-05', endDate: '2026-10-05', startTime: '17:00', endTime: '18:00', recurrence: { frequency: 'weekly', interval: 1, weekdays: [1], count: null, until: null } },
  { ...base, id: 'tomorrow', title: 'Travail d’équipe', date: '2026-10-13', endDate: '2026-10-13' },
  { ...base, id: 'ongoing', title: 'Projet de session', date: '2026-10-11', endDate: '2026-10-14', allDay: true, startTime: '', endTime: '' },
];
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (['www.google.com', 'duckduckgo.com'].includes(url.hostname)) return route.fulfill({ contentType: 'text/html', body: '<title>Recherche simulée</title>Recherche' });
  if (url.pathname.startsWith('/memo/api/auth/')) return json(route, { enabled: true, user, accounts: [{ username: 'oli', display_name: 'Oli' }, { username: 'max', display_name: 'Max' }] });
  if (url.pathname === '/api/calendar/events') return failEvents ? json(route, { error: 'Indisponible' }, 503) : json(route, { events, aiAvailable: true });
  if (url.pathname === '/api/calendar/documents') return json(route, { documents: [], folders: [] });
  if (url.pathname === '/calendar/healthz') return route.fulfill({ body: 'ok' });
  if (url.pathname.startsWith('/calendar/')) {
    const file = resolve(root, 'apps/calendar/dist', url.pathname.slice('/calendar/'.length) || 'index.html');
    if (!file.startsWith(resolve(root, 'apps/calendar/dist') + '/')) return route.abort();
    try { return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)], body: await readFile(file) }); }
    catch { return route.fulfill({ status: 404, body: 'Not found' }); }
  }
  return route.continue();
});
const url = process.env.HOMELAB_UI_URL || 'http://localhost:3000';
const shot = name => page.screenshot({ animations: 'disabled', path: resolve(output, `${name}.png`), fullPage: true });
const ready = () => expect(page.locator('.start-agenda-event')).toHaveCount(4);
const home = async () => { await page.goto(`${url}/?section=home`); await ready(); };
const noOverflow = async () => {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Viewport overflow');
  assert(await page.locator('.start-app').evaluate(element => element.scrollWidth <= element.clientWidth), 'Accueil overflow');
};
try {
  await page.addInitScript(() => {
    if (!localStorage.getItem('home-ui-seeded')) {
      localStorage.setItem('home-ui-seeded', '1');
      localStorage.setItem('tempo:tasks:v1:oli', JSON.stringify([
        { id: 'old-task', title: 'Terminer les exercices de mécanique', completedDate: null },
        { id: 'second-task', title: 'Relire mes notes de cours', completedDate: null },
        { id: 'done-task', title: 'Préparer le sac', completedDate: '2026-10-12' },
      ]));
      localStorage.setItem('clear-calendar:preferences:v1:oli', JSON.stringify({ weekStart: 0, timeFormat: '24', searchEngine: 'duckduckgo' }));
    }
  });
  await page.goto(url); await ready();
  await expect(page.locator('#start-title')).toContainText('Bonjour,');
  await expect(page.locator('#start-title')).toContainText('Oli.');
  await expect(page.locator('#dashboard-navigation button[aria-current]')).toHaveAccessibleName('Accueil');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.start-task-list li')).toHaveCount(3);
  await expect(page.getByLabel('Moteur de recherche')).toHaveValue('duckduckgo');
  await expect(page.locator('.start-upcoming-list')).toContainText('Révision hebdomadaire');
  await expect(page.locator('.start-upcoming-list')).toContainText('Se poursuit');
  await expect(page.locator('.start-event-badge').filter({ hasText: 'En cours' })).toHaveCount(1);
  await noOverflow(); await shot('desktop');

  const input = page.getByLabel('Ajouter une tâche pour aujourd’hui');
  await input.fill('Une nouvelle tâche'); await input.press('Enter');
  await expect(page.locator('.start-task-list li')).toHaveCount(4); await expect(input).toBeFocused();
  const task = page.locator('.start-task-list li').filter({ hasText: 'Une nouvelle tâche' });
  await task.getByRole('checkbox').check(); await expect(task).toHaveClass('is-complete');
  await page.reload(); await ready(); await expect(task.getByRole('checkbox')).toBeChecked();
  await task.getByRole('checkbox').uncheck(); await task.getByRole('button').click();
  await expect(page.locator('.start-task-list li')).toHaveCount(3);
  await input.fill('Brouillon conservé');
  // Let each session response complete before advancing to its timeout.
  for (let cycle = 0; cycle < 2; cycle++) {
    const refreshed = page.waitForResponse(response => response.url().endsWith('/memo/api/auth/me'));
    await page.clock.runFor(30_000);
    await (await refreshed).finished();
  }
  await page.clock.runFor(1_000); await expect(input).toHaveValue('Brouillon conservé'); await expect(input).toBeFocused();

  // Cross-tab task changes use the original per-account key.
  const other = await context.newPage(); await other.goto(`${url}/?section=home`);
  await other.getByLabel('Ajouter une tâche pour aujourd’hui').fill('Depuis un autre onglet');
  await other.getByLabel('Ajouter une tâche pour aujourd’hui').press('Enter');
  await expect(page.locator('.start-task-list')).toContainText('Depuis un autre onglet'); await other.close();

  await page.locator('.start-agenda-event').filter({ hasText: 'Cours de mécanique' }).click();
  await expect(page).toHaveURL(/section=calendar.*date=2026-10-12.*event=next/);
  const frame = page.frameLocator('iframe[title="Tempo — calendrier"]');
  await expect(frame.locator('#event-title')).toHaveValue('Cours de mécanique');
  await expect(frame.locator('.home-page')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Fermer la fenêtre', exact: true }).click();
  await page.goBack(); await ready();
  await page.locator('.start-upcoming-list button').filter({ hasText: 'Révision hebdomadaire' }).click();
  await expect(page).toHaveURL(/date=2026-10-19.*event=series/);
  await expect(frame.locator('#event-title')).toHaveValue('Révision hebdomadaire');
  await page.goBack(); await ready();
  await page.locator('.start-week button').nth(6).click();
  await expect(page).toHaveURL(/date=2026-10-18.*view=day/);
  await expect(frame.locator('.view-switch [data-action="day"]')).toHaveAttribute('aria-pressed', 'true');
  await page.goBack(); await ready();

  // Each launcher navigates to the separate app.
  for (const [selector, section] of [['.start-violet', 'memo'], ['.start-blue', 'library'], ['.start-peach', 'tv'], ['.start-sage', 'calendar']]) {
    await page.locator(selector).click(); await expect(page).toHaveURL(new RegExp(`section=${section}$`));
    await page.goBack(); await ready();
  }
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await noOverflow();
    if (width === 390 || width === 320) await shot(`mobile-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#start-title').click(); await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByLabel('Moteur de recherche').selectOption('google');
  await page.getByRole('searchbox').fill('  mécanique et énergie  '); await page.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/www.google.com\/search\?q=m%C3%A9canique\+et\+%C3%A9nergie/);
  await home(); await page.getByLabel('Moteur de recherche').selectOption('duckduckgo');
  await page.getByRole('searchbox').fill('révision'); await page.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/duckduckgo.com\//); await home();

  failEvents = true; await page.reload();
  await expect(page.locator('.start-agenda')).toContainText('momentanément indisponible');
  await input.fill('Même sans agenda'); await input.press('Enter');
  await expect(page.locator('.start-task-list')).toContainText('Même sans agenda');
  failEvents = false; await page.locator('.start-agenda').getByRole('button', { name: 'Réessayer' }).click(); await ready();
  events = []; await page.reload();
  await expect(page.locator('.start-agenda')).toContainText('Aucun événement prévu aujourd’hui');
  await page.getByRole('button', { name: 'Prévoir un moment' }).click();
  await expect(frame.locator('#event-prompt')).toBeFocused();
  await page.goto(`${url}/?section=calendar`);
  await expect(frame.locator('.month-view')).toBeVisible();
  await expect(frame.locator('[data-action="home"]')).toHaveCount(0);

  // A second account gets its own tasks and preferences.
  user = { ...user, username: 'max', display_name: '<script>Max</script>' };
  await page.goto(`${url}/?section=home`);
  await expect(page.locator('#start-title')).toContainText('<script>Max</script>');
  await expect(page.locator('.start-task-list li')).toHaveCount(0);
  await expect(page.getByLabel('Moteur de recherche')).toHaveValue('google');
  assert.deepEqual(errors, []);
  console.log('Accueil UI passed: migration, tasks, account isolation, search, recurrence, deep links, app navigation, retry and six responsive widths.');
} finally { await browser.close(); }
