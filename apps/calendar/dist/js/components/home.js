import {WEEKDAYS, dateKey, weekDates, sameDay, formatDate, fullDate, periodTitle, currentMinutes} from "../date.js";
import {icon} from "./icons.js";

export function renderHome(state, now = new Date()) {
  const today = state.today;
  const hour = currentMinutes(state.preferences.timezone, now) / 60;
  const greeting = hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : "Good evening.";
  const days = weekDates(today, state.preferences.weekStart);
  const week = periodTitle({...state, date: today, view: "week"});
  return `<div class="home-page">
    <section class="home-intro" aria-labelledby="home-title"><div><p class="home-eyebrow">YOUR DAY, AT A GLANCE</p><h1 id="home-title" tabindex="-1">${greeting}</h1><p class="home-subtitle">${formatDate(today, {weekday: "long", month: "long", day: "numeric"})}<span>·</span>A little room to breathe.</p></div><button class="home-today-button" data-action="today-day">View today ${icon("arrowRight")}</button></section>
    <div class="home-grid">
      <section class="agenda-card" aria-labelledby="agenda-title"><header class="home-card-header"><div class="home-card-title">${icon("calendar")}<h2 id="agenda-title">Today’s agenda</h2><span class="event-count">0 events</span></div><button class="home-text-link" data-action="today-day">View day ${icon("arrowRight")}</button></header>
        <div class="agenda-empty"><div class="empty-calendar-art" aria-hidden="true"><svg viewBox="0 0 104 104" fill="none"><circle cx="52" cy="52" r="51" fill="#f1f5ec"/><circle cx="52" cy="52" r="40" stroke="#e2ead9" stroke-dasharray="3 5"/><rect x="30" y="31" width="44" height="45" rx="9" fill="#fff" stroke="#96ad87" stroke-width="1.5"/><path d="M30 44h44M41 27v9M63 27v9" stroke="#96ad87" stroke-width="1.5" stroke-linecap="round"/><path d="m44 59 5 5 11-11" stroke="#729460" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="78" cy="29" r="7" fill="#e4ecdc"/><path d="M78 26v6m-3-3h6" stroke="#8da378" stroke-linecap="round"/></svg></div><h3>Your day is wide open.</h3><p>You have no events scheduled for today.<br>A little space for whatever comes next.</p></div>
        <footer class="agenda-card-footer"><span>${formatDate(today, {weekday: "long", month: "short", day: "numeric"})}</span><span><span class="agenda-status-dot"></span>Nothing scheduled</span></footer>
      </section>
      <section class="week-summary-card" aria-labelledby="week-summary-title"><div class="week-summary-heading"><span class="home-eyebrow">A LOOK AHEAD</span><span class="week-summary-icon">${icon("week")}</span></div><h2 id="week-summary-title">${week.primary}</h2><p class="week-summary-subtitle">This week <span>·</span> ${week.secondary}</p>
        <div class="home-week-strip" aria-label="Days this week">${days.map(date => `<button class="home-week-day ${sameDay(date, today) ? "is-today" : ""}" data-action="open-day" data-date="${dateKey(date)}" aria-label="Open ${fullDate(date)}. No events." ${sameDay(date, today) ? 'aria-current="date"' : ""}><span>${WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span><strong>${date.getUTCDate()}</strong><span class="week-day-dot"></span></button>`).join("")}</div>
        <div class="week-summary-empty"><span class="week-empty-icon">${icon("sun")}</span><h3>A clear week ahead.</h3><p>No events on your calendar this week.</p></div>
        <button class="open-week-link" data-action="today-week">Open this week ${icon("arrowRight")}</button>
      </section>
    </div>
    <button class="browse-calendar" data-action="month"><span class="browse-calendar-icon">${icon("calendar")}</span><span class="browse-calendar-copy"><strong>The bigger picture</strong><span>Browse your month, then take a closer look.</span></span><span class="browse-calendar-action">Open calendar ${icon("arrowRight")}</span></button>
  </div>`;
}
