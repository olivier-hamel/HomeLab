// Run after the frontend build. Uses generated clips and fixture APIs only.
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
const output = join(root, 'artifacts/desktop-player');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'homelab-player-ui-'));
const run = promisify(execFile);
await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', join(temporary, 'key.pem'), '-out', join(temporary, 'cert.pem')]);
await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x142a38:size=960x540:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100', '-vf', 'drawbox=x=0:y=380:w=iw:h=160:color=0x0b151e:t=fill,drawbox=x=380:y=150:w=200:h=230:color=0x223e4e:t=fill,drawbox=x=435:y=170:w=90:h=210:color=0x7d9d9f:t=fill', '-t', '90', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', join(temporary, 'direct.mp4')]);
await run('ffmpeg', ['-v', 'error', '-i', join(temporary, 'direct.mp4'), '-t', '12', '-c', 'copy', '-movflags', '+faststart', join(temporary, 'segment.mp4')]);
const clips = { direct: await readFile(join(temporary, 'direct.mp4')), remux: await readFile(join(temporary, 'segment.mp4')) };
const dist = join(root, 'frontend/dist');
const server = createServer({ key: await readFile(join(temporary, 'key.pem')), cert: await readFile(join(temporary, 'cert.pem')) }, async (request, response) => {
  try {
    const path = resolve(dist, `.${new URL(request.url, 'https://localhost').pathname}`);
    if (!path.startsWith(`${dist}/`) && path !== dist) { response.writeHead(404).end(); return; }
    const file = path === dist || !extname(path) ? join(dist, 'index.html') : path;
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `https://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errors = [], checks = [];
const account = { enabled: true, user: { username: 'oli', display_name: 'Oli', must_change_password: false }, accounts: [{ username: 'oli', display_name: 'Oli' }] };
const movie = { id: 1, kind: 'movie', title: 'The quiet hours', year: '2026', overview: 'Generated player test fixture.', poster: null };
const file = { id: 1, path: 'The.Quiet.Hours.2026.1080p.mp4', size: clips.direct.length, kind: 'video', sample: false };
const srt = '1\n00:00:01,000 --> 00:00:08,000\n<i>Some moments are better</i>\nwith a little room to breathe.\n\n2\n00:00:50,000 --> 00:00:58,000\nThe story continues.';
const intent = { query: 'The quiet hours 2026', label: 'The quiet hours 2026', context: { kind: 'movie', tmdbId: 1 }, media: movie };
const advice = { provider: 'heuristic', warning: null, ranking: [{ id: 'source', identity: 'match', method: 'heuristic', verdict: 'good' }] };

async function viewing(mode, downloaded) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  const torrent = { id: 'fixture', title: movie.title, state: 'ready', files: [file], downloaded, downloadSpeed: 1000, connectedPeers: 10, downloadedBytes: 1000, completedBytes: 1000, preloadBytes: 1000, preloadTarget: 1000 };
  const plan = { id: mode, mode, mime: 'video/mp4', container: 'mp4', video: 'copy', audio: 'copy', duration: 90, stream: '/api/media/stream/fixture' };
  await page.route('**/memo/api/auth/**', route => route.fulfill({ json: account }));
  await page.route('**/api/media/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.slice('/api/media/'.length);
    requests.push(path + url.search);
    if (path.startsWith('stream/')) {
      const bytes = clips[mode], range = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      await route.fulfill({ status: range ? 206 : 200, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) }); return;
    }
    const data = path === 'status' ? { tmdb: true, prowlarr: true, torrserver: true }
      : path === 'welcome' ? { line1: 'Time for a movie.', line2: 'Make yourself comfortable.' }
      : path === 'catalogue' ? { titles: [movie], pages: 1 }
      : path === 'downloads' ? { downloads: downloaded ? [{ id: 'saved', title: movie.title, intent, file, state: 'ready', totalBytes: file.size, downloadedBytes: file.size }] : [] }
      : path === 'search' ? { searchId: 'search', batch: 1, more: false, reports: [], results: [{ id: 'source', title: movie.title, quality: ['1080p'], seeders: 200, indexer: 'Fixture' }], advice }
      : path === 'recommend' ? advice
      : path.startsWith('playback') || path === 'downloads/playback' ? torrent
      : path === 'select' ? { id: 'fixture', file, stream: plan.stream }
      : path === 'inspect' ? { duration: 90, options: [plan] }
      : path === 'prepare' ? plan
      : path === 'subtitles/search' ? { title: movie.title, results: [{ id: 'english', release: 'The.Quiet.Hours.2026.1080p', name: 'English.srt', language: 'EN', hearingImpaired: false }] }
      : path === 'subtitles/download' ? { files: [{ name: 'English.srt', content: Buffer.from(srt).toString('base64') }] }
      : path === 'subtitles/provider' ? { configured: false }
      : path === 'continue-watching' ? { movies: [] }
      : { saved: true };
    await route.fulfill({ json: data });
  });
  await page.goto(`${origin}/?section=tv`);
  await page.getByRole('button', { name: `Watch ${movie.title}`, exact: true }).click();
  await expect(page.locator('.cinema-player')).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('video').evaluate(video => video.pause());
  assert.equal(await page.locator('video').evaluate(video => video.controls), false, 'Native controls are replaced');
  await expect(page.getByRole('slider', { name: 'Seek through full video' })).toHaveCount(1);
  await expect(page.locator('.tv-playback-controls, .simple-player-options')).toHaveCount(0);
  await expect(page.getByText('Full video timeline', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Lecture du fichier téléchargé sur HomeLab')).toHaveCount(0);
  checks.push(`${mode}: one overlay and timeline, no playback-mode bar`);
  return { page, requests };
}

try {
  const { page, requests } = await viewing('remux', false);
  const controls = await page.locator('.cinema-control-row button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await page.getByRole('button', { name: 'English subtitles', exact: true }).click();
  await expect.poll(() => page.locator('track').evaluate(track => track.track.cues?.length)).toBe(2);
  assert.equal(await page.locator('track').evaluate(track => track.track.mode), 'hidden');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.locator('video').evaluate(video => { video.currentTime = 2; });
  await expect(page.locator('.cinema-caption-line')).toContainText('Some moments are better');
  await expect(page.locator('.cinema-caption-line i')).toContainText('Some moments are better');
  const clearOfControls = await page.evaluate(() => {
    const caption = document.querySelector('.cinema-captions').getBoundingClientRect(), timeline = document.querySelector('.cinema-timeline').getBoundingClientRect();
    return caption.bottom < timeline.top;
  });
  assert(clearOfControls, 'Captions stay above the controls');
  await page.locator('.cinema-player').screenshot({ path: join(output, 'desktop-paused.png') });
  await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await page.getByRole('button', { name: 'Show subtitles 0.5 seconds later' }).click();
  assert.equal(await page.locator('track').evaluate(track => track.track.cues[0].startTime), 1.5);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('.cinema-caption-line')).toBeVisible();
  checks.push('Formatted captions, stable placement, timing offset, persistent menu selection');

  // Commit one pointer scrub beyond the current converted segment.
  const timeline = page.getByRole('slider', { name: 'Seek through full video' });
  const bounds = await timeline.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 5 + (bounds.width - 10) * 50 / 90, bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.locator('video').getAttribute('src')).toContain('start=50');
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  assert(await page.locator('video').evaluate(video => video.paused), 'Seeking while paused stays paused');
  assert.equal(await page.locator('track').evaluate(track => track.track.cues[1].startTime), 0.5);
  assert.equal(requests.filter(path => path.includes('stream/fixture?start=50')).length, 1, 'One request per scrub');
  checks.push('Converted seeking, absolute subtitle clock, paused seek, single scrub commit');

  await page.getByRole('button', { name: 'Playback settings' }).click();
  await page.getByRole('button', { name: '1.5×', exact: true }).click();
  assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 1.5);
  await page.locator('.cinema-player').screenshot({ path: join(output, 'desktop-settings.png') });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.locator('.cinema-player').focus();
  await page.keyboard.press('m');
  assert(await page.locator('video').evaluate(video => video.muted), 'Mute shortcut works');
  await page.keyboard.press('m');
  assert(!(await page.locator('video').evaluate(video => video.muted)));
  await page.getByRole('button', { name: 'Fullscreen video', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('cinema-player');
  await expect(page.getByRole('button', { name: 'Subtitles', exact: true })).toBeVisible();
  await page.screenshot({ path: join(output, 'desktop-fullscreen.png') });
  await page.getByRole('button', { name: 'Exit fullscreen video', exact: true }).click();
  await page.locator('.cinema-hit-area').click({ position: { x: 140, y: 140 } });
  await expect.poll(() => page.locator('video').evaluate(video => video.paused)).toBe(false);
  await page.mouse.move(1, 1);
  await expect(page.locator('.cinema-player')).toHaveAttribute('data-controls-visible', 'false');
  await page.locator('.cinema-player').screenshot({ path: join(output, 'desktop-playing.png') });
  await page.mouse.move(700, 500);
  await page.locator('video').evaluate(video => video.pause());
  checks.push('Speed, mute shortcuts, container fullscreen, controls fade away');

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.cinema-player')).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
    await page.getByRole('button', { name: 'Subtitles', exact: true }).click();
    await expect(page.getByRole('button', { name: 'English subtitles', exact: true })).toBeVisible();
    await page.locator('.cinema-player').screenshot({ path: join(output, `captions-${width}.png`) });
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  }
  checks.push('Responsive controls and captions menu at 768, 390, 320 pixels');
  await page.close();

  const local = await viewing('direct', true);
  assert.deepEqual(await local.page.locator('.cinema-control-row button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), controls, 'Downloaded and streamed videos have identical controls');
  const seek = local.page.getByRole('slider', { name: 'Seek through full video' });
  await seek.focus(); await local.page.keyboard.press('ArrowRight');
  await expect.poll(() => local.page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(10);
  await local.page.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await local.page.getByRole('button', { name: 'English subtitles', exact: true }).click();
  await expect.poll(() => local.page.locator('track').evaluate(track => track.track.cues?.length)).toBe(2);
  await local.page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await local.page.locator('.cinema-player').screenshot({ path: join(output, 'desktop-downloaded.png') });
  assert(!local.requests.includes('search'), 'Downloaded playback does not search for sources');
  await local.page.locator('video').evaluate(video => { video.currentTime = 89.8; return video.play(); });
  await expect.poll(() => local.page.locator('video').evaluate(video => video.ended)).toBe(true);
  await local.page.locator('.cinema-play').click();
  await expect.poll(() => local.page.locator('video').evaluate(video => !video.paused && video.currentTime < 2)).toBe(true);
  await local.page.getByRole('button', { name: 'Close player', exact: true }).click();
  await expect(local.page.locator('.cinema-player')).toHaveCount(0);
  await local.page.close();
  checks.push('Downloaded/direct control parity, keyboard seek, automatic subtitles, replay, close');
  assert.deepEqual(errors, [], 'No browser errors');
  console.log(JSON.stringify({ passed: true, checks, screenshots: output }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await rm(temporary, { recursive: true, force: true });
}
