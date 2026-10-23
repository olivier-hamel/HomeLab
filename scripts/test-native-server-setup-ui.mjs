// Exercise the APK setup screen with the built frontend and a simulated bridge.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, 'apps/memo/web-app/frontend/package.json'));
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const dist = resolve(root, 'frontend/dist');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
const saves = [];
page.on('pageerror', error => errors.push(error.message));
await page.exposeFunction('recordServerSave', options => saves.push(options));
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === '192.0.2.1') {
    return route.fulfill({ contentType: 'text/html', body: '<h1>HomeLab destination fixture</h1>' });
  }
  if (url.hostname !== 'localhost') return route.abort();
  const asset = resolve(dist, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
  if (!asset.startsWith(dist + sep)) return route.abort();
  const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(asset)];
  try { await route.fulfill({ contentType, body: await readFile(asset) }); }
  catch { await route.fulfill({ status: 404, body: 'Not found' }); }
});
await page.addInitScript(() => {
  window.androidBridge = {};
  window.setupFixture = { mode: 'pending', saves: 0 };
  window.Capacitor = {
    PluginHeaders: [
      { name: 'Preferences', methods: [{ name: 'get', rtype: 'promise' }, { name: 'set', rtype: 'promise' }] },
      { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] },
    ],
    nativeCallback() { return 'listener'; },
    nativePromise(plugin, method, options) {
      if (plugin === 'Preferences' && method === 'get') return Promise.resolve({ value: null });
      if (plugin === 'Preferences' && method === 'set' && options.key === 'homelab-server-url') {
        window.setupFixture.saves++;
        if (window.setupFixture.mode === 'reject') return Promise.reject(new Error('Could not save the server address.'));
        if (window.setupFixture.mode === 'resolve') return window.recordServerSave(options);
        return new Promise(() => {});
      }
      return Promise.resolve({});
    },
  };
});

try {
  await page.goto('https://localhost/');
  const address = page.getByLabel('HomeLab address');
  const connect = page.getByRole('button', { name: 'Connect', exact: true });
  await expect(connect).toBeVisible();
  await address.fill('ftp://192.0.2.1');
  await connect.click();
  await expect(page.getByRole('alert')).toContainText('HTTP or HTTPS');
  await expect(connect).toBeEnabled();
  assert.equal(await page.evaluate(() => window.setupFixture.saves), 0);

  await address.fill('https://192.0.2.1:3443');
  await page.evaluate(() => { window.setupFixture.mode = 'reject'; });
  await connect.click();
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(address).toHaveValue('https://192.0.2.1:3443');

  await page.evaluate(() => { window.setupFixture.mode = 'pending'; });
  await connect.click();
  await expect(page.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  await expect(address).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('homelab:server-error', {
    detail: { message: "This Fire TV does not trust the server's HTTPS certificate." },
  })));
  await expect(page.getByRole('alert')).toContainText('does not trust');
  await expect(connect).toBeEnabled();
  await expect(address).toHaveValue('https://192.0.2.1:3443');

  await page.clock.install();
  await connect.click();
  await expect(page.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('alert')).toContainText('network connection');
  await expect(connect).toBeEnabled();

  await page.evaluate(() => { window.setupFixture.mode = 'resolve'; });
  await connect.click();
  await expect(page).toHaveURL('https://192.0.2.1:3443/?tv=1');
  await expect(page.getByRole('heading')).toHaveText('HomeLab destination fixture');
  assert.deepEqual(saves, [{ key: 'homelab-server-url', value: 'https://192.0.2.1:3443' }]);
  assert.deepEqual(errors, []);
  console.log('PASS: setup validation, save failure, connecting state, native certificate errors, timeout, retry, and saved-server navigation');
} finally {
  await browser.close();
}
