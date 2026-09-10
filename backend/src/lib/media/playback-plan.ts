import { count, integer, list, MediaError, record, string } from "./core.ts";

type Track = {
  index: number; codec: string; profile: string; level: number; pixelFormat: string;
  depth: number; extra: Buffer; tag: string; width: number; height: number; frameRate: number;
};
export type MediaProbe = { container: string; duration: number | null; video: Track; audio?: Track };
export type PlaybackOption = {
  id: string; mode: "direct" | "remux" | "transcode"; mime: string;
  container: string; video: "copy" | "h264" | "vp9"; audio: "copy" | "aac" | "opus" | "none";
};
export type PlaybackInspection = { duration: number | null; video: string; audio: string | null; width: number; height: number; frameRate: number; options: PlaybackOption[] };

function extraData(value: unknown): Buffer {
  // ffprobe's hex dump has an offset and an ASCII column. Never parse the latter.
  const hex = string(value, 100_000).split("\n").map(line => line.split(":")[1]?.trim().split(/\s{2,}/)[0]?.replace(/\s/g, "") ?? "").join("");
  return /^[\da-f]*$/i.test(hex) ? Buffer.from(hex, "hex") : Buffer.alloc(0);
}
export function parseProbe(value: unknown, header: Buffer): MediaProbe {
  const data = record(value), format = record(data.format);
  const tracks = list(data.streams).map(record).filter(s => !record(s.disposition).attached_pic);
  const pick = (type: string) => {
    const matching = tracks.filter(s => s.codec_type === type);
    const s = matching.find(s => record(s.disposition).default === 1) ?? matching[0];
    if (!s) return;
    const pixelFormat = string(s.pix_fmt);
    const [numerator, denominator] = string(s.avg_frame_rate).split("/").map(Number);
    return { index: integer(s.index, 0, 1000), codec: string(s.codec_name), profile: string(s.profile), level: Number(s.level) || 0,
      pixelFormat, depth: Number(s.bits_per_raw_sample) || (/p(10|12)/.exec(pixelFormat)?.[1] ? Number(/p(10|12)/.exec(pixelFormat)![1]) : 8),
      extra: extraData(s.extradata), tag: string(s.codec_tag_string), width: Number(s.width) || 1920, height: Number(s.height) || 1080,
      frameRate: numerator > 0 && denominator > 0 ? numerator / denominator : 30 };
  };
  const video = pick("video");
  if (!video) throw new MediaError("probe", "No readable video track was found. Choose another file or use an external player.", 422);
  let container = string(format.format_name);
  if (container.includes("matroska")) {
    // Both containers share a demuxer; use the EBML DocType, never the filename.
    container = header.includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])) ? "webm" : "matroska";
  } else if (container.includes("mov")) container = string(record(format.tags).major_brand).trim() === "qt" ? "mov" : "mp4";
  return { container, video, audio: pick("audio"), duration: count(Number(format.duration)) || null };
}

