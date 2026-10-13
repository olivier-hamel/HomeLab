import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, CalendarDays, Clapperboard, Maximize2, Menu, Minimize2, X } from "lucide-react";
import { Button } from "./components/ui/button";
import TV from "./pages/TV";
import Memo from "./pages/Memo";
import Calendar from "./pages/Calendar";
import { useTvMode } from "./lib/tv";
import useTvNavigation from "./components/useTvNavigation";
import { hasNativeVideoPlayer, isNativeApp } from "./native";
import AccountControls from "./components/AccountControls";

const buildTag = "2026.09.10-native-4";

const sections = [
  { id: "calendar", icon: CalendarDays, label: "Calendar", component: Calendar },
  { id: "tv", icon: Clapperboard, label: "TV & Movies", component: TV },
  { id: "memo", icon: BookOpen, label: "Mémo", component: Memo },
] as const;

export default function App() {
  const tvMode = useTvMode();
  useTvNavigation(tvMode);
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]["id"]>(() => {
    const requested = new URLSearchParams(location.search).get("section");
    return !tvMode ? sections.find(section => section.id === requested)?.id || "calendar" : "tv";
  });
  const [tvFooterActions, setTvFooterActions] = useState<HTMLDivElement | null>(null);
  const [sidebarKeyboardFocus, setSidebarKeyboardFocus] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [fullscreenView, setFullscreenView] = useState(false);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const navigationButton = useRef<HTMLButtonElement>(null);
  const exitFullscreen = useCallback(() => {
    setFullscreenView(false);
    requestAnimationFrame(() => (window.matchMedia("(max-width: 767px)").matches ? navigationButton.current : fullscreenButton.current)?.focus());
  }, []);
  const selectedSection = sections.find((section) => section.id === activeSection)!;
  const Page = selectedSection.component;

  useEffect(() => {
    if (!fullscreenView) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.fullscreenElement && !document.querySelector("dialog[open]")) exitFullscreen();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [fullscreenView, exitFullscreen]);

  if (tvMode) {
    return <div className="tv-shell">
      <main key={activeSection} id="dashboard-content" tabIndex={-1} className="tv-page-enter min-w-0 flex-1 focus:outline-none">
        <TV footerActions={tvFooterActions} />
      </main>
      <footer className="tv-footer">
        <div ref={setTvFooterActions} className="tv-footer-actions" />
        <AccountControls />
        <span data-build-tag="">
          BUILD {buildTag} · {hasNativeVideoPlayer() ? "NATIVE PLAYER READY" : isNativeApp() ? "NATIVE PLUGIN MISSING" : "WEB PLAYER"}
        </span>
      </footer>
    </div>;
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden md:flex-row">
      <a href="#dashboard-content" className="sr-only z-50 bg-orange-500 p-3 text-white focus:not-sr-only focus:absolute">
        Skip to dashboard
      </a>
      <aside
        className={`dashboard-sidebar w-full shrink-0 border-b border-neutral-700 bg-neutral-900 transition-[width] duration-300 md:w-70 md:border-b-0 md:border-r ${fullscreenView ? "hidden" : ""}`}
        data-keyboard-focus={sidebarKeyboardFocus}
        onFocusCapture={event => setSidebarKeyboardFocus(event.target.matches(":focus-visible"))}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setSidebarKeyboardFocus(false);
        }}
      >
        <div className="dashboard-sidebar-header flex h-20 items-center justify-between gap-2 px-4">
          <span className="dashboard-sidebar-mark hidden text-lg font-bold tracking-wider text-orange-500" aria-hidden="true">HL</span>
          <div className="dashboard-sidebar-brand whitespace-nowrap">
            <p className="text-lg font-bold tracking-wider text-orange-500">HOMELAB</p>
            <p className="text-xs text-neutral-500">Work In Progress</p>
          </div>
          <Button
            ref={navigationButton}
            variant="ghost"
            size="icon"
            aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileMenuOpen}
            aria-controls="dashboard-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="text-neutral-400 hover:text-orange-500 md:hidden"
          >
            {mobileMenuOpen ? <X /> : <Menu />}
          </Button>
        </div>

        <div className={`dashboard-sidebar-content ${mobileMenuOpen ? "block" : "hidden"} max-h-[60svh] overflow-y-auto px-4 pb-4 md:block md:max-h-none`}>
          <AccountControls />
          <nav id="dashboard-navigation" aria-label="Dashboard sections" className="space-y-2">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-label={section.label}
                aria-current={activeSection === section.id ? "page" : undefined}
                title={section.label}
                onClick={() => {
                  setActiveSection(section.id);
                  const url = new URL(location.href);
                  url.searchParams.set("section", section.id);
                  history.replaceState(null, "", url);
                  setMobileMenuOpen(false);
                }}
                className={`dashboard-sidebar-link flex w-full items-center gap-3 rounded p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 ${activeSection === section.id ? "bg-orange-500 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
              >
                <section.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="dashboard-sidebar-label whitespace-nowrap text-sm font-medium">{section.label}</span>
              </button>
            ))}
          </nav>

          <button
            ref={fullscreenButton}
            type="button"
            aria-label="Enter fullscreen view"
            title="Fullscreen view"
            aria-controls="dashboard-content"
            onClick={() => { setFullscreenView(true); setMobileMenuOpen(false); setSidebarKeyboardFocus(false); }}
            className="dashboard-sidebar-link mt-4 flex w-full items-center gap-3 rounded p-3 text-left text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
          >
            <Maximize2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="dashboard-sidebar-label whitespace-nowrap text-sm font-medium">Fullscreen view</span>
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main id="dashboard-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-auto focus:outline-none">
          {activeSection === "memo" ? <Memo onEscape={fullscreenView ? exitFullscreen : undefined} /> : activeSection === "calendar" ? <Calendar onEscape={fullscreenView ? exitFullscreen : undefined} /> : <Page />}
        </main>
      </div>
      {fullscreenView && <Button
        variant="outline"
        aria-label="Exit fullscreen view"
        title="Exit fullscreen view (Esc)"
        onClick={exitFullscreen}
        className="fixed bottom-4 right-4 z-50 gap-2 border-neutral-600 bg-neutral-900/95 text-neutral-200 shadow-lg hover:bg-neutral-800 hover:text-white"
      >
        <Minimize2 /><span className="hidden sm:inline">Exit fullscreen</span>
      </Button>}
    </div>
  );
}
