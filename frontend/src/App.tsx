import { useState } from "react";
import { Archive, Bell, Boxes, ChevronRight, Clapperboard, ListChecks, Menu, Monitor, RefreshCw, Server, X } from "lucide-react";
import { Button } from "./components/ui/button";
import Overview from "./pages/Overview";
import Guests from "./pages/Guests";
import Tasks from "./pages/Tasks";
import Backups from "./pages/Backups";
import Infrastructure from "./pages/Infrastructure";
import TV from "./pages/TV";
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
] as const;

export default function App() {
  const tvMode = useTvMode();
  useTvNavigation(tvMode);
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]["id"]>(tvMode ? "tv" : "overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const selectedSection = sections.find((section) => section.id === activeSection)!;
  const Page = selectedSection.component;

  if (tvMode) {
    return <div className="tv-shell">
      <main id="dashboard-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
        {activeSection === "overview" && <h1 className="sr-only">Homelab overview</h1>}
        <Page />
      </main>
      <footer className="tv-footer">
        <label htmlFor="tv-dashboard-section">Dashboard</label>
        <select id="tv-dashboard-section" value={activeSection} onChange={event => setActiveSection(event.target.value as typeof activeSection)}>
          <option value="tv">TV &amp; Movies</option>
          {sections.filter(section => section.id !== "tv").map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
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
      <aside className={`w-full shrink-0 border-b border-neutral-700 bg-neutral-900 transition-[width] duration-300 md:border-b-0 md:border-r ${sidebarCollapsed ? "md:w-16" : "md:w-70"}`}>
        <div className={`flex h-20 items-center justify-between gap-2 px-4 ${sidebarCollapsed ? "md:justify-center md:px-2" : ""}`}>
          <div className={sidebarCollapsed ? "md:hidden" : ""}>
            <p className="text-lg font-bold tracking-wider text-orange-500">HOMELAB</p>
            <p className="text-xs text-neutral-500">Work In Progress</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            className="hidden shrink-0 text-neutral-400 hover:text-orange-500 md:inline-flex"
          >
            <ChevronRight className={`h-5 w-5 transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`} />
          </Button>
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

        <div className={`${mobileMenuOpen ? "block" : "hidden"} max-h-[60svh] overflow-y-auto px-4 pb-4 md:block md:max-h-none ${sidebarCollapsed ? "md:px-2" : ""}`}>
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
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 ${sidebarCollapsed ? "md:justify-center" : ""} ${activeSection === section.id ? "bg-orange-500 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-white"}`}
              >
                <section.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className={`text-sm font-medium ${sidebarCollapsed ? "md:hidden" : ""}`}>{section.label}</span>
              </button>
            ))}
          </nav>

          {!sidebarCollapsed && activeSection !== "tv" && (
            <div className="mt-8 hidden rounded border border-neutral-700 bg-neutral-800 p-4 md:block">
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
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-neutral-700 bg-neutral-800 px-4 sm:px-6">
          <p className="min-w-0 truncate text-xs text-neutral-400 sm:text-sm">
            <span className="hidden lg:inline">HOMELAB / </span>
            <span className="text-orange-500">{selectedSection.label}</span>
          </p>
          {activeSection !== "tv" && <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <span title="Sample data. Proxmox is not connected." className="rounded border border-orange-500/30 px-2 py-1 text-[10px] tracking-wider text-orange-400">SAMPLE DATA</span>
            <span className="hidden text-xs text-neutral-500 2xl:block">SAMPLE: 2026-09-05 16:45 UTC</span>
            <Button disabled title="Visual preview only" variant="ghost" size="icon" aria-label="Notifications (preview)" className="hidden text-neutral-400 sm:inline-flex">
              <Bell className="h-4 w-4" />
            </Button>
            <Button disabled title="Visual preview only" variant="ghost" size="icon" aria-label="Refresh (preview)" className="hidden text-neutral-400 sm:inline-flex">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>}
        </header>

        <main id="dashboard-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-auto focus:outline-none">
          {activeSection === "overview" && <h1 className="sr-only">Homelab overview</h1>}
          <Page />
        </main>
      </div>
    </div>
  );
}
