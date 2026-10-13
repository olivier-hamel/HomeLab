import { MediaError, list, record, string, type Fetcher } from "../media/core.ts";
import { bounded, readLimited } from "../media/http.ts";

// One server-only credential and model configuration for HomeLab's AI features.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export function geminiApiKey() { return process.env.GEMINI_API_KEY?.trim() || ""; }
export function geminiModel() { return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL; }

export async function generateGeminiObject(options: {
  instruction: string; input: unknown; schema: object; signal: AbortSignal;
  fetcher?: Fetcher; timeout?: number;
  pdf?: Uint8Array; maxOutputTokens?: number; maxResponseBytes?: number;
}): Promise<unknown> {
  const key = geminiApiKey();
  if (!key) throw new MediaError("ai_setup", "La création assistée est indisponible. Tu peux remplir les détails manuellement.", 503);
  return bounded("Gemini", options.timeout ?? 20_000, options.signal, async signal => {
    const response = await (options.fetcher ?? fetch)(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal, cache: "no-store", redirect: "error",
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.instruction }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(options.input) }, ...(options.pdf ? [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(options.pdf).toString("base64") } }] : [])] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: options.maxOutputTokens ?? 2000, responseMimeType: "application/json", responseJsonSchema: options.schema },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MediaError("ai_unavailable", response.status === 429 ? "Gemini est occupé. Réessaie dans un instant ou saisis les détails manuellement." : "Gemini n’a pas pu préparer l’événement. Réessaie ou saisis les détails manuellement.", response.status === 429 ? 429 : 502);
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
      throw new MediaError("ai_output", "La réponse de Gemini est incomplète. Précise ta demande ou saisis les détails manuellement.", 502);
    }
  }).catch(error => {
    if (error instanceof MediaError && error.code === "timeout") throw new MediaError("timeout", "Gemini prend trop de temps. Réessaie ou saisis les détails manuellement.", 504);
    if (error instanceof MediaError && error.code === "unavailable") throw new MediaError("ai_unavailable", "La connexion à Gemini est indisponible. Réessaie ou saisis les détails manuellement.", 502);
    throw error;
  });
}
