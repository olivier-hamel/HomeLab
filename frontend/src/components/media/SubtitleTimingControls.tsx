import { useId, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";

export default function SubtitleTimingControls({ offset, onChange }: { offset: number; onChange: (offset: number) => void }) {
  const id = useId();
  const [step, setStep] = useState(0.5);
  const adjust = (direction: number) => onChange(Math.round((offset + direction * step) * 10) / 10);

  return <div role="group" aria-label="Subtitle timing" aria-describedby={`${id}-help`} className="max-w-xl space-y-3 rounded-lg border border-neutral-700 bg-neutral-950/60 p-3 sm:p-4">
    <div>
      <p className="text-sm font-medium text-white">Sync subtitles</p>
    </div>
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
      <Button variant="outline" className="h-auto min-h-12 flex-col gap-1 whitespace-normal px-2 py-3 text-center" aria-label={`Show subtitles ${step} seconds earlier`} onClick={() => adjust(-1)}>
        <span className="flex items-center gap-1"><ArrowLeft aria-hidden="true" className="hidden sm:block" />Earlier</span>
        <span className="text-xs font-normal text-neutral-400">If text is late</span>
      </Button>
      <div className="flex min-w-20 flex-col items-center justify-center px-1">
        <output aria-label="Subtitle offset" aria-live="polite" aria-atomic="true" className="text-lg font-semibold tabular-nums text-orange-400">{offset > 0 ? "+" : ""}{offset.toFixed(1)} s</output>
        <span className="text-xs text-neutral-400">{offset === 0 ? "Original timing" : offset > 0 ? "Later" : "Earlier"}</span>
      </div>
      <Button variant="outline" className="h-auto min-h-12 flex-col gap-1 whitespace-normal px-2 py-3 text-center" aria-label={`Show subtitles ${step} seconds later`} onClick={() => adjust(1)}>
        <span className="flex items-center gap-1">Later<ArrowRight aria-hidden="true" className="hidden sm:block" /></span>
        <span className="text-xs font-normal text-neutral-400">If text is early</span>
      </Button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-step`} className="text-xs text-neutral-400">Adjust by</label>
        <select id={`${id}-step`} value={step} onChange={event => setStep(Number(event.target.value))} className="h-10 rounded border border-neutral-600 bg-neutral-900 px-2 text-sm text-white">
          {[0.1, 0.5, 1, 5].map(value => <option key={value} value={value}>{value} s</option>)}
        </select>
      </div>
      <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => onChange(0)}><RotateCcw aria-hidden="true" />Reset timing</Button>
    </div>
  </div>;
}
