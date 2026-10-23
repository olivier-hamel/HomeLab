import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeApiError, ChatGptBridgeClient } from '../dist/app-client.js';

const options = { baseUrl: 'http://192.168.50.10:3211', token: 'test-token' };

test('client : interruption et délai du suivi ne soumettent ni n’annulent une opération', async () => {
  const requests = [];
  const client = new ChatGptBridgeClient({ ...options, fetch: async (url, init) => {
    requests.push({ url, method: init.method });
    return Response.json({ id: 'run-id', status: 'queued' });
  } });
  await assert.rejects(client.waitForRun('run-id', { timeoutMs: 25, pollIntervalMs: 5 }), error => error.code === 'client_timeout');
  const abort = new AbortController();
  const polling = client.waitForRun('run-id', { signal: abort.signal, pollIntervalMs: 1000 });
  abort.abort();
  await assert.rejects(polling, error => error.name === 'AbortError');
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => request.method === 'GET' && request.url.endsWith('/v1/runs/run-id')));
});

test('client : panne réseau après soumission signalée comme ambiguë, sans nouvelle tentative', async () => {
  let attempts = 0;
  const client = new ChatGptBridgeClient({ ...options, fetch: async () => { attempts++; throw new TypeError('network'); } });
  await assert.rejects(client.sendMessage('conversation', 'Bonjour', { idempotencyKey: 'stable' }), error =>
    error instanceof BridgeApiError && error.status === 0 && error.mayHaveBeenSent && error.code === 'service_unreachable');
  assert.equal(attempts, 1);
  await assert.rejects(client.getRun('id'), error => !error.mayHaveBeenSent);
});

test('client : délai réseau et arrêt immédiat, sans attente non bornée', async () => {
  let calls = 0;
  const client = new ChatGptBridgeClient({ ...options, requestTimeoutMs: 10, fetch: async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  } });
  await assert.rejects(client.sendMessage('id', 'x'), error => error.mayHaveBeenSent);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.createConversation('x', { signal: abort.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('client : préfixe proxy conservé, cookies et redirections refusés', async () => {
  let request;
  const client = new ChatGptBridgeClient({ ...options, baseUrl: 'http://192.168.50.10/bridge/', fetch: async (url, init) => {
    request = { url, ...init };
    return Response.json({ run_id: 'run-id', status: 'queued' });
  } });
  await client.sendMessage('id/with?chars', 'x', { idempotencyKey: 'stable' });
  assert.equal(request.url, 'http://192.168.50.10/bridge/v1/conversations/id%2Fwith%3Fchars/messages');
  assert.equal(request.redirect, 'error');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.headers['Idempotency-Key'], 'stable');
});
