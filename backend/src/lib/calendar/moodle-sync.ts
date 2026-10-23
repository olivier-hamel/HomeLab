import { createHash, randomUUID } from "node:crypto";
import { type Collection } from "mongodb";
import { database } from "../database.ts";
import { MediaError } from "../media/core.ts";
import { moodleAuthorized, moodleUsers, owner } from "../library/model.ts";
import { withMoodle, type MoodleConnector, type MoodleCourse, type MoodleEvent, type MoodleAssignment } from "../moodle/client.ts";
import { validateEvent, type EventInput, type MoodleSource } from "./events.ts";
import { CalendarEventStore } from "./store.ts";

const INTERVAL = 30 * 60_000, LEASE = 10 * 60_000;
export function currentSemester(now = new Date()) {
  const local = torontoCivil(now);
  const month = Number(local.date.slice(5, 7));
  return `${month >= 8 ? "A" : month >= 5 ? "E" : "H"}${local.date.slice(2, 4)}`;
}
export function semesterWindow(semester: string) {
  const match = /^([HEA])(\d{2})$/.exec(semester);
  if (!match) throw new MediaError("semester", "Configure la session au format H26, E26 ou A26.", 503);
  const year = 2000 + Number(match[2]), season = match[1];
  const start = `${year}-${season === "H" ? "01" : season === "E" ? "05" : "08"}-01`;
  const end = season === "A" ? `${year + 1}-01-01` : `${year}-${season === "H" ? "05" : "08"}-01`;
  // Generous UTC boundaries; exact Toronto dates are filtered below.
  return { start, end, timeStart: Date.parse(`${start}T00:00:00Z`) / 1000, timeEnd: Date.parse(`${end}T12:00:00Z`) / 1000 };
}
export function currentCourses(courses: MoodleCourse[], semester: string) {
  semesterWindow(semester);
  const season = semester[0], year = `20${semester.slice(1)}`, number = { H: 1, E: 2, A: 3 }[season as "H" | "E" | "A"];
  const name = { H: "Hiver", E: "(?:Été|Eté|Ete)", A: "Automne" }[season as "H" | "E" | "A"];
  const pattern = new RegExp(`(?:\\b${year}${number}\\b|\\b${season}${year}\\b|\\b${semester}\\b|${name}\\s+${year}\\b)`, "i");
  return courses.filter(course => pattern.test(`${course.shortname} ${course.fullname}`));
}
export function torontoCivil(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (key: string) => parts.find(item => item.type === key)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}
export function moodleEventId(key: string) {
  const hex = createHash("sha256").update(`moodle-calendar:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
type Import = { id: string; input: EventInput; moodle: MoodleSource };
export function moodleImports(courses: MoodleCourse[], events: MoodleEvent[], assignments: MoodleAssignment[], semester: string): Import[] {
  const window = semesterWindow(semester), byCourse = new Map(courses.map(course => [course.id, course]));
  const seasonName = { H: "hiver", E: "ete", A: "automne" }[semester[0] as "H" | "E" | "A"];
  const semesterStart = events.filter(event => /debut.*(?:trimestre|session)/.test(event.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase())
    && event.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes(seasonName))
    .map(event => torontoCivil(event.start_at).date).filter(date => date >= window.start && date < window.end).sort()[0] || window.start;
  const rows: Import[] = [];
  const append = (key: string, remote: MoodleEvent | MoodleAssignment, entity: MoodleSource["entity"], input: EventInput) => {
    const moodle: MoodleSource = { key, entity, remoteId: remote.id, courseId: remote.course_id, semester, url: remote.url,
      available: true, fingerprint: createHash("sha256").update(JSON.stringify([input.title, input.description, input.date, input.endDate, input.startTime, input.endTime, input.deadline, input.context, remote.url, "personal_deadline_checked" in remote ? remote.personal_deadline_checked : null])).digest("hex"),
      ...("personal_deadline_checked" in remote ? { personalDeadlineChecked: remote.personal_deadline_checked } : {}) };
    rows.push({ id: moodleEventId(key), input: validateEvent(input), moodle });
  };
  const context = (id: number | null) => byCourse.has(id!) ? { kind: "course" as const, name: byCourse.get(id!)!.shortname, courseId: id! } : null;
  const base = { description: "", recurrence: null, typeId: "none", notes: "", documentIds: [], links: [] };
  for (const row of assignments) {
    if (!byCourse.has(row.course_id)) continue;
    const due = row.personal_deadline_checked ? row.effective_due_at : row.due_at;
    const deadline = due ? torontoCivil(due) : null;
    append(`assignment:${row.course_id}:${row.id}`, row, "assignment", { ...base, title: row.name.trim().slice(0, 160) || "Travail Moodle", kind: "task", completed: row.submitted, completedAt: null, deadline,
      date: deadline?.date || window.start, endDate: deadline?.date || window.start, allDay: !deadline?.time, startTime: deadline?.time || null, endTime: deadline?.time || null, context: context(row.course_id) });
  }
  const assignmentKeys = new Set(assignments.filter(row => byCourse.has(row.course_id)).map(row => `${row.course_id}:${row.id}`));
  for (const row of events) {
    if (row.course_id && row.course_id !== 1 && !byCourse.has(row.course_id)) continue;
    const start = torontoCivil(row.start_at);
    if (start.date < window.start || start.date >= window.end) continue;
    if (!byCourse.has(row.course_id!) && start.date < semesterStart) continue;
    // An assignment's opening/due/cutoff reminders share its submission box.
    if (row.module === "assign" && row.instance_id && byCourse.has(row.course_id!)) {
      if (!assignmentKeys.has(`${row.course_id}:${row.instance_id}`) && row.event_type === "due") {
        const key = `assignment:${row.course_id}:${row.instance_id}`;
        if (!rows.some(item => item.moodle.key === key)) append(key, { id: row.instance_id, name: row.name, course_id: row.course_id!, due_at: row.start_at, effective_due_at: null, personal_deadline_checked: false, url: row.url, submitted: false }, "assignment",
          { ...base, title: row.name.trim().slice(0, 160) || "Travail Moodle", kind: "task", completed: false, completedAt: null, deadline: start, date: start.date, endDate: start.date, allDay: false, startTime: start.time, endTime: start.time, context: context(row.course_id) });
      }
      continue;
    }
    const allDay = start.time === "00:00" && (row.duration_seconds === 0 || row.duration_seconds >= 23 * 3600);
    const end = torontoCivil(new Date(Date.parse(row.start_at) + Math.max(row.duration_seconds, allDay ? 0 : 60) * 1000 - (allDay && row.duration_seconds ? 1 : 0)));
    append(`event:${row.id}`, row, "event", { ...base, title: row.name.trim().slice(0, 160) || "Événement Moodle", date: start.date, endDate: end.date,
      allDay, startTime: allDay ? null : start.time, endTime: allDay ? null : end.time, context: context(row.course_id) });
  }
  return rows;
}

type SyncState = { username: string; status: "idle" | "running" | "warning" | "error"; semester: string; lastAttempt: string; lastSuccess: string; message: string; token: string; leaseUntil: string };
const emptyState = (username: string): SyncState => ({ username, status: "idle", semester: "", lastAttempt: "", lastSuccess: "", message: "", token: "", leaseUntil: "" });
let collectionPromise: Promise<Collection<SyncState>> | null = null;
async function syncCollection() {
  collectionPromise ??= (async () => { const collection = (await database()).collection<SyncState>("calendar_moodle_sync"); await collection.createIndex({ username: 1 }, { unique: true }); return collection; })().catch(error => { collectionPromise = null; throw error; });
  return collectionPromise;
}
export class CalendarMoodleSync {
  private jobs = new Map<string, Promise<void>>();
  private store: CalendarEventStore;
  private connect: MoodleConnector;
  private collection: typeof syncCollection;
  constructor(store = new CalendarEventStore(), connect: MoodleConnector = withMoodle, collection = syncCollection) { this.store = store; this.connect = connect; this.collection = collection; }
  async status(username: string) {
    const state = await (await this.collection()).findOne({ username: owner(username) }) || emptyState(username);
    const { status, semester, lastAttempt, lastSuccess, message, leaseUntil } = state;
    return { status: status === "running" && Date.parse(leaseUntil) < Date.now() ? "warning" : status, semester, lastAttempt, lastSuccess, message, intervalMinutes: 30 };
  }
  async start(username: string, force = false) {
    if (!moodleAuthorized(username)) throw new MediaError("moodle_access", "Ton compte n’a pas accès à cette connexion Moodle.", 403);
    if (!process.env.MOODLE_MCP_URL) throw new MediaError("moodle_config", "La connexion Moodle n’est pas configurée.", 503);
    if (this.jobs.has(username)) return false;
    const semester = process.env.CALENDAR_MOODLE_SEMESTER?.trim() || currentSemester(); semesterWindow(semester);
    const collection = await this.collection();
    try { await collection.updateOne({ username: owner(username) }, { $setOnInsert: emptyState(username) }, { upsert: true }); } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    const previous = await collection.findOne({ username });
    if (!previous || previous.status === "running" && Date.parse(previous.leaseUntil) > Date.now()) return false;
    if (!force && previous.status !== "running" && previous.semester === semester && Date.now() - Date.parse(previous.lastAttempt || "1970-01-01") < INTERVAL) return false;
    const token = randomUUID(), now = new Date().toISOString();
    const claimed = await collection.findOneAndUpdate({ username, token: previous.token, lastAttempt: previous.lastAttempt }, { $set: { token, semester, status: "running", lastAttempt: now, leaseUntil: new Date(Date.now() + LEASE).toISOString(), message: "Mise à jour des événements et remises Moodle…" } }, { returnDocument: "after" });
    if (!claimed) return false;
    const job = this.run(username, token, semester).finally(() => this.jobs.delete(username));
    this.jobs.set(username, job); void job.catch(() => {}); return true;
  }
  async wait(username: string) { await this.jobs.get(username); }
  private async run(username: string, token: string, semester: string) {
    const collection = await this.collection();
    try {
      const window = semesterWindow(semester);
      const courses = currentCourses(await this.connect(AbortSignal.timeout(60_000), session => session.courses()), semester);
      const eventResult = await this.connect(AbortSignal.timeout(60_000), session => {
        if (!session.events || !session.assignments) throw new MediaError("moodle_tools", "Mets à jour le connecteur Moodle pour les événements et remises.", 503);
        return session.events(window.timeStart, window.timeEnd);
      });
      const assignments: MoodleAssignment[] = []; let warnings = eventResult.warnings.length;
      const omissions = (items: unknown[]) => items.some(item => !item || typeof item !== "object" || (item as { warningcode?: string }).warningcode !== "personal_deadline_unavailable");
      let incomplete = omissions(eventResult.warnings);
      for (const course of courses) {
        try {
          const result = await this.connect(AbortSignal.timeout(60_000), session => {
            if (!session.assignments) throw new MediaError("moodle_tools", "Les remises Moodle sont indisponibles.", 503);
            return session.assignments(course.id);
          });
          assignments.push(...result.items); warnings += result.warnings.length + result.items.filter(row => !row.personal_deadline_checked).length;
          incomplete ||= omissions(result.warnings);
        } catch { warnings++; incomplete = true; }
      }
      if (!moodleAuthorized(username)) throw new MediaError("moodle_access", "L’accès Moodle a été retiré.", 403);
      const state = await collection.findOne({ username, token });
      if (!state || Date.parse(state.leaseUntil) < Date.now()) throw new MediaError("sync_superseded", "La synchronisation sera reprise.", 409);
      const imports = moodleImports(courses, eventResult.items, assignments, semester);
      for (const row of imports) {
        if (!moodleAuthorized(username)) throw new MediaError("moodle_access", "L’accès Moodle a été retiré.", 403);
        await this.store.importMoodle(username, row.id, row.input, row.moodle);
      }
      // Only an entirely successful snapshot can hide remotely removed items.
      if (!incomplete) await this.store.reconcileMoodle(username, new Set(imports.map(row => row.moodle.key)), semester);
      await collection.findOneAndUpdate({ username, token }, { $set: { status: warnings ? "warning" : "idle", token: "", leaseUntil: "", lastSuccess: new Date().toISOString(),
        message: warnings ? "Mise à jour partielle : certaines données ou prolongations personnelles Moodle ne sont pas vérifiées. Les éléments déjà enregistrés sont conservés." : "Les événements et remises Moodle sont à jour." } });
    } catch (error) {
      await collection.findOneAndUpdate({ username, token }, { $set: { status: "error", token: "", leaseUntil: "", message: error instanceof MediaError && error.code === "moodle_tools" ? error.message : "Moodle est indisponible. Les éléments enregistrés sont conservés; une nouvelle tentative aura lieu automatiquement." } });
    }
  }
}
export const calendarMoodleSync = new CalendarMoodleSync();
let scheduler: ReturnType<typeof setInterval> | undefined;
export function startCalendarMoodleScheduler() {
  if (scheduler) return;
  const tick = async () => { if (!process.env.MOODLE_MCP_URL || !process.env.MONGODB_URI) return; for (const username of moodleUsers()) await calendarMoodleSync.start(username).catch(() => {}); };
  scheduler = setInterval(() => { void tick(); }, 60_000); scheduler.unref();
  const initial = setTimeout(() => { void tick(); }, 15_000); initial.unref();
}
