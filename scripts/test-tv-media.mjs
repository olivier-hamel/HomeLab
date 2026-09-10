// Real Caddy + Next standalone + built React + headless Chrome, with MOCK services.
// Requires a licensed H.264/AAC MP4 fixture. See docs/tv-media.md.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as portProbe } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { subtitleZip, subtitleFixture } from './subtitle-test-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = resolve(root, 'backend/node_modules/.cache/media-reference');
const out = resolve(root, 'frontend/node_modules/.cache/tv-review');
mkdirSync(out, { recursive: true });
const caddyBin = process.env.CADDY_BIN || resolve(cache, 'caddy/caddy.exe');
const chromeBin = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const videoPath = process.env.TV_TEST_MP4 || resolve(cache, 'authorized-trailer.mp4');
for (const path of [caddyBin, chromeBin, videoPath, resolve(root, 'backend/.next/standalone/server.js'), resolve(root, 'frontend/dist/index.html')]) assert.ok(existsSync(path), `Required file: ${path}`);
const videoBytes = readFileSync(videoPath);
// Tiny generated clips exercise real browser decoding through the FFmpeg layer.
const generated = new Map();
const generatedBase = resolve(out, 'generated-base.mp4');
const ffmpeg = (args) => execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', ...args], { windowsHide: true });
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libx264', '-threads', '2', '-g', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', generatedBase]);
for (const [id, name, codecs] of [[5, 'Remux fixture.ts', ['-c', 'copy']], [6, 'Audio conversion fixture.mkv', ['-c:v', 'copy', '-c:a', 'dca', '-strict', '-2', '-ac', '2']], [7, 'Full conversion fixture.avi', ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le']]]) {
  const path = resolve(out, name); ffmpeg(['-i', generatedBase, ...codecs, path]);
  generated.set(id, { name, bytes: readFileSync(path) });
}
const freePort = async () => { const s = portProbe(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const [backendPort, frontendPort, fixturePort] = await Promise.all([freePort(), freePort(), freePort()]);
const origin = `http://127.0.0.1:${frontendPort}`;
const upstream = `http://127.0.0.1:${fixturePort}`;
const hash = 'b'.repeat(40);
const secret = 'test-only-media-canary-not-a-live-credential';
const subtitleSrt = '1\r\n00:00:00,000 --> 00:01:00,000\r\nTorrent subtitle fixture\r\n';
const metrics = { adds: 0, gets: 0, streams: [], cancellations: 0, downloads: 0, subtitleSearches: [], subtitleDownloads: 0, aiReviews: 0 };
const torrentStatus = () => ({ hash, title: 'Big Buck Bunny — authorized trailer fixture', stat: 3, file_stats: [{ id: 1, path: 'sample.mp4', length: 20 }, { id: 2, path: 'Big Buck Bunny trailer.mp4', length: videoBytes.length }, { id: 3, path: 'English.srt', length: 45 }, { id: 4, path: 'Unsupported-format fixture.avi', length: 64 }, ...[...generated].map(([id, f]) => ({ id, path: f.name, length: f.bytes.length }))], active_peers: 3, download_speed: 65536, bytes_read_data: 123456, loaded_size: 123456 });
const fixture = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, upstream);
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/gemini/v1beta/models/gemini-3.5-flash-lite:generateContent') {
      assert.equal(req.headers['x-goog-api-key'], secret);
      let raw = ''; for await (const chunk of req) raw += chunk;
      assert.ok(!raw.includes(secret) && !raw.includes('download?') && !raw.includes('magnet:'));
      const payload = JSON.parse(JSON.parse(raw).contents[0].parts[0].text);
      const candidates = payload.candidates;
      assert.equal(payload.requestedTitle.title, 'Big Buck Bunny');
      assert.equal(payload.requestedTitle.year, '2008');
      assert.ok(payload.requestedTitle.overview && payload.requestedTitle.imdbId);
      assert.ok(candidates.every(c => !c.title.startsWith('Maids')));
      metrics.aiReviews++;
      await delay(1500); // Exercise dismissals while the AI response is still in flight.
      return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ranking: candidates.map(c => ({ id: c.id, identity: 'match', verdict: c.title.includes('2160p') || c.seeders === null ? 'unsure' : 'good', reason: c.title.includes('2160p') ? '4K adds bandwidth beyond your 1080p target.' : c.seeders === null ? 'The seeder count is unknown, so streaming may stall.' : 'The matching title, reasonable size and healthy seeders make this release look promising.' })) }) }] } }] });
    }
    if (url.pathname === '/subdl-api/api/v1/subtitles') {
      assert.equal(url.searchParams.get('api_key'), secret);
      metrics.subtitleSearches.push({ imdb: url.searchParams.get('imdb_id'), type: url.searchParams.get('type'), language: url.searchParams.get('languages') });
      return json({ status: true, results: [{ name: 'Big Buck Bunny', year: 2008 }], subtitles: [
        { name: 'Raw subtitle', release_name: 'Raw subtitle release', unpack_files: [{ name: 'Online.srt', url: `/subtitle/fixture/raw?api_key=${secret}`, language: 'EN' }] },
        { name: 'Multiple-files.zip', release_name: 'Subtitle ZIP release', url: `/subtitle/fixture-pack.zip?api_key=${secret}`, lang: 'english' },
        { name: 'Slow subtitle', release_name: 'Slow subtitle release', unpack_files: [{ name: 'Slow.srt', url: '/subtitle/fixture/slow', language: 'EN' }] },
      ] });
    }
    if (url.pathname.startsWith('/subdl-download/subtitle/')) {
      assert.equal(req.headers['x-api-key'], url.pathname.endsWith('/slow') ? undefined : secret); assert.equal(req.headers.authorization, undefined); assert.equal(url.search, '');
      metrics.subtitleDownloads++;
      if (url.pathname.endsWith('/slow')) await delay(1000);
      const bytes = url.pathname.endsWith('.zip') ? subtitleZip([{ name: 'English.srt', text: subtitleFixture }, { name: 'French.srt', text: subtitleFixture.replace('Online subtitle fixture', 'ZIP subtitle fixture') }]) : Buffer.from(subtitleFixture);
      res.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': url.pathname.endsWith('.zip') ? 'application/zip' : 'text/plain' }); return res.end(bytes);
    }
    if (url.pathname.startsWith('/3/')) {
      assert.equal(req.headers.authorization, `Bearer ${secret}`);
      const title = { id: 10378, title: 'Big Buck Bunny', name: 'Authorized fixture series', release_date: '2008-04-10', first_air_date: '2008-04-10', overview: 'Creative Commons film by the Blender Foundation. This catalogue response is a test fixture.', poster_path: null, external_ids: { imdb_id: 'tt1254207', tvdb_id: 200 }, seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }] };
      if (url.pathname.includes('/season/')) return json({ episodes: [{ episode_number: 1, name: 'Authorized episode one', air_date: '2008-01-01', overview: 'Fixture episode' }, { episode_number: 2, name: 'Authorized episode two', air_date: '2008-01-02', overview: 'Fixture episode' }] });
      return json(url.pathname.includes('popular') || url.pathname.includes('search') ? { results: [title], total_pages: 2 } : title);
    }
    if (url.pathname.startsWith('/api/v1/') || url.pathname === '/1/download') {
      assert.equal(req.headers['x-api-key'], secret);
      if (url.pathname === '/api/v1/system/status') return json({ version: 'mock-contract-v1' });
      if (url.pathname === '/api/v1/indexer') return json([1, 2].map(id => ({ id, name: id === 1 ? 'Authorized content fixture' : 'Unavailable fixture indexer', enable: true, protocol: 'torrent', supportsSearch: true, supportsPagination: true, capabilities: { movieSearchParams: ['q', 'imdbId'], tvSearchParams: ['q', 'tvdbId', 'season', 'ep'] }, fields: [{ value: secret }] })));
      if (url.pathname === '/api/v1/indexerstatus') return json([]);
      if (url.pathname === '/api/v1/search') return url.searchParams.get('indexerIds') === '2' ? json({ error: secret }, 503) : json([
        { title: 'Big Buck Bunny 2008 1080p H264 AAC MP4 — licensed fixture', size: 2 * 1024 ** 3, seeders: 4000 },
        { title: 'Big Buck Bunny 2008 720p H264 AAC MP4 — alternate fixture', size: 1024 ** 3, seeders: 3000 },
        { title: 'Big Buck Bunny 2008 2160p HEVC DTS — heavy fixture', size: 20 * 1024 ** 3, seeders: 9999 },
        { title: 'Maids Big Buck Bunny 2008 1080p — unrelated fixture', size: videoBytes.length, seeders: null },
      ].map(row => ({ ...row, leechers: 3, downloadUrl: `${upstream}/1/download?apikey=${secret}&link=fixture`, imdbId: 1254207 })));
      if (url.pathname === '/1/download') { metrics.downloads++; res.writeHead(302, { Location: `magnet:?xt=urn:btih:${hash}&dn=Authorized+fixture` }); return res.end(); }
    }
    if (url.pathname === '/echo') return res.end('mock-TorrServer-contract');
    if (url.pathname === '/torrents') {
      assert.equal(req.headers.authorization, `Basic ${Buffer.from(`fixture:${secret}`).toString('base64')}`);
      let text = ''; for await (const chunk of req) text += chunk;
      const data = JSON.parse(text);
      if (data.action === 'list') return json([]);
      if (data.action === 'add') { metrics.adds++; return json({ hash, title: 'Authorized fixture', stat: 1 }); }
      assert.equal(data.action, 'get'); metrics.gets++; return json(torrentStatus());
    }
    if (url.pathname === '/stream') {
      assert.equal(url.searchParams.get('link'), hash);
      metrics.streams.push({ method: req.method, range: req.headers.range, index: url.searchParams.get('index') });
      if (url.searchParams.get('index') === '3') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(subtitleSrt); }
      if (url.searchParams.get('index') === '4') { res.writeHead(200, { 'Content-Type': 'video/x-msvideo' }); return res.end('RIFF unsupported-format test fixture; intentionally not decodable'); }
      const index = Number(url.searchParams.get('index'));
      assert.ok(index === 2 || generated.has(index), 'sample never selected automatically');
      const bytes = generated.get(index)?.bytes ?? videoBytes;
      let start = 0; let end = bytes.length - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        assert.ok(match);
        if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        else start = Math.max(0, bytes.length - Number(match[2]));
      }
      if (start >= bytes.length) { res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` }); return res.end(); }
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ETag: '"fixture"', ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
      if (req.method === 'HEAD') return res.end();
      let finished = false;
      res.on('close', () => { if (!finished) metrics.cancellations++; });
      for (let offset = start; offset <= end && !res.destroyed; offset += 65536) { res.write(bytes.subarray(offset, Math.min(end + 1, offset + 65536))); await delay(40); }
      if (!res.destroyed) { finished = true; res.end(); }
      return;
    }
    json({ error: 'Unexpected mock endpoint' }, 404);
  } catch (error) { res.writeHead(500); res.end('Fixture assertion failed'); console.error(error.message); }
});
await new Promise(r => fixture.listen(fixturePort, '127.0.0.1', r));
const originalConfig = readFileSync(resolve(root, 'frontend/Caddyfile'), 'utf8');
const config = originalConfig.replace(':8080 {', `:${frontendPort} {\n\tbind 127.0.0.1`).replace('root * /srv', `root * "${resolve(root, 'frontend/dist').replaceAll('\\', '/')}"`).replaceAll('backend:3001', `127.0.0.1:${backendPort}`);
const configPath = resolve(out, 'Caddyfile'); writeFileSync(configPath, config);
cpSync(resolve(root, 'backend/.next/static'), resolve(root, 'backend/.next/standalone/.next/static'), { recursive: true });
const processes = [];
let socket, call;
const logs = [];
const launch = (bin, args, env = process.env) => { const child = spawn(bin, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); processes.push(child); child.stdout.on('data', b => logs.push(b.toString())); child.stderr.on('data', b => logs.push(b.toString())); return child; };
try {
  const validate = launch(caddyBin, ['validate', '--config', configPath, '--adapter', 'caddyfile']);
  assert.equal(await new Promise(r => validate.on('exit', r)), 0, logs.join(''));
  launch(process.execPath, [resolve(root, 'backend/.next/standalone/server.js')], { ...process.env, NODE_ENV: 'production', PORT: String(backendPort), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1', MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: origin, MEDIA_SESSION_SECRET: secret, PROWLARR_BASE_URL: upstream, PROWLARR_API_KEY: secret, TORRSERVER_BASE_URL: upstream, TORRSERVER_USERNAME: 'fixture', TORRSERVER_PASSWORD: secret, TMDB_READ_ACCESS_TOKEN: secret, SUBDL_API_KEY: secret, GEMINI_API_KEY: secret, TV_TEST_UPSTREAM: upstream, NODE_OPTIONS: `--import=${pathToFileURL(resolve(root, 'scripts/tmdb-test-preload.mjs')).href}` });
  launch(caddyBin, ['run', '--config', configPath, '--adapter', 'caddyfile']);
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {} await delay(100); }
  assert.equal((await fetch(`${origin}/api/health`)).status, 200, logs.join(''));
  const profile = resolve(out, `chrome-${Date.now()}`);
  launch(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
  let debugPort;
  for (let i = 0; i < 100; i++) { try { debugPort = readFileSync(resolve(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); } }
  assert.ok(debugPort, 'Chrome started');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, reject) => { socket.onopen = r; socket.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = []; const browserUrls = [];
  socket.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); if (m.method === 'Network.requestWillBeSent') browserUrls.push(m.params.request.url); };
  call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const until = async (expression, timeout = 20000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await evaluate(expression)) return; await delay(100); } throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`); };
  const click = async text => { await until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`); return evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); b.click(); })()`); };
  const screenshot = async name => { const shot = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(out, `${name}.png`), Buffer.from(shot.data, 'base64')); };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin }); await until('!!document.querySelector("nav")');
  await evaluate(`document.querySelector('nav button[aria-label="TV & Movies"]').click()`);
  await until(`!!document.querySelector('[role="switch"][aria-label="Advanced mode"]')`);
  await evaluate(`document.querySelector('[role="switch"][aria-label="Advanced mode"]').click()`);
  await until(`!!document.querySelector('button[aria-label="Details for Big Buck Bunny"]')`);
  assert.equal(metrics.adds, 0, 'browsing never initiates torrents');
  assert.equal(await evaluate(`document.querySelector('header').innerText.includes('SAMPLE DATA')`), false);
  if (await evaluate(`!!document.querySelector('details[aria-label="About TMDB"]')`)) {
    await evaluate(`document.querySelector('details[aria-label="About TMDB"]').open = true`);
    await until(`document.querySelector('img[alt="TMDB"]').naturalWidth > 0`);
    assert.ok(await evaluate(`document.querySelector('details[aria-label="About TMDB"]').innerText.includes('This product uses the TMDB API but is not endorsed or certified by TMDB.')`));
    await evaluate(`document.querySelector('details[aria-label="About TMDB"]').open = false`);
  }
  await screenshot('catalogue-1440');
  await evaluate(`document.querySelector('button[aria-label="Details for Big Buck Bunny"]').click()`);
  await until(`document.body.innerText.includes('Find sources')`); await click('Find sources');
  assert.equal(await evaluate(`document.querySelector('#source-query').value`), 'Big Buck Bunny 2008');
  assert.equal(metrics.adds, 0); await click('Search sources');
  await until(`document.body.innerText.includes('Choose source')`);
  assert.ok(await evaluate(`document.body.innerText.includes('HTTP 503') && document.body.innerText.includes('S: Unknown')`));
  const recommendation = `document.querySelector('article[aria-label^="Recommended source:"]')`;
  await until(`${recommendation}?.innerText.includes('1080p H264 AAC')`);
  await evaluate(`${recommendation}.querySelector('button[aria-label]').click()`);
  await until(`${recommendation}?.innerText.includes('720p')`);
  await until(`[...document.querySelectorAll('article span')].some(s => s.textContent === 'AI')`);
  assert.ok(await evaluate(`${recommendation}.innerText.includes('720p')`), 'late AI response does not restore a rejected release');
  assert.equal(await evaluate(`document.querySelectorAll('article').length`), 3);
  assert.equal(metrics.aiReviews, 1); assert.equal(metrics.adds, 0);
  await evaluate(`(() => { const s = document.querySelector('[aria-label="Sort sources"]'); s.value = 'seeders'; s.dispatchEvent(new Event('change', {bubbles: true})); })()`);
  assert.ok(await evaluate(`${recommendation}.innerText.includes('720p')`), 'manual sorting keeps the next recommendation pinned');
  await click('Search sources'); await until(`[...document.querySelectorAll('article span')].some(s => s.textContent === 'AI')`);
  assert.equal(await evaluate(`document.querySelectorAll('article').length`), 3, 'dismissal survives searching again');
  assert.equal(metrics.aiReviews, 1, 'repeat recommendation uses the backend cache');
  for (let i = 0; i < 3; i++) {
    await click('Doesn’t work'); await delay(50);
    if (i === 1) {
      await until(`!${recommendation}`);
      assert.ok(await evaluate(`document.body.innerText.includes('No confirmed title matches remain') && document.body.innerText.includes('Not a match')`), 'a wrong title is never promoted after all matching sources fail');
    }
  }
  await until(`document.body.innerText.includes('All loaded sources are hidden')`);
  assert.equal(metrics.aiReviews, 1, 'rejecting sources does not call Gemini again');
  await click('Restore hidden sources'); await until(`${recommendation}?.innerText.includes('1080p H264 AAC')`);
  for (const width of [768, 390, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 });
    const sizing = await evaluate(`({page:document.documentElement.scrollWidth, main:document.querySelector('main').clientWidth, scroll:document.querySelector('main').scrollWidth})`);
    assert.ok(sizing.page <= width && sizing.scroll <= sizing.main + 2, JSON.stringify(sizing));
    if (width === 390) { await evaluate(`${recommendation}.scrollIntoView({block:'center'})`); await screenshot('source-assist-390'); }
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`${recommendation}.scrollIntoView({block:'center'})`);
  await screenshot('sources-1440');
  await click('Choose source'); await until(`document.body.innerText.includes('Choose sample')`);
  await evaluate(`${recommendation}.querySelector('button[aria-label]').click()`);
  await until(`!document.body.innerText.includes('Choose sample')`);
  assert.ok(await evaluate(`${recommendation}.innerText.includes('720p')`), 'rejecting the active source closes its player and promotes the next');
  await click('Choose source'); await until(`document.body.innerText.includes('Choose sample')`);
  assert.ok(metrics.adds >= 1); assert.equal(metrics.streams.length, 0, 'files do not auto-play');
  if (process.argv.includes('--sources-only')) {
    assert.deepEqual(errors, []);
    assert.ok(!browserUrls.some(u => u.includes(secret) || u.includes('generativelanguage.googleapis.com')));
    assert.ok(!logs.join('').includes(secret));
    const report = { services: 'MOCK TMDB/Prowlarr/TorrServer/Gemini', checks: ['canonical movie metadata', 'wrong-title exclusion before Gemini', 'no wrong-title recommendation after dismissing matches', '3000-seeder streaming target', 'late AI dismissal', 'cached reviews', 'manual sorting', 'restore hidden sources', 'dismiss active selection', 'source layouts at 1440/768/390/320', 'no automatic streaming', 'private credentials'], aiReviews: metrics.aiReviews };
    writeFileSync(resolve(out, 'source-assist-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } else {
  await click('Choose video'); await until('!!document.querySelector("video")');
  const chooseSubtitle = key => evaluate(`(() => { const select = document.querySelector('[aria-label="Subtitle controls"] select'); select.value = ${JSON.stringify(key)}; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  const loadLocalSubtitle = (name, content) => evaluate(`(() => { const input = document.querySelector('input[aria-label="Load subtitle file"]'); const data = new DataTransfer(); data.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)})); input.files = data.files; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await click('Find online subtitles'); await click('Search SubDL');
  await until(`!!document.querySelector('[aria-label="SubDL results"] article')`);
  assert.deepEqual(metrics.subtitleSearches[0], { imdb: 'tt1254207', type: 'movie', language: 'EN' });
  assert.equal(metrics.subtitleDownloads, 0, 'online search does not download');
  await click('Download & use');
  await until(`document.querySelector('video').textTracks[0]?.cues?.[0]?.text === 'Online subtitle fixture'`);
  assert.equal(await evaluate(`document.querySelector('video').paused`), true, 'online subtitles can load before playback');
  await evaluate(`document.querySelectorAll('[aria-label="SubDL results"] article')[1].querySelector('button').click()`);
  await until(`document.querySelectorAll('[aria-label="Downloaded subtitle files"] button').length === 2`);
  await evaluate(`document.querySelectorAll('[aria-label="Downloaded subtitle files"] button')[1].click()`);
  await until(`document.querySelector('video').textTracks[0]?.cues?.[0]?.text === 'ZIP subtitle fixture'`);
  await evaluate(`document.querySelectorAll('[aria-label="SubDL results"] article')[2].querySelector('button').click()`);
  await chooseSubtitle('');
  await until(`document.querySelector('[aria-label="Downloaded subtitle files"] button') && !document.querySelector('[aria-label="Online subtitles"]').innerText.includes('Downloading subtitles')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Subtitle controls"] select').value`), '', 'late download must not override Off');
  await evaluate(`document.querySelector('[aria-label="Online subtitles"]').scrollIntoView({block:'center'})`);
  await screenshot('online-subtitles-1440');
  await click('Hide online search');
  await chooseSubtitle('3');
  await until(`document.querySelector('video').textTracks[0]?.cues?.length > 0`);
  assert.equal(await evaluate(`document.querySelector('video').paused`), true, 'choosing subtitles does not auto-play');
  await click('Play'); await until('document.querySelector("video").currentTime > 1', 40000);
  await until(`document.querySelector('video').textTracks[0]?.activeCues?.[0]?.text === 'Torrent subtitle fixture'`);
  await evaluate(`document.querySelector('video').scrollIntoView({block:'start'})`);
  await screenshot('subtitles-1440');
  await chooseSubtitle('');
  await until(`![...document.querySelector('video').textTracks].some(t => t.mode === 'showing')`);
  const beforeSubtitle = await evaluate(`document.querySelector('video').currentTime`);
  await loadLocalSubtitle('French.vtt', 'WEBVTT\n\n00:00.000 --> 01:00.000\nBonjour depuis le fichier local\n');
  await until(`document.querySelector('video').textTracks[0]?.activeCues?.[0]?.text === 'Bonjour depuis le fichier local'`);
  assert.ok(await evaluate(`document.querySelector('video').currentTime >= ${beforeSubtitle} && !document.querySelector('video').paused`), 'switching subtitles preserves playback');
  await evaluate(`document.querySelector('video').textTracks[0].mode = 'disabled'`);
  await until(`document.querySelector('[aria-label="Subtitle controls"] select').value === ''`);
  await chooseSubtitle('local');
  await until(`document.querySelector('video').textTracks[0]?.mode === 'showing'`);
  await loadLocalSubtitle('English.srt', subtitleSrt.replace('Torrent subtitle fixture', 'Local SRT fixture'));
  await until(`document.querySelector('video').textTracks[0]?.activeCues?.[0]?.text === 'Local SRT fixture'`);
  await loadLocalSubtitle('broken.srt', 'not a subtitle');
  await until(`document.querySelector('[aria-label="Subtitle controls"]').innerText.includes('No readable subtitle cues')`);
  await chooseSubtitle('3');
  await until(`document.querySelector('video').textTracks[0]?.activeCues?.[0]?.text === 'Torrent subtitle fixture'`);
  const duration = await evaluate('document.querySelector("video").duration'); assert.ok(duration > 10);
  await evaluate('document.querySelector("video").currentTime = 30');
  await until('document.querySelector("video").currentTime > 30 && !document.querySelector("video").seeking', 40000);
  assert.ok(metrics.streams.some(r => r.range && !r.range.startsWith('bytes=0-')), 'seeking generated byte-range requests');
  await screenshot('playback-1440');
  await click('Stop'); await until('!document.querySelector("video").getAttribute("src")');
  await delay(500); assert.ok(metrics.cancellations > 0, 'Caddy and Next propagate client disconnect');
  const streamPath = await evaluate(`document.querySelector('video').getAttribute('src')`); assert.equal(streamPath, null);
  await evaluate(`document.querySelector('section[aria-label="Playback"] details').open = true`);
  await click('Create player link'); await until(`!!document.querySelector('input[readonly]')`);
  const link = await evaluate(`document.querySelector('input[readonly]').value`);
  const partial = await fetch(link, { headers: { Range: 'bytes=1-3', 'If-Range': '"fixture"' } }); assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 3);
  const head = await fetch(link, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(videoBytes.length));
  const invalid = await fetch(link, { headers: { Range: `bytes=${videoBytes.length + 10}-` } }); assert.equal(invalid.status, 416); assert.equal(await invalid.text(), '');
  await click('Revoke link'); await until(`document.body.innerText.includes('Player link revoked.')`); assert.equal((await fetch(link)).status, 410);
  for (const [id, expected] of [[5, 'Remuxing'], [6, 'Converting audio'], [7, 'Converting video and audio']]) {
    const name = generated.get(id).name;
    await evaluate(`(() => { const row = [...document.querySelectorAll('[aria-label="Torrent files"] > div')].find(e => e.innerText.includes(${JSON.stringify(name)})); row.querySelector('button').click(); })()`);
    await until(`document.querySelector('video')?.previousElementSibling?.textContent === ${JSON.stringify(name)}`);
    await chooseSubtitle('3');
    await click('Play'); await until('document.querySelector("video").currentTime > 1 && !document.querySelector("video").paused', 40000);
    assert.ok(await evaluate(`document.body.innerText.includes(${JSON.stringify(expected)})`));
    assert.ok(await evaluate(`document.querySelector('video').src.includes('/converted/')`));
    await evaluate(`(() => { const video = document.querySelector('video'); Object.defineProperty(video, 'buffered', { configurable: true, get: () => ({ length: 0 }) }); const input = document.querySelector('input[aria-label="Seek through full video"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5'); input.dispatchEvent(new Event('input', {bubbles:true})); delete video.buffered; })()`);
    await until(`document.querySelector('video').src.includes('start=5') && document.querySelector('video').currentTime > 0.5 && !document.querySelector('video').paused`, 40000);
    await until(`document.querySelector('video').textTracks[0]?.activeCues?.[0]?.text === 'Torrent subtitle fixture'`);
    await screenshot(`converted-${id}`);
    await click('Stop'); await until('!document.querySelector("video").getAttribute("src")');
  }
  await evaluate(`const row = [...document.querySelectorAll('[aria-label="Torrent files"] > div')].find(e => e.innerText.includes('Unsupported-format')); row.querySelector('button').click()`);
  await until(`document.querySelector('video')?.previousElementSibling?.textContent === 'Unsupported-format fixture.avi'`);
  await click('Play'); await until(`document.body.innerText.includes('media could not be processed') || document.body.innerText.includes('format could not be inspected')`);
  const layout = [];
  for (const width of [1440, 768, 390, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 768 }); await delay(100);
    const sizing = await evaluate(`({ viewport: innerWidth, page: document.documentElement.scrollWidth, main: document.querySelector('main').clientWidth, scroll: document.querySelector('main').scrollWidth })`);
    assert.ok(sizing.page <= width && sizing.scroll <= sizing.main + 2, JSON.stringify(sizing)); layout.push({ width, ...sizing });
    if (width === 390) { await evaluate(`document.querySelector('video').scrollIntoView({block:'center'})`); await screenshot('playback-fallback-390'); }
  }
  await click('Stop and close');
  await click('Catalogue');
  await until(`!!document.querySelector('#catalogue-kind')`);
  await evaluate(`const select = document.querySelector('#catalogue-kind'); select.value = 'tv'; select.dispatchEvent(new Event('change', {bubbles:true}))`);
  await until(`!!document.querySelector('button[aria-label="Details for Big Buck Bunny"]')`);
  await evaluate(`document.querySelector('button[aria-label="Details for Big Buck Bunny"]').click()`);
  await until(`!!document.querySelector('dialog[open] select option[value="2"]')`);
  await evaluate(`const selects = document.querySelectorAll('dialog[open] select'); selects[1].value = '2'; selects[1].dispatchEvent(new Event('change', {bubbles:true}))`);
  const addsBeforeEpisode = metrics.adds;
  await click('Find sources');
  assert.equal(await evaluate(`document.querySelector('#source-query').value`), 'Big Buck Bunny S01E02');
  assert.equal(metrics.adds, addsBeforeEpisode, 'TV episode selection does not add a torrent');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await evaluate(`sessionStorage.clear(); document.querySelector('[aria-label="Advanced mode"]').click()`);
  await until(`!!document.querySelector('[aria-label="Watch Big Buck Bunny"]')`);
  await screenshot('simple-catalogue-1440');
  const simpleAdds = metrics.adds;
  await evaluate(`document.querySelector('[aria-label="Watch Big Buck Bunny"]').click()`);
  await until(`!!document.querySelector('video') && document.querySelector('video').readyState >= 2`, 120000);
  if (await evaluate(`document.querySelector('video').paused`)) await click('Play');
  await until(`!document.querySelector('video').paused && document.querySelector('video').currentTime > 0`);
  assert.equal(metrics.adds, simpleAdds + 1, 'A movie click starts one recommended torrent');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Torrent files"]')`), false);
  await evaluate(`document.querySelector('[aria-label="English subtitles"]').click()`);
  await until(`document.querySelector('video').textTracks[0]?.cues?.length > 0`);
  assert.equal(await evaluate(`document.querySelector('video').textTracks[0].cues[0].text`), 'Torrent subtitle fixture');
  await evaluate(`document.querySelector('[aria-label="Show subtitles 0.5 seconds later"]').click()`);
  assert.equal(await evaluate(`document.querySelector('video').textTracks[0].cues[0].startTime`), 0.5);
  await screenshot('simple-playback-1440');
  await click('Try another source');
  await until(`!!document.querySelector('video') && document.querySelector('video').readyState >= 2`, 120000);
  if (await evaluate(`document.querySelector('video').paused`)) await click('Play');
  await until(`!document.querySelector('video').paused`);
  assert.equal(metrics.adds, simpleAdds + 2, 'Next source starts a different recommendation');
  await until(`document.querySelector('video').textTracks[0]?.cues?.length > 0`);
  await click('Back to browse');
  assert.equal(await evaluate(`!!document.querySelector('video')`), false);
  if (await evaluate('innerWidth < 768')) await evaluate(`document.querySelector('button[aria-label="Open navigation"]').click()`);
  await evaluate(`document.querySelector('nav button[aria-label="OVERVIEW"]').click()`);
  assert.equal(await evaluate(`document.querySelector('header').innerText.includes('SAMPLE DATA')`), true);
  const before = metrics.gets; await delay(3500); assert.equal(metrics.gets, before, 'leaving page stops polling');
  assert.deepEqual(errors, []); assert.ok(!browserUrls.some(u => u.includes(secret) || u.includes('torrserver') || u.includes('prowlarr') || u.includes('generativelanguage.googleapis.com')));
  assert.ok(!logs.join('').includes(secret), 'server logs have no fixture credentials');
  const report = { services: 'MOCK TMDB/Prowlarr/TorrServer/SubDL/Gemini — no live providers', runtime: 'Caddy + Next standalone + built React + Chrome', browser: await call('Browser.getVersion'), checks: ['catalogue/source distinction', 'TV season/episode query', '1080p Gemini recommendation', 'dismissal during AI response', 'next recommendation and manual sort', 'dismissal survives another search', 'cached Gemini review', 'all sources hidden and restore', 'dismiss active playback', 'source assist mobile layout', 'partial indexer failure', 'unknown counts', 'metadata polling', 'multi-file choice', 'MP4 playback', 'torrent SRT subtitles', 'local SRT/VTT subtitles', 'SubDL search by catalogue ID', 'SubDL raw subtitle download before playback', 'SubDL ZIP file selection', 'late subtitle download preserves Off', 'subtitle off and native controls', 'subtitle switching preserves playback', 'invalid subtitle recovery', 'seek', 'stop/disconnect', 'Range/If-Range/HEAD/416', 'external link revocation', 'unsupported-format error fixture', 'responsive layout', 'navigation polling cleanup', 'private credentials'], layout, aiReviews: metrics.aiReviews, streamRequests: metrics.streams.length, cancellations: metrics.cancellations, screenshots: out };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
} catch (error) { writeFileSync(resolve(out, 'failure.log'), `${error.stack}\n${logs.join('')}`); throw error; }
finally {
  if (call && socket?.readyState === WebSocket.OPEN) { await Promise.race([call('Browser.close').catch(() => {}), delay(1000)]); socket.close(); }
  for (const process of processes) process.kill(); fixture.closeAllConnections(); await new Promise(r => fixture.close(r));
}
