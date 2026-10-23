import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../dist/store.js';
import { Scheduler } from '../dist/scheduler.js';
import { parseAnswer, userPayload } from '../dist/protocol.js';
import { BridgeError } from '../dist/errors.js';
import { Maintenance } from '../dist/maintenance.js';

async function idle(scheduler) { await scheduler.waitIdle(); }
const final = text => JSON.stringify({ type: 'final', text });
const action = (text = 'Une note') => JSON.stringify({ type: 'tool_call', name: 'demo.create_note', arguments: { text } });

test('seuls les objets complets et les arguments autorisés deviennent des actions', () => {
  assert.equal(parseAnswer(action()).type, 'tool_call');
  assert.equal(parseAnswer('```json\n' + action() + '\n```').type, 'tool_call');
  assert.equal(parseAnswer('JSON\n' + action()).type, 'tool_call');
  assert.deepEqual(parseAnswer('JSON\n{"type":"final","text":"code"}'), { type: 'final', text: 'code' });
  for (const raw of [
    'Exemple : ' + action(),
    '{"type":"tool_call","name":"shell","arguments":{"cmd":"touch /tmp/NEVER"}}',
    '{"type":"tool_call","name":"demo.create_note","arguments":{"text":"x","path":"/tmp/x"}}',
    '{"type":"tool_call","name":"demo.list_notes","arguments":{"limit":100}}',
    '{"type":"tool_call","name":"demo.create_note","arguments":{"text":"x","__proto__":{"admin":true}}}',
    '[1,2]', 'texte ordinaire', '{"type":"final","text":""}',
    action() + '\n' + action(),
    'Exemple JSON\n' + action(), 'JSON\n' + action() + '\nExplication supplémentaire.',
  ]) {
    const parsed = parseAnswer(raw);
    assert.equal(parsed.type, 'final'); assert.equal(parsed.text, raw); assert.match(parsed.warning, /invalid_envelope/);
  }
});

test('conversations distinctes, ordre sériel, continuation avec le même identifiant distant', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const a = store.createConversation('A'), b = store.createConversation('B');
  const calls = [];
  let active = 0, maxActive = 0;
  const scheduler = new Scheduler(store, { generate: async (payload, id) => {
    maxActive = Math.max(maxActive, ++active);
    await delay(5);
    const remote = id ?? randomUUID(); calls.push({ payload, id: remote }); active--;
    return { text: final('réponse'), conversationId: remote };
  } });
  t.after(() => scheduler.close());
  const ra = scheduler.submit(a.id, 'A1'), rb = scheduler.submit(b.id, 'B1');
  await idle(scheduler);
  const aRemote = store.conversation(a.id).remote_id, bRemote = store.conversation(b.id).remote_id;
  assert.notEqual(aRemote, bRemote); assert.equal(maxActive, 1);
  scheduler.submit(a.id, 'A2'); await idle(scheduler);
  assert.equal(calls[2].id, aRemote);
  assert.deepEqual(JSON.parse(calls[2].payload), { kind: 'user', text: 'A2' });
  assert.equal(store.run(ra.id).status, 'completed'); assert.equal(store.run(rb.id).status, 'completed');
});

test('approbation obligatoire, résultat dans le même fil, décision répétée sans doublon', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const conversation = store.createConversation('Actions'), remote = randomUUID();
  const calls = [];
  const scheduler = new Scheduler(store, { generate: async (payload, id) => {
    calls.push({ payload: JSON.parse(payload), id });
    return { text: calls.length === 1 ? action('Note approuvée') : final('Note enregistrée.'), conversationId: remote };
  } });
  t.after(() => scheduler.close());
  const run = scheduler.submit(conversation.id, 'Conserve une note'); await idle(scheduler);
  assert.equal(store.run(run.id).status, 'awaiting_approval');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0);
  assert.throws(() => scheduler.submit(conversation.id, 'autre question'), /Terminer la décision/);
  const pending = store.actions(run.id)[0];
  scheduler.decide(pending.id, true); await idle(scheduler);
  assert.equal(store.run(run.id).status, 'completed');
  assert.equal(calls[1].id, remote);
  assert.equal(calls[1].payload.kind, 'tool_result'); assert.equal(calls[1].payload.result.ok, true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
  scheduler.decide(pending.id, true); await idle(scheduler);
  assert.equal(calls.length, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
  assert.throws(() => scheduler.decide(pending.id, false), /autre décision/);
});

test('refus transmis à l’assistant sans créer de note', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let count = 0, result;
  const scheduler = new Scheduler(store, { generate: async payload => {
    count++; if (count > 1) result = JSON.parse(payload);
    return { text: count === 1 ? action() : final('Refus compris.'), conversationId: remote };
  } });
  const remote = randomUUID(); t.after(() => scheduler.close());
  const run = scheduler.submit(store.createConversation('Refus').id, 'Une note'); await idle(scheduler);
  scheduler.decide(store.actions(run.id)[0].id, false); await idle(scheduler);
  assert.equal(result.result.error, 'user_denied');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0);
  assert.equal(store.run(run.id).status, 'completed');
});

test('idempotence des soumissions et limite de file', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const c = store.createConversation('A');
  const run = store.createRun(c.id, 'x', userPayload('x'), 'request-1');
  assert.equal(store.createRun(c.id, 'x', userPayload('x'), 'request-1').id, run.id);
  assert.throws(() => store.createRun(c.id, 'y', userPayload('y'), 'request-1'), /autre demande/);
  for (let i = 1; i < 16; i++) store.createRun(store.createConversation('Q').id, 'x', userPayload('x'));
  assert.throws(() => store.createRun(store.createConversation('Pleine').id, 'x', userPayload('x')), /file est pleine/);
});

