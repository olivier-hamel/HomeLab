import { useEffect, useRef, type RefObject } from "react";

// The browser owns cue parsing and timing; this layer only controls placement.
// getCueAsHTML preserves supported VTT formatting without treating files as HTML.
export default function SubtitleOverlay({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = video.current;
    const container = overlay.current;
    if (!element || !container) return;
    const tracks = new Set<TextTrack>();
    const render = () => {
      const captions: HTMLDivElement[] = [];
      for (const track of element.textTracks) {
        if (track.mode === "disabled" || !["subtitles", "captions"].includes(track.kind)) continue;
        for (const cue of track.activeCues ?? []) {
          const line = document.createElement("div");
          line.className = "cinema-caption-line";
          if (cue instanceof VTTCue) line.append(cue.getCueAsHTML());
          captions.push(line);
        }
      }
      container.replaceChildren(...captions);
    };
    const sync = () => {
      for (const track of tracks) {
        if (!Array.from(element.textTracks).includes(track)) { track.removeEventListener("cuechange", render); tracks.delete(track); }
      }
      for (const track of element.textTracks) {
        if (!tracks.has(track)) { tracks.add(track); track.addEventListener("cuechange", render); }
      }
      render();
    };
    element.textTracks.addEventListener("addtrack", sync);
    element.textTracks.addEventListener("removetrack", sync);
    element.textTracks.addEventListener("change", render);
    element.addEventListener("loadedmetadata", sync);
    element.addEventListener("timeupdate", render);
    sync();
    return () => {
      for (const track of tracks) track.removeEventListener("cuechange", render);
      element.textTracks.removeEventListener("addtrack", sync);
      element.textTracks.removeEventListener("removetrack", sync);
      element.textTracks.removeEventListener("change", render);
      element.removeEventListener("loadedmetadata", sync);
      element.removeEventListener("timeupdate", render);
      container.replaceChildren();
    };
  }, [video]);
  return <div ref={overlay} className="cinema-captions" aria-hidden="true" />;
}
