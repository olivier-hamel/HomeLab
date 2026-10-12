import {dateKey} from "../date.js";
import {icon} from "./icons.js";

function frame(title, body, extraClass = "") {
  return `<dialog class="app-dialog ${extraClass}" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon("close")}</button></div>${body}</dialog>`;
}
export function jumpDialog(state) {
  return frame("Go to a date", `<p class="dialog-description">Find a little perspective, past or future.</p><form id="jump-form"><label class="field-label" for="jump-date">Date</label><input type="date" id="jump-date" name="date" min="0001-01-01" max="9999-12-31" value="${dateKey(state.date)}" required/><div class="dialog-actions"><button class="text-button" type="button" data-action="jump-today">Go to today</button><button class="primary-button" type="submit">Go to date ${icon("arrowRight")}</button></div></form>`, "jump-dialog");
}
export function preferencesDialog(state) {
  return frame("Make yourself at home", `<p class="dialog-description">A few little things to make your calendar yours.</p><form id="preferences-form"><div class="setting-row"><div><label for="week-start">Start the week on</label><p>For the big picture and the little calendar.</p></div><select id="week-start" name="weekStart"><option value="1" ${state.preferences.weekStart === 1 ? "selected" : ""}>Monday</option><option value="0" ${state.preferences.weekStart === 0 ? "selected" : ""}>Sunday</option></select></div><div class="setting-row"><div><label for="time-format">Time format</label><p>How hours appear in week and day views.</p></div><select id="time-format" name="timeFormat"><option value="12" ${state.preferences.timeFormat === "12" ? "selected" : ""}>12-hour</option><option value="24" ${state.preferences.timeFormat === "24" ? "selected" : ""}>24-hour</option></select></div><div class="setting-row timezone-setting"><div><span class="setting-title">Time zone</span><p>America / Toronto</p></div><span class="setting-zone">Eastern Time</span></div><div class="preferences-note">${icon("check")} Your preferences are saved on this device.</div><div class="dialog-actions"><button class="primary-button" type="submit">Save preferences</button></div></form>`, "preferences-dialog");
}
export function shortcutsDialog() {
  const shortcuts = [["Month view", "M"], ["Week view", "W"], ["Day view", "D"], ["Go to today", "T"], ["Go to a date", "G"], ["Previous / next period", "←", "→"], ["Show shortcuts", "?"], ["Close dialog", "Esc"]];
  return frame("A few handy shortcuts", `<p class="dialog-description">Less clicking. More room for your day.</p><div class="shortcut-list">${shortcuts.map(([label, ...keys]) => `<div><span>${label}</span><span>${keys.map(key => `<kbd>${key}</kbd>`).join(" ")}</span></div>`).join("")}</div><p class="shortcut-note">In the month grid, use the arrow keys to move between dates. Press Enter to select; double-click to open a day.</p>`);
}
