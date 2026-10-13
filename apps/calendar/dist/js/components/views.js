import {WEEKDAYS, monthDates, weekDates, dateKey, sameDay, sameMonth, fullDate, formatDate, hourLabel, currentMinutes, zoneOffset} from "../date.js";
import {eventsOnDate, eventCount, eventTime, timeLabel, layoutTimedEvents} from "../events.js";
import {escapeHtml as esc} from "../account.js";
import {icon} from "./icons.js";

function eventButton(event, state, className = "event-chip", style = "") {
  const label = `${event.title}, ${eventTime(event, state.preferences.timeFormat)}. Modifier l’événement`;
  return `<button class="${className} ${event.allDay ? "is-all-day" : ""}" data-action="open-event" data-event-id="${event.id}" ${style ? `style="${style}"` : ""} aria-label="${esc(label)}" title="${esc(label)}"><span class="event-chip-time">${event.allDay ? "" : esc(timeLabel(event.startTime, state.preferences.timeFormat))}</span><span class="event-chip-title">${esc(event.title)}</span></button>`;
}
export function renderMonth(state) {
  const dates = monthDates(state.date, state.preferences.weekStart);
  const weekdays = Array.from({length: 7}, (_, index) => WEEKDAYS[(state.preferences.weekStart + index) % 7]);
  return `<div class="month-view calendar-panel" role="grid" aria-label="${formatDate(state.date, {month: "long", year: "numeric"})}" style="--week-count:${dates.length / 7}">
    <div class="month-weekdays" role="row">${weekdays.map(day => `<div class="weekday ${(day === WEEKDAYS[0] || day === WEEKDAYS[6]) ? "weekend" : ""}" role="columnheader"><span class="weekday-full">${day}</span><span class="weekday-short">${day.slice(0, 3)}</span></div>`).join("")}</div>
    <div class="month-weeks">${Array.from({length: dates.length / 7}, (_, row) => `<div class="month-week" role="row">${dates.slice(row * 7, row * 7 + 7).map(date => {
      const outside = !sameMonth(date, state.date), today = sameDay(date, state.today), selected = sameDay(date, state.date);
      const events = eventsOnDate(state.events, date);
      return `<div class="month-cell ${outside ? "outside" : ""} ${[0, 6].includes(date.getUTCDay()) ? "weekend" : ""} ${selected ? "selected" : ""} ${today ? "is-today" : ""}" role="gridcell" aria-selected="${selected}" data-action="open-week" data-date="${dateKey(date)}"><button class="month-date" data-action="open-week" data-date="${dateKey(date)}" tabindex="${selected ? 0 : -1}" aria-label="Voir la semaine du ${fullDate(date)}. ${eventCount(events.length)}." ${today ? 'aria-current="date"' : ""}><span class="date-number">${outside && date.getUTCDate() === 1 ? formatDate(date, {month: "short"}) + " " : ""}${date.getUTCDate()}</span>${today ? '<span class="today-label">Aujourd’hui</span>' : ""}</button><div class="month-events">${events.slice(0, 2).map(event => eventButton(event, state)).join("")}${events.length > 2 ? `<button class="more-events" data-action="open-day" data-date="${dateKey(date)}">+ ${events.length - 2} autres</button>` : ""}</div><button class="month-add-event" data-action="create-event" data-date="${dateKey(date)}" aria-label="Ajouter un événement le ${fullDate(date)}">${icon("plus")}</button></div>`;
    }).join("")}</div>`).join("")}</div>
  </div>`;
}
export function renderTimeView(state) {
  const dates = state.view === "week" ? weekDates(state.date, state.preferences.weekStart) : [state.date];
  const columns = dates.length;
  const selectedToday = dates.some(date => sameDay(date, state.today));
  const hourRows = Array.from({length: 24}, (_, hour) => `<div class="hour-label" style="top:${hour * 64}px">${hour === 0 ? "" : hourLabel(hour, state.preferences.timeFormat)}</div>`).join("");
  return `<div class="time-view calendar-panel ${state.view}-view" style="--day-count:${columns}">
    <div class="time-heading"><div class="zone-label">${zoneOffset(state.preferences.timezone, state.date)}</div><div class="time-day-headings">${dates.map(date => `<button class="time-day-heading ${sameDay(date, state.today) ? "is-today" : ""} ${sameDay(date, state.date) ? "selected" : ""}" data-action="open-day" data-date="${dateKey(date)}" aria-label="Voir le ${fullDate(date)}" ${sameDay(date, state.today) ? 'aria-current="date"' : ""}><span class="time-weekday">${state.view === "day" ? formatDate(date, {weekday: "long"}) : WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span><span class="time-date-number">${date.getUTCDate()}</span>${state.view === "day" ? `<span class="day-empty-label">${eventCount(eventsOnDate(state.events, date).length)}</span>` : ""}</button>`).join("")}</div></div>
    <div class="all-day-row"><span class="all-day-label">Journée</span><div class="all-day-columns">${dates.map(date => `<div class="all-day-cell ${sameDay(date, state.today) ? "is-today" : ""}">${eventsOnDate(state.events, date).filter(event => event.allDay).map(event => eventButton(event, state)).join("")}<button class="all-day-add" data-action="create-event" data-date="${dateKey(date)}" aria-label="Ajouter un événement le ${fullDate(date)}">${icon("plus")}</button></div>`).join("")}</div></div>
    <div class="time-scroll" role="region" aria-label="Calendrier horaire ${state.view === "week" ? "de la semaine" : "de la journée"}" tabindex="0"><div class="time-grid"><div class="hour-gutter">${hourRows}</div><div class="time-columns">${dates.map(date => {
      const timed = layoutTimedEvents(state.events || [], date);
      return `<div class="time-column ${sameDay(date, state.today) ? "is-today" : ""} ${[0, 6].includes(date.getUTCDay()) ? "weekend" : ""}" aria-label="${fullDate(date)}. ${eventCount(eventsOnDate(state.events, date).length)}.">${Array.from({length: 24}, (_, hour) => state.view === "day" ? `<button class="hour-slot hour-create" data-action="create-event" data-date="${dateKey(date)}" data-time="${String(hour).padStart(2, "0")}:00" aria-label="Ajouter un événement à ${hour} h le ${fullDate(date)}"><span class="half-hour"></span></button>` : '<div class="hour-slot" aria-hidden="true"><span class="half-hour"></span></div>').join("")}${selectedToday && sameDay(date, state.today) ? `<div class="now-line" style="top:${currentMinutes(state.preferences.timezone) / 60 * 64}px"><span></span></div>` : ""}${state.view === "week" ? `<button class="time-column-hitarea" tabindex="-1" data-action="open-day" data-date="${dateKey(date)}" aria-label="Voir l’horaire du ${fullDate(date)}"></button>` : ""}${timed.map(row => eventButton(row.event, state, `time-event ${row.end - row.start < 35 ? "short-event" : ""}`, `top:${row.start / 60 * 64}px;height:${Math.max(20, (row.end - row.start) / 60 * 64 - 2)}px;left:calc(${row.lane / row.lanes * 100}% + 3px);width:calc(${100 / row.lanes}% - 6px)`)).join("")}</div>`;
    }).join("")}</div></div></div>
  </div>`;
}
export function renderCalendar(state) { return state.view === "month" ? renderMonth(state) : renderTimeView(state); }
