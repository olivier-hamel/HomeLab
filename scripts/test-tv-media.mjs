// Real Caddy + Next standalone + built React + headless Chrome, with MOCK services.
// Requires a licensed H.264/AAC MP4 fixture. See docs/tv-media.md.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as portProbe } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = resolve(root, 'backend/node_modules/.cache/media-reference');
const out = resolve(root, 'frontend/node_modules/.cache/tv-review');
mkdirSync(out, { recursive: true });
const caddyBin = process.env.CADDY_BIN || resolve(cache, 'caddy/caddy.exe');
const chromeBin = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const videoPath = process.env.TV_TEST_MP4 || resolve(cache, 'authorized-trailer.mp4');
for (const path of [caddyBin, chromeBin, videoPath, resolve(root, 'backend/.next/standalone/server.js'), resolve(root, 'frontend/dist/index.html')]) assert.ok(existsSync(path), `Required file: ${path}`);
const videoBytes = readFileSync(videoPath);
const freePort = async () => { const s = portProbe(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const [backendPort, frontendPort, fixturePort] = await Promise.all([freePort(), freePort(), freePort()]);
const origin = `http://127.0.0.1:${frontendPort}`;
const upstream = `http://127.0.0.1:${fixturePort}`;
const hash = 'b'.repeat(40);
const secret = 'test-only-media-canary-not-a-live-credential';
const metrics = { adds: 0, gets: 0, streams: [], cancellations: 0, downloads: 0 };
const torrentStatus = () => ({ hash, title: 'Big Buck Bunny — authorized trailer fixture', stat: 3, file_stats: [{ id: 1, path: 'sample.mp4', length: 20 }, { id: 2, path: 'Big Buck Bunny trailer.mp4', length: videoBytes.length }, { id: 3, path: 'English.srt', length: 45 }, { id: 4, path: 'Unsupported-format fixture.avi', length: 64 }], active_peers: 3, download_speed: 65536, bytes_read_data: 123456, loaded_size: 123456 });
const fixture = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, upstream);
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
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
      if (url.pathname === '/api/v1/search') return url.searchParams.get('indexerIds') === '2' ? json({ error: secret }, 503) : json([{ title: 'Big Buck Bunny 2008 1080p H264 AAC — licensed fixture', size: videoBytes.length, seeders: null, leechers: 3, downloadUrl: `${upstream}/1/download?apikey=${secret}&link=fixture`, imdbId: 1254207 }]);
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
      if (url.searchParams.get('index') === '4') { res.writeHead(200, { 'Content-Type': 'video/x-msvideo' }); return res.end('RIFF unsupported-format test fixture; intentionally not decodable'); }
      assert.equal(url.searchParams.get('index'), '2', 'sample never selected automatically');
      let start = 0; let end = videoBytes.length - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        assert.ok(match);
        if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        else start = Math.max(0, videoBytes.length - Number(match[2]));
      }
      if (start >= videoBytes.length) { res.writeHead(416, { 'Content-Range': `bytes */${videoBytes.length}` }); return res.end(); }
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ETag: '"fixture"', ...(req.headers.range ? { 'Content-Range': `bytes ${start}-${end}/${videoBytes.length}` } : {}) });
      if (req.method === 'HEAD') return res.end();
      let finished = false;
      res.on('close', () => { if (!finished) metrics.cancellations++; });
      for (let offset = start; offset <= end && !res.destroyed; offset += 65536) { res.write(videoBytes.subarray(offset, Math.min(end + 1, offset + 65536))); await delay(40); }
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
  launch(process.execPath, [resolve(root, 'backend/.next/standalone/server.js')], { ...process.env, NODE_ENV: 'production', PORT: String(backendPort), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1', MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: origin, MEDIA_SESSION_SECRET: secret, PROWLARR_BASE_URL: upstream, PROWLARR_API_KEY: secret, TORRSERVER_BASE_URL: upstream, TORRSERVER_USERNAME: 'fixture', TORRSERVER_PASSWORD: secret, TMDB_READ_ACCESS_TOKEN: secret, TV_TEST_UPSTREAM: upstream, NODE_OPTIONS: `--import=${pathToFileURL(resolve(root, 'scripts/tmdb-test-preload.mjs')).href}` });
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
  await until(`!!document.querySelector('button[aria-label="Details for Big Buck Bunny"]')`);
  assert.equal(metrics.adds, 0, 'browsing never initiates torrents');
  assert.equal(await evaluate(`document.querySelector('header').innerText.includes('SAMPLE DATA')`), false);
  await evaluate(`document.querySelector('details[aria-label="About TMDB"]').open = true`);
  await until(`document.querySelector('img[alt="TMDB"]').naturalWidth > 0`);
  assert.ok(await evaluate(`document.querySelector('details[aria-label="About TMDB"]').innerText.includes('This product uses the TMDB API but is not endorsed or certified by TMDB.')`));
  await evaluate(`document.querySelector('details[aria-label="About TMDB"]').open = false`);
  await screenshot('catalogue-1440');
  await evaluate(`document.querySelector('button[aria-label="Details for Big Buck Bunny"]').click()`);
  await until(`document.body.innerText.includes('Find sources')`); await click('Find sources');
  assert.equal(await evaluate(`document.querySelector('#source-query').value`), 'Big Buck Bunny 2008');
  assert.equal(metrics.adds, 0); await click('Search sources');
  await until(`document.body.innerText.includes('Choose source')`);
  assert.ok(await evaluate(`document.body.innerText.includes('HTTP 503') && document.body.innerText.includes('S: Unknown')`));
  await screenshot('sources-1440');
  await click('Choose source'); await until(`document.body.innerText.includes('Choose sample')`);
  assert.ok(metrics.adds >= 1); assert.equal(metrics.streams.length, 0, 'files do not auto-play');
  await click('Choose video'); await until('!!document.querySelector("video")');
  await click('Play'); await until('document.querySelector("video").currentTime > 1', 40000);
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
  await evaluate(`const row = [...document.querySelectorAll('[aria-label="Torrent files"] > div')].find(e => e.innerText.includes('Unsupported-format')); row.querySelector('button').click()`);
  await until(`document.querySelector('video') && document.body.innerText.includes('Unsupported-format fixture.avi')`);
  await click('Play'); await until(`document.body.innerText.includes('Unsupported format or interrupted stream') || document.body.innerText.includes('could not start the stream')`);
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
  await until(`!!document.querySelector('section[aria-label="Title details"] select option[value="2"]')`);
  await evaluate(`const selects = document.querySelectorAll('section[aria-label="Title details"] select'); selects[1].value = '2'; selects[1].dispatchEvent(new Event('change', {bubbles:true}))`);
  const addsBeforeEpisode = metrics.adds;
  await click('Find sources');
  assert.equal(await evaluate(`document.querySelector('#source-query').value`), 'Big Buck Bunny S01E02');
  assert.equal(metrics.adds, addsBeforeEpisode, 'TV episode selection does not add a torrent');
  if (await evaluate('innerWidth < 768')) await evaluate(`document.querySelector('button[aria-label="Open navigation"]').click()`);
  await evaluate(`document.querySelector('nav button[aria-label="OVERVIEW"]').click()`);
  assert.equal(await evaluate(`document.querySelector('header').innerText.includes('SAMPLE DATA')`), true);
  const before = metrics.gets; await delay(3500); assert.equal(metrics.gets, before, 'leaving page stops polling');
  assert.deepEqual(errors, []); assert.ok(!browserUrls.some(u => u.includes(secret) || u.includes('torrserver') || u.includes('prowlarr')));
  assert.ok(!logs.join('').includes(secret), 'server logs have no fixture credentials');
  const report = { services: 'MOCK TMDB/Prowlarr/TorrServer — no live media VM', runtime: 'Caddy + Next standalone + built React + Chrome', browser: await call('Browser.getVersion'), checks: ['catalogue/source distinction', 'TV season/episode query', 'partial indexer failure', 'unknown counts', 'metadata polling', 'multi-file choice', 'MP4 playback', 'seek', 'stop/disconnect', 'Range/If-Range/HEAD/416', 'external link revocation', 'unsupported-format error fixture', 'responsive layout', 'navigation polling cleanup', 'private credentials'], layout, streamRequests: metrics.streams.length, cancellations: metrics.cancellations, screenshots: out };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { writeFileSync(resolve(out, 'failure.log'), `${error.stack}\n${logs.join('')}`); throw error; }
finally {
  if (call && socket?.readyState === WebSocket.OPEN) { await Promise.race([call('Browser.close').catch(() => {}), delay(1000)]); socket.close(); }
  for (const process of processes) process.kill(); fixture.closeAllConnections(); await new Promise(r => fixture.close(r));
}
