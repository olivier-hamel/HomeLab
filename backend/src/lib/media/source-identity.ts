import type { SearchContext, Source } from "./prowlarr.ts";

export type SourceTarget = SearchContext & { title: string; year?: string; originalTitle?: string; alternativeTitles?: string[]; overview?: string; companies?: string[] };
export type Identity = "match" | "uncertain" | "mismatch";
type IdentityCheck = { identity: Identity; reason: string };

// Compare whole names, not shared words: "Maids Obsession" is not "Obsession".
function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
const releaseMarker = /\b((?:19|20)\d{2}|s\d{1,3}(?:e\d{1,4})?|\d{1,3}x\d{1,4}|\d{3,4}p|4k|8k|bluray|blu ray|web|webrip|hdtv|dvdrip|dvd|brrip|bdrip|remux|h ?26[45]|x26[45]|hevc|aac\d*|mp4|mkv)\b/i;
const releaseSuffix = /^(?:(?:19|20)\d{2}|s\d{1,3}(?:e\d{1,4})?|\d{1,3}x\d{1,4}|\d{3,4}p|4k|8k|bluray|blu|web|webrip|hdtv|dvdrip|dvd|brrip|bdrip|remux|h|h26[45]|x26[45]|hevc|aac\d*|mp4|mkv|complete|season|extended|unrated|uncut|remastered|directors|theatrical|proper|repack|multi|dual|english|eng|french|german|spanish|italian|japanese|korean|hindi|tamil|telugu|tagalog|dubbed|subbed)(?: |$)/i;

export function queryTarget(query: string, context?: SearchContext): SourceTarget {
  const text = normalize(query);
  // A number can be part of the title (1917, 2001: A Space Odyssey).
  const start = text.indexOf(" ") + 1;
  const marker = start ? text.slice(start).match(releaseMarker) : null;
  const cut = marker ? start + marker.index! : text.length;
  const title = text.slice(0, cut).trim() || text;
  const suffix = text.slice(cut);
  const episode = suffix.match(/\bs(\d{1,3})(?:e(\d{1,4}))?\b/i) ?? suffix.match(/\b(\d{1,3})x(\d{1,4})\b/);
  const year = suffix.match(/\b((?:19|20)\d{2})\b/)?.[1];
  return { kind: episode ? "tv" : "movie", ...context, title, ...(year ? { year } : {}),
    ...(episode ? { season: Number(episode[1]), ...(episode[2] ? { episode: Number(episode[2]) } : {}) } : {}) };
}

export function sourceIdentity(source: Source, target?: SourceTarget, context?: SearchContext): IdentityCheck {
  const requested = target ?? context;
  const episode = source.title.match(/\bS(\d{1,3})(?:E(\d{1,4}))?\b/i) ?? source.title.match(/\b(\d{1,3})x(\d{1,4})\b/i);
  if (requested?.kind === "movie" && episode) return { identity: "mismatch", reason: "This listing is a TV release, but you selected a movie." };
  if (requested?.kind === "tv" && episode && ((requested.season !== undefined && Number(episode[1]) !== requested.season) || (requested.episode !== undefined && episode[2] && Number(episode[2]) !== requested.episode))) {
    return { identity: "mismatch", reason: "The listing names a different season or episode from your selection." };
  }
  if (!target) return { identity: "match", reason: "" };
  const ids = source.titleIds;
  const idKeys = ["imdbId", "tmdbId", "tvdbId"] as const;
  const sameId = (key: typeof idKeys[number]) => key === "imdbId" ? Number(ids?.imdbId?.slice(2)) === Number(target.imdbId?.slice(2)) : ids?.[key] === target[key];
  if (ids && idKeys.some(key => ids[key] !== undefined && target[key] !== undefined && !sameId(key))) {
    return { identity: "mismatch", reason: "The indexer's title ID belongs to a different movie or show." };
  }
  const idMatch = ids && idKeys.some(key => ids[key] !== undefined && target[key] !== undefined && sameId(key));
  const names = [...new Set([target.title, target.originalTitle ?? "", ...target.alternativeTitles ?? []].flatMap(name => [normalize(name), normalize(name.replace(/[’']/g, " "))]).filter(Boolean))].sort((a, b) => b.length - a.length);
  const title = normalize(source.title);
  if (!names.length) return { identity: "uncertain", reason: "The requested title is unclear, so this release cannot be recommended." };
  const name = names.find(name => title === name || (title.startsWith(`${name} `) && releaseSuffix.test(title.slice(name.length + 1))));
  if (!name) return { identity: "mismatch", reason: "The listing's full title does not match the selected title or its known alternate names." };
  const suffix = title.slice(name.length).trim();
  const year = suffix.match(/\b((?:19|20)\d{2})\b/)?.[1];
  // A TV episode's release year can differ from the series' first-air year.
  if (target.kind === "movie" && target.year && year && target.year !== year) return { identity: "mismatch", reason: "The release year belongs to a different version of the selected movie." };
  if (target.kind === "movie" && target.year && !year && !idMatch) return { identity: "uncertain", reason: "The title matches, but a release year or matching title ID is needed to distinguish this movie." };
  if (target.kind === "tv" && target.season !== undefined && !episode) return { identity: "uncertain", reason: "The show title matches, but this listing does not establish the requested season or episode." };
  return { identity: "match", reason: "" };
}
