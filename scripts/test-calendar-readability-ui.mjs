// Real Tempo UI with screenshot-shaped fixtures, without remote writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, 'apps/memo/web-app/frontend/package.json'));
const { chromium } = require('playwright'), { expect } = require('@playwright/test');
const output = resolve(root, 'artifacts/calendar-readability'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1590, height: 772 }, locale: 'fr-CA' });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.clock.install({ time: new Date('2026-10-13T17:30:00Z') });
const base = { description: '', date: '2026-10-13', endDate: '2026-10-13', startTime: '02:00', endTime: '03:00', allDay: false, recurrence: null, typeId: 'none', updatedAt: '2026-10-13T12:00:00Z' };
const events = [
 { ...base, id: 'maintenance', title: 'Maintenance serveur le mardi 13 octobre à 02:00 pour une heure' },
 { ...base, id: 'break', title: 'Période de relâche', allDay: true, startTime: null, endTime: null },
 { ...base, id: 'break-two', title: 'Période de relâche (journées sans activité pédagogique)', allDay: true, startTime: null, endTime: null },
 { ...base, id: 'meeting', title: 'Rencontre polyorbite', startTime: '18:00', endTime: '21:00' },
 { ...base, id: 'call', title: 'Appel Sébastien', date: '2026-10-14', endDate: '2026-10-14', startTime: '14:00', endTime: '16:00' },
 { ...base, id: 'short-one', title: 'Premier appel', startTime: '10:00', endTime: '10:05' },
 { ...base, id: 'short-two', title: 'Deuxième appel', startTime: '10:05', endTime: '10:10' },
 { ...base, id: 'late', title: 'Rappel à minuit', startTime: '23:59', endTime: '00:00', endDate: '2026-10-14' },
];
const json = (route, data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
await page.route('**/*', async route => {
 const path = new URL(route.request().url()).pathname;
 if (path === '/memo/api/auth/me') return json(route, { enabled: true, user: { username: 'oli', display_name: 'Oli', must_change_password: false }, accounts: [{ username: 'oli', display_name: 'Oli' }] });
 if (path === '/api/calendar/events') return json(route, { events, eventTypes: [], aiAvailable: true });
 if (path === '/api/library/notifications') return json(route, { documents: [], files: [], failures: [], scanning: 0 });
 if (path.startsWith('/api/')) return json(route, {});
 const file = resolve(root, 'apps/calendar/dist', path.slice('/calendar/'.length) || 'index.html');
 if (!path.startsWith('/calendar/') || !file.startsWith(resolve(root, 'apps/calendar/dist') + '/')) return route.abort();
 return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)], body: await readFile(file) });
});
const readable = async locator => {
 await locator.scrollIntoViewIfNeeded();
 const geometry = await locator.evaluate(card => {
  const title = card.querySelector('.event-chip-title'), text = title.getBoundingClientRect(), rect = card.getBoundingClientRect();
  return { cardHeight: rect.height, titleHeight: text.height, lineHeight: parseFloat(getComputedStyle(title).lineHeight), top: text.top - rect.top, bottom: text.bottom - rect.top };
 });
 assert(geometry.cardHeight >= 29, JSON.stringify(geometry));
 assert(geometry.titleHeight >= geometry.lineHeight - 1 && geometry.top >= 0 && geometry.bottom <= geometry.cardHeight, JSON.stringify(geometry));
};
try {
 for (const view of ['week', 'day']) {
  await page.goto(`https://tempo.test/calendar/?date=2026-10-13&view=${view}`);
  await expect(page.locator('#events-status')).toBeHidden();
  const body = page.locator('.time-body');
  assert(await body.evaluate(element => element.scrollHeight > element.clientHeight + 500));
  await readable(page.locator('.time-event[data-event-id="maintenance"]'));
  await page.screenshot({ path: resolve(output, `${view}-early-desktop.png`) });
  await readable(page.locator('.time-event[data-event-id="short-one"]'));
  await readable(page.locator('.time-event[data-event-id="short-two"]'));
  const first = await page.locator('.time-event[data-event-id="short-one"]').boundingBox();
  const second = await page.locator('.time-event[data-event-id="short-two"]').boundingBox();
  assert(first.x + first.width <= second.x + 1 || second.x + second.width <= first.x + 1, 'Short consecutive events do not cover each other');
  await readable(page.locator('.time-event[data-event-id="late"]'));
  await readable(page.locator('.time-event[data-event-id="meeting"]'));
  const scroll = await body.evaluate(element => element.scrollTop);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(scroll);
  await page.screenshot({ path: resolve(output, `${view}-evening-desktop.png`) });
  // Headers and event columns still line up after reserving the scrollbar.
  const heading = await page.locator('.time-day-heading').first().boundingBox();
  const column = await page.locator('.time-column').first().boundingBox();
  assert(Math.abs(heading.x - column.x) < 2 && Math.abs(heading.width - column.width) < 2);
 }
 for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 667 });
  await page.goto('https://tempo.test/calendar/?date=2026-10-13&view=day');
  await expect(page.locator('#events-status')).toBeHidden();
  await readable(page.locator('.time-event[data-event-id="maintenance"]'));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(output, `day-mobile-${width}.png`) });
 }
 assert.deepEqual(errors, []);
 console.log('Readability UI passed: screenshot-sized week/day, full titles, short-event lanes, last-minute events, refresh scroll retention, aligned headers and mobile.');
} finally { await browser.close(); }
