import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './store.js';
import type { Scheduler } from './scheduler.js';
import { BridgeError, errorInfo } from './errors.js';
import { lanAccess } from './access.js';
import { attachmentsSchema, MESSAGE_BODY_LIMIT_BYTES } from './attachments.js';

export interface SessionControl {
  status(): Record<string, unknown>;
  open(inspect?: boolean): Record<string, unknown>;
  close(shutdown?: boolean): Promise<void>;
}
const uuid = z.string().uuid();
const idParam = (params: unknown) => z.object({ id: uuid }).parse(params).id;
const digest = (value: string) => createHash('sha256').update(value).digest();

export function buildServer(deps: { config: Config; store: Store; scheduler: Scheduler; maintenance: SessionControl; probe: (force: boolean) => Promise<string> }) {
  const { config, store, scheduler, maintenance } = deps;
  const contract = readFileSync(join(config.projectDir, 'openapi.yaml'), 'utf8');
  const allowedAddress = lanAccess(config.lanCidrs);
  const corsMethods = ['GET', 'POST', 'DELETE'];
  const corsHeaders = ['authorization', 'content-type', 'idempotency-key'];
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 262144, requestTimeout: 15000 });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Vary', 'Origin');
    // Use the socket address, never forwarded headers supplied by a proxy or client.
    if (!allowedAddress(request.ip)) throw new BridgeError('lan_only', 'Accès réservé au même réseau local.', 403);
    if (!config.allowedHosts.includes(request.hostname.toLowerCase())) throw new BridgeError('invalid_host', 'Hôte API non autorisé.', 403);
    const maintenanceRoute = request.routeOptions.url === '/v1/session/maintenance' ||
      request.url.split('?')[0]?.replace(/\/+$/, '') === '/v1/session/maintenance';
    const origin = request.headers.origin;
    if (origin !== undefined) {
      // Maintenance credentials remain available only to local, non-browser clients.
      if (maintenanceRoute || !config.allowedOrigins.includes(origin)) throw new BridgeError('origin_not_allowed', 'Origine navigateur non autorisée.', 403);
      reply.header('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = request.headers['access-control-request-headers'];
        if (typeof method !== 'string' || !corsMethods.includes(method) ||
            (headers !== undefined && (typeof headers !== 'string' || headers.split(',').some(header => !corsHeaders.includes(header.trim().toLowerCase())))))
          throw new BridgeError('invalid_preflight', 'Méthode ou en-tête CORS non autorisé.', 403);
        return reply.header('Access-Control-Allow-Methods', corsMethods.join(', '))
          .header('Access-Control-Allow-Headers', corsHeaders.join(', ')).code(204).send();
      }
    }
    if (maintenanceRoute && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip))
      throw new BridgeError('local_only', 'La maintenance nécessite un client local ou un tunnel SSH.', 403);
    if (request.url === '/healthz') return;
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !timingSafeEqual(digest(authorization), digest(`Bearer ${config.token}`)))
      throw new BridgeError('unauthorized', 'Jeton local requis.', 401);
  });
  app.options('/*', async (_request, reply) => reply.code(404).send());
  app.get('/healthz', async () => ({ status: 'ok', service: 'chatgpt-plus-bridge' }));
  app.get('/v1/openapi.yaml', async (_request, reply) => reply.type('application/yaml').send(contract));
  app.get('/v1/status', async request => {
    const session = maintenance.status();
    const maintenanceActive = ['opening','open','closing'].includes(String(session.state));
    const force = z.object({ refresh: z.enum(['true','false']).optional() }).parse(request.query).refresh === 'true';
    const state = maintenanceActive ? 'maintenance' : scheduler.activeId ? 'generation_in_progress' : await deps.probe(force);
    return {
      service: 'chatgpt-plus-bridge', engine: 'tab2api', engine_version: '0.3.0', mode: 'real', session: state,
      queue: { ...store.counts(), paused: scheduler.paused, active_run_id: scheduler.activeId ?? null },
      maintenance: { state: session.state, expires_at: session.expires_at, error: session.error },
    };
  });
  app.post('/v1/conversations', async (request, reply) => {
    const body = z.object({ title: z.string().trim().min(1).max(200).default('Nouvelle conversation') }).strict().parse(request.body ?? {});
    return reply.code(201).send(store.createConversation(body.title));
  });
  app.get('/v1/conversations', async () => ({ conversations: store.conversations() }));
  app.get('/v1/conversations/:id', async request => {
    const id = idParam(request.params);
    return { ...store.conversation(id), messages: store.messages(id) };
  });
  app.post('/v1/conversations/:id/messages', { bodyLimit: MESSAGE_BODY_LIMIT_BYTES }, async (request, reply) => {
    const id = idParam(request.params);
    const body = z.object({ text: z.string().trim().min(1).max(32000), attachments: attachmentsSchema }).strict().parse(request.body);
    const key = z.string().min(1).max(200).optional().parse(request.headers['idempotency-key']);
    const run = scheduler.submit(id, body.text, key, body.attachments);
    return reply.code(202).send({ run_id: run.id, status: run.status });
  });
  app.get('/v1/runs/:id', async request => store.viewRun(idParam(request.params)));
  app.post('/v1/runs/:id/cancel', async request => {
    scheduler.cancel(idParam(request.params));
    return store.viewRun(idParam(request.params));
  });
  app.post('/v1/actions/:id/decision', async (request, reply) => {
    const body = z.object({ approved: z.boolean() }).strict().parse(request.body);
    const run = scheduler.decide(idParam(request.params), body.approved);
    return reply.code(202).send({ run_id: run.id, status: run.status });
  });
  app.get('/v1/session/maintenance', async () => maintenance.status());
  app.post('/v1/session/maintenance', async (request, reply) => {
    const body = z.object({ inspect: z.boolean().default(false) }).strict().parse(request.body ?? {});
    return reply.code(202).send(maintenance.open(body.inspect));
  });
  app.delete('/v1/session/maintenance', async () => { await maintenance.close(); return maintenance.status(); });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: 'invalid_request', message: 'Requête invalide.', fields: error.issues.map(issue => issue.path.join('.')) } });
    if (error instanceof BridgeError) return reply.code(error.status).send({ error: errorInfo(error) });
    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500)
      return reply.code(error.statusCode).send({ error: { code: 'invalid_request', message: 'Requête HTTP invalide ou trop volumineuse.' } });
    return reply.code(500).send({ error: errorInfo(error) });
  });
  return app;
}
