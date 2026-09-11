import { useEffect, useRef, useState, type AnimationEvent, type RefObject } from "react";
import { useTvMode } from "../lib/tv";

// Keep the native dialog (and its focus trap) alive until its exit finishes.
// Playback actions still run immediately so browser user activation is preserved.
export default function useTvDialogMotion(panel: RefObject<HTMLDialogElement | null>, close: () => void) {
  const tvMode = useTvMode();
  const [closing, setClosing] = useState(false);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const dismiss = () => {
    if (pending.current) return;
    if (!tvMode || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      close();
      return;
    }
    pending.current = true;
    setClosing(true);
    // Fallback also covers an animation cancelled by a live reduced-motion change.
    timer.current = setTimeout(close, 200);
  };

  const finish = (event: AnimationEvent<HTMLDialogElement>) => {
    if (!pending.current || event.target !== panel.current || event.animationName !== "tv-dialog-out") return;
    clearTimeout(timer.current);
    close();
  };

  return { dismiss, closing, finish };
}
