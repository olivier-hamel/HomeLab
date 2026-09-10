import type { SearchContext, SearchIntent } from "./media";

export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

export type OnlineSubtitle = { id: string; name: string; release: string; language: string; fps: string; hearingImpaired: boolean; season: number | null; episode: number | null; archive: boolean };
export type SubtitleDownload = { files: { name: string; content: string }[] };
export type SubtitleSearch = { title: string; year: number | null; results: OnlineSubtitle[] };

export function subtitleSearch(file: string, intent?: SearchIntent): { query: string; context: SearchContext } {
  const name = file.replaceAll("\\", "/").split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const episode = /\bS(\d{1,3})E(\d{1,4})\b/i.exec(name.replaceAll("_", ".")) ?? /\b(\d{1,3})x(\d{1,4})\b/i.exec(name);
  const context: SearchContext = { kind: episode ? "tv" : "movie", ...intent?.context };
  if (episode) { context.kind = "tv"; context.season = Number(episode[1]); context.episode = Number(episode[2]); }
  const clean = name.replace(/[._]/g, " ").replace(/\b(?:S\d{1,3}E\d{1,4}|\d{1,3}x\d{1,4}|480p|720p|1080p|2160p|web[ -]?dl|webrip|bluray|brrip|hdtv|x26[45]|h26[45]|hevc)\b.*$/i, "").trim();
  return { query: (intent?.query || clean || name).slice(0, 250), context };
}

export function subtitleFormat(name: string): "srt" | "vtt" | null {
  return /\.srt$/i.test(name) ? "srt" : /\.vtt$/i.test(name) ? "vtt" : null;
}

const subtitleWords = (value: string) => value.toLowerCase().replace(/\.(?:mkv|mp4|avi|srt|vtt)$/i, "").replace(/web[ ._-]?dl/g, "webdl").replace(/blu[ ._-]?ray/g, "bluray").split(/[^a-z0-9]+/).filter(Boolean);
const subtitleEpisode = (name: string) => /\bS(\d{1,3})E(\d{1,4})\b/i.exec(name.replaceAll("_", ".")) ?? /\b(\d{1,3})x(\d{1,4})\b/i.exec(name);
// Language labels belong to a folder or the filename suffix, not words in a film title.
const englishName = /(?:^|[/\\ ._-])(?:en|eng|english)(?:[/\\]|(?:[ ._-](?:sdh|cc|forced))?\.(?:srt|vtt)$)/i;
const otherLanguage = /(?:^|[/\\ ._-])(?:french|spanish|german|italian|portuguese|russian|arabic|japanese|korean|chinese|dutch|hindi)(?:[/\\]|\.(?:srt|vtt)$)|[._-](?:fr|fre|fra|es|spa|de|ger|deu|it|ita|pt|por|ru|rus|ar|ara|ja|jpn|ko|kor|zh|chi|zho|nl|dut|hin)\.(?:srt|vtt)$/i;

function subtitleMatchScore(name: string, filename: string): number {
  const target = subtitleWords(filename.replaceAll("\\", "/").split("/").pop() ?? filename);
  const words = new Set(subtitleWords(name));
  const technical = new Set(["webdl", "webrip", "bluray", "brrip", "hdtv", "1080p", "720p", "2160p"]);
  return target.reduce((score, word, index) => score + (words.has(word) ? technical.has(word) ? 8 : index === target.length - 1 ? 12 : 2 : 0), 0);
}

export function rankEnglishSubtitles(results: OnlineSubtitle[], filename: string, intent?: SearchIntent): OnlineSubtitle[] {
  const { context } = subtitleSearch(filename, intent);
  return results.filter(item => {
    if (!/^(?:en|eng|english)$/i.test(item.language.trim())) return false;
    const episode = subtitleEpisode(`${item.name} ${item.release}`);
    const seasonNumber = item.season ?? (episode ? Number(episode[1]) : null);
    const episodeNumber = item.episode ?? (episode ? Number(episode[2]) : null);
    return context.kind !== "tv" || ((context.season === undefined || seasonNumber === null || seasonNumber === context.season) && (context.episode === undefined || episodeNumber === null || episodeNumber === context.episode));
  }).sort((a, b) => (subtitleMatchScore(`${b.release} ${b.name}`, filename) - Number(b.hearingImpaired)) - (subtitleMatchScore(`${a.release} ${a.name}`, filename) - Number(a.hearingImpaired)));
}

export function rankSubtitleFiles<T extends { name: string }>(files: T[], filename: string, intent?: SearchIntent, requireEnglishName = false): T[] {
  const { context } = subtitleSearch(filename, intent);
  return files.filter(file => {
    if (!subtitleFormat(file.name) || otherLanguage.test(file.name) || (requireEnglishName && !englishName.test(file.name))) return false;
    const episode = subtitleEpisode(file.name);
    // Never pick a different episode from an expanded season archive.
    if (context.kind === "tv" && context.episode !== undefined) {
      if (episode) return Number(episode[2]) === context.episode && (context.season === undefined || Number(episode[1]) === context.season);
      return files.length === 1;
    }
    return true;
  }).sort((a, b) => (subtitleMatchScore(b.name, filename) + Number(englishName.test(b.name)) * 5) - (subtitleMatchScore(a.name, filename) + Number(englishName.test(a.name)) * 5));
}

export function subtitleTiming(cues: Iterable<Pick<TextTrackCue, "startTime" | "endTime">>) {
  // Snapshot before editing: the browser reorders its live cue list as times change.
  // Keep original times so repeated adjustments and Reset never accumulate drift.
  const original = Array.from(cues, cue => ({ cue, start: cue.startTime, end: cue.endTime }));
  return (offset: number) => {
    for (const { cue, start, end } of original) {
      cue.startTime = start + offset;
      cue.endTime = end + offset;
    }
  };
}

// HTML text tracks consume WebVTT. Convert SRT timings, keeping cue markup as
// text-track payload (never HTML), and let the browser render and synchronize it.
export function subtitleVtt(bytes: ArrayBuffer, name: string): string {
  const format = subtitleFormat(name);
  if (!format) throw new Error("Choose an SRT or VTT subtitle file.");
  if (bytes.byteLength > MAX_SUBTITLE_BYTES) throw new Error("Subtitle files must be 2 MiB or smaller.");
  const prefix = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const encoding = prefix[0] === 0xff && prefix[1] === 0xfe ? "utf-16le" : prefix[0] === 0xfe && prefix[1] === 0xff ? "utf-16be" : "utf-8";
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim(); }
  catch { throw new Error("Subtitle encoding is unsupported. Save the file as UTF-8 and try again."); }
  if (format === "vtt") {
    if (!/^WEBVTT(?:[ \t][^\n]*)?\n\n/.test(text)) throw new Error("This file is not a valid WebVTT subtitle.");
    return `${text}\n`;
  }
  const cues: string[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*$/.exec(lines.shift()?.trim() ?? "");
    if (!match || !lines.some(line => line.trim())) continue;
    const start = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
    const end = Number(match[5]) * 3600 + Number(match[6]) * 60 + Number(match[7]) + Number(match[8]) / 1000;
    if (end <= start) continue;
    cues.push(`${match[1]}:${match[2]}:${match[3]}.${match[4]} --> ${match[5]}:${match[6]}:${match[7]}.${match[8]}\n${lines.join("\n")}`);
  }
  if (!cues.length) throw new Error("No readable subtitle cues were found in this SRT file.");
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
