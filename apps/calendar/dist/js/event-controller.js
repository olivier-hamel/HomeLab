import {dateKey, parseDate, addDays, fullDate} from "./date.js";
import {createEventRepository} from "./events.js";
import {eventDialog} from "./components/event-dialog.js";
import {recurrenceLabel, firstOccurrenceDate} from "./recurrence.js";

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
    const task = form.elements.kind.value === "task";
    const hasDeadline = !task || form.elements.hasDeadline.checked;
    form.querySelector("#task-status-fields").hidden = !task;
    form.querySelector("#task-details-fields").hidden = !task;
    form.querySelector("#event-start-datetime").hidden = !hasDeadline;
    form.elements.date.required = hasDeadline;
    form.querySelector(".event-recurrence").hidden = task;
    if (task) form.elements.recurrenceFrequency.value = "none";
    form.elements.contextName.required = task && !!form.elements.contextKind.value;
    form.elements.contextName.disabled = !task || !form.elements.contextKind.value;
    form.querySelector("#event-all-day-toggle").hidden = task && !hasDeadline;
    form.querySelector("#event-all-day-toggle span").textContent = task ? "Sans heure précise" : "Toute la journée";
    for (const field of form.querySelectorAll(".event-time-field")) {
      const input = field.querySelector("input");
      field.hidden = form.elements.allDay.checked || task && (input.name === "endTime" || !hasDeadline);
      input.disabled = field.hidden; input.required = !field.hidden;
    }
    const frequency = form.elements.recurrenceFrequency.value;
    const enabled = frequency !== "none";
    const ending = form.elements.recurrenceEnd.value;
    const allDay = form.elements.allDay.checked;
    const multiday = form.elements.occurrenceMultiDay;
    if (!enabled || !allDay) multiday.checked = form.elements.endDate.value > form.elements.date.value;
    const singleDay = enabled && allDay && !multiday.checked;
    form.querySelector("#event-multiday-toggle").hidden = !enabled || !allDay;
    form.querySelector("#event-end-datetime").hidden = singleDay || task;
    form.elements.endDate.required = !singleDay && !task;
    if (task) form.elements.endDate.value = form.elements.date.value;
    if (singleDay) form.elements.endDate.value = form.elements.date.value;
    form.querySelector("#event-date-label").textContent = task ? "Échéance" : enabled ? "À partir du" : "Date de début";
    form.querySelector('label[for="event-start"]').textContent = task ? "Heure limite" : "Heure de début";
    form.querySelector("#event-end-date-label").textContent = enabled ? "Fin de la première occurrence" : "Date de fin";
    form.querySelector("#event-occurrence-note").hidden = !enabled || singleDay;
    const occurrenceEnd = parseDate(form.elements.endDate.value);
    const suggestion = form.querySelector("#event-series-end-suggestion");
    suggestion.hidden = !enabled || ending !== "never" || !occurrenceEnd || form.elements.endDate.value <= form.elements.date.value;
    if (!suggestion.hidden) suggestion.querySelector("button").textContent = `Terminer la série le ${fullDate(occurrenceEnd)}`;
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
    const rule = recurrenceInput(form);
    form.querySelector("#event-recurrence-summary").textContent = recurrenceLabel(rule);
    const date = parseDate(form.elements.date.value);
    const first = firstOccurrenceDate(form.elements.date.value, rule);
    const note = form.querySelector("#event-recurrence-date-note");
    if (first && dateKey(first) !== form.elements.date.value) {
      const offset = Math.round((first.getTime() - date.getTime()) / 86_400_000);
      const end = occurrenceEnd && addDays(occurrenceEnd, offset);
      note.textContent = `Première occurrence : ${fullDate(first)}${end && dateKey(end) > dateKey(first) && end.getUTCFullYear() <= 9999 ? ` au ${fullDate(end)}` : ""}.`;
    } else note.textContent = frequency === "monthly" && date?.getUTCDate() > 28 ? "Les mois sans ce jour seront sautés." : frequency === "yearly" && date?.getUTCMonth() === 1 && date.getUTCDate() === 29 ? "Le 29 février se répète seulement les années bissextiles." : "";
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
      if (id === loadId) store.setEvents(result.events, {eventsStatus: "ready", eventsError: "", aiAvailable: result.aiAvailable, eventTypes: result.eventTypes || [], moodleSync: result.moodleSync});
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
    dialogRoot.innerHTML = eventDialog({event, date, aiAvailable: state.aiAvailable, documents: state.documents, documentsStatus: state.documentsStatus, eventTypes: state.eventTypes});
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
        if (weekday !== undefined && form.elements.recurrenceFrequency.value !== "weekly") {
          for (const input of form.querySelectorAll('[name="recurrenceWeekdays"]')) input.checked = Number(input.value) === weekday;
        }
        if (form.elements.recurrenceUntil.value < form.elements.date.value) form.elements.recurrenceUntil.value = form.elements.date.value;
      }
      if (e.target.name === "recurrenceFrequency" && e.target.value === "weekly") {
        const weekday = parseDate(form.elements.date.value)?.getUTCDay();
        if (weekday !== undefined && !form.querySelector('[name="recurrenceWeekdays"]:checked')) form.querySelector(`[name="recurrenceWeekdays"][value="${weekday}"]`).checked = true;
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
      for (const [name, value] of Object.entries(result.event)) if (["title", "description", "date", "endDate", "startTime", "endTime", "allDay", "completed", "kind", "notes", "typeId"].includes(name) && editor.elements.namedItem(name)) {
        const input = editor.elements.namedItem(name);
        if (["allDay", "completed"].includes(name)) input.checked = value; else if (!["links", "context", "deadline"].includes(name)) input.value = value ?? "";
      }
      editor.elements.kind.value = result.event.kind || "event";
      editor.elements.hasDeadline.checked = result.event.deadline !== null;
      editor.elements.contextKind.value = result.event.context?.kind || "";
      editor.elements.contextName.value = result.event.context?.name || "";
      editor.elements.links.value = (result.event.links || []).join("\n");
      for (const input of editor.querySelectorAll('[name="documentIds"]')) input.checked = (result.event.documentIds || []).includes(input.value);
      editor.elements.occurrenceMultiDay.checked = result.event.endDate > result.event.date;
      fillRecurrence(editor, result.event.recurrence);
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
    syncRecurrence(form);
    const fields = new FormData(form);
    const allDay = fields.get("allDay") === "on";
    const input = {title: fields.get("title").trim(), description: fields.get("description").trim(), date: fields.get("date"), endDate: fields.get("endDate"), startTime: allDay ? null : fields.get("startTime"), endTime: allDay ? null : fields.get("endTime"), allDay, recurrence: recurrenceInput(form), typeId: fields.get("typeId") || "none"};
    if (form.elements.kind.value === "task") {
      const deadline = form.elements.hasDeadline.checked ? {date: input.date, time: allDay ? null : input.startTime} : null;
      const contextKind = form.elements.contextKind.value;
      const previousContext = context.event?.context;
      Object.assign(input, {kind: "task", completed: form.elements.completed.checked, deadline, recurrence: null, endDate: input.date, allDay: !deadline?.time, startTime: deadline?.time || null, endTime: deadline?.time || null,
        notes: form.elements.notes.value.trim(), links: form.elements.links.value.split(/\r?\n/).map(link => link.trim()).filter(Boolean), documentIds: fields.getAll("documentIds"),
        context: contextKind ? {kind: contextKind, name: form.elements.contextName.value.trim(), ...(previousContext?.courseId && previousContext.kind === contextKind && previousContext.name === form.elements.contextName.value.trim() ? {courseId: previousContext.courseId} : {})} : null});
    } else if (context.event?.kind === "task") Object.assign(input, {kind: "event", completed: false, completedAt: null, deadline: null});
    if (!input.title) {error("Ajoute un titre à cet événement."); return;}
    if (input.endDate < input.date || (input.kind !== "task" && !allDay && `${input.endDate}T${input.endTime}` <= `${input.date}T${input.startTime}`)) {error("La fin doit être après le début de l’événement."); return;}
    if (input.recurrence?.frequency === "weekly" && !input.recurrence.weekdays.length) {error("Choisis au moins un jour de la semaine pour la répétition."); return;}
    const first = firstOccurrenceDate(input.date, input.recurrence);
    const end = parseDate(input.endDate);
    if (!first || !end) {error("Vérifie les dates de début et de fin."); return;}
    if (input.recurrence?.until && input.recurrence.until < dateKey(first)) {error("La fin de la répétition doit inclure au moins la première occurrence."); return;}
    const offset = Math.round((first.getTime() - parseDate(input.date).getTime()) / 86_400_000);
    const alignedEnd = addDays(end, offset);
    if (alignedEnd.getUTCFullYear() > 9999) {error("La fin de l’occurrence dépasse la dernière date possible."); return;}
    input.date = dateKey(first);
    input.endDate = dateKey(alignedEnd);
    error(""); busy("save");
    try {
      const result = context.event ? await repository.updateEvent(context.event, input, context.controller.signal) : await repository.addEvent(input, context.requestId, context.controller.signal);
      ++loadId;
      const events = store.getState().events.filter(event => event.id !== result.event.id);
      store.setEvents([...events, result.event], {eventsStatus: "ready", eventsError: ""});
      context.dirty = false; context.dialog.close();
      toast(context.event ? "Modifications enregistrées." : result.event.kind === "task" ? "Tâche ajoutée." : result.event.recurrence ? "Série ajoutée à ton calendrier." : "Événement ajouté à ton calendrier.", result.event.deadline === null ? null : result.event.date);
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
    "toggle-task": async element => {
      const event = store.getState().events.find(row => row.id === element.dataset.eventId);
      if (!event || event.kind !== "task") return;
      element.disabled = true;
      try {
        const result = await repository.completeTask(event, !event.completed);
        ++loadId; store.setEvents(store.getState().events.map(row => row.id === event.id ? result.event : row));
        toast(result.event.completed ? "Tâche terminée." : "Tâche remise à faire.");
        document.querySelector(`[data-action="toggle-task"][data-event-id="${event.id}"]`)?.focus({preventScroll: true});
      } catch (err) {element.disabled = false; toast(err.message); if (["conflict", "not_found"].includes(err.code)) void loadEvents();}
    },
    "moodle-sync": async element => {element.disabled = true; try {await repository.syncMoodle(); await loadEvents();} catch (err) {toast(err.message);} finally {element.disabled = false;}},
    "create-event": element => {store.closeSidebar(); open(null, element.dataset.date, element.dataset.time);},
    "open-event": element => {const event = store.getState().events.find(event => event.id === element.dataset.eventId); if (event) open(event);},
    "events-retry": loadEvents,
    "event-natural": () => mode(true), "event-manual": () => mode(false),
    "event-example": element => {if (!current || current.busy) return; const input = current.dialog.querySelector("#event-prompt"); input.value = element.dataset.text; current.dirty = true; input.focus();},
    "event-use-end-date": () => {
      if (!current || current.busy) return;
      const form = current.dialog.querySelector("#event-save-form");
      const date = parseDate(form.elements.date.value);
      const endDate = parseDate(form.elements.endDate.value);
      if (!date || !endDate || endDate < date) return;
      form.elements.recurrenceEnd.value = "until";
      form.elements.recurrenceUntil.value = dateKey(endDate);
      form.elements.endDate.value = dateKey(!form.elements.allDay.checked && form.elements.endTime.value <= form.elements.startTime.value ? addDays(date, 1) : date);
      form.elements.occurrenceMultiDay.checked = false;
      current.dirty = true;
      error(""); syncRecurrence(form);
      form.elements.recurrenceUntil.focus();
    },
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
  setInterval(() => {if (!document.hidden && !current?.busy) void loadEvents();}, 60_000);
  return {loadEvents, openCreate: () => open(), openEvent(id) {const event = store.getState().events.find(event => event.id === id); if (event) open(event);}, toast, acceptEvents(added) {
    ++loadId;
    const ids = new Set(added.map(event => event.id));
    store.setEvents([...store.getState().events.filter(event => !ids.has(event.id)), ...added], {eventsStatus: "ready", eventsError: ""});
  }};
}
