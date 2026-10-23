import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, CheckCheck, Clapperboard, Clock3, FolderOpen, House, Plus, RefreshCw, Search, Sun, Trash2, Video } from "lucide-react";
import { useAccount } from "../lib/account-context";
import { dateLabel, dayAfter, HOME_TIMEZONE, homeStoreFor, loadHomeAgenda, todayKey, plannerTasks, writeHomeTask, homeTaskInput, migrateHomeTasks, applyTaskCompletion } from "../lib/home";
import type { CalendarEvent, CalendarModel } from "../lib/home";
import type { Navigate } from "../lib/navigation";
import "./home.css";

const apps = [
  { id: "calendar", name: "Tempo", detail: "Organiser mon temps", icon: CalendarDays, color: "sage" },
  { id: "memo", name: "Mémo", detail: "Apprendre et réviser", icon: BookOpen, color: "violet" },
  { id: "library", name: "Bibliothèque", detail: "Retrouver mes documents", icon: FolderOpen, color: "blue" },
  { id: "tv", name: "TV & Movies", detail: "Faire une pause", icon: Clapperboard, color: "peach" },
  { id: "camera", name: "Caméra", detail: "Un œil sur la maison", icon: Video, color: "green" },
] as const;
type Agenda = { status: "loading" | "ready" | "error"; events: CalendarEvent[]; model?: CalendarModel };

