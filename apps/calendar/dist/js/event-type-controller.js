import {createEventRepository} from "./events.js";
import {eventTypesDialog, eventTypeList} from "./components/event-types-dialog.js";

export function createEventTypeController(store, dialogRoot, events) {
  const repository = createEventRepository();
  let current = null;
  function error(message = "") {
    const field = current?.dialog.querySelector("#event-types-error");
    if (field) {field.textContent = message; field.hidden = !message; if (message) field.focus();}
  }
  function busy(value) {
    current.busy = value;
    current.dialog.setAttribute("aria-busy", String(value));
    for (const field of current.dialog.querySelectorAll("button, input, select")) field.disabled = value;
  }
  function close() {if (!current?.busy) current?.dialog.close();}
  function refresh(message) {
    current.dialog.querySelector("#event-types-list").innerHTML = eventTypeList(store.getState().eventTypes);
    current.dialog.querySelector("#event-types-status").textContent = message;
  }
  async function create(form) {
    if (!current || current.busy) return;
    const fields = new FormData(form), input = {name: fields.get("name").trim(), importance: Number(fields.get("importance"))};
    if (!input.name) {error("Donne un nom au type d’événement."); return;}
    const context = current;
    // Keep the same ID when retrying an interrupted request with identical details.
    if (JSON.stringify(input) !== context.input) {context.requestId = crypto.randomUUID(); context.input = JSON.stringify(input);}
    error(); busy(true);
    try {
      const result = await repository.addEventType(input, context.requestId, context.controller.signal);
      store.setEventTypes([...store.getState().eventTypes.filter(type => type.id !== result.eventType.id), result.eventType]);
      form.reset(); refresh("Type créé."); context.input = null;
    } catch (err) {if (!context.controller.signal.aborted) error(err.message);}
    finally {if (current === context) {busy(false); if (!context.input) form.elements.name.focus();}}
  }
  async function remove() {
    const context = current;
    if (!context?.deleting || context.busy) return;
    error(); busy(true);
    try {
      const result = await repository.deleteEventType(context.deleting, context.controller.signal);
      store.setEventTypes(result.eventTypes);
      events.acceptEvents(result.events);
      context.dialog.querySelector("#event-type-delete-confirm").hidden = true;
      refresh("Type supprimé. Ses événements sont conservés."); context.deleting = null;
    } catch (err) {if (!context.controller.signal.aborted) error(err.message);}
    finally {if (current === context) {busy(false); context.dialog.querySelector("#event-type-name").focus();}}
  }
  async function open() {
    if (dialogRoot.querySelector("dialog[open]")) return;
    const opener = document.activeElement;
    store.closeSidebar();
    dialogRoot.innerHTML = eventTypesDialog(store.getState().eventTypes);
    const dialog = dialogRoot.querySelector("dialog");
    const context = {dialog, opener, busy: false, controller: new AbortController(), deleting: null, input: null}; current = context;
    dialog.addEventListener("cancel", event => {event.preventDefault(); close();});
    dialog.addEventListener("close", () => {context.controller.abort(); current = null; dialogRoot.replaceChildren(); (document.contains(opener) ? opener : document.querySelector('[data-action="manage-event-types"]'))?.focus({preventScroll: true});}, {once: true});
    dialog.addEventListener("submit", event => {event.preventDefault(); void create(event.target);});
    dialog.addEventListener("click", event => {
      if (context.busy) return;
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "close-event-types") close();
      if (action === "delete-event-type") {
        const type = store.getState().eventTypes.find(type => type.id === button.dataset.typeId);
        if (!type || type.hidden) return;
        context.deleting = type.id;
        dialog.querySelector("#event-type-delete-description").textContent = `Le type « ${type.name} » sera supprimé. Ses événements resteront dans ton calendrier avec une importance normale.`;
        dialog.querySelector("#event-type-delete-confirm").hidden = false;
        dialog.querySelector('[data-action="cancel-delete-event-type"]').focus();
      }
      if (action === "cancel-delete-event-type") {context.deleting = null; dialog.querySelector("#event-type-delete-confirm").hidden = true; dialog.querySelector("#event-type-name").focus();}
      if (action === "confirm-delete-event-type") void remove();
    });
    dialog.showModal(); busy(true);
    try {
      const result = await repository.listEventTypes(context.controller.signal);
      if (current === context) {store.setEventTypes(result.eventTypes); refresh("");}
    } catch (err) {if (current === context && !context.controller.signal.aborted) error(err.message);}
    finally {if (current === context) {busy(false); if (dialog.querySelector("#event-types-error").hidden) dialog.querySelector("#event-type-name").focus();}}
  }
  return {open};
}
