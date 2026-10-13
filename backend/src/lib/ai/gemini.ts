import { MediaError, list, record, string, type Fetcher } from "../media/core.ts";
import { bounded, readLimited } from "../media/http.ts";
import { setTimeout as delay } from "node:timers/promises";

// Server-only Gemini configuration for media AI features.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export function geminiApiKey() { return process.env.GEMINI_API_KEY?.trim() || ""; }
export function geminiModel() { return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL; }

export class GeminiProviderError extends MediaError {
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

export async function generateGeminiObject(options: {
  instruction: string; input: unknown; schema: object; signal: AbortSignal;
  fetcher?: Fetcher; timeout?: number; retries?: number;
  pdf?: Uint8Array; maxOutputTokens?: number; maxResponseBytes?: number;
}): Promise<unknown> {
  const key = geminiApiKey();
  if (!key) throw new MediaError("ai_setup", "La création assistée est indisponible. Tu peux remplir les détails manuellement.", 503);
  const model = geminiModel();
  const timeout = options.timeout ?? 20_000;
  const deadline = Date.now() + timeout;
  const retries = options.retries ?? 0;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: options.instruction }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(options.input) }, ...(options.pdf ? [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(options.pdf).toString("base64") } }] : [])] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: options.maxOutputTokens ?? 2000, responseMimeType: "application/json", responseJsonSchema: options.schema },
  });
  return bounded("Gemini", timeout, options.signal, async signal => {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const backoff = 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
      let response: Response;
      try {
        response = await (options.fetcher ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal, cache: "no-store", redirect: "error", body,
        });
      } catch (error) {
        if (signal.aborted || error instanceof MediaError || attempt >= retries || backoff >= deadline - Date.now()) throw error;
        await delay(backoff, undefined, { signal });
        continue;
      }
      if (!response.ok) {
        const envelope = await readLimited(response, 16 * 1024).then(bytes => record(JSON.parse(new TextDecoder().decode(bytes)))).catch(() => ({}));
        const reported = record(record(envelope).error).status;
        const upstreamCode = typeof reported === "string" && ["INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "NOT_FOUND", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"].includes(reported) ? reported : "UNKNOWN";
        const [code, message] = response.status === 400 ? ["ai_request", "La demande d’analyse a été refusée. Vérifie la configuration du serveur."]
          : [401, 403].includes(response.status) ? ["ai_credentials", "Le service d’analyse n’est pas autorisé. Vérifie la configuration du serveur."]
          : response.status === 404 ? ["ai_model", "Le service d’analyse n’est pas disponible. Vérifie la configuration du serveur."]
          : ["ai_unavailable", response.status === 429 ? "La limite de requêtes ou le quota du service d’analyse est atteint. Patiente ou saisis les détails manuellement." : "L’analyse est temporairement indisponible. Réessaie dans un instant ou saisis les détails manuellement."];
        const retryAfter = response.headers.get("retry-after");
        const retryAfterMs = retryAfter === null ? 0 : /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        const wait = Math.max(backoff, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
        // All attempts share one deadline; a long Retry-After returns the provider
        // error immediately instead of occupying the dialog until a timeout.
        if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries && wait < deadline - Date.now()) {
          await delay(wait, undefined, { signal });
          continue;
        }
        // Do not expose upstream messages, request bodies, PDF data or credentials.
        throw new GeminiProviderError(code, message, response.status === 429 ? 429 : 502, response.status, upstreamCode, model);
      }
      try {
        const limit = options.maxResponseBytes ?? 32 * 1024;
        const envelope = record(JSON.parse(new TextDecoder().decode(await readLimited(response, limit))));
        const candidate = record(list(envelope.candidates)[0]);
        if (candidate.finishReason !== "STOP") throw new Error("Incomplete response");
        const output = list(record(candidate.content).parts).map(record).filter(part => part.thought !== true).map(part => string(part.text, limit)).join("");
        if (!output || output.includes(key)) throw new Error("Invalid response");
        return JSON.parse(output);
      } catch {
        throw new MediaError("ai_output", "L’analyse est incomplète. Précise ta demande ou saisis les détails manuellement.", 502);
      }
    }
  }).catch(error => {
    if (error instanceof MediaError && error.code === "timeout") throw new MediaError("timeout", "L’analyse prend trop de temps. Réessaie ou saisis les détails manuellement.", 504);
    if (error instanceof MediaError && error.code === "unavailable") throw new MediaError("ai_unavailable", "Le service d’analyse est injoignable. Réessaie ou saisis les détails manuellement.", 502);
    throw error;
  });
}
