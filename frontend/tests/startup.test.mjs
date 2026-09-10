import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Execute the actual pre-module script without React or any loaded assets.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function shell() {
  const events = {};
  const nodes = Object.fromEntries(['startup-status', 'startup-error', 'startup-details', 'startup-retry'].map(id => [id, {
    hidden: true, textContent: '', focus() { this.focused = true; }, addEventListener(event, callback) { this[event] = callback; },
  }]));
  let mounted = false;
  let timeout;
  let reloaded = false;
  const context = {
    document: { getElementById: id => mounted ? nodes[id] : null, addEventListener: (event, callback) => { events[event] = callback; } },
    location: { origin: 'http://192.168.0.46:3000', pathname: '/', reload() { reloaded = true; } },
    navigator: { userAgent: 'Fire TV test WebView' },
    console: { error() {}, info() {} },
    addEventListener: (event, callback) => { events[event] = callback; },
    setTimeout: callback => { timeout = callback; return 1; }, clearTimeout: () => { timeout = undefined; },
  };
  context.window = context;
  runInNewContext(script, context);
  return { nodes, events, api: context.homeLabStartup, mount() { mounted = true; events.DOMContentLoaded(); }, expire() { timeout?.(); }, get reloaded() { return reloaded; } };
}

test('pre-module failures survive missing DOM and expose a working retry', () => {
  const page = shell();
  page.events.error({ target: { tagName: 'SCRIPT', src: 'http://server/assets/missing.js' } });
  page.mount();
  assert.equal(page.nodes['startup-error'].hidden, false);
  assert.match(page.nodes['startup-details'].textContent, /Asset failed to load[\s\S]*missing.js/);
  assert.equal(page.nodes['startup-retry'].focused, true);
  page.nodes['startup-retry'].click();
  assert.equal(page.reloaded, true);
});

test('startup watchdog identifies a stalled Preferences call; successful mount cancels it', () => {
  const page = shell(); page.mount();
  page.api.stage('Reading the saved server (Preferences.get)'); page.expire();
  assert.match(page.nodes['startup-details'].textContent, /Startup timed out[\s\S]*Preferences.get/);
  const healthy = shell(); healthy.mount(); healthy.api.complete(); healthy.expire();
  assert.equal(healthy.nodes['startup-error'].hidden, true);
});

test('JavaScript errors, promise rejections and reported render errors remain visible outside React', () => {
  for (const trigger of [
    page => page.events.error({ message: 'Startup exploded', filename: '/assets/app.js', lineno: 10, colno: 2 }),
    page => page.events.unhandledrejection({ reason: new Error('Startup exploded') }),
    page => page.api.fail('React render error', new Error('Startup exploded')),
  ]) {
    const page = shell(); page.mount(); page.api.complete(); trigger(page);
    assert.equal(page.nodes['startup-error'].hidden, false);
    assert.match(page.nodes['startup-details'].textContent, /Startup exploded/);
    page.api.fail('Secondary failure', 'Keep the original cause');
    assert.doesNotMatch(page.nodes['startup-details'].textContent, /Secondary failure/);
  }
});

test('image and late resource failures do not hide a working app', () => {
  const page = shell(); page.mount();
  page.events.error({ target: { tagName: 'IMG', src: '/poster.jpg' } });
  page.api.complete();
  page.events.error({ target: { tagName: 'LINK', rel: 'stylesheet', href: '/late.css' } });
  assert.equal(page.nodes['startup-error'].hidden, true);
});
