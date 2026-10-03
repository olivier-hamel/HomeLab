import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Bell, BookOpen, Boxes, Clapperboard, ListChecks, Maximize2, Menu, Minimize2, Monitor, RefreshCw, Server, X } from "lucide-react";
import { Button } from "./components/ui/button";
import Overview from "./pages/Overview";
import Guests from "./pages/Guests";
import Tasks from "./pages/Tasks";
import Backups from "./pages/Backups";
import Infrastructure from "./pages/Infrastructure";
import TV from "./pages/TV";
import Memo from "./pages/Memo";
import { useTvMode } from "./lib/tv";
import useTvNavigation from "./components/useTvNavigation";
import { hasNativeVideoPlayer, isNativeApp } from "./native";

const buildTag = "2026.09.10-native-4";

const sections = [
  { id: "overview", icon: Monitor, label: "OVERVIEW", component: Overview },
  { id: "guests", icon: Boxes, label: "VMS & CONTAINERS", component: Guests },
  { id: "tasks", icon: ListChecks, label: "TASKS", component: Tasks },
  { id: "backups", icon: Archive, label: "BACKUPS", component: Backups },
  { id: "infrastructure", icon: Server, label: "INFRASTRUCTURE", component: Infrastructure },
  { id: "tv", icon: Clapperboard, label: "TV & Movies", component: TV },
  { id: "memo", icon: BookOpen, label: "Mémo", component: Memo },
] as const;

export default function App() {
  const tvMode = useTvMode();
  useTvNavigation(tvMode);
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]["id"]>(() => {
    const requested = new URLSearchParams(location.search).get("section");
    return !tvMode ? sections.find(section => section.id === requested)?.id || "overview" : "tv";
  });
  const [tvFooterActions, setTvFooterActions] = useState<HTMLDivElement | null>(null);
  const [sidebarKeyboardFocus, setSidebarKeyboardFocus] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [fullscreenView, setFullscreenView] = useState(false);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const exitFullscreen = useCallback(() => {
    setFullscreenView(false);
    requestAnimationFrame(() => fullscreenButton.current?.focus());
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
        {activeSection === "overview" && <h1 className="sr-only">Homelab overview</h1>}
        {activeSection === "tv" ? <TV footerActions={tvFooterActions} /> : <Page />}
      </main>
      <footer className="tv-footer">
        {activeSection === "tv" && <div ref={setTvFooterActions} className="tv-footer-actions" />}
        <label htmlFor="tv-dashboard-section">Dashboard</label>
        <select id="tv-dashboard-section" value={activeSection} onChange={event => setActiveSection(event.target.value as typeof activeSection)}>
          <option value="tv">TV &amp; Movies</option>
          {sections.filter(section => section.id !== "tv" && section.id !== "memo").map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
        </select>
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

          {activeSection !== "tv" && activeSection !== "memo" && (
            <div className="dashboard-sidebar-sample mt-8 hidden rounded border border-neutral-700 bg-neutral-800 p-4 md:block">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                <span className="text-xs text-white">CLUSTER ONLINE</span>
              </div>
              <div className="space-y-1 text-xs text-neutral-500">
                <p>UPTIME: 12 DAYS</p>
                <p>NODES: 3 ONLINE</p>
                <p>GUESTS: 6 RUNNING</p>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className={`dashboard-header ${fullscreenView ? "hidden" : "flex"} h-16 shrink-0 items-center justify-between gap-3 border-b border-neutral-700 bg-neutral-800 px-4 sm:px-6`}>
          <p className="min-w-0 truncate text-xs text-neutral-400 sm:text-sm">
            <span className="hidden lg:inline">HOMELAB / </span>
            <span className="text-orange-500">{selectedSection.label}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {activeSection !== "tv" && activeSection !== "memo" && <>
              <span title="Sample data. Proxmox is not connected." className="rounded border border-orange-500/30 px-2 py-1 text-[10px] tracking-wider text-orange-400">SAMPLE DATA</span>
              <span className="hidden text-xs text-neutral-500 2xl:block">SAMPLE: 2026-09-05 16:45 UTC</span>
              <Button disabled title="Visual preview only" variant="ghost" size="icon" aria-label="Notifications (preview)" className="hidden text-neutral-400 sm:inline-flex">
                <Bell className="h-4 w-4" />
              </Button>
              <Button disabled title="Visual preview only" variant="ghost" size="icon" aria-label="Refresh (preview)" className="hidden text-neutral-400 sm:inline-flex">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>}
            <Button
              ref={fullscreenButton}
              variant="ghost"
              size="icon"
              aria-label="Enter fullscreen view"
              title="Fullscreen view"
              aria-controls="dashboard-content"
              onClick={() => { setFullscreenView(true); setMobileMenuOpen(false); setSidebarKeyboardFocus(false); }}
              className="shrink-0 text-neutral-400 hover:text-orange-500"
            >
              <Maximize2 />
            </Button>
          </div>
        </header>

        <main id="dashboard-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-auto focus:outline-none">
          {activeSection === "overview" && <h1 className="sr-only">Homelab overview</h1>}
          {activeSection === "memo" ? <Memo onEscape={fullscreenView ? exitFullscreen : undefined} /> : <Page />}
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
