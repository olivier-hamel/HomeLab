import {eventsOnDate, eventsInRange, eventCount, eventTime} from "../events.js";
import {WEEKDAYS, dateKey, weekDates, sameDay, formatDate, fullDate, periodTitle, currentMinutes} from "../date.js";
import {icon} from "./icons.js";
import {escapeHtml} from "../account.js";

export function renderHome(state, now = new Date()) {
  const today = state.today;
  const events = eventsOnDate(state.events, today);
  const ready = !state.eventsStatus || state.eventsStatus === "ready";
  const hour = currentMinutes(state.preferences.timezone, now) / 60;
  const baseGreeting = hour < 12 ? "Bonjour" : hour < 17 ? "Bon après-midi" : "Bonsoir";
  const greeting = state.account ? `${baseGreeting}, ${escapeHtml(state.account.display_name)}.` : `${baseGreeting}.`;
  const days = weekDates(today, state.preferences.weekStart);
  const weekEvents = eventsInRange(state.events, dateKey(days[0]), dateKey(days[6]));
  const week = periodTitle({...state, date: today, view: "week"});
  return `<div class="home-page">
    <section class="home-intro" aria-labelledby="home-title"><div><p class="home-eyebrow">TA JOURNÉE EN UN COUP D’ŒIL</p><h1 id="home-title" tabindex="-1">${greeting}</h1><p class="home-subtitle">${formatDate(today, {weekday: "long", month: "long", day: "numeric"})}<span>·</span>Un peu de temps pour souffler.</p></div><button class="home-today-button" data-action="today-day">Voir aujourd’hui ${icon("arrowRight")}</button></section>
    <div class="home-grid">
      <section class="agenda-card" aria-labelledby="agenda-title"><header class="home-card-header"><div class="home-card-title">${icon("calendar")}<h2 id="agenda-title">Au programme</h2><span class="event-count">${ready ? eventCount(events.length) : "…"}</span></div><button class="home-text-link" data-action="today-day">Voir la journée ${icon("arrowRight")}</button></header>
        ${!ready ? '<div class="agenda-empty"><h3>Ton calendrier</h3><p>Les événements s’afficheront une fois le calendrier chargé.</p></div>' : events.length ? `<div class="home-event-list">${events.slice(0, 6).map(event => `<button class="home-event-row" data-action="open-event" data-event-id="${event.id}"><span class="home-event-time">${eventTime(event, state.preferences.timeFormat)}</span><span><strong>${escapeHtml(event.title)}</strong>${event.description ? `<span>${escapeHtml(event.description)}</span>` : ""}</span>${icon("chevronRight")}</button>`).join("")}${events.length > 6 ? `<button class="home-text-link" data-action="today-day">Voir les ${eventCount(events.length)}</button>` : ""}</div>` : `<div class="agenda-empty"><div class="empty-calendar-art" aria-hidden="true"><svg viewBox="0 0 104 104" fill="none"><circle cx="52" cy="52" r="51" fill="#f1f5ec"/><circle cx="52" cy="52" r="40" stroke="#e2ead9" stroke-dasharray="3 5"/><rect x="30" y="31" width="44" height="45" rx="9" fill="#fff" stroke="#96ad87" stroke-width="1.5"/><path d="M30 44h44M41 27v9M63 27v9" stroke="#96ad87" stroke-width="1.5" stroke-linecap="round"/><path d="m44 59 5 5 11-11" stroke="#729460" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="78" cy="29" r="7" fill="#e4ecdc"/><path d="M78 26v6m-3-3h6" stroke="#8da378" stroke-linecap="round"/></svg></div><h3>Ta journée est libre.</h3><p>Tu n’as aucun événement prévu aujourd’hui.<br>Du temps pour ce qui te fait envie.</p></div>`}
        <footer class="agenda-card-footer"><span>${formatDate(today, {weekday: "long", month: "short", day: "numeric"})}</span><span><span class="agenda-status-dot"></span>${ready ? events.length ? "Ta journée prend forme" : "Rien de prévu" : "Chargement"}</span></footer>
      </section>
      <section class="week-summary-card" aria-labelledby="week-summary-title"><div class="week-summary-heading"><span class="home-eyebrow">LES JOURS À VENIR</span><span class="week-summary-icon">${icon("week")}</span></div><h2 id="week-summary-title">${week.primary}</h2><p class="week-summary-subtitle">Cette semaine <span>·</span> ${week.secondary}</p>
        <div class="home-week-strip" aria-label="Jours de la semaine">${days.map(date => `<button class="home-week-day ${sameDay(date, today) ? "is-today" : ""}" data-action="open-day" data-date="${dateKey(date)}" aria-label="Voir le ${fullDate(date)}. ${eventCount(eventsOnDate(state.events, date).length)}." ${sameDay(date, today) ? 'aria-current="date"' : ""}><span>${WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span><strong>${date.getUTCDate()}</strong><span class="week-day-dot ${eventsOnDate(state.events, date).length ? "has-events" : ""}"></span></button>`).join("")}</div>
        ${weekEvents.length ? `<div class="week-upcoming"><p>${eventCount(weekEvents.length)} cette semaine</p>${weekEvents.slice(0, 3).map(event => `<button data-action="open-event" data-event-id="${event.id}"><span>${formatDate(new Date(`${event.date}T12:00:00Z`), {weekday: "short", day: "numeric"})}</span><strong>${escapeHtml(event.title)}</strong></button>`).join("")}</div>` : `<div class="week-summary-empty"><span class="week-empty-icon">${icon("sun")}</span><h3>${ready ? "Une semaine tranquille." : "Les jours à venir"}</h3><p>${ready ? "Aucun événement prévu cette semaine." : "Chargement du calendrier…"}</p></div>`}
        <button class="open-week-link" data-action="today-week">Voir cette semaine ${icon("arrowRight")}</button>
      </section>
    </div>
    <button class="browse-calendar" data-action="month"><span class="browse-calendar-icon">${icon("calendar")}</span><span class="browse-calendar-copy"><strong>Une vue d’ensemble</strong><span>Parcours le mois, puis explore chaque journée.</span></span><span class="browse-calendar-action">Ouvrir le calendrier ${icon("arrowRight")}</span></button>
  </div>`;
}
