import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import type { Config } from './config.js';
import { privateDir } from './config.js';
import type { Desktop } from './desktop.js';
import type { Processes } from './processes.js';
import { BridgeError } from './errors.js';
import { instructions } from './protocol.js';
import { MAX_TOTAL_BYTES, type Attachment } from './attachments.js';

export interface ChatEngine {
  generate(payload: string, conversationId: string | null, signal: AbortSignal, attachments?: readonly Attachment[]): Promise<{ text: string; conversationId: string }>;
}
const require = createRequire(import.meta.url);
export class Engine implements ChatEngine {
  private starting?: Promise<void>;
  private state = 'unknown';
  private observedAt = 0;
  private readonly cli: string;
  private readonly baseUrl: string;
  constructor(readonly config: Config, private desktop: Desktop, private processes: Processes) {
    this.cli = join(dirname(require.resolve('tab2api')), 'cli/index.js');
    this.baseUrl = `http://127.0.0.1:${config.enginePort}`;
  }
  private environment() {
    const data = join(this.config.dataDir, 'tab2api');
    privateDir(data);
    return {
      ...this.desktop.environment(),
      TAB2API_HOST: '127.0.0.1', TAB2API_PORT: String(this.config.enginePort),
      TAB2API_API_TOKEN: this.config.engineToken,
      TAB2API_DATA_DIR: data, TAB2API_PROFILE_DIR: join(data, 'browser-profile'),
      TAB2API_HEADLESS: 'false', TAB2API_CONCURRENCY: '1', TAB2API_QUEUE_CAPACITY: '1',
      TAB2API_REQUEST_TIMEOUT_MS: String(this.config.timeoutMs), TAB2API_DEBUG: 'false', TAB2API_LOG_LEVEL: 'warn',
      TAB2API_MEDIA_LIMIT_BYTES: String(MAX_TOTAL_BYTES),
    };
  }
  async start() {
    if (this.starting) return this.starting;
    if (this.processes.has('engine')) return;
    this.starting = this.launch();
    try { await this.starting; } finally { this.starting = undefined; }
  }
  private async launch() {
    // Refuse to attach to an existing listener, even if it happens to speak tab2api.
    const net = await import('node:net');
    await new Promise<void>((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', () => reject(new BridgeError('engine_port_busy', 'Le port du moteur est déjà utilisé.', 503)));
      probe.listen(this.config.enginePort, '127.0.0.1', () => probe.close(() => resolve()));
    });
    const child = this.processes.start('engine', process.execPath, [join(this.config.projectDir, 'dist/engine-worker.js')], this.environment());
    for (let i = 0; i < 150; i++) {
      if (!this.processes.has('engine')) { await child.exited; throw new BridgeError('engine_start_failed', 'tab2api n’a pas démarré.', 503); }
      try {
        const response = await this.call('/healthz', { auth: false, timeoutMs: 500 });
        if (response.service === 'tab2api' && response.status === 'ok') { this.state = 'unknown'; this.observedAt = 0; return; }
      } catch { /* Wait for startup. */ }
      await delay(100);
    }
    await this.stop();
    throw new BridgeError('engine_timeout', 'tab2api ne répond pas au démarrage.', 503);
  }
  async stop() { await this.processes.stop('engine'); this.state = 'browser_disconnected'; }
  login() {
    return this.processes.start('login', process.execPath, [this.cli, 'login'], this.environment()).exited.then(code => {
      if (code !== 0) throw new BridgeError('login_failed', 'La connexion manuelle n’a pas été validée.', 503);
    });
  }
  inspect() {
    return this.processes.start('login', process.execPath, [join(this.config.projectDir, 'dist/maintenance-browser.js'), join(this.config.dataDir, 'tab2api/browser-profile')], this.environment()).exited.then(code => {
      if (code !== 0) throw new BridgeError('inspection_failed', 'La session d’inspection a été interrompue.', 503);
    });
  }
  async stopLogin() { await this.processes.stop('login'); }
  async probe(force = false) {
    if (!force && Date.now() - this.observedAt < 30_000) return this.state;
    try {
      const result = await this.call('/readyz', { timeoutMs: 35_000, allowUnavailable: true });
      this.state = typeof result.session === 'string' ? result.session : 'browser_disconnected';
    } catch { this.state = 'browser_disconnected'; }
    this.observedAt = Date.now();
    return this.state;
  }
  private async call(path: string, options: { body?: unknown; signal?: AbortSignal; timeoutMs?: number; auth?: boolean; allowUnavailable?: boolean } = {}): Promise<Record<string, any>> {
    const signal = AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs + 5000);
    let response: Response;
    try {
      response = await fetch(this.baseUrl + path, {
        method: options.body ? 'POST' : 'GET',
        headers: { ...(options.auth !== false && { Authorization: `Bearer ${this.config.engineToken}` }), ...(options.body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
        signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal,
        redirect: 'error',
      });
    } catch { throw new BridgeError('engine_unreachable', 'Le moteur a été interrompu ou n’a pas répondu ; aucun nouvel envoi automatique.', 502, !!options.body); }
    let result: Record<string, any>;
    try { result = await response.json() as Record<string, any>; }
    catch { throw new BridgeError('engine_invalid_response', 'Réponse du moteur illisible.', 502, !!options.body); }
    if (!response.ok && !(response.status === 503 && options.allowUnavailable)) {
      const code = result.error?.code ?? 'engine_error';
      this.state = code; this.observedAt = Date.now();
      const remote = result.error?.conversation_id;
      throw new BridgeError(code, 'Demande refusée ou interrompue par le moteur ; consulter l’état de session.', 502, !!options.body,
        typeof remote === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(remote) ? remote : undefined);
    }
    return result;
  }
  async generate(payload: string, conversationId: string | null, signal: AbortSignal, attachments: readonly Attachment[] = []) {
    await this.start();
    // Published 0.3.0 has a strict schema: no `temporary`, `tools`, or `reasoning_effort`.
    const result = await this.call('/v1/chat/completions', { signal, body: {
      model: 'chatgpt-web', stream: false,
      messages: [{ role: 'developer', content: instructions }, { role: 'user', content: payload }],
      ...(attachments.length && { bridge_attachments: attachments }),
      ...(conversationId && { conversation_id: conversationId }),
    } });
    const text = result.choices?.[0]?.message?.content;
    const id = result.tab2api?.conversation_id;
    if (typeof text !== 'string' || !text.trim() || typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
      throw new BridgeError('conversation_id_missing', 'Réponse vide ou identifiant distant absent ; vérifier la session avant de continuer.', 502, true);
    if (conversationId && conversationId !== id) throw new BridgeError('conversation_mismatch', 'La conversation distante a changé.', 502, true);
    this.state = 'ready'; this.observedAt = Date.now();
    return { text, conversationId: id };
  }
}
