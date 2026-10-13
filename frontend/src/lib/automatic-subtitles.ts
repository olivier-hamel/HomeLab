import { mediaApi, type SearchIntent, type TorrentFile } from "./media.ts";
import { rankEnglishSubtitles, rankSubtitleFiles, subtitleSearch, subtitleVtt, type SubtitleDownload, type SubtitleSearch } from "./subtitles.ts";

// Shared by desktop and the native player: prefer captions packaged with the release.
export async function loadEnglishSubtitles(playbackId: string, filename: string, files: TorrentFile[], search: SearchIntent | undefined, cancellation: AbortSignal) {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(100_000)]);
  const deadline = (ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  signal.throwIfAborted();
  const bundled = rankSubtitleFiles(files.filter(file => file.kind === "subtitle").map(file => ({ ...file, name: file.path })), filename, search, true);
  for (const file of bundled.slice(0, 3)) {
    try {
      const response = await fetch(`/api/media/subtitles/${playbackId}/${file.id}`, { signal: deadline(15_000), credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("The included subtitles could not be downloaded.");
      const content = subtitleVtt(await response.arrayBuffer(), file.path);
      signal.throwIfAborted();
      return { name: file.path, content };
    } catch { signal.throwIfAborted(); }
  }
  const result = await mediaApi<SubtitleSearch>("subtitles/search", deadline(20_000), { id: playbackId, ...subtitleSearch(filename, search), language: "EN" });
  for (const choice of rankEnglishSubtitles(result.results, filename, search).slice(0, 3)) {
    try {
      const download = await mediaApi<SubtitleDownload>("subtitles/download", deadline(30_000), { id: playbackId, choice: choice.id });
      for (const file of rankSubtitleFiles(download.files, filename, search)) {
        try {
          const content = subtitleVtt(Uint8Array.from(atob(file.content), c => c.charCodeAt(0)).buffer, file.name);
          signal.throwIfAborted();
          return { name: file.name, content };
        } catch { signal.throwIfAborted(); }
      }
    } catch { signal.throwIfAborted(); }
  }
  signal.throwIfAborted();
  throw new Error("English subtitles aren't available for this version right now. Try again in a moment.");
}
