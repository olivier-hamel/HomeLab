import { useEffect, useState } from "react";
import { mediaApi } from "../../lib/media";

type WelcomeCopy = { line1: string; line2: string };
const fallback: WelcomeCopy = { line1: "Pick something great.", line2: "We'll take care of the rest." };

export default function Welcome() {
  const [copy, setCopy] = useState(fallback);
  useEffect(() => {
    const controller = new AbortController();
    void mediaApi<WelcomeCopy>("welcome", AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
      .then(value => {
        if (!controller.signal.aborted && typeof value.line1 === "string" && value.line1.trim() && typeof value.line2 === "string" && value.line2.trim()) setCopy(value);
      })
      .catch(() => { /* Welcome copy never blocks browsing or playback. */ });
    return () => controller.abort();
  }, []);

  return <div className="simple-welcome">
    <p className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">{copy.line1}<br /><span className="text-neutral-400">{copy.line2}</span></p>
    <p className="mt-4 text-sm text-neutral-400 sm:text-base">Choose a movie and settle in. Your best available version starts automatically.</p>
  </div>;
}
