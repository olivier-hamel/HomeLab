import {eventsOnDate, eventCount} from "../events.js";
import {MONTHS, WEEKDAYS, monthDates, dateKey, sameDay, sameMonth, fullDate, formatDate} from "../date.js";
import {icon} from "./icons.js";

export function renderMiniCalendar(state) {
  const weekdays = Array.from({length: 7}, (_, i) => WEEKDAYS[(state.preferences.weekStart + i) % 7]);
  return `<section class="mini-calendar" aria-label="Choisir une date">
    <div class="mini-heading"><h2>${MONTHS[state.miniDate.getUTCMonth()]} <span>${state.miniDate.getUTCFullYear()}</span></h2>
      <div class="mini-nav"><button class="icon-button compact" data-action="mini-prev" aria-label="Mois précédent dans le mini calendrier">${icon("chevronLeft")}</button><button class="icon-button compact" data-action="mini-next" aria-label="Mois suivant dans le mini calendrier">${icon("chevronRight")}</button></div>
    </div>
    <div class="mini-weekdays">${weekdays.map(day => `<span title="${day}">${day[0]}</span>`).join("")}</div>
    <div class="mini-grid">${monthDates(state.miniDate, state.preferences.weekStart, true).map(date => `<button class="mini-day ${sameMonth(date, state.miniDate) ? "" : "outside"} ${sameDay(date, state.date) ? "selected" : ""} ${sameDay(date, state.today) ? "today" : ""}" data-action="open-week" data-date="${dateKey(date)}" aria-label="Voir la semaine du ${fullDate(date)}" aria-pressed="${sameDay(date, state.date)}" ${sameDay(date, state.today) ? 'aria-current="date"' : ""}>${date.getUTCDate()}</button>`).join("")}</div>
  </section>`;
}
export function renderSidebar(state) {
  const today = sameDay(state.date, state.today);
  return `<div class="sidebar-top"><a class="brand" href="./" data-action="month" aria-label="Calendrier Tempo"><span class="brand-icon">${icon("calendar")}</span><span>Tempo<span class="brand-period">.</span></span></a><button class="icon-button sidebar-close" data-action="close-sidebar" aria-label="Fermer le menu">${icon("close")}</button></div>
    <nav class="sidebar-navigation" aria-label="Navigation principale"><button class="calendar-nav" data-action="calendar-home" ${state.page === "calendar" ? 'aria-current="page"' : ""}>${icon("calendar")}<span>Mon calendrier</span><span class="nav-dot"></span></button>
    </nav>
    ${renderMiniCalendar(state)}
    <div class="sidebar-divider"></div>
    <section class="day-overview" aria-label="Jour sélectionné">
      <div class="overview-eyebrow">${today ? "AUJOURD’HUI" : formatDate(state.date, {weekday: "long"}).toUpperCase()}<span class="small-sun">${icon("sun")}</span></div>
      <div class="overview-date"><span class="overview-number">${state.date.getUTCDate()}</span><div><strong>${MONTHS[state.date.getUTCMonth()]}</strong><span>${formatDate(state.date, {weekday: "long"})}, ${state.date.getUTCFullYear()}</span></div></div>
      <div class="empty-agenda"><span class="empty-dash"></span><span>${state.eventsStatus === "loading" ? "Chargement…" : state.eventsStatus === "error" ? "Calendrier indisponible" : eventsOnDate(state.events, state.date).length ? eventCount(eventsOnDate(state.events, state.date).length) + (eventsOnDate(state.events, state.date).length > 1 ? " prévus" : " prévu") : "Aucun événement prévu"}</span></div>
      <button class="day-link" data-action="open-day" data-date="${dateKey(state.date)}">Voir cette journée ${icon("arrowRight")}</button>
    </section>
    <div class="sidebar-bottom"><div class="little-note"><span class="note-dot"></span>Au rythme de tes journées.</div>
      <button class="sidebar-utility" data-action="shortcuts">${icon("keyboard")}<span>Raccourcis clavier</span><kbd>?</kbd></button>
      <button class="sidebar-utility" data-action="settings">${icon("settings")}<span>Préférences</span></button>
    </div>`;
}
