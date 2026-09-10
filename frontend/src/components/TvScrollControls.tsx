import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "./ui/button";
import { scrollTvPage } from "./useTvScrolling";

export default function TvScrollControls({ dialog = false }: { dialog?: boolean }) {
  const target = dialog ? "dialog" : "page";
  return <div data-tv-scroll-controls="" className={`tv-scroll-controls ${dialog ? "tv-dialog-scroll-controls" : "tv-page-scroll-controls"}`} role="group" aria-label={dialog ? "Dialog scrolling" : "Page scrolling"}>
    <Button type="button" variant="outline" aria-label={`Scroll ${target} up`} onClick={event => scrollTvPage(-1, event.currentTarget)}><ArrowUp />Up</Button>
    <Button type="button" variant="outline" aria-label={`Scroll ${target} down`} onClick={event => scrollTvPage(1, event.currentTarget)}><ArrowDown />Down</Button>
  </div>;
}
