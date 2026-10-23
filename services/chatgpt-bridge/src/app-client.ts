import type { ApiError, BridgeStatus, Conversation, ConversationDetail, DocumentInput, Run, Submission } from './api-types.js';
export type * from './api-types.js';

export interface RequestOptions { signal?: AbortSignal }
export interface SendOptions extends RequestOptions { idempotencyKey?: string; attachments?: readonly DocumentInput[] }
export interface WaitOptions extends RequestOptions { timeoutMs?: number; pollIntervalMs?: number }
export interface BridgeClientOptions {
  /** API root, without /v1. A reverse-proxy path prefix is supported. */
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

export class BridgeApiError extends Error {
  constructor(public readonly status: number, public readonly error: ApiError) {
    super(error.message);
    this.name = 'BridgeApiError';
  }
  get code() { return this.error.code; }
  get mayHaveBeenSent() { return this.error.may_have_been_sent === true; }
}

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value < 1 || value > 2_147_483_647) throw new RangeError(`${name} must be between 1 and 2147483647 ms.`);
  return value;
}

function deadline(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(external?.reason);
  if (external?.aborted) abort();
  else external?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new BridgeApiError(0, { code: 'client_timeout', message: 'The API request or polling deadline expired.' })), timeoutMs);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); external?.removeEventListener('abort', abort); },
  };
}

function sleep(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Fetch-based client for Node.js, native apps and browser applications. Never retries submissions. */
export class ChatGptBridgeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: BridgeClientOptions) {
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new TypeError('baseUrl must be an HTTP(S) URL without credentials, query or fragment.');
    if (!options.token.trim() || /[\r\n]/.test(options.token)) throw new TypeError('A bearer token is required.');
    this.baseUrl = url.href.replace(/\/+$/, '');
    this.token = options.token;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = positive(options.requestTimeoutMs ?? 45_000, 'requestTimeoutMs');
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}, body?: unknown, key?: string): Promise<T> {
    options.signal?.throwIfAborted();
    const pending = deadline(this.requestTimeoutMs, options.signal);
    try {
      const response = await this.fetcher(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(key !== undefined && { 'Idempotency-Key': key }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error', credentials: 'omit', signal: pending.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new BridgeApiError(response.status, result.error ?? { code: 'http_error', message: `HTTP ${response.status}` });
      return result as T;
    } catch (error) {
      if (error instanceof BridgeApiError && !pending.signal.aborted) throw error;
      // Once a mutation has been attempted, a transport failure cannot prove it was rejected.
      throw new BridgeApiError(0, {
        code: pending.signal.aborted ? 'request_aborted' : 'service_unreachable',
        message: 'The API response was not received. No request was retried.',
        may_have_been_sent: method !== 'GET',
      });
    } finally { pending.dispose(); }
  }

  status(refresh = false, options?: RequestOptions) {
    return this.request<BridgeStatus>('GET', `/v1/status?refresh=${refresh}`, options);
  }
  async listConversations(options?: RequestOptions) {
    return (await this.request<{ conversations: Conversation[] }>('GET', '/v1/conversations', options)).conversations;
  }
  createConversation(title?: string, options?: RequestOptions) {
    return this.request<Conversation>('POST', '/v1/conversations', options, title === undefined ? {} : { title });
  }
  getConversation(id: string, options?: RequestOptions) {
    return this.request<ConversationDetail>('GET', `/v1/conversations/${encodeURIComponent(id)}`, options);
  }
  sendMessage(conversationId: string, text: string, options: SendOptions = {}) {
    return this.request<Submission>('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/messages`, options,
      { text, ...(options.attachments && { attachments: options.attachments }) }, options.idempotencyKey);
  }
  getRun(id: string, options?: RequestOptions) {
    return this.request<Run>('GET', `/v1/runs/${encodeURIComponent(id)}`, options);
  }
  cancelRun(id: string, options?: RequestOptions) {
    return this.request<Run>('POST', `/v1/runs/${encodeURIComponent(id)}/cancel`, options);
  }
  decideAction(id: string, approved: boolean, options?: RequestOptions) {
    return this.request<Submission>('POST', `/v1/actions/${encodeURIComponent(id)}/decision`, options, { approved });
  }

  /** Returns when a run completes, needs approval, fails, is cancelled or is interrupted.
   * Aborting/timing out only stops polling; the persisted run continues on the service. */
  async waitForRun(id: string, options: WaitOptions = {}): Promise<Run> {
    const interval = positive(options.pollIntervalMs ?? 1000, 'pollIntervalMs');
    const pending = deadline(positive(options.timeoutMs ?? 660_000, 'timeoutMs'), options.signal);
    try {
      while (true) {
        pending.signal.throwIfAborted();
        const run = await this.getRun(id, { signal: pending.signal });
        if (!['queued', 'running'].includes(run.status)) return run;
        await sleep(interval, pending.signal);
      }
    } catch (error) {
      if (pending.signal.aborted) throw pending.signal.reason;
      throw error;
    } finally { pending.dispose(); }
  }
}
