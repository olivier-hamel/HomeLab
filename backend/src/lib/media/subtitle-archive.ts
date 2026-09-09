import { crc32, inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { MediaError } from "./core.ts";

export const SUBTITLE_LIMIT = 2 * 1024 * 1024;
export const ARCHIVE_LIMIT = 4 * 1024 * 1024;
const inflate = promisify(inflateRaw);
export type SubtitleContent = { name: string; content: string };
export const supportedSubtitle = (name: string) => /\.(srt|vtt)$/i.test(name);

// Read standard stored/deflated ZIPs in memory. Never extract paths to disk.
// Central-directory sizes, actual inflation output and CRC are checked separately.
export async function subtitleArchive(bytes: Uint8Array, signal: AbortSignal): Promise<SubtitleContent[]> {
  const data = Buffer.from(bytes);
  const invalid = () => new MediaError("subtitle_archive", "This subtitle ZIP is damaged or unsupported. Choose another release.", 422);
  if (data.length > ARCHIVE_LIMIT) throw new MediaError("too_large", "Subtitle ZIP files must be 4 MiB or smaller.", 413);
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65_557); end--) {
    if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length) break;
  }
  if (end < 0 || end < data.length - 65_557 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw invalid();
  const entries = data.readUInt16LE(end + 10);
  let cursor = data.readUInt32LE(end + 16);
  const directoryEnd = cursor + data.readUInt32LE(end + 12);
  if (entries > 100 || entries !== data.readUInt16LE(end + 8) || directoryEnd !== end) throw invalid();
  const files: SubtitleContent[] = [];
  let total = 0;
  for (let i = 0; i < entries; i++) {
    signal.throwIfAborted();
    if (cursor + 46 > directoryEnd || data.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const checksum = data.readUInt32LE(cursor + 16);
    const compressed = data.readUInt32LE(cursor + 20);
    const size = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32);
    const local = data.readUInt32LE(cursor + 42);
    if (next > directoryEnd || data.readUInt16LE(cursor + 34)) throw invalid();
    const rawName = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const basename = rawName.replaceAll("\\", "/").split("/").pop() ?? "";
    const name = [...basename].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("").slice(0, 250);
    cursor = next;
    if (!supportedSubtitle(name) || rawName.startsWith("__MACOSX/")) continue;
    if (files.length >= 30 || size > SUBTITLE_LIMIT || total + size > ARCHIVE_LIMIT) throw new MediaError("too_large", "This subtitle pack is too large. Choose an individual episode or a smaller release.", 413);
    if ((flags & 0x2041) || ![0, 8].includes(method) || local + 30 > directoryEnd || data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 8) !== method || data.readUInt16LE(local + 6) !== flags) throw invalid();
    const offset = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if (offset + compressed > data.readUInt32LE(end + 16)) throw invalid();
    let content: Buffer;
    try { content = method === 0 ? data.subarray(offset, offset + compressed) : await inflate(data.subarray(offset, offset + compressed), { maxOutputLength: SUBTITLE_LIMIT }); }
    catch { throw invalid(); }
    signal.throwIfAborted();
    if (content.length !== size || crc32(content) !== checksum) throw invalid();
    total += content.length;
    files.push({ name, content: content.toString("base64") });
  }
  if (cursor !== directoryEnd) throw invalid();
  if (!files.length) throw new MediaError("subtitle_format", "This release has no SRT or VTT subtitles. Choose another release.", 422);
  return files;
}
