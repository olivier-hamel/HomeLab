import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildServer, loadConfig } from 'tab2api';
import { Engine } from '../dist/engine.js';
import { instructions } from '../dist/protocol.js';
import { attachmentHandoff } from '../dist/engine-attachments.js';

// These test-only providers exercise the actual installed gateway and adapter HTTP
// contract. They are not selectable from the executable service or configuration.
test('paquet publié : schéma strict, création et continuation réelle du contrat HTTP', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-upstream-'));
  const require = createRequire(import.meta.url);
  assert.equal(require('./../node_modules/tab2api/package.json').version, '0.3.0');
  const token = 'upstream-contract-test-key-123456';
  const config = await loadConfig({ TAB2API_DATA_DIR: dir, TAB2API_PROFILE_DIR: join(dir, 'browser-profile'), TAB2API_API_TOKEN: token });
  const remote = randomUUID(), received = [];
  const provider = {
    id: 'chatgpt-web', generate: async request => { received.push(request); return { text: '{"type":"final","text":"ok"}', providerModel: 'chatgpt-web', conversationId: remote }; },
    health: async () => 'ready', reset: async () => {}, close: async () => {},
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, child() { return this; } };
  const upstream = buildServer({ config, provider, logger });
  provider.generate = attachmentHandoff(upstream, provider.generate);
  await upstream.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await upstream.close(); rmSync(dir, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${token}` };
  const incompatible = await upstream.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: { model: 'chatgpt-web', messages: [{ role: 'user', content: 'x' }], temporary: false } });
  assert.equal(incompatible.statusCode, 400);
  const engine = new Engine({ enginePort: upstream.server.address().port, engineToken: token, timeoutMs: 1000 }, {}, { has: () => true });
  const first = await engine.generate('{"kind":"user","text":"x"}', null, new AbortController().signal);
  assert.equal(first.conversationId, remote); assert.equal(first.text, '{"type":"final","text":"ok"}');
  await engine.generate('{"kind":"user","text":"suite"}', remote, new AbortController().signal);
  const document = { filename: 'report.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data_base64: Buffer.alloc(300000, 42).toString('base64') };
  await engine.generate('Read the document', remote, new AbortController().signal, [document]);
  assert.equal(received[2].attachments[0].filename, 'report.docx');
  assert.equal(received[2].attachments[0].mimeType, document.mime_type);
  assert.equal(received[2].attachments[0].data.toString('base64'), document.data_base64);
  assert.equal(received[2].conversationId, remote);
  const invalidFile = await upstream.inject({ method: 'POST', url: '/v1/chat/completions', headers, payload: { model: 'chatgpt-web', messages: [{ role: 'user', content: 'x' }], bridge_attachments: [{ ...document, filename: '../secret.docx' }] } });
  assert.equal(invalidFile.statusCode, 400);
  const unauthorized = await upstream.inject({ method: 'POST', url: '/v1/chat/completions', payload: { model: 'chatgpt-web', messages: [{ role: 'user', content: 'x' }], bridge_attachments: [document] } });
  assert.equal(unauthorized.statusCode, 401);
  await engine.generate('Text after documents', remote, new AbortController().signal);
  assert.deepEqual(received[3].attachments, []);
  assert.equal(received.length, 4);
  assert.equal(received[0].conversationId, undefined); assert.equal(received[1].conversationId, remote);
  assert.ok(received[0].prompt.includes('demo.create_note'));
  assert.ok(received[0].prompt.includes('kind'));
  assert.match(instructions, /accord humain/);
});

test('identifiant distant absent : aucun résultat supposé continuable', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-invalid-'));
  const token = 'upstream-contract-test-key-123456';
  const config = await loadConfig({ TAB2API_DATA_DIR: dir, TAB2API_PROFILE_DIR: join(dir, 'browser-profile'), TAB2API_API_TOKEN: token });
  const provider = { id: 'chatgpt-web', generate: async () => ({ text: 'réponse sans id', providerModel: 'chatgpt-web' }), health: async () => 'ready', close: async () => {} };
  const logger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, child() { return this; } };
  const upstream = buildServer({ config, provider, logger });
  await upstream.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await upstream.close(); rmSync(dir, { recursive: true, force: true }); });
  const engine = new Engine({ enginePort: upstream.server.address().port, engineToken: token, timeoutMs: 1000 }, {}, { has: () => true });
  await assert.rejects(() => engine.generate('x', null, new AbortController().signal), error => error.code === 'conversation_id_missing' && error.ambiguous);
});
