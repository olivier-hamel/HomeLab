import { useRef, useState } from "react";
import { useTvMode } from "../../lib/tv";

function timestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export default function PlaybackTimeline({ duration, position, onSeek }: { duration: number; position: number; onSeek: (seconds: number) => void }) {
  const tvMode = useTvMode();
  const [preview, setPreview] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const dragging = useRef(false);
  const current = Math.min(duration, Math.max(0, preview ?? position));
  const commit = () => {
    const target = pending.current;
    pending.current = null;
    setPreview(null);
    if (target !== null) onSeek(Math.min(target, Math.max(0, duration - 1)));
  };

  return <div className="space-y-1 rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-medium text-neutral-200">Full video timeline</span>
      <span className="tabular-nums text-neutral-400"><span className="text-orange-400">{timestamp(current)}</span> / {timestamp(duration)}</span>
    </div>
    <input type="range" min={0} max={duration} step={1} value={current}
      aria-label="Seek through full video" aria-valuetext={`${timestamp(current)} of ${timestamp(duration)}`}
      className="block h-8 w-full cursor-pointer touch-none accent-orange-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
      onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
      onChange={event => {
        const target = Number(event.currentTarget.value);
        pending.current = target;
        setPreview(target);
        // Assistive technology can change the value without pointer or keyboard events.
        if (!dragging.current) commit();
      }}
      onPointerUp={() => { dragging.current = false; commit(); }}
      onPointerCancel={() => { dragging.current = false; pending.current = null; setPreview(null); }}
      onKeyDown={event => {
        if (tvMode && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
        const delta = { ArrowLeft: -10, ArrowDown: -10, ArrowRight: 10, ArrowUp: 10, PageDown: -60, PageUp: 60 }[event.key];
        if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        const target = event.key === "Home" ? 0 : event.key === "End" ? duration : Math.min(duration, Math.max(0, (pending.current ?? current) + delta!));
        pending.current = target;
        setPreview(target);
      }}
      onKeyUp={event => { if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) commit(); }}
      onBlur={() => { dragging.current = false; commit(); }} />
    <div aria-hidden="true" className="flex justify-between text-[10px] tabular-nums text-neutral-500">
      {[0, 0.25, 0.5, 0.75, 1].map(fraction => <span key={fraction}>{timestamp(duration * fraction)}</span>)}
    </div>
  </div>;
}