test('reprise persistante des conversations, approbations et résultats après redémarrage', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-store-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite'), remote = randomUUID();
  let store = new Store(path);
  const c = store.createConversation('Persistante');
  const run = store.createRun(c.id, 'x', userPayload('x'));
  store.claim(); store.recordAnswer(run.id, remote, action(), parseAnswer(action())); store.close();
  store = new Store(path);
  assert.equal(store.conversation(c.id).remote_id, remote);
  assert.equal(store.run(run.id).status, 'awaiting_approval');
  store.decide(store.actions(run.id)[0].id, true);
  store.claim(); store.prepareToolResult(run.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
  store.close();
  store = new Store(path); t.after(() => store.close());
  assert.equal(store.run(run.id).status, 'interrupted');
  store.prepareToolResult(run.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
  assert.throws(() => store.createRun(c.id, 'suite', userPayload('suite')), /interruption ambiguë/);
  store.cancel(run.id);
  assert.equal(store.createRun(c.id, 'suite', userPayload('suite')).status, 'queued');
});

test('annuler un envoi ne le relance jamais et ignore une réponse tardive', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let resolve, count = 0;
  const scheduler = new Scheduler(store, { generate: () => {
    count++; return new Promise(done => { resolve = done; });
  } });
  t.after(() => scheduler.close());
  const run = scheduler.submit(store.createConversation('Annuler').id, 'x');
  scheduler.cancel(run.id);
  resolve({ text: action(), conversationId: randomUUID() });
  await idle(scheduler);
  assert.equal(store.run(run.id).status, 'cancelled');
  assert.equal(JSON.parse(store.run(run.id).error).may_have_been_sent, true);
  assert.equal(store.actions(run.id).length, 0); assert.equal(count, 1);
});

test('erreur ambiguë sans nouvelle soumission automatique', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let count = 0;
  const scheduler = new Scheduler(store, { generate: async () => { count++; throw new BridgeError('timeout', 'Interrompu', 502, true); } });
  t.after(() => scheduler.close());
  const run = scheduler.submit(store.createConversation('Timeout').id, 'x'); await idle(scheduler);
  assert.equal(store.run(run.id).status, 'interrupted'); assert.equal(count, 1);
});

test('huit actions maximum et changement de conversation refusé', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  const c = store.createConversation('Limite'), remote = randomUUID();
  const scheduler = new Scheduler(store, { generate: async () => ({ text: action(), conversationId: remote }) });
  t.after(() => scheduler.close());
  const run = scheduler.submit(c.id, 'x'); await idle(scheduler);
  for (let i = 0; i < 8; i++) {
    const pending = store.actions(run.id).find(a => a.status === 'pending'); assert.ok(pending);
    scheduler.decide(pending.id, false); await idle(scheduler);
  }
  assert.equal(store.run(run.id).status, 'failed'); assert.equal(store.actions(run.id).length, 8);
  const run2 = store.createRun(c.id, 'x2', userPayload('x2')); store.claim();
  assert.throws(() => store.recordAnswer(run2.id, randomUUID(), final('x'), 'x'), /conversation distante a changé/);
});

test('maintenance : drainage, mot de passe absent après fermeture et expiration', async () => {
  const events = [];
  let loginResolve;
  const engine = { stop: async () => events.push('stop'), start: async () => events.push('start'), login: () => new Promise(resolve => { loginResolve = resolve; }), stopLogin: async () => events.push('stopLogin') };
  const desktop = { openAccess: async () => ({ url: 'http://127.0.0.1:6081/vnc.html', password: 'private!' }), closeAccess: async () => events.push('closeAccess') };
  const scheduler = { pause: () => events.push('pause'), resume: () => events.push('resume'), waitIdle: async () => events.push('idle') };
  const maintenance = new Maintenance({ maintenanceTtlMs: 30 }, desktop, engine, scheduler);
  assert.equal(maintenance.open().state, 'opening');
  await delay(5);
  assert.equal(maintenance.status().state, 'open');
  assert.equal(maintenance.status().password, 'private!');
  assert.deepEqual(events.slice(0, 3), ['pause','idle','stop']);
  await delay(50);
  assert.equal(maintenance.status().state, 'closed');
  assert.equal(maintenance.status().password, undefined);
  assert.ok(events.includes('resume'));
  loginResolve(); await maintenance.close(true);
});

test('maintenance d’inspection : reste ouverte sur un compte prêt jusqu’à fermeture explicite', async () => {
  let resolveInspect, inspected = false, resumed = false;
  const engine = { stop: async () => {}, start: async () => {}, inspect: () => { inspected = true; return new Promise(resolve => { resolveInspect = resolve; }); }, stopLogin: async () => resolveInspect?.() };
  const desktop = { openAccess: async () => ({ url: 'http://127.0.0.1:6081/vnc.html', password: 'private!' }), closeAccess: async () => {} };
  const scheduler = { pause() {}, resume() { resumed = true; }, waitIdle: async () => {} };
  const maintenance = new Maintenance({ maintenanceTtlMs: 1000 }, desktop, engine, scheduler);
  maintenance.open(true); await delay(5);
  assert.equal(inspected, true); assert.equal(maintenance.status().state, 'open');
  assert.equal(maintenance.status().purpose, 'inspect');
  await maintenance.close(); assert.equal(maintenance.status().state, 'closed'); assert.equal(resumed, true);
});
