import {dateKey, parseDate, addDays} from "./date.js";
import {createEventRepository} from "./events.js";
import {eventDialog} from "./components/event-dialog.js";
import {recurrenceLabel} from "./recurrence.js";

export function createEventController(store, dialogRoot) {
  const repository = createEventRepository();
  let current = null, loadId = 0, toastTimer;
  function recurrenceInput(form) {
    const frequency = form.elements.recurrenceFrequency.value;
    if (frequency === "none") return null;
    const ending = form.elements.recurrenceEnd.value;
    return {frequency, interval: Number(form.elements.recurrenceInterval.value),
      weekdays: frequency === "weekly" ? [...form.querySelectorAll('[name="recurrenceWeekdays"]:checked')].map(input => Number(input.value)).sort((a, b) => a - b) : [],
      until: ending === "until" ? form.elements.recurrenceUntil.value : null,
      count: ending === "count" ? Number(form.elements.recurrenceCount.value) : null};
  }
  function syncRecurrence(form) {
    const frequency = form.elements.recurrenceFrequency.value;
    const enabled = frequency !== "none";
    const ending = form.elements.recurrenceEnd.value;
    form.querySelector("#event-recurrence-options").hidden = !enabled;
    form.elements.recurrenceInterval.disabled = !enabled;
    form.elements.recurrenceInterval.required = enabled;
    form.elements.recurrenceEnd.disabled = !enabled;
    form.querySelector("#event-interval-prefix").textContent = frequency === "weekly" ? "Toutes les" : "Tous les";
    form.querySelector("#event-interval-unit").textContent = ({daily: "jours", weekly: "semaines", monthly: "mois", yearly: "ans"})[frequency] || "semaines";
    form.querySelector("#event-weekdays").hidden = frequency !== "weekly";
    for (const input of form.querySelectorAll('[name="recurrenceWeekdays"]')) input.disabled = frequency !== "weekly";
    for (const name of ["until", "count"]) {
      form.querySelector(`#event-${name}-field`).hidden = ending !== name;
      const input = form.elements[name === "until" ? "recurrenceUntil" : "recurrenceCount"];
      input.disabled = !enabled || ending !== name;
      input.required = enabled && ending === name;
    }
    form.elements.recurrenceUntil.min = form.elements.date.value;
    form.querySelector("#event-recurrence-summary").textContent = recurrenceLabel(recurrenceInput(form));
    const date = parseDate(form.elements.date.value);
    const note = form.querySelector("#event-recurrence-date-note");
    note.textContent = frequency === "monthly" && date?.getUTCDate() > 28 ? "Les mois sans ce jour seront sautés." : frequency === "yearly" && date?.getUTCMonth() === 1 && date.getUTCDate() === 29 ? "Le 29 février se répète seulement les années bissextiles." : "";
    note.hidden = !note.textContent;
  }
  function fillRecurrence(form, rule) {
    form.elements.recurrenceFrequency.value = rule?.frequency || "none";
    form.elements.recurrenceInterval.value = rule?.interval || 1;
    form.elements.recurrenceEnd.value = rule?.until ? "until" : rule?.count ? "count" : "never";
    form.elements.recurrenceUntil.value = rule?.until || form.elements.date.value;
    form.elements.recurrenceCount.value = rule?.count || 10;
    const days = rule?.weekdays || [parseDate(form.elements.date.value).getUTCDay()];
    for (const input of form.querySelectorAll('[name="recurrenceWeekdays"]')) input.checked = days.includes(Number(input.value));
    syncRecurrence(form);
  }
  async function loadEvents() {
    const id = ++loadId;
    try {
      const result = await repository.list();
      if (id === loadId) store.setEvents(result.events, {eventsStatus: "ready", eventsError: "", aiAvailable: result.aiAvailable});
    } catch (error) {
      if (id === loadId) store.setEvents(store.getState().events, {eventsStatus: "error", eventsError: error.message});
    }
  }
  function toast(message, date) {
    const root = document.getElementById("event-toast");
    clearTimeout(toastTimer);
    root.replaceChildren();
    const text = document.createElement("span"); text.textContent = message; root.append(text);
    if (date) {
      const button = document.createElement("button"); button.textContent = "Voir";
      button.onclick = () => {store.openDate(parseDate(date), "day"); root.hidden = true;}; root.append(button);
    }
    root.hidden = false;
    toastTimer = setTimeout(() => {root.hidden = true;}, 6000);
  }
  function error(message) {
    const target = current?.dialog.querySelector("#event-error");
    if (!target) return;
    target.textContent = message || ""; target.hidden = !message;
    if (message) target.focus();
  }
  function busy(operation) {
    if (!current) return;
    current.busy = operation;
    current.dialog.setAttribute("aria-busy", String(!!operation));
    for (const button of current.dialog.querySelectorAll("button")) button.disabled = !!operation && (operation !== "interpret" || !["close-event-dialog", "event-discard-cancel", "event-discard-confirm"].includes(button.dataset.action));
    const prompt = current.dialog.querySelector("#event-prompt");
    if (prompt) prompt.disabled = operation === "interpret";
    const submit = current.dialog.querySelector(operation === "interpret" ? "#event-interpret-form button[type=submit]" : "#event-save-form button[type=submit]");
    if (submit && operation) {submit.dataset.previousHtml = submit.innerHTML; submit.innerHTML = `<span class="event-spinner" aria-hidden="true"></span>${operation === "interpret" ? "Préparation en cours…" : "Enregistrement…"}`;}
    if (!operation) for (const button of current.dialog.querySelectorAll("[data-previous-html]")) {button.innerHTML = button.dataset.previousHtml; delete button.dataset.previousHtml;}
  }
  function requestClose() {
    if (!current || ["save", "delete"].includes(current.busy)) return;
    if (current.dirty) {
      current.dialog.querySelector("#event-discard-confirm").hidden = false;
      current.dialog.querySelector('[data-action="event-discard-cancel"]').focus();
    } else current.dialog.close();
  }
  function mode(natural) {
    if (!current || current.busy) return;
    for (const name of ["natural", "manual"]) {
      const selected = natural === (name === "natural");
      const tab = current.dialog.querySelector(`#${name}-tab`);
      if (tab) {tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;}
      const panel = current.dialog.querySelector(`#${name}-panel`); if (panel) panel.hidden = !selected;
    }
    current.dialog.querySelector(natural ? "#event-prompt" : "#event-title")?.focus();
  }
  function open(event = null, selectedDate, startTime) {
    if (current) {requestClose(); return;}
    dialogRoot.querySelector("dialog")?.close();
    const state = store.getState();
    const opener = document.activeElement;
    const date = selectedDate || dateKey(state.page === "home" ? state.today : state.date);
    dialogRoot.innerHTML = eventDialog({event, date, aiAvailable: state.aiAvailable, documents: state.documents, documentsStatus: state.documentsStatus});
    const dialog = dialogRoot.querySelector("dialog");
    const context = {dialog, event, opener, dirty: false, busy: null, controller: new AbortController(), requestId: crypto.randomUUID()};
    current = context;
    if (startTime) {
      dialog.querySelector('[name="startTime"]').value = startTime;
      const hour = Number(startTime.slice(0, 2));
      dialog.querySelector('[name="endTime"]').value = `${String((hour + 1) % 24).padStart(2, "0")}:${startTime.slice(3)}`;
      if (hour === 23) dialog.querySelector('[name="endDate"]').value = dateKey(addDays(parseDate(date), 1));
      mode(false);
    }
    dialog.addEventListener("cancel", e => {e.preventDefault(); requestClose();});
    dialog.addEventListener("click", e => {
      if (e.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) requestClose();
    });
    syncRecurrence(dialog.querySelector("#event-save-form"));
    context.previousWeekday = parseDate(dialog.querySelector('[name="date"]').value).getUTCDay();
    dialog.addEventListener("input", () => {context.dirty = true; error(""); syncRecurrence(dialog.querySelector("#event-save-form"));});
    dialog.addEventListener("change", e => {
      const form = dialog.querySelector("#event-save-form");
      if (e.target.name === "allDay") {
        for (const field of form.querySelectorAll(".event-time-field")) {field.hidden = e.target.checked; const input = field.querySelector("input"); input.disabled = e.target.checked; input.required = !e.target.checked;}
      }
      if (e.target.name === "date") {
        form.elements.endDate.min = form.elements.date.value;
        if (form.elements.endDate.value < form.elements.date.value) form.elements.endDate.value = form.elements.date.value;
        const weekday = parseDate(form.elements.date.value)?.getUTCDay();
        if (weekday !== undefined) {
          const selected = form.querySelectorAll('[name="recurrenceWeekdays"]:checked');
          if (selected.length === 1 && Number(selected[0].value) === context.previousWeekday) selected[0].checked = false;
          form.querySelector(`[name="recurrenceWeekdays"][value="${weekday}"]`).checked = true;
        }
        if (weekday !== undefined) context.previousWeekday = weekday;
        if (form.elements.recurrenceUntil.value < form.elements.date.value) form.elements.recurrenceUntil.value = form.elements.date.value;
      }
      if (e.target.name === "recurrenceFrequency" && e.target.value === "weekly") {
        const weekday = parseDate(form.elements.date.value)?.getUTCDay();
        if (weekday !== undefined) form.querySelector(`[name="recurrenceWeekdays"][value="${weekday}"]`).checked = true;
      }
      syncRecurrence(form);
    });
    dialog.addEventListener("keydown", e => {
      if (e.target.matches('[role="tab"]') && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        e.preventDefault(); mode(e.key === "Home" || (e.key !== "End" && e.target.id === "manual-tab"));
        dialog.querySelector('[role="tab"][aria-selected="true"]').focus();
      }
    });
    dialog.addEventListener("close", () => {
      context.controller.abort();
      if (current !== context) return;
      current = null;
      dialogRoot.replaceChildren();
      const focusTarget = document.contains(opener) ? opener : document.querySelector(`[data-event-id="${event?.id || ""}"]`) || document.querySelector('[data-action="create-event"]');
      focusTarget?.focus({preventScroll: true});
    });
    dialog.showModal();
    dialog.querySelector(event || !state.aiAvailable || startTime ? "#event-title" : "#event-prompt").focus();
  }
  async function interpret(form) {
    const context = current;
    if (!context || context.busy) return;
    error(""); busy("interpret");
    try {
      const result = await repository.interpret(form.elements.text.value, context.dialog.querySelector('[name="date"]').value, context.controller.signal);
      if (current !== context) return;
      if (!result.event) {error(result.clarification || "Précise la date et le moment à prévoir."); return;}
      const editor = context.dialog.querySelector("#event-save-form");
      for (const [name, value] of Object.entries(result.event)) if (editor.elements.namedItem(name)) {
        const input = editor.elements.namedItem(name);
        if (name === "allDay") input.checked = value; else input.value = value ?? "";
      }
      fillRecurrence(editor, result.event.recurrence);
      context.previousWeekday = parseDate(editor.elements.date.value).getUTCDay();
      editor.elements.allDay.dispatchEvent(new Event("change", {bubbles: true}));
      editor.elements.endDate.min = editor.elements.date.value;
      context.dialog.querySelector("#event-review").hidden = false;
      context.dirty = true;
      busy(null); mode(false);
    } catch (err) {if (current === context && !context.controller.signal.aborted) error(err.message);}
    finally {if (current === context) busy(null);}
  }
  async function save(form) {
    const context = current;
    if (!context || context.busy) return;
    const fields = new FormData(form);
    const allDay = fields.get("allDay") === "on";
    const input = {title: fields.get("title").trim(), description: fields.get("description").trim(), date: fields.get("date"), endDate: fields.get("endDate"), startTime: allDay ? null : fields.get("startTime"), endTime: allDay ? null : fields.get("endTime"), allDay, recurrence: recurrenceInput(form)};
    if (!input.title) {error("Ajoute un titre à cet événement."); return;}
    if (input.endDate < input.date || (!allDay && `${input.endDate}T${input.endTime}` <= `${input.date}T${input.startTime}`)) {error("La fin doit être après le début de l’événement."); return;}
    if (input.recurrence?.frequency === "weekly" && !input.recurrence.weekdays.includes(parseDate(input.date).getUTCDay())) {error("Sélectionne au moins le jour de la date de début pour répéter l’événement chaque semaine."); return;}
    error(""); busy("save");
    try {
      const result = context.event ? await repository.updateEvent(context.event, input, context.controller.signal) : await repository.addEvent(input, context.requestId, context.controller.signal);
      ++loadId;
      const events = store.getState().events.filter(event => event.id !== result.event.id);
      store.setEvents([...events, result.event], {eventsStatus: "ready", eventsError: ""});
      context.dirty = false; context.dialog.close();
      toast(context.event ? "Modifications enregistrées." : result.event.recurrence ? "Série ajoutée à ton calendrier." : "Événement ajouté à ton calendrier.", result.event.date);
    } catch (err) {if (current === context) {error(err.message); busy(null); if (["conflict", "not_found"].includes(err.code)) void loadEvents();}}
  }
  async function remove() {
    const context = current;
    if (!context?.event || context.busy) return;
    error(""); busy("delete");
    try {
      await repository.deleteEvent(context.event, context.controller.signal);
      ++loadId;
      store.setEvents(store.getState().events.filter(event => event.id !== context.event.id), {eventsStatus: "ready", eventsError: ""});
      context.dirty = false; context.dialog.close(); toast(context.event.recurrence ? "Série supprimée." : "Événement supprimé.");
    } catch (err) {if (current === context) {error(err.message); busy(null); if (["conflict", "not_found"].includes(err.code)) void loadEvents();}}
  }
  const actions = {
    "create-event": element => {store.closeSidebar(); open(null, element.dataset.date, element.dataset.time);},
    "open-event": element => {const event = store.getState().events.find(event => event.id === element.dataset.eventId); if (event) open(event);},
    "events-retry": loadEvents,
    "event-natural": () => mode(true), "event-manual": () => mode(false),
    "event-example": element => {if (!current || current.busy) return; const input = current.dialog.querySelector("#event-prompt"); input.value = element.dataset.text; current.dirty = true; input.focus();},
    "close-event-dialog": requestClose,
    "event-delete": () => {current.dialog.querySelector("#event-delete-confirm").hidden = false; current.dialog.querySelector('[data-action="event-delete-cancel"]').focus();},
    "event-delete-cancel": () => {current.dialog.querySelector("#event-delete-confirm").hidden = true; current.dialog.querySelector('[data-action="event-delete"]').focus();},
    "event-delete-confirm": remove,
    "event-discard-cancel": () => {current.dialog.querySelector("#event-discard-confirm").hidden = true; current.dialog.querySelector("section:not([hidden]) input, section:not([hidden]) textarea")?.focus();},
    "event-discard-confirm": () => {if (!["save", "delete"].includes(current.busy)) current.dialog.close();},
  };
  document.addEventListener("click", e => {
    const element = e.target.closest("[data-action]");
    if (element && actions[element.dataset.action] && !element.disabled) {e.preventDefault(); actions[element.dataset.action](element);}
  });
  document.addEventListener("submit", e => {
    if (!["event-interpret-form", "event-save-form"].includes(e.target.id)) return;
    e.preventDefault();
    void (e.target.id === "event-interpret-form" ? interpret(e.target) : save(e.target));
  });
  document.addEventListener("visibilitychange", () => {if (!document.hidden) void loadEvents();});
  return {loadEvents, openCreate: () => open(), openEvent(id) {const event = store.getState().events.find(event => event.id === id); if (event) open(event);}, toast, acceptEvents(added) {
    ++loadId;
    const ids = new Set(added.map(event => event.id));
    store.setEvents([...store.getState().events.filter(event => !ids.has(event.id)), ...added], {eventsStatus: "ready", eventsError: ""});
  }};
}
