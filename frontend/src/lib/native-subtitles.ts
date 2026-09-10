import { mediaApi, type SearchIntent, type TorrentFile } from "./media.ts";
import { subtitleFormat, subtitleSearch, subtitleVtt, type SubtitleDownload, type SubtitleSearch } from "./subtitles.ts";
import type { NativePlayerRequest } from "../native.ts";
import { loadEnglishSubtitles } from "./automatic-subtitles.ts";

type Choice = { kind: "torrent"; file: TorrentFile } | { kind: "online"; id: string } | { kind: "download"; file: SubtitleDownload["files"][number] };

// The native menus use the existing authenticated backend, including SubDL's
// scoped choice IDs and archive extraction. No provider key reaches the APK.
export function nativeSubtitleSession(playbackId: string, filename: string, files: TorrentFile[], search?: SearchIntent) {
  const choices = new Map<string, Choice>();
  const initial = subtitleSearch(filename, search);
  let automatic: Awaited<ReturnType<typeof loadEnglishSubtitles>> | undefined;
  let sequence = 0;
  const remember = (choice: Choice, name: string) => {
    const id = String(++sequence);
    choices.set(id, choice);
    return { id, name };
  };
  const caption = (file: SubtitleDownload["files"][number]) => ({
    subtitle: { name: file.name, content: subtitleVtt(Uint8Array.from(atob(file.content), character => character.charCodeAt(0)).buffer, file.name) },
  });
  return async (request: NativePlayerRequest, signal: AbortSignal): Promise<Record<string, unknown>> => {
    if (request.action === "subtitleAuto") {
      signal.throwIfAborted();
      automatic ??= await loadEnglishSubtitles(playbackId, filename, files, search, signal);
      signal.throwIfAborted();
      return { subtitle: automatic };
    }
    if (request.action === "subtitleFiles") {
      choices.clear();
      return { title: "Subtitles included with this torrent", choices: files.filter(file => file.kind === "subtitle" && subtitleFormat(file.path))
        .map(file => remember({ kind: "torrent", file }, file.path)), emptyMessage: "No SRT or VTT files in this torrent. Try online search or embedded tracks." };
    }
    if (request.action === "subtitleSearch") {
      choices.clear();
      const query = (request.query?.trim() || initial.query).slice(0, 250);
      const context = query === initial.query ? initial.context : {
        kind: initial.context.kind, season: initial.context.season, episode: initial.context.episode,
      };
      const result = await mediaApi<SubtitleSearch>("subtitles/search", signal, { id: playbackId, query, context, language: request.language || "EN" });
      return { title: "Choose a subtitle release", choices: result.results.map(item => remember({ kind: "online", id: item.id }, item.release || item.name)),
        emptyMessage: "No subtitles found. Try another title or language." };
    }
    if (request.action !== "subtitleChoice") throw new Error("Unknown subtitle action.");
    const choice = choices.get(request.choice ?? "");
    if (!choice) throw new Error("This subtitle choice expired. Search again.");
    if (choice.kind === "download") return caption(choice.file);
    if (choice.kind === "torrent") {
      const response = await fetch(`/api/media/subtitles/${playbackId}/${choice.file.id}`, { signal, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("The included subtitles could not be downloaded. Try again.");
      return { subtitle: { name: choice.file.path, content: subtitleVtt(await response.arrayBuffer(), choice.file.path) } };
    }
    const download = await mediaApi<SubtitleDownload>("subtitles/download", signal, { id: playbackId, choice: choice.id });
    const usable = download.files.filter(file => subtitleFormat(file.name));
    if (usable.length === 1) return caption(usable[0]);
    choices.clear();
    return { title: "Choose the movie or episode subtitle", choices: usable.map(file => remember({ kind: "download", file }, file.name)),
      emptyMessage: "This download contains no SRT or VTT subtitles." };
  };
}
