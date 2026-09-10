// UI integration check against built assets and local mock APIs; no live media services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { checkNativePlayer } from './native-player-ui-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'frontend/dist');
const output = resolve(root, 'frontend/node_modules/.cache/fire-tv-review');
mkdirSync(output, { recursive: true });
const profile = resolve(output, `chrome-${Date.now()}`);
const titles = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, kind: 'movie', title: `Example movie ${i + 1}`, year: '2026', overview: 'A sample catalogue title for remote navigation testing.', poster: null }));
const shows = titles.map(title => ({ ...title, kind: 'tv', title: `Example show ${title.id}` }));
const episodes = Array.from({ length: 24 }, (_, i) => ({ number: i + 1, name: `Episode ${i + 1}`, overview: 'A sample episode description for scrolling a full season.', airDate: '2026-01-01' }));
const file = { id: 1, path: 'Example movie.mp4', size: 1000000, kind: 'video', sample: false };
const torrent = { id: 'fixture', title: 'Example movie', state: 'ready', files: [file], downloadSpeed: 1024, connectedPeers: 5, downloadedBytes: 1000, completedBytes: 1000, preloadBytes: null, preloadTarget: null };
const plan = { id: 'direct', mode: 'direct', mime: 'video/mp4', container: 'mp4', video: 'copy', audio: 'copy', stream: '/api/media/stream/fixture', duration: 120 };
const source = { id: 'source', title: 'Example movie 2026', indexer: 'Fixture', size: 1000000, seeders: 5000, leechers: 0, peers: 5000, quality: ['1080p'], match: 'Title match' };
const alternatives = [source, { ...source, id: 'best', title: 'Example movie 2026 WEB-DL-GROUP' }, { ...source, id: 'broken', title: 'Example movie 2026 alternate' }, { ...source, id: 'wrong', title: 'Unrelated movie' }];
const advice = { provider: 'gemini', ranking: ['best', 'broken', 'source', 'wrong'].map(id => ({ id, identity: id === 'wrong' ? 'mismatch' : 'match', verdict: 'good', method: 'gemini', reason: 'Fixture' })) };
const metrics = { adds: [], selects: [], reviews: 0, subtitleSearches: [], subtitleDownloads: [] };
let simpleFixture = true;
let subtitleDelay = 0;
let recommendationDelay = 250;
let fallbackAdvice = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (path.startsWith('/api/media/')) {
    const endpoint = path.slice('/api/media/'.length);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (endpoint === 'recommend') { metrics.reviews++; await delay(recommendationDelay); }
    if (endpoint === 'playback') {
      metrics.adds.push(body.sourceId);
      if (simpleFixture && body.sourceId === 'broken') { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Fixture source unavailable' })); return; }
    }
    if (endpoint === 'select') metrics.selects.push(body.fileId);
    if (endpoint === 'subtitles/search') metrics.subtitleSearches.push(body);
    if (endpoint === 'subtitles/download') { metrics.subtitleDownloads.push(body.choice); await delay(subtitleDelay); }
    const json = endpoint === 'status' ? { tmdb: true, prowlarr: true, torrserver: true }
      : endpoint === 'catalogue' ? { titles: url.searchParams.get('kind') === 'tv' ? shows : titles, pages: 1 }
      : endpoint.startsWith('details/') ? { ...(endpoint.startsWith('details/tv/') ? shows : titles)[Number(endpoint.split('/').pop()) - 1], seasons: endpoint.startsWith('details/tv/') ? [{ number: 1, name: 'Season 1', episodes: episodes.length }] : [], imdbId: 'tt123', tvdbId: null, rating: 8.1 }
      : endpoint === 'continue-watching' ? { movies: [] }
      : endpoint.startsWith('season/') ? { episodes }
      : endpoint === 'search' ? { searchId: 'search', results: simpleFixture ? alternatives : [source], reports: [], more: false, batch: 1, advice: { provider: 'heuristic', ranking: [] } }
      : endpoint === 'recommend' ? fallbackAdvice ? { ...advice, provider: 'heuristic', warning: "Gemini's request limit or quota was reached. Using basic matching for this search." } : advice
      : endpoint === 'select' ? { id: 'selected', file, stream: plan.stream }
      : endpoint === 'inspect' ? { duration: 120, options: [plan] }
      : endpoint === 'prepare' ? plan
      : endpoint.startsWith('playback') ? { ...torrent, files: simpleFixture ? [{ ...file, id: 3, path: 'English.txt', kind: 'other', size: 99000000 }, { ...file, id: 2, path: 'sample.mp4', sample: true, size: 99000000 }, { ...file, id: 4, path: 'Short.mp4', size: 100 }, file] : [file] }
      : endpoint === 'subtitles/search' ? { title: 'Example movie', results: [{ id: 'mismatch', name: 'Other.srt', release: 'Other', language: 'FR' }, { id: 'english', name: 'Example movie.zip', release: 'Example movie WEB-DL-GROUP', language: 'EN', hearingImpaired: false, season: null, episode: null }] }
      : endpoint === 'subtitles/download' ? { files: [{ name: 'French.srt', content: Buffer.from('1\n00:00:01,000 --> 00:00:05,000\nFrench fixture').toString('base64') }, { name: 'English.srt', content: Buffer.from('1\n00:00:01,000 --> 00:00:05,000\nEnglish fixture').toString('base64') }] }
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
const chrome = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let socket;
let call;
const errors = [];
try {
  let debugPort;
  for (let i = 0; i < 100; i++) {
    try { debugPort = readFileSync(resolve(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await delay(100); }
  }
  assert.ok(debugPort, 'Headless Chrome started');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let requestId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const { done, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else done(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++requestId; pending.set(id, { done, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
    const body = await evaluate('document.body.innerText.slice(0, 1000)').catch(() => 'unavailable');
    throw new Error(`Timed out: ${expression}\nPage text: ${body}\nBrowser errors: ${JSON.stringify(errors)}`);
  };
  const focus = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); };
  const press = async key => {
    const code = ({ Enter: 13, Escape: 27, PageUp: 33, PageDown: 34, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 })[key];
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code || 0, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code || 0 });
    await delay(70);
  };
  const activate = async selector => { await focus(selector); await press('Enter'); };
  const active = () => evaluate('document.activeElement?.getAttribute("aria-label") || document.activeElement?.id || document.activeElement?.textContent');
  const resize = (width, height) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await call('Page.enable'); await call('Runtime.enable');
  if (process.argv.includes('--native-player')) {
    await resize(1280, 720);
    await checkNativePlayer({ call, evaluate, until, activate, origin, metrics });
    assert.deepEqual(errors, [], 'No browser exceptions during native player requests');
    console.log(JSON.stringify({ passed: true, checks: 'native subtitle API and archive selection, position-preserving source replacement, exhausted sources, quit to catalogue' }));
  } else {
  // Emulate older Silk APIs and playback state. Real decoding is outside this UI test.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    AbortSignal.any = undefined; AbortSignal.timeout = undefined;
    const states = new WeakMap();
    const state = v => { if (!states.has(v)) states.set(v, { paused: true, time: 0 }); return states.get(v); };
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get() { return state(this).paused; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get() { return state(this).time; }, set(v) { state(this).time = v; this.dispatchEvent(new Event('timeupdate')); } });
    HTMLMediaElement.prototype.load = function() {};
    HTMLMediaElement.prototype.play = function() { if (window.blockAutoplay) return Promise.reject(new DOMException('User gesture required', 'NotAllowedError')); state(this).paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function() { state(this).paused = true; this.dispatchEvent(new Event('pause')); };
  ` });
  await resize(1440, 900);
  await call('Page.navigate', { url: origin });
  await until('!!document.querySelector("aside")');
  assert.equal(await evaluate('document.documentElement.dataset.tvMode'), undefined, 'Normal desktop keeps its layout');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).fontSize'), '16px');
  await focus('nav button'); await press('ArrowRight');
  assert.equal(await active(), 'OVERVIEW', 'TV spatial navigation is inactive on desktop');
  await call('Page.navigate', { url: `${origin}/?tv=1` });
  await until('!!document.querySelector(".media-profile-grid button, .tv-catalogue-grid button")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".tv-footer")).display'), 'none', 'Profile chooser hides the TV footer');
  await evaluate('document.querySelector(".media-profile-grid button")?.click()');
  await until('document.querySelectorAll(".tv-catalogue-grid .title-card").length === 16');
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".tv-footer")).display'), 'none', 'TV footer returns after choosing a profile');
  for (const [width, height] of [[1280, 720], [1920, 1080], [960, 540], [390, 844]]) {
    await resize(width, height);
    const columns = await evaluate('getComputedStyle(document.querySelector(".tv-catalogue-grid")).gridTemplateColumns.split(" ").length');
    assert.ok(width < 600 ? columns === 2 : columns >= 5, `Catalogue is dense at ${width}px (${columns} columns)`);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth + 1'), `No horizontal overflow at ${width}`);
    if (width >= 1280) {
      await evaluate('window.scrollTo(0, 0)');
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve(output, `tv-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  }
  await resize(1280, 720);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Advanced mode"]').getAttribute('aria-checked')`), 'false', 'Simple mode is the default');
  assert.equal(await evaluate(`!!document.querySelector('#source-query')`), false);
  assert.equal(metrics.adds.length, 0, 'Browsing does not add a torrent');
  assert.equal(await evaluate('!!document.querySelector("[data-tv-scroll-controls]")'), false, 'TV pages have no Up/Down controls');
  await activate('.simple-catalogue-tabs button:last-child');
  await until('!!document.querySelector(\'[aria-label="Choose episode of Example show 1"]\')');
  await activate('.tv-catalogue-grid button');
  await until('document.querySelectorAll(".simple-episodes button").length === 24');
  const episodeBackground = await evaluate('window.scrollY');
  await focus('dialog button');
  await press('PageDown');
  await until('document.querySelector("dialog").scrollTop > 0');
  await press('PageUp');
  await focus('.simple-episodes button');
  for (let i = 1; i < episodes.length; i++) await press('ArrowDown');
  assert.equal(await active(), 'Watch episode 24: Episode 24', 'Remote can reach the last episode');
  assert.ok(await evaluate('document.activeElement.getBoundingClientRect().bottom <= document.querySelector("dialog").getBoundingClientRect().bottom'), 'Last episode is visible in the dialog');
  assert.equal(await evaluate('window.scrollY'), episodeBackground, 'Episode scrolling leaves the background still');
  await press('Escape');
  await activate('.simple-catalogue-tabs button:first-child');
  await until('!!document.querySelector(\'[aria-label="Details for Example movie 1"]\')');
  await evaluate('window.blockAutoplay = true');
  await activate('.tv-catalogue-grid button');
  await until('!!document.querySelector("dialog[open]") && document.body.innerText.includes("8.1")');
  assert.equal(await evaluate('!!document.querySelector(".simple-title-card .catalogue-info-button")'), false, 'TV cards have no separate information overlay');
  assert.equal(metrics.adds.length, 0, 'Movie click opens information before playback search');
  await until('!!document.querySelector("dialog button.bg-orange-600:not(:disabled)")');
  await activate('dialog button.bg-orange-600');
  await until(`document.body.innerText.includes('Ready to watch. Press Play to start.')`);
  assert.deepEqual(metrics.adds, ['best'], 'Uses Gemini ranking, not source result order');
  assert.ok(await evaluate(`document.body.innerText.includes('Selected with Gemini')`), 'A successful review is accurately labeled');
  assert.deepEqual(metrics.selects, [1], 'Selects the main video over a larger sample or non-video');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Torrent files"]')`), false);
  assert.equal(metrics.adds.length, 1, 'Blocked autoplay does not mark the source as broken');
  await evaluate('window.blockAutoplay = false');
  await activate('.tv-playback-controls button.bg-orange-600');
  await until('!document.querySelector("video").paused');
  await activate('[aria-label="English subtitles"]');
  await until('!!document.querySelector("video track")');
  assert.equal(metrics.subtitleSearches[0].language, 'EN');
  assert.equal(metrics.subtitleSearches[0].context.tmdbId, 1, 'Automatic subtitles retain catalogue identity');
  assert.deepEqual(metrics.subtitleDownloads, ['english']);
  assert.ok(await evaluate(`fetch(document.querySelector('track').src).then(r => r.text()).then(t => t.includes('English fixture'))`), 'Selects English from a mixed archive');
  await until(`!!document.querySelector('[aria-label="Show subtitles 0.5 seconds later"]')`);
  await activate('[aria-label="Show subtitles 0.5 seconds later"]');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Subtitle offset"]').textContent`), '+0.5 s');
  assert.equal(await evaluate('document.querySelector("video").paused'), false, 'Subtitle timing preserves playback');
  await activate('[aria-label="English subtitles"]');
  await until('!document.querySelector("video track")');
  await activate('[aria-label="English subtitles"]');
  await until('!!document.querySelector("video track")');
  assert.equal(metrics.subtitleDownloads.length, 1, 'Turning subtitles back on uses the downloaded file');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Subtitle offset"]').textContent`), '+0.5 s', 'Toggle preserves manual timing');
  const reviewsBeforeNext = metrics.reviews;
  await evaluate(`window.previousVideo = document.querySelector('video'); [...document.querySelectorAll('button')].find(b => b.textContent.includes('Try another source')).click()`);
  await until('document.querySelector("video") && !document.querySelector("video").paused');
  assert.deepEqual(metrics.adds, ['best', 'broken', 'source'], 'Next skips an unavailable torrent automatically');
  assert.equal(metrics.reviews, reviewsBeforeNext, 'Switching reuses the ranked queue');
  assert.equal(await evaluate('window.previousVideo.paused && !window.previousVideo.hasAttribute("src")'), true, 'Old player is stopped and detached');
  await until('!!document.querySelector("video track")');
  assert.equal(await evaluate(`document.querySelector('[aria-label="English subtitles"]').getAttribute('aria-checked')`), 'true', 'Subtitle preference follows the next source');
  await evaluate(`document.querySelector('video').dispatchEvent(new Event('error'))`);
  await until(`document.body.innerText.includes('No more matching versions')`);
  assert.equal(metrics.adds.includes('wrong'), false, 'An unrelated title never auto-plays after exhaustion');
  await activate('[data-tv-back]');
  await evaluate('sessionStorage.clear()');
  recommendationDelay = 1000;
  const beforeCancel = metrics.adds.length;
  await activate('.tv-catalogue-grid button');
  await until('!!document.querySelector("dialog button.bg-orange-600:not(:disabled)")');
  await activate('dialog button.bg-orange-600');
  await delay(100);
  await activate('[data-tv-back]');
  await delay(1100);
  assert.equal(metrics.adds.length, beforeCancel, 'Leaving during AI review never starts a late torrent');
  recommendationDelay = 0;
  subtitleDelay = 500;
  await activate('.tv-catalogue-grid button');
  await until('!!document.querySelector("dialog button.bg-orange-600:not(:disabled)")');
  await activate('dialog button.bg-orange-600');
  await until('document.querySelector("video") && !document.querySelector("video").paused');
  await activate('[aria-label="English subtitles"]');
  await until(`document.querySelector('[aria-label="Subtitle controls"]').textContent.includes('Loading subtitles')`);
  await activate('[aria-label="English subtitles"]');
  await delay(700);
  assert.equal(await evaluate('!!document.querySelector("video track")'), false, 'Late subtitle download cannot turn captions back on');
  await activate('[data-tv-back]');
  await evaluate('sessionStorage.clear()');
  fallbackAdvice = true;
  await activate('.tv-catalogue-grid button');
  await until('!!document.querySelector("dialog button.bg-orange-600:not(:disabled)")');
  await activate('dialog button.bg-orange-600');
  await until('document.querySelector("video") && !document.querySelector("video").paused');
  assert.ok(await evaluate(`document.body.innerText.includes("Gemini's request limit or quota was reached.")`), 'Simple mode explains the actual fallback reason');
  assert.equal(await evaluate(`document.body.innerText.includes('AI unavailable')`), false);
  await activate('[data-tv-back]');
  await evaluate('sessionStorage.clear()');
  await focus('#catalogue-query');
  await call('Input.insertText', { text: 'Example' });
  await press('Enter');
  await until(`!![...document.querySelectorAll('button')].find(button => button.textContent.includes('Exit search'))`);
  await activate('[data-tv-back]');
  await until(`document.querySelector('#catalogue-query').value === '' && document.body.innerText.includes('Popular movies')`);
  await activate('[aria-label="Advanced mode"]');
  simpleFixture = false;
  await until(`!!document.querySelector('#catalogue-kind')`);
  assert.equal(await evaluate('localStorage.getItem("homelab:advanced-media")'), 'true', 'Mode preference is saved');
  assert.ok(await evaluate('document.scrollingElement.scrollHeight > innerHeight'), 'TV content scrolls the browser document');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("main")).overflowY'), 'visible', 'No nested page scrollbar');
  await evaluate('window.scrollTo(0, 0)');
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY: 400 });
  await until('window.scrollY > 0');
  await evaluate('window.scrollTo(0, 0)');
  await focus('[aria-label="Advanced mode"]'); await press('PageDown');
  assert.ok(await evaluate('window.scrollY > 0'), 'PageDown scrolls from a focused page control');
  await press('PageUp'); assert.equal(await evaluate('window.scrollY'), 0);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 710 });
  await until('window.scrollY > 60');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 360 });
  const afterEdge = await evaluate('window.scrollY');
  await delay(450);
  assert.equal(await evaluate('window.scrollY'), afterEdge, 'Moving the cursor away stops edge scrolling');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 30 });
  await until('window.scrollY < ' + afterEdge);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 360 });
  await evaluate(`(() => {
    const section = document.createElement('section'); section.id = 'scroll-regression';
    section.innerHTML = '<button id="last-content-control">Last control</button><p style="height:1800px">Long text after the last control</p>';
    document.querySelector('main').append(section);
    document.querySelector('#last-content-control').focus();
    document.querySelector('#last-content-control').scrollIntoView({ block: 'start' });
  })()`);
  const beforeFallback = await evaluate('window.scrollY');
  await press('ArrowDown');
  assert.ok(await evaluate('window.scrollY > ' + beforeFallback), 'Down scrolls long text when there is no next control');
  await evaluate('document.querySelector("#scroll-regression").remove()');
  await focus('.tv-catalogue-grid button');
  await press('ArrowRight'); assert.equal(await active(), 'Details for Example movie 2');
  await press('ArrowDown'); assert.equal(await active(), 'Details for Example movie 7');
  await press('ArrowDown'); assert.equal(await active(), 'Details for Example movie 12');
  assert.ok(await evaluate('document.activeElement.getBoundingClientRect().bottom <= innerHeight'), 'Offscreen poster scrolls into the viewport');
  await press('Enter'); await until('!!document.querySelector("dialog[open]")');
  for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']) {
    await press(key); assert.ok(await evaluate('!!document.activeElement.closest("dialog")'), 'Focus stays in title details');
  }
  const behindDialog = await evaluate('window.scrollY');
  await evaluate(`document.querySelector('dialog').style.maxHeight = '260px'; document.querySelector('dialog .max-w-4xl').style.minHeight = '900px'`);
  await focus('dialog button'); await press('PageDown');
  assert.ok(await evaluate('document.querySelector("dialog").scrollTop > 0'), 'PageDown scrolls long dialog content');
  const dialogScroll = await evaluate('document.querySelector("dialog").scrollTop');
  const dialogBottom = await evaluate('document.querySelector("dialog").getBoundingClientRect().bottom');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: dialogBottom - 10 });
  await delay(500);
  assert.equal(await evaluate('document.querySelector("dialog").scrollTop'), dialogScroll, 'Cursor beside a dialog does not scroll it');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 710 });
  await delay(500);
  assert.equal(await evaluate('window.scrollY'), behindDialog, 'Dialog scrolling and cursor edges leave the background still');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 360 });
  await press('Escape');
  assert.equal(await active(), 'Details for Example movie 12', 'Dialog returns focus to the selected poster');
  await focus('#catalogue-query');
  await call('Input.insertText', { text: 'Example' });
  await press('ArrowLeft'); assert.equal(await active(), 'catalogue-query', 'Left edits text');
  await press('ArrowDown'); assert.notEqual(await active(), 'catalogue-query', 'Down leaves text entry');
  await focus('#catalogue-kind'); await press('ArrowRight'); assert.notEqual(await active(), 'catalogue-kind', 'Right leaves native select');
  await activate('.tv-catalogue-grid button');
  await until('!!document.querySelector("dialog button.bg-orange-600")');
  await activate('dialog button.bg-orange-600');
  await until('!!document.querySelector("#source-query")');
  assert.equal(await active(), 'source-query', 'Find sources focuses the source form');
  await activate('#source-query + button');
  await until('!!document.querySelector("article button")');
  await until(`document.body.innerText.includes("Gemini's request limit or quota was reached.")`);
  fallbackAdvice = false;
  await evaluate(`window.focusTrail = []; document.addEventListener('focusin', e => window.focusTrail.push(e.target.getAttribute('aria-label') || e.target.textContent))`);
  await activate('article button');
  await until(`!!document.querySelector('[aria-label="Torrent files"] button')`);
  assert.equal(await active(), 'Close playback', 'Opening playback moves focus into its panel');
  await activate('[aria-label="Torrent files"] button');
  await until('!!document.querySelector("video")');
  assert.equal((await active()).trim(), 'Play', 'Selecting a file focuses Play');
  await press('Enter'); await until('document.querySelector(".tv-playback-controls").textContent.includes("Pause")');
  await activate('[aria-label="Forward 10 seconds"]');
  assert.equal(await evaluate('document.querySelector("video").currentTime'), 10, 'TV seek moves a direct stream without restarting');
  await focus('input[type="range"]'); await press('ArrowRight');
  assert.equal(await evaluate('document.querySelector("video").currentTime'), 20);
  await press('ArrowDown'); assert.ok(await evaluate('document.activeElement.type !== "range"'), 'The timeline does not trap the remote');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "MediaPlayPause", bubbles: true, cancelable: true }))');
  await until('document.querySelector("video").paused');
  await activate('[aria-label="Toggle fullscreen video"]');
  await until('!!document.fullscreenElement');
  assert.ok(await evaluate('document.fullscreenElement.classList.contains("tv-player-screen")'), 'TV fullscreen includes large controls');
  await press('Escape'); await until('!document.fullscreenElement');
  assert.ok(await evaluate('!!document.querySelector("video")'), 'First Back exits fullscreen without closing playback');
  await focus('.tv-playback-controls button:not(:disabled)'); await press('Escape');
  await until('!document.querySelector("video")');
  assert.ok((await active()).includes('Choose source'), `Closing playback restores the source button (got ${await active()}; ${JSON.stringify(await evaluate('window.focusTrail'))})`);
  await press('Escape'); await until('!!document.querySelector("#catalogue-query")');
  assert.equal(await evaluate('document.querySelector(".tv-header")'), null, 'TV mode has no top bar');
  assert.ok(await evaluate('document.querySelector(".tv-footer")?.innerText.includes("BUILD")'), 'TV build information is in the footer');
  assert.ok(await evaluate('!!document.querySelector(".tv-footer #tv-dashboard-section")'), 'Dashboard navigation is in the footer');
  assert.ok(await evaluate('!!document.querySelector(".tv-footer [aria-label=\"Advanced mode\"]")'), 'Advanced mode is in the footer');
  assert.equal(await evaluate('document.querySelectorAll("[aria-label=\"Advanced mode\"]").length'), 1, 'TV page does not duplicate Advanced mode in its header');
  await evaluate(`(() => { const select = document.querySelector('#tv-dashboard-section'); select.value = 'overview'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until('document.querySelector("#tv-dashboard-section").value === "overview"');
  await evaluate(`(() => { const select = document.querySelector('#tv-dashboard-section'); select.value = 'tv'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until('!!document.querySelector("#catalogue-query")');
  await call('Page.navigate', { url: `${origin}/?tv=0` }); await until('!!document.querySelector("aside")');
  assert.equal(await evaluate('document.documentElement.dataset.tvMode'), undefined);
  await call('Page.navigate', { url: origin }); await until('!!document.querySelector("aside")');
  assert.equal(await evaluate('localStorage.getItem("homelab:tv-mode")'), '0', 'Desktop override persists on this browser');
  await evaluate('localStorage.removeItem("homelab:tv-mode")');
  await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit/537.36 Silk/120.1 Chrome/120.0 Safari/537.36' });
  await call('Page.navigate', { url: origin }); await until('!!document.querySelector(".tv-shell")');
  assert.equal(await evaluate('document.documentElement.dataset.tvMode'), 'true', 'Fire TV auto-detection');
  assert.deepEqual(errors, [], 'No browser exceptions');
  simpleFixture = true;
  fallbackAdvice = false;
  await checkNativePlayer({ call, evaluate, until, activate, origin, metrics });
  assert.deepEqual(errors, [], 'No browser exceptions during native player requests');
  await call('Page.navigate', { url: origin });
  await until('!!document.querySelector(".tv-shell")');
  // Reproduce the native-3 failure: Android interface exists, but no injected plugin headers.
  const missingBridge = await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.androidBridge = {};' });
  await call('Page.navigate', { url: `${origin}/?tv=1` });
  await until('document.querySelector("#startup-error")?.hidden === false');
  assert.match(await evaluate('document.querySelector("#startup-details").textContent'), /Bootstrap failed[\s\S]*Preferences.*not implemented on android/);
  assert.equal(await active(), 'startup-retry', 'Startup failure focuses Retry for the remote');
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: missingBridge.identifier });
  await activate('#startup-retry');
  await until('!!document.querySelector(".tv-shell")');
  assert.equal(await evaluate('document.querySelector("#startup-error").hidden'), true, 'Retry recovers after bridge failure');
  // The footer controls a native select during TV render; force that render to throw.
  const renderFailure = await call('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(HTMLSelectElement.prototype, "value", { get() { throw new Error("Fixture React render failure"); }, set() { throw new Error("Fixture React render failure"); } });' });
  await call('Page.navigate', { url: `${origin}/?tv=1` });
  await until('document.querySelector("#startup-error")?.hidden === false');
  assert.match(await evaluate('document.querySelector("#startup-details").textContent'), /React render error[\s\S]*Fixture React render failure/);
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: renderFailure.identifier });
  console.log(JSON.stringify({ passed: true, viewports: [1280, 1920, 960, 390], checks: 'simple default and saved advanced mode, automatic Gemini selection, largest main video, autoplay denial recovery, automatic English ZIP selection, subtitle offset and cancellation, next source and failed-source fallback, exhausted sources, AI cancellation, desktop isolation, auto-detection, fallback APIs, scrolling, D-pad, dialogs, manual selection, seeking, fullscreen and Back', screenshots: output }, null, 2));
  }
} finally {
  if (call && socket?.readyState === WebSocket.OPEN) {
    await Promise.race([call('Browser.close').catch(() => {}), delay(1000)]); socket.close();
  }
  chrome.kill();
  await new Promise(done => { server.close(done); server.closeAllConnections(); });
}
