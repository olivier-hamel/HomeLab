import {createCalendarStore} from "./state.js";
import {dateKey, parseDate, addDays, fullDate, periodTitle, zoneOffset} from "./date.js";
import {renderSidebar} from "./components/sidebar.js";
import {renderCalendar} from "./components/views.js";
import {icon} from "./components/icons.js";
import {jumpDialog, preferencesDialog, shortcutsDialog} from "./components/dialogs.js";

let storage = null;
try {storage = window.localStorage;} catch { /* All calendar controls still work without storage. */ }
const store = createCalendarStore(storage);
const app = document.getElementById("app");
const dialogRoot = document.getElementById("dialog-root");
let dialogOpener = null;
let renderedPeriod = null;
let renderedView = null;

app.innerHTML = `<div class="app-shell"><div class="sidebar-overlay" data-action="close-sidebar"></div><aside id="sidebar" class="sidebar" aria-label="Calendar sidebar"></aside><main class="main"><header class="workspace-header"><div class="workspace-name"><button class="icon-button menu-button" data-action="toggle-sidebar" aria-label="Open sidebar" aria-expanded="false" aria-controls="sidebar">${icon("menu")}</button><span class="workspace-label">My calendar</span><span class="workspace-separator"></span><span class="personal-label"><span></span>Personal</span></div><button class="jump-button" data-action="jump" aria-label="Go to a date">${icon("calendar")}<span>Go to date</span><kbd>G</kbd></button></header><section class="calendar-workspace"><div class="calendar-toolbar"><div class="period-controls"><h1 id="period-title"></h1><div class="period-navigation"><button class="icon-button" data-action="prev" aria-label="Previous month">${icon("chevronLeft")}</button><button class="icon-button" data-action="next" aria-label="Next month">${icon("chevronRight")}</button></div><button class="today-button" data-action="today" title="Go to today (T)">Today</button></div><div class="view-switch" role="group" aria-label="Calendar view">${["month", "week", "day"].map(view => `<button data-action="${view}" aria-pressed="false" title="${view[0].toUpperCase() + view.slice(1)} view (${view[0].toUpperCase()})">${view[0].toUpperCase() + view.slice(1)}</button>`).join("")}</div></div><div id="calendar-content" class="calendar-content" tabindex="-1"></div><footer class="calendar-footer"><span id="view-hint"></span><span class="timezone-info">${icon("globe")}<span>Toronto</span><span class="footer-dot">·</span><span id="timezone-offset"></span></span></footer></section></main></div>`;

function render(state, reason = "initial") {
  const active = document.activeElement;
  const focusAction = active?.closest("[data-action]")?.dataset.action;
  const focusDate = active?.dataset.date;
  const focusWasMonth = active?.classList.contains("month-date");
  const focusWasMini = active?.classList.contains("mini-day");
  const oldScroll = document.querySelector(".time-scroll")?.scrollTop;
  if (reason !== "clock") document.getElementById("sidebar").innerHTML = renderSidebar(state);
  app.querySelector(".app-shell").classList.toggle("sidebar-is-open", state.sidebarOpen);
  app.querySelector(".menu-button").setAttribute("aria-expanded", String(state.sidebarOpen));
  syncSidebarAccess(state);
  if (reason === "sidebar") {
    (state.sidebarOpen ? app.querySelector(".sidebar-close") : app.querySelector(".menu-button"))?.focus();
    return;
  }
  if (reason === "mini") {
    if (focusAction) app.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll: true});
    return;
  }
  const title = periodTitle(state);
  document.getElementById("period-title").innerHTML = `<span class="period-primary">${title.primary}</span><span class="period-year">${title.secondary}</span>`;
  app.querySelector('[data-action="prev"]').setAttribute("aria-label", `Previous ${state.view}`);
  app.querySelector('[data-action="next"]').setAttribute("aria-label", `Next ${state.view}`);
  for (const button of app.querySelectorAll(".view-switch button")) button.setAttribute("aria-pressed", String(button.dataset.action === state.view));
  const monthKey = dateKey(state.date).slice(0, 7);
  const retainMonth = state.view === "month" && renderedView === "month" && renderedPeriod === monthKey && ["date", "keyboard-date"].includes(reason);
  if (retainMonth) {
    for (const cell of app.querySelectorAll(".month-cell")) {
      const button = cell.querySelector(".month-date");
      const selected = button.dataset.date === dateKey(state.date);
      cell.classList.toggle("selected", selected);
      cell.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  } else document.getElementById("calendar-content").innerHTML = renderCalendar(state);
  renderedPeriod = monthKey;
  renderedView = state.view;
  document.getElementById("view-hint").innerHTML = state.view === "month" ? '<span class="hint-dot"></span>Double-click a date to open the day' : '<span class="hint-dot"></span>Your calendar. A little room to breathe.';
  document.getElementById("timezone-offset").textContent = zoneOffset(state.preferences.timezone, state.date);
  const scroll = app.querySelector(".time-scroll");
  if (scroll) scroll.scrollTop = oldScroll !== undefined && reason !== "view" ? oldScroll : 7 * 64 - 16;
  if (focusWasMonth || reason === "keyboard-date") app.querySelector(`.month-date[data-date="${dateKey(state.date)}"]`)?.focus({preventScroll: true});
  else if (focusWasMini) {
    if (window.matchMedia("(max-width: 760px)").matches) (app.querySelector(".month-date[tabindex='0']") || document.getElementById("calendar-content"))?.focus({preventScroll: true});
    else app.querySelector(`.mini-day[data-date="${focusDate}"]`)?.focus({preventScroll: true});
  }
  else if (focusAction && !document.contains(active)) app.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll: true});
  if (["navigate", "view", "today", "date", "keyboard-date"].includes(reason)) document.getElementById("announcement").textContent = `${title.primary} ${title.secondary}. ${state.view} view. Selected ${fullDate(state.date)}.`;
}

