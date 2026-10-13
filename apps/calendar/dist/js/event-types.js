import {escapeHtml as esc} from "./account.js";

export const DEFAULT_EVENT_TYPE_ID = "none";
export const IMPORTANCE_LEVELS = [
  {value: 1, label: "Très faible", detail: "Un repère discret"},
  {value: 2, label: "Faible", detail: "Une petite place"},
  {value: 3, label: "Normale", detail: "Une carte classique"},
  {value: 4, label: "Élevée", detail: "Une carte plus grande"},
  {value: 5, label: "Très élevée", detail: "Une carte bien en évidence"},
];
export function visibleEventTypes(types = []) {return types.filter(type => !type.hidden && type.id !== DEFAULT_EVENT_TYPE_ID);}
export function eventType(event, types = []) {return visibleEventTypes(types).find(type => type.id === event.typeId) || null;}
export function eventImportance(event, types = []) {const value = eventType(event, types)?.importance; return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 3;}
export function eventTypeOptions(types = [], selected = DEFAULT_EVENT_TYPE_ID) {
  const visible = visibleEventTypes(types);
  const id = visible.some(type => type.id === selected) ? selected : DEFAULT_EVENT_TYPE_ID;
  return `<option value="none" ${id === DEFAULT_EVENT_TYPE_ID ? "selected" : ""}>—</option>${visible.map(type => `<option value="${esc(type.id)}" ${id === type.id ? "selected" : ""}>${esc(type.name)} · ${IMPORTANCE_LEVELS[type.importance - 1]?.label || "Normale"}</option>`).join("")}`;
}
