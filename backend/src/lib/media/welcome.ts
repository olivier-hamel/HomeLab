import { randomInt, randomUUID } from "node:crypto";
import { list, record, type Fetcher } from "./core.ts";
import { bounded, readLimited } from "./http.ts";
import { ASSIST_MODEL } from "./source-assist.ts";

export type WelcomeCopy = { line1: string; line2: string };
export const WELCOME_FALLBACK: WelcomeCopy = { line1: "Pick something great.", line2: "We'll take care of the rest." };
const BATCH_SIZE = 8;

function line(value: unknown, apiKey: string): string {
  if (typeof value !== "string") throw new Error("Invalid welcome line");
  const text = value.trim();
  if (!text || text.length > 42 || /[\r\n<>[\]#*`]|https?:|www\./i.test(text) || text.includes(apiKey)) throw new Error("Invalid welcome line");
  return text;
}

export class Welcome {
  private fetcher: Fetcher;
  private copies: WelcomeCopy[] = [];
  private expires = 0;
  private retryAfter = 0;
  private pending: Promise<void> | undefined;
  private last = "";
  constructor(fetcher: Fetcher = fetch) { this.fetcher = fetcher; }

  async get(signal: AbortSignal): Promise<WelcomeCopy> {
    signal.throwIfAborted();
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return WELCOME_FALLBACK;
    if (Date.now() >= this.expires && Date.now() >= this.retryAfter) {
      // Share one bounded generation across visits, even if one visitor leaves.
      this.pending ??= this.generate(apiKey).finally(() => { this.pending = undefined; });
      await this.pending;
    }
    signal.throwIfAborted();
    const choices = this.copies.filter(copy => JSON.stringify(copy) !== this.last);
    const copy = choices.length ? choices[randomInt(choices.length)] : WELCOME_FALLBACK;
    this.last = JSON.stringify(copy);
    return copy;
  }

  private async generate(apiKey: string): Promise<void> {
    try {
      const data = await bounded("Gemini welcome", 8000, new AbortController().signal, async signal => {
        const response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${ASSIST_MODEL}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, signal, cache: "no-store", redirect: "manual",
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `Write ${BATCH_SIZE} distinct two-line welcome headlines for HomeLab Cinema, a personal movie and TV browsing app.
Each pair should feel warm, casual, concise and a little playful, inviting someone to pick something to watch and settle in.
Use varied ideas and sentence structures across pairs. Each line must be at most 42 characters, ideally 3 to 7 words.
The second line should complement the first. Plain English text only, no markdown, links, emoji, quotes from films, or technical jargon.
Do not promise availability, instant playback, quality or safety. Do not mention AI. Return only the requested JSON.` }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify({ variation: randomUUID(), avoid: this.copies }) }] }],
            generationConfig: { temperature: 1, maxOutputTokens: 2000, responseMimeType: "application/json", responseJsonSchema: {
              type: "object", properties: { copies: { type: "array", minItems: BATCH_SIZE, maxItems: BATCH_SIZE, items: {
                type: "object", properties: { line1: { type: "string" }, line2: { type: "string" } }, required: ["line1", "line2"], additionalProperties: false,
              } } }, required: ["copies"], additionalProperties: false,
            } },
          }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error("Welcome unavailable"); }
        const envelope = record(JSON.parse(new TextDecoder().decode(await readLimited(response, 32 * 1024))));
        const candidate = record(list(envelope.candidates)[0]);
        if (candidate.finishReason !== "STOP") throw new Error("Incomplete welcome");
        const output = list(record(candidate.content).parts).map(record).filter(part => part.thought !== true).map(part => typeof part.text === "string" ? part.text : "").join("");
        return record(JSON.parse(output));
      });
      if (!Array.isArray(data.copies) || data.copies.length !== BATCH_SIZE) throw new Error("Invalid welcome batch");
      const copies = data.copies.map(value => { const row = record(value); return { line1: line(row.line1, apiKey), line2: line(row.line2, apiKey) }; });
      if (new Set(copies.map(copy => JSON.stringify(copy).toLowerCase())).size !== BATCH_SIZE) throw new Error("Repeated welcome copy");
      this.copies = copies;
      this.expires = Date.now() + 60 * 60_000;
    } catch {
      // Keep previously generated copy during outages and avoid retrying on every visit.
      this.retryAfter = Date.now() + 60_000;
    }
  }
}
