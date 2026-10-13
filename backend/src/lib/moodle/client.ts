import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { bounded } from "../media/http.ts";
import { MediaError } from "../media/core.ts";
import { createHash } from "node:crypto";

export const moodleTools = ["list_courses", "list_files", "read_file"] as const;
export type MoodleTool = typeof moodleTools[number];
export type MoodleCourse = { id: number; shortname: string; fullname: string };
export type MoodleFile = { id: string; filename: string; mimetype: string; filesize: number; section: string; module: string; modified?: number; contenthash?: string };
export type MoodleText = { filename: string; course_id: number; text: string; truncated: boolean; characters_extracted: number; note: string };
export type MoodleSession = {
  tools: readonly MoodleTool[];
  courses(): Promise<MoodleCourse[]>;
  files(courseId: number): Promise<MoodleFile[]>;
  read(courseId: number, fileId: string): Promise<MoodleText>;
  download?: (courseId: number, fileId: string) => Promise<{ filename: string; bytes: Uint8Array<ArrayBuffer> }>;
};
export type MoodleConnector = <T>(signal: AbortSignal, work: (session: MoodleSession) => Promise<T>) => Promise<T>;

const invalidResult = () => new MediaError("moodle_result", "Moodle a renvoyé une réponse invalide. Réessaie dans un instant.", 502);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResult();
  return value as Record<string, unknown>;
}
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "result" in value) return (value as Record<string, unknown>).result;
  return value;
}

// FastMCP wraps lists in structuredContent.result and also emits one text block
// per row. read_file currently returns a single JSON text block instead.
export function moodleResult(result: CallToolResult, list: boolean): unknown {
  if (result.isError) throw new MediaError("moodle_tool", "Moodle n’a pas pu terminer cette demande. Réessaie dans un instant.", 502);
  if (result.structuredContent !== undefined) return unwrap(result.structuredContent);
  const values: unknown[] = [];
  for (const block of result.content) {
    if (block.type !== "text") continue;
    try { values.push(JSON.parse(block.text)); } catch { /* Informational text is not tool data. */ }
  }
  if (values.length === 1) {
    const value = unwrap(values[0]);
    return list && !Array.isArray(value) ? [value] : value;
  }
  if (list && values.length && values.every(value => value && typeof value === "object" && !Array.isArray(value))) return values;
  throw invalidResult();
}

function courses(value: unknown): MoodleCourse[] {
  if (!Array.isArray(value) || value.length > 10_000) throw invalidResult();
  return value.map(item => {
    const row = object(item);
    if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || typeof row.shortname !== "string" || typeof row.fullname !== "string") throw invalidResult();
    return { id: Number(row.id), shortname: row.shortname, fullname: row.fullname };
  });
}
function files(value: unknown): MoodleFile[] {
  if (!Array.isArray(value) || value.length > 20_000) throw invalidResult();
  return value.map(item => {
    const row = object(item);
    if (typeof row.id !== "string" || !row.id || row.id.length > 2048 || typeof row.filename !== "string" || typeof row.mimetype !== "string"
      || !Number.isSafeInteger(row.filesize) || Number(row.filesize) < 0 || typeof row.section !== "string" || typeof row.module !== "string") throw invalidResult();
    return { id: row.id, filename: row.filename, mimetype: row.mimetype, filesize: Number(row.filesize), section: row.section, module: row.module,
      ...(Number.isSafeInteger(row.modified) && Number(row.modified) >= 0 ? { modified: Number(row.modified) } : {}),
      ...(typeof row.contenthash === "string" && /^[a-f0-9]{40,64}$/i.test(row.contenthash) ? { contenthash: row.contenthash } : {}) };
  });
}
function text(value: unknown, courseId: number): MoodleText {
  const row = object(value);
  if (typeof row.filename !== "string" || row.course_id !== courseId || typeof row.text !== "string" || Array.from(row.text).length > 50_000
    || typeof row.truncated !== "boolean" || !Number.isSafeInteger(row.characters_extracted) || Number(row.characters_extracted) < 0 || typeof row.note !== "string") throw invalidResult();
  return { filename: row.filename, course_id: courseId, text: row.text, truncated: row.truncated, characters_extracted: Number(row.characters_extracted), note: row.note };
}

export function moodleEndpoint(): URL {
  let url: URL;
  try { url = new URL(process.env.MOODLE_MCP_URL || ""); } catch { throw new MediaError("moodle_config", "La connexion Moodle n’est pas configurée.", 503); }
  // This unauthenticated endpoint must be reached only through a local forward.
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "18000" || url.pathname !== "/mcp" || url.search || url.hash || url.username || url.password) {
    throw new MediaError("moodle_config", "La connexion privée Moodle est mal configurée.", 503);
  }
  return url;
}

