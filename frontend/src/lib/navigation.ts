export type SectionId = "home" | "calendar" | "tv" | "memo" | "library" | "camera";
export type CalendarTarget = { date?: string; view?: "month" | "week" | "day"; event?: string; create?: boolean };
export type Navigate = (section: SectionId, target?: CalendarTarget) => void;

export function sectionUrl(section: SectionId, target: CalendarTarget = {}) {
  const url = new URL(location.href);
  for (const key of ["date", "view", "event", "create"]) url.searchParams.delete(key);
  url.searchParams.set("section", section);
  if (section === "calendar") {
    if (target.date) url.searchParams.set("date", target.date);
    if (target.view) url.searchParams.set("view", target.view);
    if (target.event) url.searchParams.set("event", target.event);
    if (target.create) url.searchParams.set("create", "1");
  }
  return url;
}

export function calendarFrameUrl(search: string) {
  const source = new URLSearchParams(search), params = new URLSearchParams();
  const date = source.get("date"), view = source.get("view"), event = source.get("event");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) params.set("date", date);
  if (view && ["month", "week", "day"].includes(view)) params.set("view", view);
  if (event && /^[\w-]{1,80}$/.test(event)) params.set("event", event);
  if (source.get("create") === "1") params.set("create", "1");
  return `/calendar/${params.size ? `?${params}` : ""}`;
}