function codec(track: Track, container: string): string | null {
  const { extra, profile, level } = track;
  switch (track.codec) {
    case "h264": {
      // AVCDecoderConfigurationRecord or Annex B SPS contains profile/constraints/level.
      let config = extra[0] === 1 ? extra.subarray(1, 4) : undefined;
      if (!config) {
        for (let i = 0; i + 6 < extra.length; i++) if (extra[i] === 0 && extra[i + 1] === 0 && extra[i + 2] === 1 && (extra[i + 3] & 31) === 7) { config = extra.subarray(i + 4, i + 7); break; }
      }
      const profiles: Record<string, number> = { Baseline: 66, "Constrained Baseline": 66, Main: 77, High: 100, "High 10": 110, "High 4:2:2": 122, "High 4:4:4 Predictive": 244 };
      if (config?.length === 3) return `avc1.${config.toString("hex")}`;
      if (profiles[profile] && level > 0 && level < 256) return `avc1.${Buffer.from([profiles[profile], profile === "Constrained Baseline" ? 0xe0 : 0, level]).toString("hex")}`;
      return null;
    }
    case "hevc": {
      const tag = container === "mp4" ? "hvc1" : track.tag === "hev1" ? "hev1" : "hvc1";
      if (extra[0] === 1 && extra.length >= 13) {
        let compatibility = 0;
        for (let i = 0; i < 32; i++) compatibility = (compatibility * 2) + ((extra.readUInt32BE(2) >>> i) & 1);
        const constraints = [...extra.subarray(6, 12)];
        while (constraints.length && constraints.at(-1) === 0) constraints.pop();
        return `${tag}.${["", "A", "B", "C"][extra[1] >> 6]}${extra[1] & 31}.${compatibility.toString(16)}.${extra[1] & 32 ? "H" : "L"}${extra[12]}${constraints.map(n => `.${n.toString(16).padStart(2, "0")}`).join("")}`;
      }
      // ffprobe reports HEVC level_idc (e.g. 153 for 5.1).
      if (["Main", "Main 10"].includes(profile) && level > 0) return `${tag}.${profile === "Main" ? 1 : 2}.4.L${level}.B0`;
      return null;
    }
    case "vp8": return "vp8";
    case "vp9": return `vp09.${String(Number(/\d/.exec(profile)?.[0]) || 0).padStart(2, "0")}.${String(level > 0 ? level : 10).padStart(2, "0")}.${String(track.depth).padStart(2, "0")}`;
    case "av1": {
      if (extra.length >= 3 && (extra[0] & 0x80)) return `av01.${extra[1] >> 5}.${String(extra[1] & 31).padStart(2, "0")}${extra[2] & 128 ? "H" : "M"}.${String(track.depth).padStart(2, "0")}`;
      return level >= 0 && level <= 23 ? `av01.0.${String(level).padStart(2, "0")}M.${String(track.depth).padStart(2, "0")}` : null;
    }
    case "aac": {
      const profiles: Record<string, number> = { LC: 2, "HE-AAC": 5, "HE-AACv2": 29, Main: 1, SSR: 3, LTP: 4 };
      return profiles[profile] ? `mp4a.40.${profiles[profile]}` : null;
    }
    case "mp3": return "mp4a.69";
    case "ac3": return "ac-3";
    case "eac3": return "ec-3";
    case "opus": return "opus";
    case "vorbis": return "vorbis";
    case "flac": return "flac";
    case "theora": return "theora";
    default: return null;
  }
}
const containers: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", matroska: "video/x-matroska", avi: "video/x-msvideo", mpegts: "video/mp2t", mpeg: "video/mpeg", ogg: "video/ogg" };
const muxCodecs = {
  mp4: { video: ["h264", "hevc", "av1", "vp9"], audio: ["aac", "mp3", "ac3", "eac3", "opus", "flac"] },
  webm: { video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"] },
};
function h264Level(track: Track): number {
  const blocks = Math.ceil(track.width / 16) * Math.ceil(track.height / 16);
  const limits = [[30, 1620, 40500], [31, 3600, 108000], [32, 5120, 216000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040], [52, 36864, 2073600], [60, 139264, 4177920], [61, 139264, 8355840], [62, 139264, 16711680]];
  return limits.find(([, frame, rate]) => blocks <= frame && blocks * track.frameRate <= rate)?.[0] ?? 62;
}
export function inspectPlayback(probe: MediaProbe): PlaybackInspection {
  const options: PlaybackOption[] = [];
  const add = (container: string, video: PlaybackOption["video"], audio: PlaybackOption["audio"], direct = false) => {
    const v = video === "copy" ? codec(probe.video, container) : video === "h264" ? `avc1.6400${h264Level(probe.video).toString(16).padStart(2, "0")}` : "vp9";
    const a = audio === "none" ? null : audio === "copy" ? codec(probe.audio!, container) : audio === "aac" ? "mp4a.40.2" : "opus";
    if (!v || (audio !== "none" && !a) || !containers[container]) return;
    const mode = direct ? "direct" : video === "copy" && ["copy", "none"].includes(audio) ? "remux" : "transcode";
    options.push({ id: `${direct ? "direct" : container}-${video}-${audio}`, mode, container, video, audio, mime: `${containers[container]}; codecs="${[v, a].filter(Boolean).join(", ")}"` });
  };
  add(probe.container, "copy", probe.audio ? "copy" : "none", true);
  for (const container of ["mp4", "webm"] as const) {
    const copyVideo = muxCodecs[container].video.includes(probe.video.codec);
    const copyAudio = !probe.audio || muxCodecs[container].audio.includes(probe.audio.codec);
    const video = container === "mp4" ? "h264" : "vp9";
    const audio = !probe.audio ? "none" : container === "mp4" ? "aac" : "opus";
    if (copyVideo && copyAudio) add(container, "copy", probe.audio ? "copy" : "none");
    if (copyVideo && probe.audio) add(container, "copy", audio);
    if (copyAudio) add(container, video, probe.audio ? "copy" : "none");
    if (probe.audio) add(container, video, audio);
  }
  const cost = (o: PlaybackOption) => o.mode === "direct" ? 0 : 1 + (o.video !== "copy" ? 100 : 0) + (!["copy", "none"].includes(o.audio) ? 10 : 0);
  options.sort((a, b) => cost(a) - cost(b));
  return { duration: probe.duration, video: probe.video.codec, audio: probe.audio?.codec ?? null, width: probe.video.width, height: probe.video.height, frameRate: probe.video.frameRate, options };
}
export function choosePlayback(inspection: PlaybackInspection, supported: unknown): PlaybackOption {
  if (!Array.isArray(supported) || supported.length > 20 || supported.some(id => typeof id !== "string" || id.length > 64)) throw new MediaError("input", "Invalid browser playback capabilities.", 400);
  const option = inspection.options.find(o => supported.includes(o.id));
  if (!option) throw new MediaError("codec", "This browser does not report support for the available playback formats. Use an external player.", 422);
  return option;
}

// Arguments are server-generated and passed directly to spawn, never to a shell.
export const inputArguments = (url: string) => ["-protocol_whitelist", "http,tcp", "-format_whitelist", "mov,matroska,webm,avi,mpegts,mpeg,mpegvideo,ogg,asf,flv", "-rw_timeout", "90000000", "-probesize", "5000000", "-analyzeduration", "5000000", "-i", url];
export function conversionArguments(url: string, probe: MediaProbe, option: PlaybackOption, start = 0): string[] {
  if (option.mode === "direct") throw new MediaError("input", "Direct playback does not require FFmpeg.", 400);
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", ...(start ? ["-ss", String(start)] : []), ...inputArguments(url),
    // Seek through TorrServer ranges, then discard pre-roll. Copied video resumes
    // at the next keyframe; encoded video uses FFmpeg's accurate input seeking.
    ...(start && option.video === "copy" ? ["-ss", "0"] : []), "-map", `0:${probe.video.index}`, ...(probe.audio ? ["-map", `0:${probe.audio.index}`] : ["-an"]),
    "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn", "-c:v", option.video === "copy" ? "copy" : option.video === "h264" ? "libx264" : "libvpx-vp9",
    ...(option.video === "h264" ? ["-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level:v", (h264Level(probe.video) / 10).toFixed(1), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-force_key_frames", "expr:gte(t,n_forced*2)"] : option.video === "vp9" ? ["-deadline", "realtime", "-cpu-used", "6", "-crf", "32", "-b:v", "0", "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*2)"] : []),
    ...(option.video !== "copy" ? ["-threads", "2"] : []),
    ...(option.audio === "none" ? [] : ["-c:a", option.audio === "copy" ? "copy" : option.audio === "aac" ? "aac" : "libopus", ...(!["copy", "none"].includes(option.audio) ? ["-b:a", "192k", "-ac", "2"] : [])]),
    // MPEG-TS AAC carries ADTS headers; fragmented MP4 requires AudioSpecificConfig.
    // This bitstream filter changes framing only, without decoding/re-encoding AAC.
    ...(option.container === "mp4" && option.audio === "copy" && probe.audio?.codec === "aac" ? ["-bsf:a", "aac_adtstoasc"] : []),
    ...(option.container === "mp4" && option.video === "copy" && probe.video.codec === "hevc" ? ["-tag:v", "hvc1"] : []),
    "-max_muxing_queue_size", "1024", "-avoid_negative_ts", "make_zero", "-f", option.container,
    ...(option.container === "mp4" ? ["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "2000000"] : ["-cluster_time_limit", "2000", "-live", "1"]), "pipe:1"];
}
