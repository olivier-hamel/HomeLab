import { MediaError, list, record, type Fetcher } from "../media/core.ts";
import { bounded, readLimited } from "../media/http.ts";
import { setTimeout as delay } from "node:timers/promises";

// Server-only configuration shared by all Tempo event creation and document scans.
export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";
export function openaiApiKey() { return process.env.OPENAI_API_KEY?.trim() || ""; }
export function openaiModel() { return DEFAULT_OPENAI_MODEL; }

export class OpenAIProviderError extends MediaError {
  upstreamStatus: number;
  upstreamCode: string;
  model: string;
  constructor(code: string, message: string, status: number, upstreamStatus: number, upstreamCode: string, model: string) {
    super(code, message, status);
    this.upstreamStatus = upstreamStatus;
    this.upstreamCode = upstreamCode;
    this.model = model;
  }
}

export async function generateOpenAIObject(options: {
  instruction: string; input: unknown; schema: object; signal: AbortSignal;
  fetcher?: Fetcher; timeout?: number; retries?: number;
  pdf?: Uint8Array; filename?: string; schemaName?: string;
  maxOutputTokens?: number; maxResponseBytes?: number;
}): Promise<unknown> {
  const key = openaiApiKey();
  if (!key) throw new MediaError("ai_setup", "La création assistée est indisponible. Tu peux remplir les détails manuellement.", 503);
  const model = openaiModel();
  const timeout = options.timeout ?? 20_000;
  const deadline = Date.now() + timeout;
  const retries = options.retries ?? 0;
  const body = JSON.stringify({
    model, instructions: options.instruction,
    input: [{ role: "user", content: options.pdf ? [
      { type: "input_text", text: JSON.stringify(options.input) },
      { type: "input_file", filename: options.filename ?? "document.pdf", file_data: `data:application/pdf;base64,${Buffer.from(options.pdf).toString("base64")}` },
    ] : JSON.stringify(options.input) }],
    reasoning: { effort: "low" }, max_output_tokens: options.maxOutputTokens ?? 4000, store: false,
    text: { format: { type: "json_schema", name: options.schemaName ?? "calendar_event", strict: true, schema: options.schema } },
  });
  return bounded("OpenAI", timeout, options.signal, async signal => {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
      let response: Response;
      try {
        response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          signal, cache: "no-store", redirect: "error", body,
        });
      } catch (error) {
        if (signal.aborted || error instanceof MediaError || attempt >= retries || backoff >= deadline - Date.now()) throw error;
        await delay(backoff, undefined, { signal });
        continue;
      }
      if (!response.ok) {
        const envelope = await readLimited(response, 16 * 1024).then(bytes => record(JSON.parse(new TextDecoder().decode(bytes)))).catch(() => ({}));
        const upstream = record(record(envelope).error);
        const reported = upstream.code ?? upstream.type;
        const upstreamCode = typeof reported === "string" && ["invalid_api_key", "authentication_error", "permission_denied", "invalid_request_error", "model_not_found", "rate_limit_exceeded", "insufficient_quota", "server_error", "timeout"].includes(reported) ? reported : "UNKNOWN";
        const [code, message] = response.status === 400 ? ["ai_request", "La demande d’analyse a été refusée. Vérifie la configuration du serveur."]
          : [401, 403].includes(response.status) ? ["ai_credentials", "Le service d’analyse n’est pas autorisé. Vérifie la configuration du serveur."]
          : response.status === 404 ? ["ai_model", "Le service d’analyse n’est pas disponible. Vérifie la configuration du serveur."]
          : ["ai_unavailable", response.status === 429 ? "La limite de requêtes ou le quota du service d’analyse est atteint. Patiente avant de réessayer." : "L’analyse est temporairement indisponible. Réessaie dans un instant."];
        const retryAfter = response.headers.get("retry-after");
        const retryAfterMs = retryAfter === null ? 0 : /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        const wait = Math.max(backoff, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
        // All attempts and backoffs share the browser's preparation deadline.
        if ([408, 429, 500, 502, 503, 504].includes(response.status) && upstreamCode !== "insufficient_quota" && attempt < retries && wait < deadline - Date.now()) {
          await delay(wait, undefined, { signal });
          continue;
        }
        // Only allowlisted diagnostics leave this helper; never upstream messages.
        throw new OpenAIProviderError(code, message, response.status === 429 ? 429 : 502, response.status, upstreamCode, model);
      }
      try {
        const envelope = record(JSON.parse(new TextDecoder().decode(await readLimited(response, options.maxResponseBytes ?? 32 * 1024))));
        if (envelope.status !== "completed" || envelope.error || envelope.incomplete_details) throw new Error("Incomplete response");
        const messages = list(envelope.output).map(record).filter(item => item.type === "message" && item.role === "assistant");
        if (!messages.length || messages.some(message => message.status !== "completed")) throw new Error("Incomplete message");
        const parts = messages.flatMap(message => list(message.content).map(record));
        if (parts.some(part => part.type !== "output_text" || typeof part.text !== "string")) throw new Error("Invalid response");
        const output = parts.map(part => part.text).join("");
        const result: unknown = JSON.parse(output);
        if (JSON.stringify(result).includes(key)) throw new Error("Invalid response");
        return result;
      } catch {
        throw new MediaError("ai_output", "L’analyse est incomplète. Précise ta demande ou saisis les détails manuellement.", 502);
      }
    }
  }).catch(error => {
    if (error instanceof MediaError && error.code === "timeout") throw new MediaError("timeout", "L’analyse prend trop de temps. Réessaie ou saisis les détails manuellement.", 504);
    if (error instanceof MediaError && error.code === "unavailable") throw new MediaError("ai_unavailable", "Le service d’analyse est injoignable. Réessaie dans un instant.", 502);
    throw error;
  });
}
