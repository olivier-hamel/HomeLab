import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccountVerifier } from '../src/lib/accounts.ts';
import { createMediaApi } from '../src/lib/media/api.ts';
import { ProgressStore } from '../src/lib/media/progress-store.ts';
import { accountSession } from './fixtures/accounts.mjs';

const origin = 'https://accounts.test';
const accountCookie = `memo_session=${'o'.repeat(43)}`;
Object.assign(process.env, { MEDIA_TRUSTED_NETWORK: 'true', MEDIA_ALLOWED_ORIGINS: origin, MEDIA_SESSION_SECRET: 'test-accounts-session-secret-at-least-32-characters', MEMO_AUTH_URL: 'http://memo.test:8000' });
function request(path = 'status', cookie = accountCookie, profile, body) {
  return new Request(`${origin}/api/media/${path}`, { headers: {
    Cookie: cookie, Origin: origin, ...(profile ? { 'X-Media-Profile': profile } : {}),
    ...(body ? { 'Content-Type': 'application/json', 'X-Media-Request': '1' } : {}),
  }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
}
function fixture() {
  let valid = true;
  const authRequests = [];
  const authenticate = createAccountVerifier(async (url, init) => {
    assert.equal(String(url), 'http://memo.test:8000/api/auth/me');
    const headers = new Headers(init.headers);
    authRequests.push(headers);
    return valid && headers.get('cookie') === accountCookie ? Response.json({ enabled: true, ...accountSession }) : Response.json({}, { status: 401 });
  });
  const hash = 'a'.repeat(40);
  const api = createMediaApi(async url => new URL(url).pathname === '/torrents'
    ? Response.json({ hash, stat: 3, file_stats: [{ id: 1, path: 'Film.mp4', length: 1000 }] })
    : new Response('movie'), undefined, authenticate);
  return { api, authRequests, revoke: () => { valid = false; } };
}

test('media status and all film endpoints require a real HomeLab session', async () => {
  const f = fixture();
  for (const path of ['status', 'catalogue', 'continue-watching', 'stream/unknown', 'converted/unknown']) {
    const response = await f.api(request(path, ''));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'account_session');
  }
  assert.equal(f.authRequests.length, 0);
  assert.equal((await f.api(request('status', `memo_session=${'x'.repeat(43)}`))).status, 401);
  const status = await f.api(request());
  assert.equal(status.status, 200);
  assert.match(status.headers.get('set-cookie'), /Secure/);
  f.revoke();
  assert.equal((await f.api(request())).status, 401);
});

test('the verifier forwards only the Mémo cookie and fails closed on disabled auth, outages and password changes', async () => {
  const verify = createAccountVerifier(async (_url, init) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('cookie'), accountCookie);
    assert.equal(headers.get('host'), 'accounts.test');
    assert.equal(headers.get('x-forwarded-proto'), 'https');
    return Response.json({ enabled: true, ...accountSession });
  });
  await verify(request('status', `other=private; ${accountCookie}; homelab_media=other`));
  for (const [response, status] of [
    [Response.json({ enabled: false, user: null, accounts: [] }), 503],
    [Response.json({ enabled: true, ...accountSession, user: { ...accountSession.user, must_change_password: true } }), 403],
    [new Response('unavailable', { status: 502 }), 503],
    [new Response('bad JSON'), 503],
  ]) {
    await assert.rejects(createAccountVerifier(async () => response)(request()), error => error.status === status);
  }
  await assert.rejects(createAccountVerifier(async () => { throw new Error('offline'); })(request()), error => error.status === 503);
});

test('switching the cinema profile keeps Oli authenticated and preserves the shared Max progress identity', async () => {
  const f = fixture();
  const cookie = `${accountCookie}; ${(await f.api(request())).headers.get('set-cookie').split(';')[0]}`;
  const original = ProgressStore.prototype.list;
  const previousUri = process.env.MONGODB_URI;
  const profiles = [];
  process.env.MONGODB_URI = 'mongodb://fixture.invalid';
  ProgressStore.prototype.list = async function (profile) { profiles.push(profile); return []; };
  try {
    assert.equal((await f.api(request('continue-watching', cookie))).status, 200);
    assert.equal((await f.api(request('continue-watching', cookie, 'max'))).status, 200);
    assert.deepEqual(profiles, ['oli', 'max']);
    assert.ok(f.authRequests.every(headers => headers.get('cookie') === accountCookie));
    assert.equal((await f.api(request('continue-watching', cookie, 'unknown'))).status, 400);
    assert.equal((await f.api(request('continue-watching', cookie, 'default'))).status, 400);
    f.revoke();
    assert.equal((await f.api(request('continue-watching', cookie, 'max'))).status, 401);
  } finally {
    ProgressStore.prototype.list = original;
    if (previousUri === undefined) delete process.env.MONGODB_URI; else process.env.MONGODB_URI = previousUri;
  }
});

test('external/native movie links require their creator session to remain valid', async () => {
  const f = fixture();
  process.env.TORRSERVER_BASE_URL = 'http://torrents.test';
  const cookie = `${accountCookie}; ${(await f.api(request())).headers.get('set-cookie').split(';')[0]}`;
  const added = await (await f.api(request('playback', cookie, 'max', { magnet: `magnet:?xt=urn:btih:${'a'.repeat(40)}` }))).json();
  const selected = await (await f.api(request('select', cookie, 'max', { id: added.id, fileId: 1 }))).json();
  const shared = await (await f.api(request('share', cookie, 'max', { id: selected.id }))).json();
  assert.ok(shared.path);
  const stream = await f.api(new Request(`${origin}${shared.path}`));
  assert.equal(stream.status, 200);
  await stream.body.cancel();
  f.revoke();
  assert.equal((await f.api(new Request(`${origin}${shared.path}`))).status, 401);
});
