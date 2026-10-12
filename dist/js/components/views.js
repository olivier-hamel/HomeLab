import {WEEKDAYS, monthDates, weekDates, dateKey, sameDay, sameMonth, fullDate, formatDate, hourLabel, currentMinutes, zoneOffset} from "../date.js";

export function renderMonth(state) {
  const dates = monthDates(state.date, state.preferences.weekStart);
  const weekdays = Array.from({length: 7}, (_, index) => WEEKDAYS[(state.preferences.weekStart + index) % 7]);
  return `<div class="month-view calendar-panel" role="grid" aria-label="${formatDate(state.date, {month: "long", year: "numeric"})}" style="--week-count:${dates.length / 7}">
    <div class="month-weekdays" role="row">${weekdays.map(day => `<div class="weekday ${(day === "Sunday" || day === "Saturday") ? "weekend" : ""}" role="columnheader"><span class="weekday-full">${day}</span><span class="weekday-short">${day.slice(0, 3)}</span></div>`).join("")}</div>
    <div class="month-weeks">${Array.from({length: dates.length / 7}, (_, row) => `<div class="month-week" role="row">${dates.slice(row * 7, row * 7 + 7).map(date => {
      const outside = !sameMonth(date, state.date), today = sameDay(date, state.today), selected = sameDay(date, state.date);
      return `<div class="month-cell ${outside ? "outside" : ""} ${date.getUTCDay() === 0 || date.getUTCDay() === 6 ? "weekend" : ""} ${selected ? "selected" : ""} ${today ? "is-today" : ""}" role="gridcell" aria-selected="${selected}"><button class="month-date" data-action="select-date" data-date="${dateKey(date)}" tabindex="${selected ? 0 : -1}" aria-label="${fullDate(date)}. No events." ${today ? 'aria-current="date"' : ""}><span class="date-number">${outside && date.getUTCDate() === 1 ? formatDate(date, {month: "short"}) + " " : ""}${date.getUTCDate()}</span>${today ? '<span class="today-label">Today</span>' : ""}</button></div>`;
    }).join("")}</div>`).join("")}</div>
  </div>`;
}

export function renderTimeView(state) {
  const dates = state.view === "week" ? weekDates(state.date, state.preferences.weekStart) : [state.date];
  const columns = dates.length;
  const selectedToday = dates.some(date => sameDay(date, state.today));
  const hourRows = Array.from({length: 24}, (_, hour) => `<div class="hour-label" style="top:${hour * 64}px">${hour === 0 ? "" : hourLabel(hour, state.preferences.timeFormat)}</div>`).join("");
  return `<div class="time-view calendar-panel ${state.view}-view" style="--day-count:${columns}">
    <div class="time-heading"><div class="zone-label">${zoneOffset(state.preferences.timezone, state.date)}</div><div class="time-day-headings">${dates.map(date => `<button class="time-day-heading ${sameDay(date, state.today) ? "is-today" : ""} ${sameDay(date, state.date) ? "selected" : ""}" data-action="open-day" data-date="${dateKey(date)}" aria-label="Open ${fullDate(date)}"><span class="time-weekday">${state.view === "day" ? formatDate(date, {weekday: "long"}) : WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span><span class="time-date-number">${date.getUTCDate()}</span>${state.view === "day" ? '<span class="day-empty-label">A day of possibilities</span>' : ""}</button>`).join("")}</div></div>
    <div class="all-day-row"><span class="all-day-label">All-day</span><div class="all-day-columns">${dates.map(date => `<div class="all-day-cell ${sameDay(date, state.today) ? "is-today" : ""}"></div>`).join("")}</div></div>
    <div class="time-scroll" role="region" aria-label="${state.view === "week" ? "Weekly" : "Daily"} hourly calendar" tabindex="0"><div class="time-grid"><div class="hour-gutter">${hourRows}</div><div class="time-columns">${dates.map(date => `<div class="time-column ${sameDay(date, state.today) ? "is-today" : ""} ${[0, 6].includes(date.getUTCDay()) ? "weekend" : ""}" aria-label="${fullDate(date)}. No events.">${Array.from({length: 24}, (_, h) => `<div class="hour-slot" aria-hidden="true"><span class="half-hour"></span></div>`).join("")}${selectedToday && sameDay(date, state.today) ? `<div class="now-line" style="top:${currentMinutes(state.preferences.timezone) / 60 * 64}px"><span></span></div>` : ""}</div>`).join("")}</div></div></div>
  </div>`;
}

export function renderCalendar(state) { return state.view === "month" ? renderMonth(state) : renderTimeView(state); }
