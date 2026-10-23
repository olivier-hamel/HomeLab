#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../dist/config.js';
import { client } from '../dist/client.js';
import { setTimeout as delay } from 'node:timers/promises';

// Every model turn here uses the real ChatGPT.com account. Nothing runs on import.
const call = client(loadConfig());
const stage = process.argv[2] ?? 'minimal';
const log = (test, detail) => console.log(JSON.stringify({ test, ...detail }));
let lastTurnAt = 0;
async function turn(id, text) {
  const remaining = 30_000 - (Date.now() - lastTurnAt);
  if (remaining > 0) await delay(remaining);
  lastTurnAt = Date.now();
  const submitted = await call('POST', `/v1/conversations/${id}/messages`, { text });
  for (;;) {
    const run = await call('GET', `/v1/runs/${submitted.run_id}`);
    if (['queued','running'].includes(run.status)) { await delay(1000); continue; }
    assert.equal(run.status, 'completed', `${run.status}: ${JSON.stringify(run.error)}`);
    return run;
  }
}
try {
  const status = await call('GET', '/v1/status?refresh=true');
  assert.equal(status.mode, 'real');
  assert.equal(status.session, 'ready', 'Connecter le compte avec npm run cli -- session open.');
  if (stage === 'minimal') {
    const c = await call('POST', '/v1/conversations', { title: 'Qualification minimale réelle' });
    const marker = randomBytes(8).toString('hex').toUpperCase();
    await turn(c.id, `Retiens le code ${marker} pour cette conversation. Réponds seulement OK.`);
    log('premier_tour', { status: 'PASS', conversation: c.id, note: 'Attente d’au moins 30 secondes entre les débuts des deux demandes.' });
    const resumed = await turn(c.id, 'Quel est le code convenu au début ? Réponds uniquement avec ce code.');
    assert.ok(resumed.answer.toUpperCase().includes(marker), 'Le code n’a pas été rappelé.');
    log('continuation_reelle', { status: 'PASS', conversation: c.id, model_requests: 2 });
  } else if (stage === 'chat') {
    const a = await call('POST', '/v1/conversations', { title: 'Qualification réelle A' });
    const b = await call('POST', '/v1/conversations', { title: 'Qualification réelle B' });
    const ma = randomBytes(8).toString('hex').toUpperCase(), mb = randomBytes(8).toString('hex').toUpperCase();
    await turn(a.id, `Retiens le code ${ma} pour cette conversation. Réponds brièvement.`);
    await turn(b.id, `Retiens le code ${mb} pour cette conversation. Réponds brièvement.`);
    const a2 = await turn(a.id, 'Quel est le code convenu au début ? Réponds uniquement avec ce code.');
    const b2 = await turn(b.id, 'Quel est le code convenu au début ? Réponds uniquement avec ce code.');
    assert.ok(a2.answer.toUpperCase().includes(ma) && !a2.answer.toUpperCase().includes(mb));
    assert.ok(b2.answer.toUpperCase().includes(mb) && !b2.answer.toUpperCase().includes(ma));
    const ra = await call('GET', `/v1/conversations/${a.id}`), rb = await call('GET', `/v1/conversations/${b.id}`);
    assert.ok(ra.remote_id && rb.remote_id && ra.remote_id !== rb.remote_id);
    log('conversations_isolees', { status: 'PASS', conversations: [a.id, b.id] });
  } else if (stage === 'long') {
    const c = await call('POST', '/v1/conversations', { title: 'Qualification réponse longue' });
    const marker = 'FIN_' + randomBytes(8).toString('hex');
    const run = await turn(c.id, `Explique en français les réseaux domestiques en environ 900 mots. Termine exactement par ${marker}.`);
    assert.ok(run.answer.length >= 3000, 'Réponse plus courte que prévu.');
    log('reponse_longue', { status: run.answer.includes(marker) ? 'PASS' : 'INCONCLUSIF', characters: run.answer.length });
  } else if (stage === 'resume') {
    const id = process.argv[3];
    assert.match(id ?? '', /^[0-9a-f-]{36}$/);
    const before = await call('GET', `/v1/conversations/${id}`);
    await turn(id, 'Rappelle le code convenu au début de cette conversation.');
    const after = await call('GET', `/v1/conversations/${id}`);
    assert.equal(after.remote_id, before.remote_id);
    log('reprise_identifiant', { status: 'PASS', note: 'Le redémarrage externe et la mémoire du code restent à confirmer par l’utilisateur.' });
  } else throw new Error('Étapes : minimal (2 demandes), chat (4 demandes), long (1 demande), resume <conversation-id> (1 demande). Pour les actions, suivre le README.');
} catch (error) { log(stage, { status: 'FAIL', detail: error.message }); process.exitCode = 1; }
