// Older Silk releases support AbortController but lack these newer static helpers.
// Leave native implementations intact on current desktop/TV browsers.
export function installAbortSignalFallbacks() {
  if (typeof AbortSignal.timeout !== "function") {
    AbortSignal.timeout = (milliseconds: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    };
  }
  if (typeof AbortSignal.any !== "function") {
    AbortSignal.any = (signals: AbortSignal[]) => {
      const controller = new AbortController();
      const listeners = new Map<AbortSignal, () => void>();
      const abort = (signal: AbortSignal) => {
        controller.abort(signal.reason);
        for (const [source, listener] of listeners) source.removeEventListener("abort", listener);
        listeners.clear();
      };
      for (const signal of signals) {
        if (signal.aborted) { abort(signal); break; }
        if (!listeners.has(signal)) {
          const listener = () => abort(signal);
          listeners.set(signal, listener);
          signal.addEventListener("abort", listener, { once: true });
        }
      }
      return controller.signal;
    };
  }
}
