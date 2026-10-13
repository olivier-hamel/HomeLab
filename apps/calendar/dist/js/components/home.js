import {eventsOnDate, eventsInRange, eventCount, eventTime, timeLabel} from "../events.js";
import {WEEKDAYS, dateKey, addDays, parseDate, sameDay, formatDate, fullDate, currentMinutes} from "../date.js";
import {icon} from "./icons.js";
import {escapeHtml} from "../account.js";

function renderTasks(state) {
  const today = dateKey(state.today);
  const tasks = (state.tasks || []).filter(task => !task.completedDate || task.completedDate === today);
  const completed = tasks.filter(task => task.completedDate).length;
  return `<section class="home-tasks" aria-labelledby="tasks-title">
    <div class="home-section-heading"><h3 id="tasks-title">À faire</h3><span class="task-progress" role="status">${tasks.length ? `${completed} sur ${tasks.length} terminée${completed > 1 ? "s" : ""}` : "Une chose à la fois"}</span></div>
    ${tasks.length ? `<ul class="home-task-list">${tasks.map(task => `<li class="home-task ${task.completedDate ? "is-complete" : ""}"><label><input type="checkbox" data-task-id="${escapeHtml(task.id)}" ${task.completedDate ? "checked" : ""}/><span class="task-check" aria-hidden="true">${icon("check")}</span><span class="task-title">${escapeHtml(task.title)}</span></label><button type="button" class="task-remove" data-action="remove-task" data-task-id="${escapeHtml(task.id)}" aria-label="Supprimer la tâche : ${escapeHtml(task.title)}">${icon("close")}</button></li>`).join("")}</ul>` : '<p class="home-tasks-empty">Les petites choses à ne pas oublier.</p>'}
    <form id="home-task-form" class="home-task-form"><label class="sr-only" for="home-task-title">Ajouter une tâche pour aujourd’hui</label>${icon("plus")}<input id="home-task-title" name="title" type="text" placeholder="Ajouter une tâche…" maxlength="160" required autocomplete="off"/><button type="submit" aria-label="Ajouter la tâche">${icon("arrowRight")}</button></form>
    <p class="home-tasks-note">${state.tasksSaved ? "Enregistrées sur cet appareil" : "Conservées pour cette session"}</p>
  </section>`;
}

function renderAgenda(state, now) {
  const today = dateKey(state.today);
  const events = eventsOnDate(state.events, today);
  const minutes = currentMinutes(state.preferences.timezone, now);
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const next = events.find(event => !event.allDay && (event.endDate > today || event.endTime > time));
  return events.length ? `<div class="today-event-list">${events.slice(0, 4).map(event => {
    const ended = !event.allDay && event.endDate === today && event.endTime <= time;
    const ongoing = !event.allDay && !ended && (event.date < today || event.startTime <= time);
    const status = ongoing ? "En cours" : event === next ? "À suivre" : "";
    return `<button class="today-event ${ended ? "is-past" : ""} ${status ? "is-next" : ""}" data-action="open-event" data-event-id="${escapeHtml(event.id)}"><span class="today-event-marker" aria-hidden="true"></span><span class="today-event-copy"><strong>${escapeHtml(event.title)}</strong><span>${eventTime(event, state.preferences.timeFormat)}${event.description ? ` <span class="event-description">· ${escapeHtml(event.description)}</span>` : ""}</span></span>${status ? `<span class="today-event-status">${status}</span>` : icon("chevronRight")}</button>`;
  }).join("")}${events.length > 4 ? `<button class="home-text-link agenda-more" data-action="today-day">Voir les ${eventCount(events.length)} ${icon("arrowRight")}</button>` : ""}</div>` : `<div class="home-empty-state"><span class="home-empty-icon">${icon("sun")}</span><div><h3>Ta journée est libre.</h3><p>Tu n’as aucun événement prévu aujourd’hui.</p><button class="home-text-link" data-action="create-event">Prévoir un moment ${icon("plus")}</button></div></div>`;
}

