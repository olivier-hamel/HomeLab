import { useEffect } from "react";

function scrollContainer(from: Element | null): HTMLElement | null {
  const scope = document.fullscreenElement ?? document.querySelector("dialog[open]");
  if (scope instanceof HTMLVideoElement) return null;
  // Never let a dialog's scroll escape into the page behind it.
  if (scope && (!from || !scope.contains(from))) return scope as HTMLElement;
  for (let element = from; element && element !== document.body && element !== document.documentElement; element = element.parentElement) {
    if (element instanceof HTMLElement && element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY)) return element;
    if (element === scope) break;
  }
  return (scope ?? document.scrollingElement) as HTMLElement | null;
}

export function scrollTvPage(direction: -1 | 1, from: Element | null = null, distance?: number): boolean {
  const container = scrollContainer(from);
  if (!container) return false;
  const before = container.scrollTop;
  const height = container === document.scrollingElement ? window.innerHeight : container.clientHeight;
  container.scrollBy({ top: direction * (distance ?? height * 0.7), behavior: "auto" });
  return container.scrollTop !== before;
}

export default function useTvScrolling(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    let previous = 0;
    let started = 0;
    let lastDirection = 0;
    let lastContainer: HTMLElement | null = null;
    const stop = () => { cancelAnimationFrame(frame); frame = 0; pointer = null; lastDirection = 0; };
    const tick = (now: number) => {
      frame = 0;
      if (!pointer || document.hidden || document.fullscreenElement) return;
      const target = document.elementFromPoint(pointer.x, pointer.y);
      if (target?.closest(".tv-footer, [data-tv-scroll-controls], input, select, textarea, video, [contenteditable='true']")) return;
      const container = scrollContainer(target);
      if (!container) return;
      const isPage = container === document.scrollingElement;
      const bounds = container.getBoundingClientRect();
      if (!isPage && (pointer.x < bounds.left || pointer.x > bounds.right)) return;
      const top = isPage ? 0 : Math.max(0, bounds.top);
      const bottom = isPage ? window.innerHeight : Math.min(window.innerHeight, bounds.bottom);
      const edge = Math.min(72, (bottom - top) / 4);
      const direction = pointer.y >= bottom - edge && pointer.y <= bottom ? 1 : pointer.y >= top && pointer.y < top + edge ? -1 : 0;
      if (!direction) { lastDirection = 0; return; }
      if (direction !== lastDirection || container !== lastContainer) {
        started = now; lastDirection = direction; lastContainer = container;
      }
      // A brief dwell lets the user click a control near the edge without moving it.
      if (now - started > 350) {
        const distance = Math.min(50, now - previous) * 0.45;
        if (!scrollTvPage(direction, target, distance)) return;
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    const move = (event: MouseEvent) => {
      if (event.buttons) { stop(); return; }
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) { lastDirection = 0; frame = requestAnimationFrame(tick); }
    };
    const leave = (event: MouseEvent) => { if (!event.relatedTarget) stop(); };
    document.addEventListener("mousemove", move, { passive: true });
    document.addEventListener("mouseout", leave);
    document.addEventListener("mousedown", stop);
    document.addEventListener("keydown", stop);
    document.addEventListener("wheel", stop, { passive: true });
    document.addEventListener("visibilitychange", stop);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("mousedown", stop);
      document.removeEventListener("keydown", stop);
      document.removeEventListener("wheel", stop);
      document.removeEventListener("visibilitychange", stop);
      window.removeEventListener("blur", stop);
    };
  }, [enabled]);
}
