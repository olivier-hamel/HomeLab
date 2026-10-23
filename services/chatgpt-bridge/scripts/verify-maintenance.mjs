#!/usr/bin/env node
// Attaches a view-only noVNC client. No ChatGPT message, click, or credential entry.
import { join } from 'node:path';
import { loadConfig } from '../dist/config.js';
import { client } from '../dist/client.js';

const config = loadConfig();
process.env.PLAYWRIGHT_BROWSERS_PATH = config.browsersDir;
const { chromium } = await import('playwright');
let browser;
try {
  const session = await client(config)('GET', '/v1/session/maintenance');
  if (session.state !== 'open') throw new Error('Ouvrir d’abord la session avec npm run cli -- session open.');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 980 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(session.url);
  await page.evaluate(() => { localStorage.setItem('noVNC_view_only', 'true'); });
  await page.reload();
  await page.locator('#noVNC_connect_button').click();
  await page.locator('#noVNC_password_input').fill(session.password);
  await page.locator('#noVNC_credentials_button').click();
  await page.waitForFunction(() => document.documentElement.classList.contains('noVNC_connected'), undefined, { timeout: 15000 });
  await page.waitForFunction(() => { const canvas = document.querySelector('#noVNC_container canvas'); return canvas && canvas.width >= 1000 && canvas.height >= 700; });
  if (errors.length) throw new Error(errors.join('; '));
  const screenshot = join(config.dataDir, 'maintenance-check.png');
  await page.screenshot({ path: screenshot });
  console.log(JSON.stringify({ status: 'PASS', check: 'authenticated_vnc_framebuffer', screenshot, chatgpt_messages_sent: 0 }));
} catch (error) { console.error(JSON.stringify({ status: 'FAIL', detail: error.message })); process.exitCode = 1; }
finally { await browser?.close(); }