export default function Home({ onNavigate }: { onNavigate: Navigate }) {
  const { user } = useAccount();
  const [store] = useState(() => homeStoreFor(user.username));
  const { preferences } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [now, setNow] = useState(() => new Date());
  const [agenda, setAgenda] = useState<Agenda>({ status: "loading", events: [] });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [taskError, setTaskError] = useState("");
  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const agendaVersion = useRef(0);
  const taskOperation = useRef(false);
  const newTaskRequest = useRef<{ title: string; id: string } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const taskInput = useRef<HTMLInputElement>(null);
  const taskList = useRef<HTMLUListElement>(null);
  const today = todayKey(now);
  const todayTasks = plannerTasks(agenda.events, today, showCompleted, agenda.model);
  const completed = todayTasks.filter(task => task.completed).length;
  const remaining = todayTasks.length - completed;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: HOME_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const hour = Number(time.slice(0, 2));
  const greeting = hour < 12 ? "Bonjour" : hour < 17 ? "Bon après-midi" : "Bonsoir";
  const events = agenda.model?.eventsOnDate(agenda.events.filter(event => event.kind !== "task"), today) || [];
  const tomorrow = dayAfter(today, 1);
  const upcoming = agenda.model?.eventsInRange(agenda.events.filter(event => event.kind !== "task"), tomorrow, dayAfter(today, 14)) || [];
  const next = events.find(event => !event.allDay && (event.endDate > today || event.endTime > time));
  const engine = preferences.searchEngine;
  const engineLabel = engine === "google" ? "Google" : "DuckDuckGo";
  const openEvent = (event: CalendarEvent, date = today) => onNavigate("calendar", { date, view: "day", event: event.id });

  useEffect(() => {
    search.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const load = () => {
      if (taskOperation.current) return;
      const id = ++agendaVersion.current;
      void loadHomeAgenda(controller.signal).then(result => {
        if (!controller.signal.aborted && id === agendaVersion.current) setAgenda({ status: "ready", ...result });
      }).catch(() => {
        if (!controller.signal.aborted && id === agendaVersion.current) setAgenda({ status: "error", events: [] });
      });
    };
    const visible = () => { if (!document.hidden) { setNow(new Date()); load(); } };
    void migrateHomeTasks(store, user.username, todayKey()).then(() => { if (!controller.signal.aborted) { setTaskError(previous => previous.startsWith("Certaines anciennes tâches") ? "" : previous); load(); } }).catch(() => {
      if (!controller.signal.aborted) { setTaskError("Certaines anciennes tâches attendent leur transfert. Réessaie pour les enregistrer dans Tempo."); load(); }
    });
    const timer = setInterval(visible, 60_000);
    document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [attempt, user.username, store]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      try { if (event.storageArea === localStorage) store.sync(event.key); } catch { /* Storage is optional. */ }
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))) {
        event.preventDefault(); search.current?.focus();
      }
    };
    window.addEventListener("storage", sync);
    window.addEventListener("keydown", shortcut);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("keydown", shortcut); };
  }, [store]);

  async function taskAction(id: string, work: () => Promise<{ event?: CalendarEvent }>, message: string, optimistic?: Partial<CalendarEvent>) {
    if (taskOperation.current) return;
    taskOperation.current = true; ++agendaVersion.current;
    const focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTaskBusy(id); setTaskError("");
    const previousTask = agenda.events.find(event => event.id === id);
    if (optimistic) setAgenda(previous => ({ ...previous, events: previous.events.map(event => event.id === id ? applyTaskCompletion(event, !!optimistic.completed, optimistic.completedAt || null, optimistic.occurrenceDate) : event) }));
    try {
      const result = await work();
      setAgenda(previous => ({ ...previous, events: result.event ? [...previous.events.filter(event => event.id !== result.event!.id), result.event] : previous.events.filter(event => event.id !== id) }));
      setAnnouncement(message);
      return true;
    } catch (error) {
      if (optimistic && previousTask) setAgenda(previous => ({ ...previous, events: previous.events.map(event => event.id === id ? previousTask : event) }));
      setTaskError(error instanceof Error ? error.message : "La tâche n’a pas pu être enregistrée.");
      setAttempt(value => value + 1);
      return false;
    } finally {
      taskOperation.current = false; setTaskBusy(null);
      requestAnimationFrame(() => { if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true }); });
    }
  }

  function pending() {
    return <div className="start-empty" role="status"><CalendarDays size={28} /><p>{agenda.status === "error" ? "Ton agenda est momentanément indisponible." : "Chargement de ton agenda…"}</p>{agenda.status === "error" && <button className="start-text-button" onClick={() => { setAgenda({ status: "loading", events: [] }); setAttempt(value => value + 1); }}><RefreshCw size={15} /> Réessayer</button>}</div>;
  }

  return <div className="start-app" aria-label="Accueil">
    <div className="start-container">
      <header className="start-topbar"><span className="start-wordmark"><House size={18} /> Accueil<span className="start-wordmark-dot">.</span></span><span className="start-zone"><span /> Toronto <span className="start-zone-divider">/</span> {time}</span></header>

      <section className="start-hero" aria-labelledby="start-title">
        <div className="start-hero-copy"><p className="start-eyebrow">{dateLabel(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p><h1 id="start-title">{greeting},<br /><span>{user.display_name}.</span></h1><p className="start-hero-subtitle">Une nouvelle page pour ta journée.</p><div className="start-summary"><span><CheckCheck size={16} /> {remaining} tâche{remaining > 1 ? "s" : ""} à faire</span><span><CalendarDays size={16} /> {agenda.status === "ready" ? `${events.length} événement${events.length > 1 ? "s" : ""} aujourd’hui` : agenda.status === "error" ? "Agenda indisponible" : "Ton agenda arrive"}</span></div></div>
        <div className="start-day-art" aria-hidden="true"><div className="start-orbit start-orbit-one" /><div className="start-orbit start-orbit-two" /><Sun className="start-art-sun" /><div className="start-date-card"><span>{dateLabel(today, { weekday: "long" })}</span><strong>{dateLabel(today, { day: "numeric" })}</strong><span>{dateLabel(today, { month: "long" })}</span><div><span /><span /><span /></div></div></div>
      </section>

      <form className="start-search" role="search" aria-label="Rechercher sur le Web" action={engine === "google" ? "https://www.google.com/search" : "https://duckduckgo.com/"} method="get" target="_top" onSubmit={event => {
        if (!query.trim()) { event.preventDefault(); search.current?.setCustomValidity("Écris quelque chose à rechercher."); search.current?.reportValidity(); }
        else if (search.current) search.current.value = query.trim();
      }}>
        <Search size={20} aria-hidden="true" /><label className="sr-only" htmlFor="start-search-input">Rechercher sur le Web</label><input ref={search} id="start-search-input" name="q" type="search" placeholder="Une idée, une question, une recherche…" value={query} onChange={event => { event.target.setCustomValidity(""); setQuery(event.target.value); }} autoComplete="off" enterKeyHint="search" required />
        <label className="sr-only" htmlFor="start-engine">Moteur de recherche</label><select id="start-engine" value={engine} onChange={event => store.setSearchEngine(event.target.value as typeof engine)}><option value="google">Google</option><option value="duckduckgo">DuckDuckGo</option></select><kbd aria-hidden="true">/</kbd><button type="submit" aria-label={`Rechercher avec ${engineLabel}`}><ArrowRight size={19} /></button>
      </form>

      <nav className="start-launcher" aria-label="Mes applications">{apps.map(app => <button key={app.id} className={`start-launch start-${app.color}`} onClick={() => onNavigate(app.id)}><span className="start-launch-icon"><app.icon size={21} /></span><span><strong>{app.name}</strong><small>{app.detail}</small></span><ArrowUpRight size={16} /></button>)}</nav>

      <div className="start-main-grid">
        <section className="start-panel start-tasks" aria-labelledby="start-tasks-title"><header className="start-panel-heading"><div><p className="start-eyebrow">Une chose à la fois</p><h2 id="start-tasks-title">Mes tâches<span className="start-count">{remaining}</span></h2></div><span className="start-progress-label">{completed}/{todayTasks.length}</span></header>
          <div className="start-progress" role="progressbar" aria-label="Tâches terminées" aria-valuemin={0} aria-valuemax={Math.max(1, todayTasks.length)} aria-valuenow={completed}><span style={{ width: `${todayTasks.length ? completed / todayTasks.length * 100 : 0}%` }} /></div>
          {agenda.status === "loading" ? <p role="status">Chargement des tâches…</p> : agenda.status === "error" ? pending() : todayTasks.length ? <ul ref={taskList} className="start-task-list">{todayTasks.map(task => <li key={`${task.id}:${task.occurrenceDate || ""}`} className={task.completed ? "is-complete" : undefined}><label><input type="checkbox" checked={!!task.completed} disabled={!!taskBusy} aria-label={`${task.completed ? "Remettre à faire" : "Terminer"} : ${task.title}`} onChange={() => { void taskAction(task.id, () => writeHomeTask(`events/${task.id}`, "PATCH", { completed: !task.completed, updatedAt: task.updatedAt, ...(task.recurrence ? { occurrenceDate: task.occurrenceDate } : {}) }), task.completed ? "Tâche remise à faire." : "Tâche terminée.", { completed: !task.completed, completedAt: task.completed ? null : new Date().toISOString(), occurrenceDate: task.occurrenceDate }); }} /><span className="start-task-check" aria-hidden="true"><Check size={14} /></span></label><button className="start-task-details" onClick={() => openEvent(task, task.deadline?.date || today)}><strong>{task.title}</strong><small>{task.deadline ? `${task.deadline.date < today && !task.completed ? "En retard · " : ""}${dateLabel(task.deadline.date, { day: "numeric", month: "short" })}${task.deadline.time ? ` · ${task.deadline.time}` : ""}` : "Sans échéance"}{task.context ? ` · ${task.context.name}` : ""}{task.recurrence ? " · Récurrente" : ""}</small></button><button disabled={!!taskBusy} aria-label={`${task.recurrence ? "Gérer la suppression de la série" : "Supprimer la tâche"} : ${task.title}`} onClick={() => { if (task.recurrence) { openEvent(task, task.deadline?.date || today); return; } void taskAction(task.id, () => writeHomeTask(`events/${task.id}`, "DELETE", { updatedAt: task.updatedAt }), "Tâche supprimée."); }}><Trash2 size={15} /></button></li>)}</ul> : <div className="start-task-empty"><span><CheckCheck size={25} /></span><h3>Fais de la place à l’essentiel.</h3><p>Ajoute les petites choses que tu veux accomplir.</p></div>}
          {taskError && <p role="alert" className="start-task-error">{taskError}</p>}
          <form className="start-task-form" onSubmit={event => { event.preventDefault(); if (!draft.trim() || taskOperation.current) return; const title = draft.trim(); if (newTaskRequest.current?.title !== title) newTaskRequest.current = { title, id: crypto.randomUUID() }; const requestId = newTaskRequest.current.id; void taskAction("new", () => writeHomeTask("events", "POST", { requestId, event: homeTaskInput(title, today) }), "Tâche ajoutée.").then(saved => { if (saved) { newTaskRequest.current = null; setDraft(""); requestAnimationFrame(() => taskInput.current?.focus()); } }); }}><Plus size={17} aria-hidden="true" /><label htmlFor="start-task-input" className="sr-only">Ajouter une tâche pour aujourd’hui</label><input ref={taskInput} id="start-task-input" value={draft} onChange={event => { event.target.setCustomValidity(""); setDraft(event.target.value); }} placeholder="Ajouter une tâche pour aujourd’hui…" maxLength={160} required autoComplete="off" disabled={!!taskBusy || agenda.status !== "ready"} /><button type="submit" aria-label="Ajouter la tâche" disabled={!!taskBusy || agenda.status !== "ready"}><ArrowRight size={17} /></button></form>
          <footer className="start-panel-note"><label><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)} /> Voir les terminées</label><button className="start-text-button" onClick={() => onNavigate("calendar", { date: today, create: true })}>Créer avec le dialogue <ArrowUpRight size={13} /></button><span>Enregistrées dans Tempo · privées à ton compte</span></footer>
        </section>

        <section className="start-panel start-agenda" aria-labelledby="start-agenda-title"><header className="start-panel-heading"><div><p className="start-eyebrow">Ton temps, en un coup d’œil</p><h2 id="start-agenda-title">Le fil de la journée</h2></div><button className="start-round-button" aria-label="Voir la journée dans Tempo" onClick={() => onNavigate("calendar", { date: today, view: "day" })}><ArrowUpRight size={19} /></button></header>
          {agenda.status !== "ready" ? pending() : events.length ? <div className="start-agenda-list">{events.slice(0, 5).map(event => {
            const ended = !event.allDay && event.endDate === today && event.endTime <= time;
            const ongoing = !event.allDay && !ended && (event.date < today || event.startTime <= time);
            return <button key={`${event.id}-${event.date}`} className={`start-agenda-event ${ended ? "is-past" : ""} ${ongoing ? "is-current" : ""}`} onClick={() => openEvent(event)}><span className="start-event-time">{event.allDay ? "Journée" : event.date < today ? "Se poursuit" : agenda.model?.timeLabel(event.startTime, preferences.timeFormat)}<span className="start-timeline-dot" /></span><span className="start-event-copy"><strong>{event.title}</strong><small>{agenda.model?.eventTime(event, preferences.timeFormat)}</small>{event.description && <small className="start-event-description">{event.description}</small>}{ongoing || event === next ? <span className="start-event-badge">{ongoing ? "En cours" : "À suivre"}</span> : null}</span><ArrowUpRight size={15} /></button>;
          })}{events.length > 5 && <button className="start-text-button" onClick={() => onNavigate("calendar", { date: today, view: "day" })}>Voir les {events.length} événements <ArrowRight size={15} /></button>}</div> : <div className="start-empty"><Sun size={30} /><h3>Du temps pour toi.</h3><p>Aucun événement prévu aujourd’hui.</p><button className="start-text-button" onClick={() => onNavigate("calendar", { date: today, create: true })}>Prévoir un moment <Plus size={15} /></button></div>}
          <footer className="start-agenda-footer"><Clock3 size={14} /><span>Ton agenda Tempo, toujours au même endroit.</span></footer>
        </section>
      </div>

      <section className="start-panel start-upcoming" aria-labelledby="start-upcoming-title"><header className="start-panel-heading"><div><p className="start-eyebrow">Un peu plus loin</p><h2 id="start-upcoming-title">À l’horizon</h2></div><button className="start-text-button" onClick={() => onNavigate("calendar", { date: today, view: "week" })}>Ouvrir Tempo <ArrowRight size={15} /></button></header>
        <div className="start-week" aria-label="Les sept prochains jours">{Array.from({ length: 7 }, (_, index) => {
          const day = dayAfter(today, index), count = agenda.model?.eventsOnDate(agenda.events, day).length;
          return <button key={day} aria-label={`Voir le ${dateLabel(day, { weekday: "long", day: "numeric", month: "long" })}${agenda.status === "ready" ? `, ${count} événement${count !== 1 ? "s" : ""}` : ""}`} aria-current={day === today ? "date" : undefined} onClick={() => onNavigate("calendar", { date: day, view: "day" })}><span>{dateLabel(day, { weekday: "short" })}</span><strong>{dateLabel(day, { day: "numeric" })}</strong><span className={count ? "has-events" : ""} /></button>;
        })}<p>Les 14<br />prochains jours<span>{agenda.status === "ready" ? `${upcoming.length} événement${upcoming.length > 1 ? "s" : ""}` : ""}</span></p></div>
        {agenda.status !== "ready" ? pending() : upcoming.length ? <div className="start-upcoming-list">{upcoming.slice(0, 3).map(event => {
          const day = event.date < tomorrow ? tomorrow : event.date;
          return <button key={`${event.id}-${event.date}`} onClick={() => openEvent(event, day)}><span className="start-upcoming-date"><strong>{dateLabel(day, { day: "numeric" })}</strong><small>{dateLabel(day, { month: "short" })}</small></span><span className="start-event-copy"><strong>{event.title}</strong><small>{event.date < tomorrow ? "Se poursuit" : day === tomorrow ? "Demain" : dateLabel(day, { weekday: "long" })} · {agenda.model?.eventTime(event, preferences.timeFormat)}</small></span><ArrowUpRight size={17} /></button>;
        })}</div> : <p className="start-upcoming-empty">Rien de prévu pour les 14 prochains jours. La suite reste à écrire.</p>}
      </section>
      <footer className="start-footer"><span>Ton espace. Ta journée.</span><span>HOMELAB <span aria-hidden="true">↗</span></span></footer>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
  </div>;
}