function syncSidebarAccess(state = store.getState()) {
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const sidebar = document.getElementById("sidebar");
  sidebar.inert = mobile && !state.sidebarOpen;
  app.querySelector("main").inert = mobile && state.sidebarOpen;
  if (mobile && state.sidebarOpen) {sidebar.setAttribute("role", "dialog"); sidebar.setAttribute("aria-modal", "true");}
  else {sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal");}
}
window.matchMedia("(max-width: 760px)").addEventListener("change", () => {store.closeSidebar(); syncSidebarAccess();});

function closeDialog() {dialogRoot.querySelector("dialog")?.close();}
function openDialog(type) {
  closeDialog();
  dialogOpener = document.activeElement;
  const state = store.getState();
  dialogRoot.innerHTML = type === "jump" ? jumpDialog(state) : type === "settings" ? preferencesDialog(state) : shortcutsDialog();
  const dialog = dialogRoot.querySelector("dialog");
  const opener = dialogOpener;
  const openerAction = opener?.dataset.action;
  dialog.addEventListener("close", () => {
    if (dialogRoot.firstElementChild !== dialog) return;
    dialogRoot.innerHTML = "";
    const target = document.contains(opener) ? opener : openerAction ? app.querySelector(`[data-action="${openerAction}"]`) : null;
    target?.focus({preventScroll: true});
  });
  dialog.addEventListener("click", event => {if (event.target === dialog) {const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();}});
  dialog.showModal();
  if (type === "jump") dialog.querySelector("input").focus();
}

const actions = {
  prev: () => store.navigate(-1), next: () => store.navigate(1), today: () => store.goToday(),
  month: () => store.setView("month"), week: () => store.setView("week"), day: () => store.setView("day"),
  "mini-prev": () => store.navigateMini(-1), "mini-next": () => store.navigateMini(1),
  "select-date": element => store.selectDate(parseDate(element.dataset.date)),
  "open-day": element => {store.selectDate(parseDate(element.dataset.date)); store.setView("day");},
  jump: () => openDialog("jump"), settings: () => openDialog("settings"), shortcuts: () => openDialog("shortcuts"),
  "close-dialog": closeDialog, "jump-today": () => {closeDialog(); store.goToday();},
  "toggle-sidebar": () => store.toggleSidebar(), "close-sidebar": () => store.closeSidebar(),
  "calendar-home": () => {store.goToday(); store.setView("month");}
};
document.addEventListener("click", event => {const element = event.target.closest("[data-action]"); if (element) actions[element.dataset.action]?.(element);});
document.addEventListener("dblclick", event => {
  const element = event.target.closest(".month-date");
  if (element) {store.selectDate(parseDate(element.dataset.date)); store.setView("day");}
});
document.addEventListener("submit", event => {
  if (event.target.id === "jump-form") {
    event.preventDefault();
    const date = parseDate(new FormData(event.target).get("date"));
    if (date) {closeDialog(); store.selectDate(date);}
  }
  if (event.target.id === "preferences-form") {
    event.preventDefault();
    const fields = new FormData(event.target);
    store.setPreferences({weekStart: Number(fields.get("weekStart")), timeFormat: fields.get("timeFormat")});
    closeDialog();
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && store.getState().sidebarOpen) store.closeSidebar();
  if (event.key === "Tab" && store.getState().sidebarOpen && window.matchMedia("(max-width: 760px)").matches) {
    const buttons = Array.from(app.querySelectorAll(".sidebar a, .sidebar button")).filter(element => element.getClientRects().length);
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  }
  if (dialogRoot.querySelector("dialog[open]") || event.ctrlKey || event.metaKey || event.altKey || event.target.matches("input, select, textarea, [contenteditable=true]")) return;
  const dateButton = event.target.closest(".month-date");
  if (dateButton && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    const delta = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[event.key];
    store.selectDate(addDays(parseDate(dateButton.dataset.date), delta), "keyboard-date");
    return;
  }
  const shortcuts = {m: actions.month, w: actions.week, d: actions.day, t: actions.today, g: actions.jump, "?": actions.shortcuts, ArrowLeft: actions.prev, ArrowRight: actions.next};
  const action = shortcuts[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (action) {event.preventDefault(); action();}
});
store.subscribe(render);
render(store.getState());
setInterval(() => {if (!document.hidden) store.refreshClock();}, 60_000);
document.addEventListener("visibilitychange", () => {if (!document.hidden) store.refreshClock();});
