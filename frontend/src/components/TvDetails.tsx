import { useEffect, useRef, type ComponentProps } from "react";
import { useTvMode } from "../lib/tv";

// Animate the native disclosure itself; its children keep their layout and state.
export default function TvDetails(props: ComponentProps<"details">) {
  const panel = useRef<HTMLDetailsElement>(null);
  const tvMode = useTvMode();
  useEffect(() => {
    const element = panel.current;
    const summary = element?.querySelector("summary");
    if (!tvMode || !element || !summary) return;
    let animation: Animation | undefined;
    let expanded = element.open;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const restore = () => {
      element.style.height = "";
      element.style.overflow = "";
      delete element.dataset.tvClosing;
    };
    const settle = () => {
      animation?.cancel();
      animation = undefined;
      element.open = expanded;
      restore();
    };
    const toggle = () => {
      const from = element.getBoundingClientRect().height;
      animation?.cancel();
      restore();
      expanded = !expanded;
      if (motion.matches || typeof element.animate !== "function") {
        element.open = expanded;
        return;
      }
      element.open = expanded;
      const to = element.getBoundingClientRect().height;
      element.open = true;
      // Hidden descendants must not receive D-pad focus during a collapse.
      if (!expanded) {
        element.dataset.tvClosing = "true";
        summary.focus({ preventScroll: true });
      }
      element.style.overflow = "hidden";
      element.style.height = `${from}px`;
      animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: expanded ? 260 : 180,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
      animation.onfinish = settle;
    };
    const click = (event: MouseEvent) => { event.preventDefault(); toggle(); };
    const dismiss = () => { if (expanded) toggle(); };
    summary.addEventListener("click", click);
    element.addEventListener("tv:close-details", dismiss);
    motion.addEventListener("change", settle);
    return () => {
      animation?.cancel();
      restore();
      summary.removeEventListener("click", click);
      element.removeEventListener("tv:close-details", dismiss);
      motion.removeEventListener("change", settle);
    };
  }, [tvMode]);
  return <details {...props} ref={panel} data-tv-disclosure="" />;
}
