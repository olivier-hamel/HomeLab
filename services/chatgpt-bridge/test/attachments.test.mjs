import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { attachmentsSchema, attachmentMetadata, MAX_FILE_BYTES, MESSAGE_BODY_LIMIT_BYTES } from '../dist/attachments.js';
import { Store } from '../dist/store.js';
import { Scheduler } from '../dist/scheduler.js';
import { buildServer } from '../dist/server.js';
import { loadConfig } from '../dist/config.js';
import { ChatGptBridgeClient } from '../dist/app-client.js';

const file = (filename = 'report.pdf', content = '%PDF-1.7\nprivate document') => ({ filename, data_base64: Buffer.from(content).toString('base64') });

test('migration : les conversations et demandes texte existantes restent utilisables', t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-document-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite');
  let store = new Store(path);
  const c = store.createConversation('Before attachments');
  const run = store.createRun(c.id, 'Old text request', '{}', 'old-key');
  store.db.exec('DROP TABLE run_attachments; PRAGMA user_version=1;');
  store.close();
  store = new Store(path); t.after(() => store.close());
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(store.run(run.id).status, 'queued');
  assert.deepEqual(store.viewRun(run.id).attachments, []);
  assert.deepEqual(store.messages(c.id)[0].attachments, []);
  assert.equal(store.createRun(c.id, 'Old text request', '{}', 'old-key').id, run.id);
});

test('documents : noms, types, base64 canonique et limites validés avant stockage', () => {
  const [pdf] = attachmentsSchema.parse([file()]);
  assert.equal(pdf.mime_type, 'application/pdf');
  assert.equal(attachmentMetadata([pdf])[0].size_bytes, Buffer.from(pdf.data_base64, 'base64').length);
  for (const entry of [
    file('../secret.pdf'), file('folder/report.pdf'), file('folder\\report.pdf'), file('.hidden.pdf'), file('bad\nname.pdf'),
    file('script.exe'), { ...file(), path: '/etc/passwd' }, { ...file(), mime_type: 'text/plain' },
    { ...file(), data_base64: '' }, { ...file(), data_base64: 'not base64' }, { ...file(), data_base64: 'Zh==' },
    { ...file(), data_base64: 'data:application/pdf;base64,YQ==' },
    { ...file(), data_base64: Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64') },
  ]) assert.equal(attachmentsSchema.safeParse([entry]).success, false, entry.filename);
  assert.equal(attachmentsSchema.safeParse([file(), file()]).success, false);
  assert.equal(attachmentsSchema.safeParse(Array.from({ length: 5 }, (_, i) => file(`${i}.txt`))).success, false);
  const large = Buffer.alloc(MAX_FILE_BYTES).toString('base64');
  assert.equal(attachmentsSchema.safeParse([{ filename: 'a.pdf', data_base64: large }, { filename: 'b.pdf', data_base64: large }]).success, true);
  assert.equal(attachmentsSchema.safeParse([{ filename: 'a.pdf', data_base64: large }, { filename: 'b.pdf', data_base64: large }, file('c.txt')]).success, false);
});

test('documents : reprise de la file après redémarrage, idempotence et aucune réexpédition après décision', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-documents-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite'), attachments = attachmentsSchema.parse([file()]);
  let store = new Store(path);
  const conversation = store.createConversation('Document');
  const run = store.createRun(conversation.id, 'Read', '{}', 'document-key', attachments);
  store.close();
  store = new Store(path);
  const calls = [], remote = randomUUID();
  const scheduler = new Scheduler(store, { generate: async (payload, id, signal, files) => {
    calls.push({ payload, id, files });
    return { conversationId: remote, text: calls.length === 1 ? '{"type":"tool_call","name":"demo.create_note","arguments":{"text":"From document"}}' : '{"type":"final","text":"Done"}' };
  } });
  t.after(async () => { await scheduler.close(); store.close(); });
  scheduler.kick(); await scheduler.waitIdle();
  assert.deepEqual(calls[0].files, attachments);
  assert.deepEqual(store.attachmentMetadata(run.id), attachmentMetadata(attachments));
  assert.equal(store.createRun(conversation.id, 'Read', '{}', 'document-key', attachments).id, run.id);
  for (const changed of [[], attachmentsSchema.parse([file('renamed.pdf')]), attachmentsSchema.parse([file('report.pdf', 'changed')])])
    assert.throws(() => store.createRun(conversation.id, 'Read', '{}', 'document-key', changed), error => error.code === 'idempotency_conflict');
  scheduler.decide(store.actions(run.id)[0].id, false); await scheduler.waitIdle();
  assert.deepEqual(calls[1].files, []);
  assert.equal(calls[1].id, remote);
  assert.equal(store.run(run.id).status, 'completed');
  assert.equal(store.messages(conversation.id)[0].attachments[0].filename, 'report.pdf');
  assert.doesNotMatch(JSON.stringify(store.viewRun(run.id)), /data_base64|private document/);
});

test('API et client : document volumineux, métadonnées publiques, requêtes invalides refusées', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-document-api-'));
  const config = loadConfig({ BRIDGE_DATA_DIR: dir }), store = new Store(':memory:');
  const received = [];
  const scheduler = new Scheduler(store, { generate: async (_text, _id, _signal, files) => {
    received.push(files); return { conversationId: randomUUID(), text: '{"type":"final","text":"Read"}' };
  } });
  const app = buildServer({ config, store, scheduler, maintenance: { status: () => ({ state: 'closed' }), open() {}, async close() {} }, probe: async () => 'ready' });
  t.after(async () => { await scheduler.close(); await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new ChatGptBridgeClient({ baseUrl: `http://127.0.0.1:${app.server.address().port}`, token: config.token });
  const c = await client.createConversation();
  const attachments = [file('large.txt', 'a'.repeat(300000))];
  const submitted = await client.sendMessage(c.id, 'Read', { attachments, idempotencyKey: 'with-file' });
  await scheduler.waitIdle();
  assert.equal(received[0][0].data_base64, attachments[0].data_base64);
  const run = await client.getRun(submitted.run_id);
  assert.equal(run.attachments[0].size_bytes, 300000);
  assert.equal(run.attachments[0].sha256.length, 64);
  assert.doesNotMatch(JSON.stringify(run), /data_base64/);
  assert.equal((await client.getConversation(c.id)).messages[0].attachments[0].filename, 'large.txt');
  assert.equal((await client.sendMessage(c.id, 'Read', { attachments, idempotencyKey: 'with-file' })).run_id, submitted.run_id);
  await assert.rejects(client.sendMessage(c.id, 'Read', { idempotencyKey: 'with-file' }), error => error.code === 'idempotency_conflict');
  const url = `/v1/conversations/${c.id}/messages`, headers = { authorization: `Bearer ${config.token}` };
  for (const invalid of [[{ filename: '../file.pdf', data_base64: 'YQ==' }], [{ filename: 'x.txt', data_base64: '??==' }], [{ path: '/etc/passwd' }]])
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { text: 'Read', attachments: invalid } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, payload: { text: 'Read', attachments } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/json' }, payload: ' '.repeat(MESSAGE_BODY_LIMIT_BYTES + 1) })).statusCode, 413);
  assert.equal(received.length, 1);
});
