import {WEEKDAYS, monthDates, weekDates, dateKey, sameDay, sameMonth, fullDate, formatDate, hourLabel, currentMinutes, zoneOffset} from "../date.js";
import {eventsOnDate, eventCount, eventTime, timeLabel, layoutTimedEvents} from "../events.js";
import {isFrequentRecurrence} from "../recurrence.js";
import {escapeHtml as esc} from "../account.js";
import {icon} from "./icons.js";
import {eventType, eventImportance, IMPORTANCE_LEVELS} from "../event-types.js";

function eventLabel(event, state) {
  const type = eventType(event, state.eventTypes);
  return `${event.title}, ${eventTime(event, state.preferences.timeFormat)}${event.kind === "task" ? event.completed ? ", terminée" : ", à faire" : ""}${type ? `, ${type.name}, importance ${IMPORTANCE_LEVELS[eventImportance(event, state.eventTypes) - 1].label.toLowerCase()}` : ""}${event.recurrence ? ", récurrent" : ""}${event.source ? `, document : ${event.source.documentName}` : ""}. ${event.recurrence ? "Modifier toute la série" : event.kind === "task" ? "Modifier la tâche" : "Modifier l’événement"}`;
}
function eventButton(event, state, className = "event-chip", style = "") {
  const label = eventLabel(event, state);
  if (event.kind === "task") return `<div class="${className} calendar-task ${event.completed ? "is-complete" : ""} ${event.allDay ? "is-all-day" : ""} importance-${eventImportance(event, state.eventTypes)}" ${style ? `style="${style}"` : ""}><button class="calendar-task-check" data-action="toggle-task" data-event-id="${event.id}" role="checkbox" aria-checked="${!!event.completed}" aria-label="${esc(`${event.completed ? "Remettre à faire" : "Terminer"} : ${event.title}`)}">${event.completed ? icon("check") : ""}</button><button class="calendar-task-open" data-action="open-event" data-event-id="${event.id}" aria-label="${esc(label)}" title="${esc(label)}"><span class="event-chip-time">${event.deadline?.time ? esc(timeLabel(event.deadline.time, state.preferences.timeFormat)) : ""}</span><span class="event-chip-title">${esc(event.title)}</span></button></div>`;
  if (state.view === "week" && !eventType(event, state.eventTypes) && isFrequentRecurrence(event.recurrence)) className += " recurring-event-card";
  return `<button class="${className} ${event.allDay ? "is-all-day" : ""} importance-${eventImportance(event, state.eventTypes)}" data-action="open-event" data-event-id="${event.id}" ${style ? `style="${style}"` : ""} aria-label="${esc(label)}" title="${esc(label)}"><span class="event-chip-time">${event.allDay ? "" : esc(timeLabel(event.startTime, state.preferences.timeFormat))}</span><span class="event-chip-title">${esc(event.title)}</span>${event.source ? icon("document", "event-source-icon") : ""}</button>`;
}
function recurringMarker(event, state, style = "") {
  const label = esc(eventLabel(event, state));
  return `<button class="recurring-event-marker ${event.allDay ? "is-all-day" : ""} ${style ? "is-timed" : ""} importance-${eventImportance(event, state.eventTypes)}" data-action="open-event" data-event-id="${event.id}" ${style ? `style="${style}"` : ""} aria-label="${label}" title="${label}"></button>`;
}
function discreet(event, state, timed = false) {
  if (event.kind === "task") return false;
  if (state.view === "week" && event.recurrence) return false;
  if (eventType(event, state.eventTypes)) return eventImportance(event, state.eventTypes) <= (timed ? 2 : 1);
  return state.view !== "day" && isFrequentRecurrence(event.recurrence);
}
function renderOverviewEvents(events, state, date, limit = events.length) {
  const regular = events.filter(event => !discreet(event, state)).sort((a, b) => eventImportance(b, state.eventTypes) - eventImportance(a, state.eventTypes));
  const recurring = events.filter(event => discreet(event, state));
  return `${regular.slice(0, limit).map(event => eventButton(event, state)).join("")}${recurring.length ? `<div class="recurring-event-markers">${recurring.map(event => recurringMarker(event, state)).join("")}</div>` : ""}${regular.length > limit ? `<button class="more-events" data-action="open-day" data-date="${dateKey(date)}">+ ${regular.length - limit} autres</button>` : ""}`;
}
function renderTimedEvents(state, date) {
  const events = (state.events || []).filter(event => event.kind !== "task");
  const regular = events.filter(event => !discreet(event, state, true));
  const recurring = layoutTimedEvents(events.filter(event => discreet(event, state, true)), date);
  const position = (row, minimumHeight) => `top:${row.start / 1440 * 100}%;height:min(${(1440 - row.start) / 1440 * 100}%, max(${minimumHeight}px, calc(${(row.end - row.start) / 1440 * 100}% - 2px)))`;
  const buttons = layoutTimedEvents(regular, date, state.eventTypes).map(row => eventButton(row.event, state, `time-event ${row.end - row.start < 60 ? "short-event" : ""}`, `${position(row, 16)};left:calc(${row.offset * 100}% + 3px);width:calc(${row.width * 100}% - 6px)`)).join("");
  if (!recurring.length) return buttons;
  // Discreet event types keep a separate gutter alongside the visible cards.
  const gutter = `min(25%, ${Math.max(...recurring.map(row => row.lanes)) * 12}px)`;
  return `<div class="time-events" style="right:${gutter}">${buttons}</div><div class="time-recurring-events" style="width:${gutter}">${recurring.map(row => recurringMarker(row.event, state, `${position(row, 6)};left:${row.lane / row.lanes * 100}%;width:${100 / row.lanes}%`)).join("")}</div>`;
}
export function renderMonth(state) {
  const dates = monthDates(state.date, state.preferences.weekStart);
  const weekdays = Array.from({length: 7}, (_, index) => WEEKDAYS[(state.preferences.weekStart + index) % 7]);
  return `<div class="month-view calendar-panel" role="grid" aria-label="${formatDate(state.date, {month: "long", year: "numeric"})}" style="--week-count:${dates.length / 7}">
    <div class="month-weekdays" role="row">${weekdays.map(day => `<div class="weekday ${(day === WEEKDAYS[0] || day === WEEKDAYS[6]) ? "weekend" : ""}" role="columnheader"><span class="weekday-full">${day}</span><span class="weekday-short">${day.slice(0, 3)}</span></div>`).join("")}</div>
    <div class="month-weeks">${Array.from({length: dates.length / 7}, (_, row) => `<div class="month-week" role="row">${dates.slice(row * 7, row * 7 + 7).map(date => {
      const outside = !sameMonth(date, state.date), today = sameDay(date, state.today), selected = sameDay(date, state.date);
      const events = eventsOnDate(state.events, date);
      return `<div class="month-cell ${outside ? "outside" : ""} ${[0, 6].includes(date.getUTCDay()) ? "weekend" : ""} ${selected ? "selected" : ""} ${today ? "is-today" : ""}" role="gridcell" aria-selected="${selected}" data-action="open-week" data-date="${dateKey(date)}"><button class="month-date" data-action="open-week" data-date="${dateKey(date)}" tabindex="${selected ? 0 : -1}" aria-label="Voir la semaine du ${fullDate(date)}. ${eventCount(events.length)}." ${today ? 'aria-current="date"' : ""}><span class="date-number">${outside && date.getUTCDate() === 1 ? formatDate(date, {month: "short"}) + " " : ""}${date.getUTCDate()}</span>${today ? '<span class="today-label">Aujourd’hui</span>' : ""}</button><div class="month-events">${renderOverviewEvents(events, state, date, 2)}</div><button class="month-add-event" data-action="create-event" data-date="${dateKey(date)}" aria-label="Ajouter un événement le ${fullDate(date)}">${icon("plus")}</button></div>`;
    }).join("")}</div>`).join("")}</div>
  </div>`;
}
export function renderTimeView(state) {
  const dates = state.view === "week" ? weekDates(state.date, state.preferences.weekStart) : [state.date];
  const columns = dates.length;
  const selectedToday = dates.some(date => sameDay(date, state.today));
  const hourRows = Array.from({length: 24}, (_, hour) => `<div class="hour-label" style="top:${hour / 24 * 100}%">${hour === 0 ? "" : hourLabel(hour, state.preferences.timeFormat)}</div>`).join("");
  return `<div class="time-view calendar-panel ${state.view}-view" style="--day-count:${columns}">
    <div class="time-heading"><div class="zone-label">${zoneOffset(state.preferences.timezone, state.date)}</div><div class="time-day-headings">${dates.map(date => `<button class="time-day-heading ${sameDay(date, state.today) ? "is-today" : ""} ${sameDay(date, state.date) ? "selected" : ""}" data-action="open-day" data-date="${dateKey(date)}" aria-label="Voir le ${fullDate(date)}" ${sameDay(date, state.today) ? 'aria-current="date"' : ""}><span class="time-weekday">${state.view === "day" ? formatDate(date, {weekday: "long"}) : WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span><span class="time-date-number">${date.getUTCDate()}</span>${state.view === "day" ? `<span class="day-empty-label">${eventCount(eventsOnDate(state.events, date).length)}</span>` : ""}</button>`).join("")}</div></div>
    <div class="all-day-row"><span class="all-day-label">Journée</span><div class="all-day-columns">${dates.map(date => `<div class="all-day-cell ${sameDay(date, state.today) ? "is-today" : ""}">${renderOverviewEvents(eventsOnDate(state.events, date).filter(event => event.allDay || event.kind === "task"), state, date)}<button class="all-day-add" data-action="create-event" data-date="${dateKey(date)}" aria-label="Ajouter un événement le ${fullDate(date)}">${icon("plus")}</button></div>`).join("")}</div></div>
    <div class="time-body" role="region" aria-label="Calendrier horaire ${state.view === "week" ? "de la semaine" : "de la journée"}" tabindex="0"><div class="time-grid"><div class="hour-gutter">${hourRows}</div><div class="time-columns">${dates.map(date => {
      return `<div class="time-column ${sameDay(date, state.today) ? "is-today" : ""} ${[0, 6].includes(date.getUTCDay()) ? "weekend" : ""}" aria-label="${fullDate(date)}. ${eventCount(eventsOnDate(state.events, date).length)}.">${Array.from({length: 24}, (_, hour) => state.view === "day" ? `<button class="hour-slot hour-create" data-action="create-event" data-date="${dateKey(date)}" data-time="${String(hour).padStart(2, "0")}:00" aria-label="Ajouter un événement à ${hour} h le ${fullDate(date)}"><span class="half-hour"></span></button>` : '<div class="hour-slot" aria-hidden="true"><span class="half-hour"></span></div>').join("")}${selectedToday && sameDay(date, state.today) ? `<div class="now-line" style="top:${currentMinutes(state.preferences.timezone) / 1440 * 100}%"><span></span></div>` : ""}${state.view === "week" ? `<button class="time-column-hitarea" tabindex="-1" data-action="open-day" data-date="${dateKey(date)}" aria-label="Voir l’horaire du ${fullDate(date)}"></button>` : ""}${renderTimedEvents(state, date)}</div>`;
    }).join("")}</div></div></div>
  </div>`;
}
export function renderCalendar(state) { return state.view === "month" ? renderMonth(state) : renderTimeView(state); }
