// Run after `npm --prefix frontend run build`. All media/account APIs are fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(root, 'apps/memo/web-app/frontend/package.json'));
const { chromium } = require('playwright'), { expect } = require('@playwright/test');
const output = join(root, 'artifacts/media-downloads'); await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'homelab-downloads-ui-'));
await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', join(temporary, 'key.pem'), '-out', join(temporary, 'cert.pem')]);
await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12', '-t', '3', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(temporary, 'video.mp4')]);
const video = await readFile(join(temporary, 'video.mp4'));
const dist = join(root, 'frontend/dist');
const server = createServer({ key: await readFile(join(temporary, 'key.pem')), cert: await readFile(join(temporary, 'cert.pem')) }, async (request, response) => {
  try {
    const path = resolve(dist, `.${new URL(request.url, 'http://localhost').pathname}`);
    if (!path.startsWith(`${dist}/`) && path !== dist) { response.writeHead(404).end(); return; }
    const file = path === dist || !extname(path) ? join(dist, 'index.html') : path;
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `https://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'fr-CA', ignoreHTTPSErrors: true });
const errors = [], requests = [], downloads = [];
page.on('pageerror', error => errors.push(error.message));
const account = { enabled: true, user: { username: 'oli', display_name: 'Oli', must_change_password: false }, accounts: [{ username: 'oli', display_name: 'Oli' }] };
const movie = { id: 1, kind: 'movie', title: 'Fixture Movie', year: '2026', overview: 'A locally generated test movie.', poster: null };
const show = { ...movie, id: 2, kind: 'tv', title: 'Fixture Show' };
let intent;
const file = () => ({ id: 1, path: intent?.context?.kind === 'tv' ? 'Fixture.Show.S01E02.mp4' : 'Fixture.Movie.mp4', kind: 'video', sample: false, size: video.length });
const status = (downloaded = false) => ({ id: downloaded ? 'local-session' : 'torrent-session', title: 'Fixture video', state: 'ready', files: [file()], downloaded, downloadSpeed: 0, connectedPeers: 0, downloadedBytes: video.length, completedBytes: video.length, preloadBytes: video.length, preloadTarget: video.length });
await page.route('**/memo/api/auth/**', route => route.fulfill({ json: account }));
await page.route('**/api/library**', route => route.fulfill({ json: { folders: [], files: [], semester: 'A26', maxFileBytes: 25000000, moodleAvailable: false, sync: { status: 'idle', message: '', lastAttempt: null, lastSuccess: null, saved: 0, total: 0 } } }));
await page.route('**/api/media/**', async route => {
  const request = route.request(), url = new URL(request.url()), path = url.pathname.slice('/api/media/'.length), body = request.postDataJSON();
  requests.push(path);
  let data;
  if (path === 'status') data = { tmdb: true, prowlarr: true, torrserver: true };
  else if (path === 'welcome') data = { line1: 'Pick a title.', line2: 'Download it for later.' };
  else if (path === 'catalogue') data = { titles: [movie, show], pages: 1 };
  else if (path.startsWith('details/')) data = { ...(path.includes('/movie/') ? movie : show), imdbId: null, tvdbId: null, rating: null, seasons: [{ number: 1, name: 'Season 1', episodes: 2 }] };
  else if (path.startsWith('season/')) data = { episodes: [{ number: 2, name: 'The second episode', overview: 'Episode fixture', airDate: '2026-10-01' }] };
  else if (path === 'search') { intent = body; data = { searchId: 'search', batch: 1, more: false, reports: [], warning: null, results: [{ id: 'source', title: intent.query, quality: ['1080p'], size: video.length, seeders: 200, indexer: 'Fixture' }], advice: { provider: 'heuristic', warning: null, ranking: [{ id: 'source', identity: 'match', method: 'heuristic', verdict: 'good' }] } }; }
  else if (path === 'recommend') data = { provider: 'heuristic', warning: null, ranking: [{ id: 'source', identity: 'match', method: 'heuristic', verdict: 'good' }] };
  else if (path === 'playback') data = status();
  else if (path.startsWith('playback/')) data = status(path.includes('local'));
  else if (path === 'select') data = { id: body.id, file: file(), stream: `/api/media/stream/${body.id}` };
  else if (path === 'downloads' && request.method() === 'POST') {
    assert.equal(body.intent.media.id, intent.context.tmdbId);
    const row = { id: String(downloads.length + 1), title: body.intent.label, intent: body.intent, file: file(), state: 'downloading', downloadedBytes: 100, totalBytes: video.length, error: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    downloads.push(row); data = { download: row };
  } else if (path === 'downloads') data = { downloads };
  else if (path === 'downloads/playback') { intent = downloads.find(row => row.id === body.downloadId).intent; data = status(true); }
  else if (path === 'downloads/remove') { downloads.splice(downloads.findIndex(row => row.id === body.downloadId), 1); data = { removed: true }; }
  else if (path === 'downloads/retry') { const row = downloads.find(row => row.id === body.downloadId); row.state = 'ready'; row.error = ''; row.downloadedBytes = row.totalBytes; data = { download: row }; }
  else if (path === 'inspect') data = { duration: 3, options: [{ id: 'direct', mode: 'direct', mime: 'video/mp4', container: 'mp4', video: 'copy', audio: 'none' }] };
  else if (path === 'prepare') data = { id: 'direct', mode: 'direct', mime: 'video/mp4', container: 'mp4', video: 'copy', audio: 'none', duration: 3, stream: '/api/media/stream/local-session' };
  else if (path.startsWith('stream/')) { await route.fulfill({ contentType: 'video/mp4', body: video }); return; }
  else if (['history', 'progress'].includes(path)) data = { saved: true };
  else if (path === 'subtitles/provider') data = { configured: false };
  else { await route.fulfill({ status: 404, json: { error: `Unexpected fixture endpoint: ${path}` } }); return; }
  await route.fulfill({ json: data });
});
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Viewport overflow');
const shot = name => page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
try {
  await page.goto(`${origin}/?section=tv`);
  await page.getByRole('button', { name: 'More information about Fixture Movie' }).click();
  await page.getByRole('button', { name: 'Télécharger sur le serveur', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Téléchargements', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Fixture Movie 2026' })).toBeVisible();
  assert(!requests.includes('inspect'), 'download must not start a player');
  await page.getByRole('button', { name: 'Retour au catalogue' }).click();
  await page.getByRole('button', { name: 'Choose episode of Fixture Show' }).click();
  await page.getByRole('button', { name: 'Télécharger l’épisode 2 : The second episode' }).click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByText('Téléchargement en cours', { exact: false })).toHaveCount(2);
  await expect(page.getByText('2 en cours · 0 en attente', { exact: false })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(2);
  assert(!requests.includes('inspect'), 'Adding another download must not start playback');
  await noOverflow(); await shot('cinema-desktop');
  for (const row of downloads) { row.state = 'ready'; row.downloadedBytes = row.totalBytes; }
  await page.getByRole('button', { name: 'Retour au catalogue' }).click();
  const beforeWatch = requests.length;
  await page.getByRole('button', { name: 'Watch Fixture Movie', exact: true }).click();
  await expect(page.locator('video')).toHaveAttribute('src', '/api/media/stream/local-session');
  assert(requests.slice(beforeWatch).includes('downloads/playback'), 'Saved playback must use the local download endpoint');
  assert(!requests.slice(beforeWatch).includes('search'), 'saved movie must not search for a torrent');
  assert(!requests.slice(beforeWatch).includes('playback'), 'saved movie must not add a torrent');
  await page.goto(`${origin}/?section=library`);
  await page.locator('.library-download-folder').click();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Importer', exact: true })).toBeDisabled();
  await noOverflow(); await shot('library-desktop');
  for (const width of [768, 390, 320]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(); if (width === 390) await shot('library-mobile'); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const movieRow = page.getByRole('article', { name: 'Fixture Movie 2026' });
  await movieRow.getByRole('button', { name: 'Supprimer Fixture Movie 2026', exact: true }).click();
  await movieRow.getByRole('button', { name: 'Confirmer la suppression' }).click();
  await expect(page.getByRole('article')).toHaveCount(1); assert.equal(downloads.length, 1);
  downloads[0].state = 'error'; downloads[0].error = 'Fixture interruption'; downloads[0].downloadedBytes = 100;
  await page.reload(); await page.locator('.library-download-folder').click();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByText('Prêt à regarder', { exact: false })).toBeVisible();
  await page.goto(`${origin}/?section=tv&tv=1`);
  await page.getByRole('button', { name: 'Téléchargements', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regarder', exact: true })).toBeVisible();
  await noOverflow(); await shot('cinema-tv');
  assert.deepEqual(errors, []);
  console.log('Media downloads UI passed: simultaneous movie/episode progress, no playback during download, local playback, library management, deletion, resume, mobile and TV.');
} catch (error) {
  console.error({ body: (await page.locator('body').innerText()).slice(0, 3000), errors, requests });
  await shot('failure');
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true });
}
