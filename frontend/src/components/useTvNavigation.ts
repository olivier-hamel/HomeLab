import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { nearestControl, useTvMode, type Direction } from "../lib/tv";
import useTvScrolling, { scrollTvPage } from "./useTvScrolling";

const selector = "button, a[href], input, select, textarea, summary, video[controls], [tabindex]";

function controls(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(element => {
    if (element.tabIndex < 0 || element.matches(":disabled") || element.closest("[inert], [hidden], [aria-hidden='true']")) return false;
    const closingDisclosure = element.closest("details[data-tv-closing]");
    if (closingDisclosure && element !== closingDisclosure.querySelector("summary")) return false;
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && getComputedStyle(element).visibility !== "hidden";
  });
}

function focus(element: HTMLElement | undefined, smooth = false) {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
}

export function useTvFocus(ref: RefObject<HTMLElement | null>) {
  const enabled = useTvMode();
  const restoration = useRef(0);
  useLayoutEffect(() => {
    cancelAnimationFrame(restoration.current);
    if (!enabled || !ref.current) return;
    const parentScope = ref.current.parentElement?.closest("[data-tv-focus-scope]");
    ref.current.dataset.tvFocusScope = "";
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focus(ref.current.querySelector<HTMLElement>("[data-tv-initial-focus]") ?? controls(ref.current)[0]);
    // Wait for nested players/panels to detach before restoring their opener.
    return () => { restoration.current = requestAnimationFrame(() => {
      if (trigger?.isConnected && (!parentScope || parentScope.isConnected)) focus(trigger);
    }); };
  }, [enabled, ref]);
}

export default function useTvNavigation(enabled: boolean) {
  useTvScrolling(enabled);
  useEffect(() => {
    if (!enabled) return;
    const root = () => document.fullscreenElement ?? document.querySelector("dialog[open]") ?? document;
    let focusedScope: HTMLElement | null = null;
    let startupFocus: HTMLElement | null = null;
    let startupNavigationStarted = false;
    const focusin = (event: FocusEvent) => {
      focusedScope = event.target instanceof HTMLElement ? event.target.closest("[data-tv-focus-scope]") : null;
    };
    const initial = (scope: ParentNode = root()) => {
      const available = controls(scope);
      focus(available.find(element => element.hasAttribute("data-tv-initial-focus")) ?? available[0]);
    };
    const focusStartupTitle = () => {
      if (startupNavigationStarted) return;
      const title = controls(root()).find(element => element.hasAttribute("data-tv-startup-focus"));
      // More important rows (for example Continue Watching) can finish after the
      // catalogue. Follow the first card in document order until the user moves.
      if (title && title !== startupFocus) {
        startupFocus = title;
        focus(title);
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const text = active?.matches("textarea, input:not([type='range']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit'])") || active?.isContentEditable;
      const key = event.key && event.key !== "Unidentified" ? event.key : ({ 33: "PageUp", 34: "PageDown", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown" } as Record<number, string>)[event.keyCode];
      if (["PageUp", "PageDown", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Select", "Escape", "BrowserBack", "GoBack", "Backspace"].includes(key) || event.keyCode === 4 || event.keyCode === 23) startupNavigationStarted = true;
      if (key === "PageUp" || key === "PageDown") {
        if (!text && !active?.matches("select, input, video") && scrollTvPage(key === "PageUp" ? -1 : 1, active)) event.preventDefault();
        return;
      }
      if (["Escape", "BrowserBack", "GoBack", "Backspace"].includes(key) || event.keyCode === 4) {
        if (text) return;
        if (document.fullscreenElement) {
          event.preventDefault();
          void document.exitFullscreen().catch(() => {});
          return;
        }
        const dialog = document.querySelector("dialog[open]");
        const details = active?.closest("details[open]");
        if (dialog) {
          event.preventDefault();
          dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        } else if (details instanceof HTMLDetailsElement) {
          event.preventDefault();
          if (details.hasAttribute("data-tv-disclosure")) details.dispatchEvent(new Event("tv:close-details"));
          else details.open = false;
          focus(details.querySelector("summary") ?? undefined);
        } else {
          const back = document.querySelector<HTMLElement>("[data-tv-back]");
          if (back) { event.preventDefault(); back.click(); }
        }
        return;
      }
      // Standard Enter keeps native button/form/select behavior. Some remotes send Select instead.
      if (key === "Select" || event.keyCode === 23) {
        if (active && !text && !active.matches("select, video, input[type='range']")) { event.preventDefault(); active.click(); }
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
      const horizontal = key === "ArrowLeft" || key === "ArrowRight";
      if ((text && horizontal) || active?.isContentEditable) return;
      if (active?.matches("select") && !horizontal) return;
      if (active?.matches("input[type='range'], video") && (horizontal || document.fullscreenElement)) return;
      const available = controls(root());
      if (!active || !available.includes(active)) { event.preventDefault(); initial(); return; }
      const activeCard = active.closest(".title-card");
      const candidates = available.filter(element => element !== active
        // An overlaid info button must not steal movement to a different card.
        && !(element.matches(".catalogue-info-button") && element.closest(".title-card") !== activeCard))
        .map(element => ({ element, bounds: element.getBoundingClientRect() }));
      // Fixed scroll buttons must not interrupt navigation through offscreen rows.
      const next = nearestControl(active.getBoundingClientRect(), candidates.filter(({ element }) => !element.closest("[data-tv-scroll-controls]")), key as Direction);
      if (next) { event.preventDefault(); focus(next.element, true); }
      else if (!horizontal && scrollTvPage(key === "ArrowUp" ? -1 : 1, active, window.innerHeight * 0.2)) event.preventDefault();
      else {
        const toolbar = nearestControl(active.getBoundingClientRect(), candidates, key as Direction);
        if (toolbar) { event.preventDefault(); focus(toolbar.element); }
      }
    };
    const pointerdown = () => { startupNavigationStarted = true; };
    const restartStartupFocus = () => {
      startupNavigationStarted = false;
      startupFocus = null;
      requestAnimationFrame(focusStartupTitle);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", pointerdown);
    document.addEventListener("focusin", focusin);
    const frame = requestAnimationFrame(() => { initial(); focusStartupTitle(); });
    let recovery = 0;
    // Async results can remove the focused control. Recover only if focus was lost.
    const observer = new MutationObserver(() => {
      focusStartupTitle();
      if (!document.activeElement || document.activeElement === document.body || document.activeElement.matches(":disabled")) {
        cancelAnimationFrame(recovery);
        recovery = requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body || document.activeElement.matches(":disabled")) initial(focusedScope?.isConnected ? focusedScope : root());
        });
      }
    });
    window.addEventListener("homelab:tv-startup-focus", restartStartupFocus);
    observer.observe(document.getElementById("root")!, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(recovery); document.removeEventListener("keydown", keydown); document.removeEventListener("pointerdown", pointerdown); document.removeEventListener("focusin", focusin); window.removeEventListener("homelab:tv-startup-focus", restartStartupFocus); observer.disconnect(); };
  }, [enabled]);
}
