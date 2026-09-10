// Real caption rendering against built assets and local mock APIs.
// Run after frontend build: node scripts/test-subtitle-timing.mjs [--firefox]
// TV_TEST_MP4 may point to a playable H.264 clip of at least 12 seconds; defaults
// to the generated fixture from test-tv-media.mjs. No live services are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'frontend/dist');
const output = resolve(root, 'frontend/node_modules/.cache/subtitle-timing');
mkdirSync(output, { recursive: true });
const profile = resolve(output, `browser-${Date.now()}`);
const titles = [{ id: 1, kind: 'movie', title: 'Example movie', year: '2026', overview: 'Subtitle timing fixture', poster: null }];
const file = { id: 1, path: 'Example movie.mp4', size: 1000000, kind: 'video', sample: false };
const torrent = { id: 'fixture', title: 'Example movie', state: 'ready', files: [file], downloadSpeed: 1024, connectedPeers: 5, downloadedBytes: 1000, completedBytes: 1000, preloadBytes: null, preloadTarget: null };
const plan = { id: 'remux', mode: 'remux', mime: 'video/mp4', container: 'mp4', video: 'copy', audio: 'copy', stream: '/api/media/stream/fixture', duration: 120 };
const source = { id: 'source', title: 'Example movie 2026', indexer: 'Fixture', size: 1000000, seeders: 5000, leechers: 0, peers: 5000, quality: ['1080p'], match: 'Title match' };
const advice = { provider: 'gemini', ranking: [{ id: 'source', identity: 'match', verdict: 'good', method: 'gemini', reason: 'Fixture' }] };
const videoBytes = readFileSync(process.env.TV_TEST_MP4 || resolve(root, 'frontend/node_modules/.cache/tv-review/generated-base.mp4'));
const subtitle = Buffer.from('1\n00:00:01,000 --> 00:00:05,000\nEnglish fixture\n\n2\n00:00:31,000 --> 00:00:35,000\nAfter seek').toString('base64');
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (path === '/api/media/stream/fixture') {
    const bytes = videoBytes;
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    res.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(match ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + bytes.length } : {}) });
    res.end(bytes.subarray(start, end + 1)); return;
  }
  if (path.startsWith('/api/media/')) {
    const endpoint = path.slice('/api/media/'.length);
    for await (const chunk of req) { void chunk; }
    const json = endpoint === 'status' ? { tmdb: true, prowlarr: true, torrserver: true }
      : endpoint === 'catalogue' ? { titles, pages: 1 }
      : endpoint.startsWith('details/') ? { ...titles[0], seasons: [], imdbId: 'tt123', tvdbId: null }
      : endpoint === 'search' ? { searchId: 'search', results: [source], reports: [], more: false, batch: 1, advice: { provider: 'heuristic', ranking: [] } }
      : endpoint === 'recommend' ? advice
      : endpoint === 'select' ? { id: 'selected', file, stream: plan.stream }
      : endpoint === 'inspect' ? { duration: 120, options: [plan] }
      : endpoint === 'prepare' ? plan
      : endpoint.startsWith('playback') ? torrent
      : endpoint === 'subtitles/search' ? { title: 'Example movie', results: [{ id: 'mismatch', name: 'Other.srt', release: 'Other', language: 'FR' }, { id: 'english', name: 'Example movie.zip', release: 'Example movie WEB-DL-GROUP', language: 'EN', hearingImpaired: false, season: null, episode: null }] }
      : endpoint === 'subtitles/download' ? { files: [{ name: 'English.srt', content: subtitle }] }
      : endpoint === 'subtitles/provider' ? { configured: false } : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); return;
  }
  const asset = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
  if (!asset.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const bytes = readFileSync(asset);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' })[extname(asset)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const firefoxMode = process.argv.includes('--firefox');
const debug = createServer(); await new Promise(done => debug.listen(0, '127.0.0.1', done));
const port = debug.address().port; await new Promise(done => debug.close(done));
mkdirSync(profile, { recursive: true });
writeFileSync(resolve(profile, 'user.js'), 'user_pref("media.autoplay.default", 0);\n');
const browser = firefoxMode
  ? spawn(process.env.FIREFOX_BIN || 'C:/Program Files/Mozilla Firefox/firefox.exe', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  : spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

let socket, call;
const errors = [];
try {
  let url;
  for (let i = 0; i < 100; i++) {
    try {
      if (firefoxMode) url = 'ws://127.0.0.1:' + port + '/session';
      else {
        const debugPort = readFileSync(resolve(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
        const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
        url = targets.find(target => target.type === 'page').webSocketDebuggerUrl;
      }
      socket = new WebSocket(url);
      await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; }); break;
    } catch { await delay(100); }
  }
  assert.equal(socket?.readyState, WebSocket.OPEN, 'Browser started');
  let requestId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (pending.has(message.id)) {
      const { done, reject, timer } = pending.get(message.id); pending.delete(message.id); clearTimeout(timer);
      if (message.error || message.type === 'error') reject(new Error(JSON.stringify(message))); else done(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => reject(new Error(method + ' timed out')), 15000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  let context;
  if (firefoxMode) {
    await call('session.new', { capabilities: {} });
    ({ context } = await call('browsingContext.create', { type: 'tab' }));
  } else { await call('Page.enable'); await call('Runtime.enable'); }
  const evaluate = async expression => {
    if (firefoxMode) {
      const result = await call('script.evaluate', { expression: '(async () => JSON.stringify(await (' + expression + ')))()', target: { context }, awaitPromise: true });
      if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
      return result.result.value === undefined ? undefined : JSON.parse(result.result.value);
    }
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
    throw new Error('Timed out: ' + expression);
  };
  const activate = async selector => {
    await evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()'); await delay(100);
  };
  const resize = (width, height) => firefoxMode ? call('browsingContext.setViewport', { context, viewport: { width, height } }) : call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await resize(1280, 720);
  await (firefoxMode ? call('browsingContext.navigate', { context, url: origin + '/?tv=1', wait: 'complete' }) : call('Page.navigate', { url: origin + '/?tv=1' }));
  await until('!!document.querySelector(".tv-catalogue-grid button")');
  await activate('.tv-catalogue-grid button');
  await until('!!document.querySelector("video")');
  await evaluate('document.querySelector("video").muted = true');
  await activate('.tv-playback-controls button.bg-orange-600');
  await until('document.querySelector("video").readyState >= 2');
  await evaluate('document.querySelector("video").pause()');
  await activate('[aria-label="English subtitles"]');
  await until('document.querySelector("track")?.track.cues?.length > 0');
  const inspect = () => evaluate('({time: document.querySelector("video").currentTime, cues: Array.from(document.querySelector("track").track.cues, c => [c.startTime,c.endTime]), active: Array.from(document.querySelector("track").track.activeCues || [], c => c.text)})');
  assert.deepEqual((await inspect()).cues, [[1, 5], [31, 35]]);
  await activate('[aria-label="Show subtitles 0.5 seconds later"]');
  assert.deepEqual((await inspect()).cues, [[1.5, 5.5], [31.5, 35.5]]);
  await activate('[aria-label="Show subtitles 0.5 seconds earlier"]');
  assert.deepEqual((await inspect()).cues, [[1, 5], [31, 35]]);
  await evaluate('document.querySelector("video").currentTime = 1.25');
  await until('!document.querySelector("video").seeking');
  assert.deepEqual((await inspect()).active, ['English fixture']);
  await activate('[aria-label="Show subtitles 0.5 seconds later"]');
  assert.deepEqual((await inspect()).active, [], 'Delaying an active caption immediately removes it, even while paused');
  assert.equal((await inspect()).time, 1.25, 'Adjusting subtitles does not seek the video');
  await activate('[aria-label="Show subtitles 0.5 seconds earlier"]');
  assert.deepEqual((await inspect()).active, ['English fixture'], 'Advancing restores the active caption immediately');

  const setStep = async value => evaluate(`(() => { const select = document.querySelector('[aria-label="Subtitle timing"] select'); select.value = '${value}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await setStep(0.1);
  for (let i = 0; i < 3; i++) await activate('[aria-label="Show subtitles 0.1 seconds later"]');
  assert.deepEqual((await inspect()).cues, [[1.3, 5.3], [31.3, 35.3]], 'Fine adjustments have no accumulated drift');
  await setStep(5);
  await activate('[aria-label="Show subtitles 5 seconds earlier"]');
  assert.deepEqual((await inspect()).cues.map(times => times.map(time => Math.round(time * 10) / 10)), [[-3.7, 0.3], [26.3, 30.3]], 'Large negative offsets retain cues before time zero');
  await evaluate(`[...document.querySelectorAll('[aria-label="Subtitle timing"] button')].find(button => button.textContent.includes('Reset timing')).click()`);
  await until('document.querySelector("track").track.cues[0].startTime === 1');
  assert.deepEqual((await inspect()).cues, [[1, 5], [31, 35]], 'Reset restores the original cue boundaries');
  await setStep(0.5);
  await activate('[aria-label="Show subtitles 0.5 seconds later"]');
  await evaluate('document.querySelector("video").load()');
  await until('document.querySelector("video").readyState >= 2');
  assert.deepEqual((await inspect()).cues, [[1.5, 5.5], [31.5, 35.5]], 'Reload retains the offset');
  await activate('[aria-label="Show subtitles 0.5 seconds later"]');
  assert.deepEqual((await inspect()).cues, [[2, 6], [32, 36]], 'Reload does not apply the offset twice');
  await activate('[aria-label="English subtitles"]');
  await until('!document.querySelector("track")');
  await activate('[aria-label="English subtitles"]');
  await until('document.querySelector("track")?.track.cues?.length === 2');
  assert.deepEqual((await inspect()).cues, [[2, 6], [32, 36]], 'Turning subtitles off and on retains timing');

  // Seek beyond downloaded data so the player starts a new converted timeline.
  await evaluate(`(() => { const input = document.querySelector('input[type="range"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '30'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until('document.querySelector("video").src.includes("start=30") && document.querySelector("video").readyState >= 2');
  await evaluate('document.querySelector("video").pause()');
  assert.deepEqual((await inspect()).cues, [[-28, -24], [2, 6]], 'Converted seek combines timeline start and manual offset');
  await activate('[aria-label="Show subtitles 0.5 seconds earlier"]');
  assert.deepEqual((await inspect()).cues, [[-28.5, -24.5], [1.5, 5.5]], 'Timing still works after a converted seek');

  for (const width of [1280, 390]) {
    await resize(width, width === 390 ? 844 : 720);
    await evaluate(`document.querySelector('[aria-label="Subtitle timing"]').scrollIntoView({ block: 'center' })`);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `No overflow at ${width}px`);
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('[aria-label="Subtitle timing"] button')).every(button => button.scrollWidth <= button.clientWidth + 1)`), `Button labels fit at ${width}px`);
    const screenshot = firefoxMode ? await call('browsingContext.captureScreenshot', { context }) : await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(output, `${firefoxMode ? 'firefox' : 'chrome'}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, browser: firefoxMode ? 'Firefox' : 'Chrome', checks: 'Active captions, both offset directions, fine and coarse steps, reset, reload, toggle, converted seek, responsive layout', screenshots: output }));
} finally {
  if (call && socket?.readyState === WebSocket.OPEN) {
    await Promise.race([call(firefoxMode ? 'browser.close' : 'Browser.close').catch(() => {}), delay(1000)]); socket.close();
  }
  browser.kill();
  await new Promise(done => { server.close(done); server.closeAllConnections(); });
}
