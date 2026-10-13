// Sustained browser regression with synthetic live HLS; no camera or credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(root, 'apps/memo/web-app/frontend/package.json'));
const { chromium, firefox } = require('playwright');
const { expect } = require('@playwright/test');
const fixture = resolve(root, 'artifacts/camera/live-regression');
await mkdir(fixture, { recursive: true });
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=20',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000', '-t', '45', '-c:v', 'libx264', '-preset', 'ultrafast',
  '-g', '10', '-bf', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '16000', '-b:a', '48k', '-output_ts_offset', '7500',
  '-f', 'hls', '-hls_time', '0.5', '-hls_list_size', '0', '-start_number', '12600', '-hls_flags', 'independent_segments',
  '-hls_segment_filename', resolve(fixture, 'segment-%09d.ts'), resolve(fixture, 'index.m3u8')]);
const source = await readFile(resolve(fixture, 'index.m3u8'), 'utf8');
const segments = [...source.matchAll(/#EXTINF:([\d.]+),\s*(segment-\d{9}\.ts)/g)].map(match => ({ duration: Number(match[1]), file: match[2] }));
const browser = process.env.CAMERA_UI_BROWSER === 'firefox'
  ? await firefox.launch({ headless: true })
  : await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
let start, expireNext = false, expiredFile, expiredRequests = 0;
const delay = () => new Promise(resolve => setTimeout(resolve, 350));
const json = (route, value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
await context.route('**/*', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.startsWith('/memo/api/auth/')) return json(route, { enabled: true, user: { username: 'fixture', display_name: 'Fixture', must_change_password: false }, accounts: [{ username: 'fixture', display_name: 'Fixture' }] });
  if (path === '/api/camera/status') return json(route, { name: 'Caméra de test', model: 'Tapo C200', configured: true, connected: true, ptz: false, presetsSupported: false, presets: [], credentialsFromEnv: false, network: { host: '192.168.0.188' } });
  if (path.startsWith('/api/camera/stream/')) {
    await delay();
    const file = path.split('/').at(-1);
    if (file === 'index.m3u8') {
      start ??= Date.now() - 6000;
      const count = Math.min(segments.length, Math.floor((Date.now() - start) / 500));
      const first = Math.max(0, count - 12);
      const playlist = `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${12600 + first}\n#EXT-X-INDEPENDENT-SEGMENTS\n`
        + segments.slice(first, count).map((segment, index) => `#EXTINF:${segment.duration},\n#EXT-X-PROGRAM-DATE-TIME:${new Date(start + (first + index) * 500).toISOString()}\n${segment.file}\n`).join('');
      return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: playlist });
    }
    assert.match(file, /^segment-\d{9}\.ts$/);
    if (expireNext && !expiredFile) { expiredFile = file; expireNext = false; }
    if (file === expiredFile) { expiredRequests++; return route.fulfill({ status: 404, body: 'Expired synthetic segment' }); }
    return route.fulfill({ contentType: 'video/mp2t', body: await readFile(resolve(fixture, file)) });
  }
  if (path.startsWith('/api/')) return json(route, { events: [], documents: [], folders: [] });
  const file = resolve(root, 'frontend/dist', path.slice(1) || 'index.html');
  if (!file.startsWith(resolve(root, 'frontend/dist') + '/')) return route.abort();
  try { return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(file)], body: await readFile(file) }); }
  catch { return route.fulfill({ status: 404, body: 'Not found' }); }
});
const sample = () => page.locator('video').evaluate(video => ({ time: video.currentTime, frames: video.getVideoPlaybackQuality().totalVideoFrames, ready: video.readyState }));
try {
  await page.goto('https://camera.test/?section=camera');
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT', { timeout: 15_000 });
  const first = await sample();
  let previous = first;
  for (let second = 0; second < 8; second++) {
    await page.waitForTimeout(1000);
    const current = await sample();
    assert(current.time - previous.time > 0.7, `Playback froze: ${JSON.stringify({ previous, current })}`);
    assert(current.frames - previous.frames >= 10, 'Frames must keep decoding while the playlist advances');
    previous = current;
  }
  // A fragment referenced by an in-flight playlist disappears. Recovery must
  // advance to current media instead of spending seconds retrying that old URL.
  expireNext = true;
  await page.waitForFunction(time => document.querySelector('video')?.currentTime > time + 6, previous.time, { timeout: 12_000 });
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT', { timeout: 5000 });
  assert(expiredRequests > 0, 'The stale-fragment failure must actually be exercised');
  const recovered = await sample();
  assert(recovered.frames - previous.frames >= 60, 'Recovery must render new frames');
  await page.locator('video').evaluate(video => video.pause());
  await page.waitForTimeout(2000);
  await page.locator('video').evaluate(video => video.play());
  await page.getByRole('button', { name: 'Revenir au direct', exact: true }).click();
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT');
  await page.getByLabel('Qualité du flux').selectOption('sd');
  await expect(page.locator('.camera-live-badge')).toHaveText('DIRECT', { timeout: 15_000 });
  const sd = await sample();
  await page.waitForTimeout(2000);
  const final = await sample();
  assert(final.frames - sd.frames >= 25, 'SD playback must keep decoding');
  assert.deepEqual(errors, []);
  console.log('Camera live regression passed: continuous HD/SD audio/video, 350 ms requests, two-hour timestamps, expired fragment recovery and buffered return to live.');
} finally { await browser.close(); }
