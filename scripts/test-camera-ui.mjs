// Browser QA with synthetic HLS. No camera access or real credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, 'apps/memo/web-app/frontend/package.json'));
const { chromium, firefox } = require('playwright'), { expect } = require('@playwright/test');
const output = resolve(root, 'artifacts/camera'), fixture = resolve(output, 'synthetic');
await mkdir(fixture, { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=15', '-t', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-pix_fmt', 'yuv420p', '-an', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0', '-hls_segment_filename', resolve(fixture, 'segment-%09d.ts'), resolve(fixture, 'index.m3u8')]);
const browser = process.env.CAMERA_UI_BROWSER === 'firefox'
  ? await firefox.launch({ headless: true })
  : await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const baseUrl = process.env.HOMELAB_CAMERA_DEV_URL || 'https://camera.test';
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, locale: 'fr-CA' });
const page = await context.newPage(), errors = [], commands = [], streamRequests = [], playerModules = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (/\/hls(?:\.mjs|__js\.js)/.test(response.url())) playerModules.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] });
});
let configured = false, connected = false, failPreset = false, presets = [];
let name = 'Caméra maison';
const status = () => ({ name, model: 'Tapo C200', configured, connected, ptz: connected, presetsSupported: connected, presets, credentialsFromEnv: false, network: { host: '192.168.0.188', mask: '255.255.255.0', gateway: '192.168.0.1', dns: '192.168.0.202' }, ...(configured && !connected ? { issue: 'Connexion impossible. Vérifie le compte caméra et le réseau.' } : {}) });
const json = (route, value, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(value) });
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.startsWith('/memo/api/auth/')) return json(route, { enabled: true, user: { username: 'oli', display_name: 'Oli', must_change_password: false }, accounts: [{ username: 'oli', display_name: 'Oli' }] });
  if (url.pathname === '/api/camera/status') return json(route, status());
  if (url.pathname.startsWith('/api/camera/stream/')) {
    streamRequests.push(url.pathname);
    const file = url.pathname.split('/').at(-1);
    if (!/^(index\.m3u8|segment-\d{9}\.ts)$/.test(file)) return json(route, { error: 'Bad asset' }, 404);
    return route.fulfill({ contentType: file.endsWith('m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', body: await readFile(resolve(fixture, file)) });
  }
  if (url.pathname.startsWith('/api/camera/') && req.method() === 'POST') {
    const body = req.postDataJSON(), action = url.pathname.split('/').at(-1);
    assert.equal(req.headers()['x-camera-request'], '1'); commands.push({ action, body });
    if (action === 'settings') { configured = true; name = body.name; return json(route, status()); }
    if (action === 'preset') {
      if (failPreset) return json(route, { error: 'Ce firmware a refusé le point de vue.' }, 502);
      if (body.action === 'save') presets.push({ name: body.value, token: String(presets.length + 1) });
      if (body.action === 'remove') presets = presets.filter(preset => preset.token !== body.value);
    }
    return json(route, { ok: true });
  }
  if (url.pathname.startsWith('/api/')) return json(route, { events: [], documents: [], folders: [] });
  if (process.env.HOMELAB_CAMERA_DEV_URL) return url.origin === new URL(baseUrl).origin ? route.continue() : route.abort();
  const file = resolve(root, 'frontend/dist', url.pathname.slice(1) || 'index.html');
  if (!file.startsWith(resolve(root, 'frontend/dist') + '/')) return route.abort();
  try { return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(file)], body: await readFile(file) }); }
  catch { return route.fulfill({ status: 404, body: 'Not found' }); }
});
const shot = name => page.screenshot({ animations: 'disabled', path: resolve(output, `${name}.png`), fullPage: true });
const noOverflow = async () => {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Viewport overflow');
  assert(await page.locator('.camera-app').evaluate(element => element.scrollWidth <= element.clientWidth), 'Camera overflow');
  for (const selector of ['.camera-viewer', '.camera-viewer-state', '.camera-player-toolbar']) {
    for (const element of await page.locator(selector).all()) {
      const bounds = await element.boundingBox();
      if (bounds) assert(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, `${selector} is clipped inside its card`);
    }
  }
};
try {
  await page.goto(`${baseUrl}/?section=camera`);
  await expect(page.getByRole('heading', { name: 'Ta maison, bientôt ici.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Orienter vers le haut' })).toBeDisabled();
  await noOverflow(); await shot('desktop-setup');
  await page.getByRole('button', { name: 'Connecter ma caméra' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.camera-network summary').click(); await expect(page.getByText('192.168.0.202', { exact: true })).toBeVisible();
  await page.getByLabel('Nom de la caméra').fill('Salon');
  await page.getByLabel('Utilisateur du compte caméra').fill('fixture-user');
  await page.getByLabel('Mot de passe du compte caméra', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Afficher le mot de passe' }).click();
  await expect(page.getByLabel('Mot de passe du compte caméra', { exact: true })).toHaveAttribute('type', 'text');
  await shot('desktop-settings');
  await page.getByRole('dialog').getByRole('button', { name: 'Connecter ma caméra', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.camera-device-status')).toHaveText('Hors ligne'); await shot('desktop-offline');
  connected = true;
  await page.getByRole('button', { name: 'Relancer le direct', exact: true }).first().click();
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT', { timeout: 20_000 });
  await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByRole('button', { name: 'Capture', exact: true })).toBeEnabled();
  await shot('desktop-synthetic-live');
  await page.getByRole('button', { name: 'Orienter vers la gauche' }).click();
  await expect(page.getByRole('button', { name: 'Orienter vers la gauche' })).toBeEnabled();
  assert(commands.some(command => command.action === 'move' && command.body.direction === 'left' && command.body.speed === 0.5));
  await page.getByRole('button', { name: 'Douce', exact: true }).click();
  await page.getByRole('button', { name: 'Orienter vers le haut' }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Orienter vers la droite' })).toBeEnabled();
  assert(commands.some(command => command.body.direction === 'right' && command.body.speed === 0.25));
  await page.getByRole('button', { name: 'Arrêter le mouvement' }).click();
  await page.getByLabel('Zoom numérique').focus(); await page.keyboard.press('Home'); for (let index = 0; index < 10; index++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('video')).toHaveCSS('transform', 'matrix(2, 0, 0, 2, 0, 0)');
  await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  await page.getByRole('button', { name: 'Activer le son' }).click();
  assert.equal(await page.locator('video').evaluate(video => video.muted), false);
  await page.getByRole('button', { name: 'Couper le son' }).click();
  await page.getByLabel('Qualité du flux').selectOption('sd');
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT', { timeout: 20_000 });
  assert(streamRequests.some(path => path.includes('/sd/')));
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await expect(page.locator('.camera-recent-grid button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Enregistrer cet angle', exact: true }).click();
  await page.getByLabel('Nom du point de vue').fill('Entrée'); failPreset = true;
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Ce firmware a refusé');
  await expect(page.getByLabel('Nom du point de vue')).toBeVisible();
  failPreset = false; await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('.camera-presets li')).toHaveCount(1);
  await page.getByRole('button', { name: '01 Entrée' }).click();
  await page.getByRole('button', { name: 'Mettre le direct en pause' }).click();
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reprendre le direct', exact: true }).first().click();
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Afficher le flux en plein écran' }).click();
  await expect(page.getByRole('button', { name: 'Quitter le plein écran' })).toBeVisible(); await page.getByRole('button', { name: 'Quitter le plein écran' }).click(); await expect(page.getByRole('button', { name: 'Quitter le plein écran' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Captures/ }).click(); await expect(page.locator('.camera-gallery-grid article')).toHaveCount(1);
  await page.locator('.camera-gallery-image').click(); await expect(page.getByRole('dialog')).toBeVisible(); await shot('desktop-capture');
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Télécharger', exact: true }).click();
  assert.match((await download).suggestedFilename(), /^tapo-.*\.jpg$/);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(); await shot('mobile-gallery');
  await page.getByRole('button', { name: 'Retour au direct' }).click(); await noOverflow();
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT', { timeout: 20_000 });
  await shot('mobile-synthetic-live');
  await page.getByRole('button', { name: 'Supprimer le point de vue Entrée' }).click(); await expect(page.locator('.camera-presets li')).toHaveCount(0);
  configured = false; connected = false;
  await page.goto(`${baseUrl}/?section=camera`); await expect(page.getByRole('heading', { name: 'Ta maison, bientôt ici.' })).toBeVisible(); await noOverflow(); await shot('mobile-setup');
  await page.getByRole('button', { name: 'Connecter ma caméra' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); await shot('mobile-settings');
  await page.keyboard.press('Escape'); await page.setViewportSize({ width: 320, height: 740 }); await noOverflow(); await shot('small-setup');
  await page.getByRole('button', { name: /^Captures/ }).click(); await expect(page.getByRole('heading', { name: 'Le premier instant est à venir.' })).toBeVisible(); await noOverflow();
  assert.deepEqual(errors, []);
  if (process.env.HOMELAB_CAMERA_DEV_URL) {
    assert(playerModules.length > 0, 'HLS.js must load from the actual dev server');
    assert(playerModules.every(module => module.status === 200 && module.type?.includes('javascript') && !module.url.includes('/.vite/deps/')), 'HLS.js must load as JavaScript independently of the optimizer cache');
    console.log('Development module serving verified:', playerModules);
  }
  console.log('Camera UI passed: setup, offline recovery, real HLS playback, movement, presets, audio, zoom, snapshots, downloads, pause, fullscreen and 1440/390/320 px layouts.');
} finally { await browser.close(); }