export function renderHome(state, now = new Date()) {
  const today = state.today;
  const events = eventsOnDate(state.events, today);
  const ready = !state.eventsStatus || state.eventsStatus === "ready";
  const failed = state.eventsStatus === "error";
  const hour = currentMinutes(state.preferences.timezone, now) / 60;
  const baseGreeting = hour < 12 ? "Bonjour" : hour < 17 ? "Bon après-midi" : "Bonsoir";
  const greeting = state.account ? `${baseGreeting}, ${escapeHtml(state.account.display_name)}.` : `${baseGreeting}.`;
  const days = Array.from({length: 7}, (_, index) => addDays(today, index));
  const tomorrow = dateKey(addDays(today, 1));
  const upcoming = eventsInRange(state.events, tomorrow, dateKey(addDays(today, 14)));
  const engine = state.preferences.searchEngine === "duckduckgo" ? "duckduckgo" : "google";
  const engineLabel = engine === "google" ? "Google" : "DuckDuckGo";
  const action = engine === "google" ? "https://www.google.com/search" : "https://duckduckgo.com/";
  return `<div class="home-page">
    <section class="home-intro" aria-labelledby="home-title">
      <p class="home-date">${formatDate(today, {weekday: "long", month: "long", day: "numeric"})}</p>
      <h1 id="home-title" tabindex="-1">${greeting}</h1>
      <p class="home-subtitle">Tout commence ici.</p>
      <form id="home-search-form" class="home-search" role="search" aria-label="Rechercher sur le Web" action="${action}" method="get" target="_top">
        <label class="sr-only" for="home-search-input">Rechercher avec ${engineLabel}</label><span class="home-search-icon">${icon("search")}</span><input id="home-search-input" name="q" type="search" placeholder="Rechercher sur le Web…" required autocomplete="off" enterkeyhint="search" spellcheck="false"/><kbd class="search-key-hint" aria-hidden="true">/</kbd><button type="submit" class="home-search-submit" aria-label="Rechercher avec ${engineLabel}">${icon("arrowRight")}</button>
      </form>
      <fieldset class="search-engines"><legend class="sr-only">Moteur de recherche</legend><label><input id="search-google" type="radio" name="searchEngine" value="google" ${engine === "google" ? "checked" : ""}/><span><span class="search-engine-letter google-letter" aria-hidden="true">G</span>Google</span></label><label><input id="search-duckduckgo" type="radio" name="searchEngine" value="duckduckgo" ${engine === "duckduckgo" ? "checked" : ""}/><span><span class="search-engine-letter duck-letter" aria-hidden="true">D</span>DuckDuckGo</span></label></fieldset>
      <nav class="home-shortcuts" aria-label="Accès rapides"><button class="home-shortcut browse-calendar" data-action="month">${icon("calendar")}Calendrier</button><span aria-hidden="true"></span><button class="home-shortcut" data-action="documents">${icon("document")}Documents</button></nav>
    </section>
    <div class="home-grid">
      <section class="home-card today-card" aria-labelledby="agenda-title">
        <header class="home-card-header"><div class="home-card-heading"><span class="home-heading-icon">${icon("calendar")}</span><div><h2 id="agenda-title">Aujourd’hui</h2><p>${formatDate(today, {day: "numeric", month: "long"})}</p></div></div><button class="home-card-link" data-action="today-day" aria-label="Voir la journée d’aujourd’hui">${icon("arrowRight")}</button></header>
        <section class="home-agenda" aria-labelledby="today-agenda-title"><div class="home-section-heading"><h3 id="today-agenda-title">Ton agenda</h3><span>${ready ? eventCount(events.length) : failed ? "Indisponible" : "Chargement…"}</span></div>
          ${ready ? renderAgenda(state, now) : `<div class="home-calendar-pending"><span class="home-empty-icon">${icon("calendar")}</span><p>${failed ? "Ton agenda est momentanément indisponible." : "Ton agenda arrive…"}</p>${failed ? '<button class="home-text-link" data-action="events-retry">Réessayer</button>' : ""}</div>`}
        </section>
        ${renderTasks(state)}
      </section>
      <section class="home-card upcoming-card" aria-labelledby="upcoming-title">
        <header class="home-card-header"><div class="home-card-heading"><span class="home-heading-icon">${icon("week")}</span><div><h2 id="upcoming-title">À venir</h2><p>Les 14 prochains jours</p></div></div><button class="home-card-link" data-action="today-week" aria-label="Voir cette semaine">${icon("arrowRight")}</button></header>
        <div class="home-week-strip" aria-label="Les sept prochains jours">${days.map(date => {
          const dayEvents = eventsOnDate(state.events, date);
          return `<button class="home-week-day ${sameDay(date, today) ? "is-today" : ""}" data-action="open-day" data-date="${dateKey(date)}" aria-label="Voir le ${fullDate(date)}.${ready ? ` ${eventCount(dayEvents.length)}.` : ""}" ${sameDay(date, today) ? 'aria-current="date"' : ""}><span>${WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span><strong>${date.getUTCDate()}</strong><span class="week-day-dot ${ready && dayEvents.length ? "has-events" : ""}"></span></button>`;
        }).join("")}</div>
        ${ready ? upcoming.length ? `<div class="upcoming-event-list">${upcoming.slice(0, 3).map(event => {
          const displayDate = parseDate(event.date < tomorrow ? tomorrow : event.date);
          return `<button class="upcoming-event" data-action="open-event" data-event-id="${escapeHtml(event.id)}"><span class="upcoming-date"><strong>${displayDate.getUTCDate()}</strong><span>${formatDate(displayDate, {month: "short"})}</span></span><span class="upcoming-event-copy"><strong>${escapeHtml(event.title)}</strong><span>${event.date < tomorrow ? "Se poursuit" : event.date === tomorrow ? "Demain" : formatDate(displayDate, {weekday: "long"})} <span>·</span> ${event.allDay ? "Toute la journée" : timeLabel(event.startTime, state.preferences.timeFormat)}</span></span>${icon("chevronRight")}</button>`;
        }).join("")}</div><p class="upcoming-total">${eventCount(upcoming.length)} dans les 14 prochains jours</p>` : `<div class="upcoming-empty"><span class="upcoming-empty-art" aria-hidden="true">${icon("week")}<span>${icon("check")}</span></span><h3>De l’espace pour tes projets.</h3><p>Aucun événement dans les 14 prochains jours.<br>La suite se dessine à ton rythme.</p><button class="home-text-link" data-action="create-event">Ajouter un événement ${icon("plus")}</button></div>` : `<div class="home-calendar-pending upcoming-pending"><span class="home-empty-icon">${icon("week")}</span><p>${failed ? "Les événements à venir sont indisponibles." : "Chargement des prochains événements…"}</p></div>`}
        <footer class="home-card-footer"><button class="home-text-link" data-action="month">Voir le calendrier ${icon("arrowRight")}</button><span>${formatDate(today, {month: "long", year: "numeric"})}</span></footer>
      </section>
    </div>
    <p class="home-bottom-note">Un peu de clarté dans ta journée.</p>
  </div>`;
}
