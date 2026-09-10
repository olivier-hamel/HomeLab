import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Welcome, WELCOME_FALLBACK } from '../src/lib/media/welcome.ts';
import { ASSIST_MODEL } from '../src/lib/media/source-assist.ts';
import { createMediaApi } from '../src/lib/media/api.ts';

const secret = 'test-only-welcome-private-canary';
Object.assign(process.env, { GEMINI_API_KEY: secret, MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: 'http://welcome.test', MEDIA_SESSION_SECRET: secret });
const signal = () => new AbortController().signal;
const copies = Array.from({ length: 8 }, (_, i) => ({ line1: `Movie night, take ${i + 1}.`, line2: 'Make yourself comfortable.' }));
const answer = (value = copies) => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ copies: value }) }] } }] });

test('uses the existing Gemini model and rotates cached copy without consecutive repeats', async () => {
  let calls = 0;
  const welcome = new Welcome(async (url, init) => {
    calls++;
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${ASSIST_MODEL}:generateContent`);
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), secret);
    assert.equal(init.redirect, 'manual');
    const body = JSON.parse(init.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(!init.body.includes(secret));
    return answer();
  });
  let previous;
  for (let i = 0; i < 20; i++) {
    const copy = await welcome.get(signal());
    assert.ok(copies.some(value => JSON.stringify(value) === JSON.stringify(copy)));
    assert.notDeepEqual(copy, previous);
    previous = copy;
  }
  assert.equal(calls, 1);
});

test('concurrent visitors share one generation and leaving does not cancel it for others', async () => {
  let resolve;
  let calls = 0;
  const welcome = new Welcome(async () => { calls++; return new Promise(done => { resolve = done; }); });
  const controller = new AbortController();
  const leaving = welcome.get(controller.signal);
  const staying = welcome.get(signal());
  controller.abort();
  resolve(answer());
  await assert.rejects(leaving, { name: 'AbortError' });
  const copy = await staying;
  assert.ok(copies.some(value => JSON.stringify(value) === JSON.stringify(copy)));
  assert.equal(calls, 1);
});

test('missing key skips Gemini', async () => {
  delete process.env.GEMINI_API_KEY;
  try {
    const welcome = new Welcome(async () => { assert.fail('No upstream request without a key'); });
    assert.deepEqual(await welcome.get(signal()), WELCOME_FALLBACK);
  } finally { process.env.GEMINI_API_KEY = secret; }
});

test('upstream failures and invalid output fall back and apply a retry cooldown', async () => {
  for (const response of [
    () => new Response('unavailable', { status: 503 }),
    () => answer(copies.slice(0, 1)),
    () => answer(copies.map(() => copies[0])),
    () => answer([{ ...copies[0], line1: 'x'.repeat(43) }, ...copies.slice(1)]),
    () => answer([{ ...copies[0], line1: '<b>Watch this</b>' }, ...copies.slice(1)]),
    () => answer([{ ...copies[0], line1: secret }, ...copies.slice(1)]),
    () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }),
  ]) {
    let calls = 0;
    const welcome = new Welcome(async () => { calls++; return response(); });
    assert.deepEqual(await welcome.get(signal()), WELCOME_FALLBACK);
    assert.deepEqual(await welcome.get(signal()), WELCOME_FALLBACK);
    assert.equal(calls, 1);
  }
});

test('expired batches refresh and an outage retains the previous generated copy', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let calls = 0;
  const welcome = new Welcome(async () => ++calls === 2 ? new Response(null, { status: 503 }) : answer());
  await welcome.get(signal());
  t.mock.timers.tick(60 * 60_000 + 1);
  assert.notDeepEqual(await welcome.get(signal()), WELCOME_FALLBACK);
  await welcome.get(signal());
  assert.equal(calls, 2);
  t.mock.timers.tick(60_001);
  await welcome.get(signal());
  assert.equal(calls, 3);
});

test('welcome endpoint requires a media session and returns uncached public copy', async () => {
  let calls = 0;
  const api = createMediaApi(async () => { calls++; return answer(); });
  const url = 'http://welcome.test/api/media/';
  const rejected = await api(new Request(`${url}welcome`));
  assert.equal(rejected.status, 401);
  assert.equal(calls, 0);
  const status = await api(new Request(`${url}status`));
  const cookie = status.headers.get('set-cookie').split(';')[0];
  const response = await api(new Request(`${url}welcome`, { headers: { cookie } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const copy = await response.json();
  assert.ok(copies.some(value => JSON.stringify(value) === JSON.stringify(copy)));
  assert.ok(!JSON.stringify(copy).includes(secret));
});
