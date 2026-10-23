import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../dist/config.js';
import { Store } from '../dist/store.js';
import { Scheduler } from '../dist/scheduler.js';
import { buildServer } from '../dist/server.js';
import { ChatGptBridgeClient, BridgeApiError } from '../dist/app-client.js';

async function fixture(t, environment = {}, generate = async () => ({ text: '{"type":"final","text":"Réponse test"}', conversationId: randomUUID() })) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-api-'));
  const config = loadConfig({ ...environment, BRIDGE_DATA_DIR: dir });
  const store = new Store(':memory:');
  const scheduler = new Scheduler(store, { generate });
  const maintenance = { status: () => ({ state: 'closed' }), open: () => ({ state: 'open', password: 'temporary-secret' }), close: async () => {} };
  const app = buildServer({ config, store, scheduler, maintenance, probe: async () => 'login_required' });
  await app.ready();
  t.after(async () => { await scheduler.close(); await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${config.token}` };
  return { app, config, store, scheduler, headers };
}

test('API protégée, pas de CORS et refus des hôtes étrangers', async t => {
  const { app, headers } = await fixture(t);
  assert.equal((await app.inject('/healthz')).statusCode, 200);
  assert.equal((await app.inject('/v1/status')).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/status', headers: { authorization: 'Bearer wrong' } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/status', headers: { ...headers, origin: 'https://untrusted.example' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/v1/status', headers: { ...headers, host: 'untrusted.example' } })).statusCode, 403);
  const status = await app.inject({ url: '/v1/status', headers });
  assert.equal(status.statusCode, 200); assert.equal(status.json().mode, 'real');
  assert.equal(status.json().session, 'login_required');
  assert.equal(status.headers['cache-control'], 'no-store');
  assert.doesNotMatch(status.body, /temporary-secret/);
});

test('contrat API complet et arguments supplémentaires refusés', async t => {
  const { app, headers, scheduler, store } = await fixture(t);
  const created = await app.inject({ method: 'POST', url: '/v1/conversations', headers, payload: { title: 'Test' } });
  assert.equal(created.statusCode, 201); const c = created.json();
  const extra = await app.inject({ method: 'POST', url: `/v1/conversations/${c.id}/messages`, headers, payload: { text: 'x', mode: 'mock' } });
  assert.equal(extra.statusCode, 400);
  const submitted = await app.inject({ method: 'POST', url: `/v1/conversations/${c.id}/messages`, headers: { ...headers, 'idempotency-key': 'stable' }, payload: { text: 'Bonjour' } });
  assert.equal(submitted.statusCode, 202);
  await scheduler.waitIdle();
  const id = submitted.json().run_id;
  const run = await app.inject({ url: `/v1/runs/${id}`, headers });
  assert.equal(run.json().answer, 'Réponse test'); assert.equal(run.json().next_payload, undefined);
  const repeated = await app.inject({ method: 'POST', url: `/v1/conversations/${c.id}/messages`, headers: { ...headers, 'idempotency-key': 'stable' }, payload: { text: 'Bonjour' } });
  assert.equal(repeated.json().run_id, id);
  assert.equal(store.messages(c.id).length, 2);
  assert.equal((await app.inject({ url: `/v1/conversations/${c.id}`, headers })).json().remote_id.length, 36);
  assert.equal((await app.inject({ url: '/v1/runs/not-an-id', headers })).statusCode, 400);
  assert.equal((await app.inject({ url: `/v1/runs/${randomUUID()}`, headers })).statusCode, 404);
});

test('CLI contre une vraie écoute HTTP locale, avec plusieurs documents joints', async t => {
  let received;
  const { app, config } = await fixture(t, {}, async (_payload, _id, _signal, files) => {
    received = files;
    return { text: '{"type":"final","text":"Réponse test"}', conversationId: randomUUID() };
  });
  const pdf = join(config.dataDir, 'rapport.pdf'), txt = join(config.dataDir, 'notes.txt');
  writeFileSync(pdf, '%PDF-1.7\nDocument test'); writeFileSync(txt, 'Notes test');
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = app.server.address().port;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', 'ask', '--json', '--attach', pdf, '--attach', txt, 'Bonjour'], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, BRIDGE_DATA_DIR: config.dataDir, BRIDGE_PORT: String(port) }, stdio: ['ignore','pipe','pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.once('error', reject); child.once('exit', code => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).answer, 'Réponse test');
  assert.equal(received.length, 2);
  assert.equal(received[0].filename, 'rapport.pdf');
  assert.equal(received[1].mime_type, 'text/plain');
  assert.equal(Buffer.from(received[0].data_base64, 'base64').toString(), '%PDF-1.7\nDocument test');
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(config.token));
});

test('LAN configuré : même sous-réseau seulement, même avec un jeton valide et des en-têtes de proxy', async t => {
  const { app, headers } = await fixture(t, { BRIDGE_HOST: '0.0.0.0', BRIDGE_ALLOWED_HOSTS: '192.168.50.10', BRIDGE_LAN_CIDRS: '192.168.50.0/24' });
  const request = remoteAddress => app.inject({ url: '/v1/status', remoteAddress, headers: {
    ...headers, host: '192.168.50.10:3211', 'x-forwarded-for': '192.168.50.22', 'x-real-ip': '192.168.50.22',
  } });
  for (const address of ['192.168.50.22', '::ffff:192.168.50.22', '127.0.0.1']) assert.equal((await request(address)).statusCode, 200, address);
  for (const address of ['192.168.51.22', '10.0.0.22', '203.0.113.22']) {
    const result = await request(address);
    assert.equal(result.statusCode, 403, address);
    assert.equal(result.json().error.code, 'lan_only');
  }
  assert.equal((await app.inject({ url: '/healthz', remoteAddress: '203.0.113.22' })).statusCode, 403);
  assert.equal((await app.inject({ url: '/v1/status', remoteAddress: '192.168.50.22', headers: { host: '192.168.50.10' } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/session/maintenance', remoteAddress: '192.168.50.22', headers })).json().error.code, 'local_only');
});

test('CORS explicite : prévol sans jeton, requêtes authentifiées et maintenance locale seulement', async t => {
  const origin = 'http://192.168.50.20:3000';
  const { app, headers } = await fixture(t, { BRIDGE_ALLOWED_ORIGINS: origin });
  const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/conversations', headers: {
    origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'Authorization, Content-Type, Idempotency-Key',
  } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined);
  const missingToken = await app.inject({ url: '/v1/status', headers: { origin } });
  assert.equal(missingToken.statusCode, 401);
  assert.equal(missingToken.headers['access-control-allow-origin'], origin);
  const created = await app.inject({ method: 'POST', url: '/v1/conversations', headers: { ...headers, origin }, payload: { title: 'Browser' } });
  assert.equal(created.statusCode, 201);
  for (const untrusted of ['null', 'http://192.168.50.20:3001', 'http://192.168.50.20.evil:3000']) {
    const result = await app.inject({ url: '/v1/status', headers: { ...headers, origin: untrusted } });
    assert.equal(result.statusCode, 403);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  for (const extra of [{ 'access-control-request-method': 'PATCH' }, { 'access-control-request-headers': 'x-admin' }]) {
    assert.equal((await app.inject({ method: 'OPTIONS', url: '/v1/conversations', headers: {
      origin, 'access-control-request-method': 'POST', ...extra,
    } })).statusCode, 403);
  }
  for (const method of ['GET', 'POST', 'DELETE', 'OPTIONS']) {
    assert.equal((await app.inject({ method, url: '/v1/session/maintenance', headers: { ...headers, origin, 'access-control-request-method': 'POST' } })).statusCode, 403);
  }
});

test('contrat OpenAPI téléchargeable et protégé', async t => {
  const { app, headers } = await fixture(t);
  assert.equal((await app.inject('/v1/openapi.yaml')).statusCode, 401);
  const response = await app.inject({ url: '/v1/openapi.yaml', headers });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /application\/yaml/);
  assert.match(response.body, /openapi: 3\.1\.0/);
});

test('client app : conversation, suivi, idempotence, erreurs HTTP et annulation', async t => {
  const { app, config, scheduler } = await fixture(t);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new ChatGptBridgeClient({ baseUrl: `http://127.0.0.1:${app.server.address().port}/`, token: config.token });
  assert.equal((await client.status()).session, 'login_required');
  const conversation = await client.createConversation('App');
  const submission = await client.sendMessage(conversation.id, 'Bonjour', { idempotencyKey: 'app-key' });
  const run = await client.waitForRun(submission.run_id, { pollIntervalMs: 5 });
  assert.equal(run.status, 'completed');
  assert.equal(run.answer, 'Réponse test');
  assert.equal((await client.sendMessage(conversation.id, 'Bonjour', { idempotencyKey: 'app-key' })).run_id, run.id);
  assert.equal((await client.getConversation(conversation.id)).messages.length, 2);
  assert.equal((await client.listConversations())[0].id, conversation.id);
  await assert.rejects(client.sendMessage(conversation.id, 'Différent', { idempotencyKey: 'app-key' }), error => error instanceof BridgeApiError && error.status === 409 && error.code === 'idempotency_conflict');
  scheduler.pause();
  const queued = scheduler.store.createRun(conversation.id, 'Annuler', '{}');
  assert.equal((await client.cancelRun(queued.id)).status, 'cancelled');
});

test('client app : arrêt sur approbation, décision humaine puis réponse dans le même fil', async t => {
  let calls = 0;
  const remote = randomUUID();
  const { app, config, store } = await fixture(t, {}, async () => ({
    text: ++calls === 1 ? '{"type":"tool_call","name":"demo.create_note","arguments":{"text":"App note"}}' : '{"type":"final","text":"Enregistré"}',
    conversationId: remote,
  }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new ChatGptBridgeClient({ baseUrl: `http://127.0.0.1:${app.server.address().port}`, token: config.token });
  const conversation = await client.createConversation();
  const submission = await client.sendMessage(conversation.id, 'Une note');
  const waiting = await client.waitForRun(submission.run_id, { pollIntervalMs: 5 });
  assert.equal(waiting.status, 'awaiting_approval');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0);
  await client.decideAction(waiting.actions[0].id, true);
  assert.equal((await client.waitForRun(submission.run_id, { pollIntervalMs: 5 })).answer, 'Enregistré');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
});