export const withMoodle: MoodleConnector = async (signal, work) => {
  const endpoint = moodleEndpoint();
  return bounded("Moodle", 60_000, signal, async connectionSignal => {
    const client = new Client({ name: "homelab-moodle", version: "1.0.0" });
    let closing = false;
    const transport = new StreamableHTTPClientTransport(endpoint, {
      fetch: (url, init) => fetch(url, { ...init, redirect: "error", cache: "no-store", credentials: "omit",
        signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), closing ? AbortSignal.timeout(3000) : connectionSignal]) }),
    });
    const options = { signal: connectionSignal, timeout: 15_000 };
    try {
      await client.connect(transport, options); // Includes MCP initialize + initialized.
      const discovered = new Map<string, Record<string, unknown>>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, options);
        for (const tool of page.tools) discovered.set(tool.name, tool.inputSchema);
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw invalidResult();
        if (cursor) cursors.add(cursor);
        if (cursors.size > 100) throw invalidResult();
      } while (cursor);
      for (const name of moodleTools) {
        const schema = discovered.get(name);
        if (!schema) throw new MediaError("moodle_tools", "Les outils Moodle attendus ne sont pas disponibles.", 502);
        const properties = object(schema.properties ?? {});
        if (name !== "list_courses" && (object(properties.course_id).type !== "integer" || !Array.isArray(schema.required) || !schema.required.includes("course_id"))) throw invalidResult();
        if (name === "read_file" && (object(properties.file_id).type !== "string" || !(schema.required as unknown[]).includes("file_id"))) throw invalidResult();
      }
      const call = async (name: MoodleTool, args: Record<string, unknown>, list: boolean) => moodleResult(
        CallToolResultSchema.parse(await client.callTool({ name, arguments: args }, CallToolResultSchema, { signal: connectionSignal, timeout: 45_000 })), list);
      const downloadSchema = discovered.get("download_file");
      let download: MoodleSession["download"];
      if (downloadSchema) {
        const properties = object(downloadSchema.properties ?? {});
        if (object(properties.course_id).type !== "integer" || object(properties.file_id).type !== "string") throw invalidResult();
        download = async (courseId, fileId) => downloadOriginal(async args => moodleResult(CallToolResultSchema.parse(
          await client.callTool({ name: "download_file", arguments: args }, CallToolResultSchema, { signal: connectionSignal, timeout: 45_000 })), false), courseId, fileId);
      }
      return await work({ tools: moodleTools, ...(download ? { download } : {}),
        courses: async () => courses(await call("list_courses", {}, true)),
        files: async courseId => files(await call("list_files", { course_id: courseId }, true)),
        read: async (courseId, fileId) => text(await call("read_file", { course_id: courseId, file_id: fileId }, false), courseId),
      });
    } finally {
      closing = true;
      await transport.terminateSession().catch(() => {});
      await client.close().catch(() => {});
    }
  });
};

export async function downloadOriginal(call: (args: Record<string, unknown>) => Promise<unknown>, courseId: number, fileId: string) {
  const chunks: Buffer[] = []; let offset = 0; let checksum = ""; let size = 0; let filename = "";
  for (let page = 0; page < 51; page++) {
    const row = object(await call({ course_id: courseId, file_id: fileId, offset, length: 512 * 1024, sha256: checksum }));
    if (row.course_id !== courseId || row.offset !== offset || typeof row.filename !== "string" || typeof row.data_base64 !== "string" || row.data_base64.length > 700_000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.data_base64) || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)
      || !Number.isSafeInteger(row.filesize) || Number(row.filesize) <= 0 || Number(row.filesize) > 25 * 1024 * 1024 || typeof row.eof !== "boolean") throw invalidResult();
    if (!offset) { checksum = row.sha256; size = Number(row.filesize); filename = row.filename; }
    if (row.sha256 !== checksum || row.filesize !== size || row.filename !== filename) throw invalidResult();
    const chunk = Buffer.from(row.data_base64, "base64");
    if (!chunk.length || chunk.length > 512 * 1024 || chunk.toString("base64") !== row.data_base64 || offset + chunk.length > size) throw invalidResult();
    chunks.push(chunk); offset += chunk.length;
    if (row.eof) {
      const bytes = Buffer.concat(chunks);
      if (offset !== size || createHash("sha256").update(bytes).digest("hex") !== checksum) throw invalidResult();
      return { filename, bytes: new Uint8Array(bytes) };
    }
    if (offset >= size) throw invalidResult();
  }
  throw invalidResult();
}
