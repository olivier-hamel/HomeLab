// UI integration check against built assets and local mock APIs; no live media services.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'frontend/dist');
const output = resolve(root, 'frontend/node_modules/.cache/fire-tv-review');
mkdirSync(output, { recursive: true });
const profile = resolve(output, `chrome-${Date.now()}`);
const titles = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, kind: 'movie', title: `Example movie ${i + 1}`, year: '2026', overview: 'A sample catalogue title for remote navigation testing.', poster: null }));
const file = { id: 1, path: 'Example movie.mp4', size: 1000000, kind: 'video', sample: false };
const torrent = { id: 'fixture', title: 'Example movie', state: 'ready', files: [file], downloadSpeed: 1024, connectedPeers: 5, downloadedBytes: 1000, completedBytes: 1000, preloadBytes: null, preloadTarget: null };
const plan = { id: 'direct', mode: 'direct', mime: 'video/mp4', container: 'mp4', video: 'copy', audio: 'copy', stream: '/api/media/stream/fixture', duration: 120 };
const source = { id: 'source', title: 'Example movie 2026', indexer: 'Fixture', size: 1000000, seeders: 5000, leechers: 0, peers: 5000, quality: ['1080p'], match: 'Title match' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/media/')) {
    const endpoint = path.slice('/api/media/'.length);
    const json = endpoint === 'status' ? { tmdb: true, prowlarr: true, torrserver: true }
      : endpoint === 'catalogue' ? { titles, pages: 1 }
      : endpoint.startsWith('details/') ? { ...titles[Number(endpoint.split('/').pop()) - 1], seasons: [], imdbId: 'tt123', tvdbId: null }
      : endpoint === 'search' ? { searchId: 'search', results: [source], reports: [], more: false, batch: 1, advice: { ranking: [] } }
      : endpoint === 'recommend' ? { ranking: [] }
      : endpoint === 'select' ? { id: 'selected', file, stream: plan.stream }
      : endpoint === 'inspect' ? { duration: 120, options: [plan] }
      : endpoint === 'prepare' ? plan
      : endpoint.startsWith('playback') ? torrent
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
    throw new Error(`Timed out: ${expression}`);
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
  // Emulate older Silk APIs and playback state. Real decoding is outside this UI test.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    AbortSignal.any = undefined; AbortSignal.timeout = undefined;
    const states = new WeakMap();
    const state = v => { if (!states.has(v)) states.set(v, { paused: true, time: 0 }); return states.get(v); };
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get() { return state(this).paused; } });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get() { return state(this).time; }, set(v) { state(this).time = v; this.dispatchEvent(new Event('timeupdate')); } });
    HTMLMediaElement.prototype.load = function() {};
    HTMLMediaElement.prototype.play = function() { state(this).paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
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
  await until('document.querySelectorAll(".tv-catalogue-grid button").length === 16');
  for (const [width, height, columns] of [[1280, 720, 4], [1920, 1080, 5], [960, 540, 3], [390, 844, 2]]) {
    await resize(width, height);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".tv-catalogue-grid")).gridTemplateColumns.split(" ").length'), columns);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth + 1'), `No horizontal overflow at ${width}`);
    if (width >= 1280) {
      await evaluate('window.scrollTo(0, 0)');
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(resolve(output, `tv-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  }
  await resize(1280, 720);
  assert.ok(await evaluate('document.scrollingElement.scrollHeight > innerHeight'), 'TV content scrolls the browser document');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("main")).overflowY'), 'visible', 'No nested page scrollbar');
  await activate('[aria-label="Scroll page down"]');
  assert.ok(await evaluate('window.scrollY > 0'), 'Visible Down button scrolls the document');
  const afterDown = await evaluate('window.scrollY');
  await activate('[aria-label="Scroll page up"]');
  assert.ok(await evaluate('window.scrollY < ' + afterDown), 'Visible Up button scrolls back');
  await evaluate('window.scrollTo(0, 0)');
  await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY: 400 });
  await until('window.scrollY > 0');
  await evaluate('window.scrollTo(0, 0)');
  await focus('.tv-header button'); await press('PageDown');
  assert.ok(await evaluate('window.scrollY > 0'), 'PageDown scrolls even with header focus');
  await press('PageUp'); assert.equal(await evaluate('window.scrollY'), 0);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 710 });
  await until('window.scrollY > 60');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 360 });
  const afterEdge = await evaluate('window.scrollY');
  await delay(450);
  assert.equal(await evaluate('window.scrollY'), afterEdge, 'Moving the cursor away stops edge scrolling');
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 30, y: 105 });
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
  await press('ArrowDown'); assert.equal(await active(), 'Details for Example movie 6');
  await press('ArrowDown'); assert.equal(await active(), 'Details for Example movie 10');
  assert.ok(await evaluate('document.activeElement.getBoundingClientRect().bottom <= document.querySelector(".tv-remote-hint").getBoundingClientRect().top'), 'Offscreen poster scrolled above the fixed footer');
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
  assert.equal(await active(), 'Details for Example movie 10', 'Dialog returns focus to the selected poster');
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
  await activate('.tv-desktop-link'); await until('!!document.querySelector("aside")');
  assert.equal(await evaluate('document.documentElement.dataset.tvMode'), undefined);
  await call('Page.navigate', { url: origin }); await until('!!document.querySelector("aside")');
  assert.equal(await evaluate('localStorage.getItem("homelab:tv-mode")'), '0', 'Desktop override persists on this browser');
  await evaluate('localStorage.removeItem("homelab:tv-mode")');
  await call('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit/537.36 Silk/120.1 Chrome/120.0 Safari/537.36' });
  await call('Page.navigate', { url: origin }); await until('!!document.querySelector(".tv-shell")');
  assert.equal(await evaluate('document.documentElement.dataset.tvMode'), 'true', 'Fire TV auto-detection');
  assert.deepEqual(errors, [], 'No browser exceptions');
  console.log(JSON.stringify({ passed: true, viewports: [1280, 1920, 960, 390], checks: 'desktop isolation, auto-detection, saved override, fallback APIs, document/wheel scrolling, cursor edges, scroll buttons, PageUp/Down, D-pad fallback, fields, dialogs, source/file selection, seeking, fullscreen and Back', screenshots: output }, null, 2));
} finally {
  if (call && socket?.readyState === WebSocket.OPEN) {
    await Promise.race([call('Browser.close').catch(() => {}), delay(1000)]); socket.close();
  }
  chrome.kill();
  await new Promise(done => { server.close(done); server.closeAllConnections(); });
}
