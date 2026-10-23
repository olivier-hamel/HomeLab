import type { Config } from './config.js';
import { BridgeError } from './errors.js';

export function client(config: Pick<Config, 'port' | 'token'>) {
  return async function call(method: string, path: string, body?: unknown, key?: string): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
        method, headers: { Authorization: `Bearer ${config.token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(key && { 'Idempotency-Key': key }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(400_000),
      });
    } catch { throw new BridgeError('service_unreachable', 'Service inaccessible. Démarrer npm start ; aucune soumission relancée automatiquement.', 503); }
    const result = await response.json() as any;
    if (!response.ok) throw new BridgeError(result.error?.code ?? 'http_error', result.error?.message ?? `HTTP ${response.status}`, response.status);
    return result;
  };
}
