import { randomUUID } from "node:crypto";
import { MediaError } from "../media/core.ts";
import { withMoodle, type MoodleConnector, type MoodleCourse, type MoodleFile } from "../moodle/client.ts";
import { libraryStore, type LibraryStore } from "./store.ts";
import { fileKind, MAX_FILE_BYTES, moodleAuthorized, moodleUsers, MOODLE_FOLDER, queuedScan, semesterCourses, sourceFingerprint, stableId, SYNC_INTERVAL, validateFile, type Library } from "./model.ts";

const LEASE = 10 * 60 * 1000;
type RemoteCourse = { course: MoodleCourse; files: MoodleFile[] };
export function mergeManifest(library: Library, courses: RemoteCourse[], now: string) {
  const seen = new Set<string>();
  const ensureFolder = (id: string, name: string, parentId: string) => {
    const folder = library.folders.find(row => row.id === id);
    if (folder) Object.assign(folder, { name, parentId });
    else library.folders.push({ id, name, parentId, managed: true, createdAt: now });
  };
  for (const { course, files } of courses) {
    const courseFolder = stableId(`course:${course.id}`);
    ensureFolder(courseFolder, course.fullname.replace(/\s*\(A20\d{2}\)\s*/g, " ").trim(), MOODLE_FOLDER);
    for (const remote of files) {
      const kind = fileKind(remote.filename); if (!kind) continue;
      const section = remote.section.trim().normalize("NFC") || "Général";
      const folderId = stableId(`section:${course.id}:${section}`);
      ensureFolder(folderId, section, courseFolder);
      const id = stableId(`file:${course.id}:${remote.id}`); seen.add(id);
      let file = library.files.find(row => row.id === id);
      if (!file) {
        file = { id, name: remote.filename, kind, folderId, size: remote.filesize, blobId: null, previewId: null,
          createdAt: now, updatedAt: now, error: "", tempoScan: queuedScan(true), source: { courseId: course.id, fileId: remote.id, module: remote.module, fingerprint: "", checkedAt: "", available: true } };
        library.files.push(file);
      }
      // Preserve the cached original and its name/size until a replacement is saved.
      file.folderId = folderId;
      if (!file.blobId) Object.assign(file, { name: remote.filename, kind, size: remote.filesize });
      if (file.source) { file.source.available = true; file.source.module = remote.module; }
      if (remote.filesize > MAX_FILE_BYTES) file.error = "Ce fichier dépasse la limite de 25 Mo.";
    }
  }
  // Moodle deletions never destroy a saved original. Keep its existing folders.
  for (const file of library.files) if (file.source && !seen.has(file.id)) file.source.available = false;
  return courses.flatMap(({ course, files }) => files.filter(file => fileKind(file.filename)).map(file => ({ course, file, id: stableId(`file:${course.id}:${file.id}`) })));
}
export class MoodleSync {
  private jobs = new Map<string, Promise<void>>();
  readonly store: LibraryStore;
  private connect: MoodleConnector;
  constructor(store: LibraryStore = libraryStore, connect: MoodleConnector = withMoodle) { this.store = store; this.connect = connect; }
  async start(username: string, force = false) {
    if (!moodleAuthorized(username)) throw new MediaError("moodle_access", "Ton compte n’a pas accès à cette connexion Moodle.", 403);
    if (!process.env.MOODLE_MCP_URL) throw new MediaError("moodle_config", "La connexion Moodle n’est pas configurée.", 503);
    if (this.jobs.has(username)) return false;
    const token = randomUUID(), now = new Date().toISOString();
    const claimed = await this.store.mutate(username, library => {
      if (library.sync.status === "running" && Date.parse(library.sync.leaseUntil) > Date.now()) return false;
      if (!force && library.sync.lastAttempt && Date.now() - Date.parse(library.sync.lastAttempt) < SYNC_INTERVAL) return false;
      library.sync = { ...library.sync, status: "running", token, lastAttempt: now, leaseUntil: new Date(Date.now() + LEASE).toISOString(), message: "Recherche des fichiers Moodle…", saved: 0, total: 0 };
      return true;
    });
    if (!claimed) return false;
    const job = this.run(username, token).finally(() => this.jobs.delete(username));
    this.jobs.set(username, job); void job.catch(() => {});
    return true;
  }
  async wait(username: string) { await this.jobs.get(username); }
  private async commit(username: string, token: string, change: (library: Library) => void) {
    if (!moodleAuthorized(username)) throw new MediaError("moodle_access", "L’accès Moodle a été retiré.", 403);
    await this.store.mutate(username, library => {
      if (library.sync.token !== token) throw new MediaError("sync_superseded", "Une nouvelle synchronisation a pris le relais.", 409);
      change(library); library.sync.leaseUntil = new Date(Date.now() + LEASE).toISOString();
    });
  }
  private async run(username: string, token: string) {
    try {
      let canDownload = false;
      const courses = await this.connect(AbortSignal.timeout(60_000), async session => {
        const selected = semesterCourses(await session.courses(), process.env.LIBRARY_MOODLE_SEMESTER || "A26");
        canDownload = !!session.download;
        const rows: RemoteCourse[] = [];
        for (const course of selected) rows.push({ course, files: await session.files(course.id) });
        return rows;
      });
      const now = new Date().toISOString(); let work: ReturnType<typeof mergeManifest> = [];
      await this.commit(username, token, library => {
        work = mergeManifest(library, courses, now);
        library.sync.total = work.length;
        library.sync.message = "Enregistrement des fichiers originaux…";
      });
      if (!canDownload) {
        await this.finish(username, token, "warning", "Les cours sont répertoriés. Active l’outil de téléchargement du serveur Moodle pour sauvegarder les originaux.", false); return;
      }
      let failed = 0, saved = 0;
      const originalFiles = (await this.store.snapshot(username)).files;
      for (const { course, file: remote, id } of work) {
        if (!moodleAuthorized(username)) throw new MediaError("moodle_access", "L’accès Moodle a été retiré.", 403);
        const file = originalFiles.find(row => row.id === id)!;
        if (remote.filesize > MAX_FILE_BYTES) { failed++; continue; }
        // Moodle's modified timestamp detects same-size edits. Older servers get
        // a daily refresh so a replacement with the same byte length is found.
        const fingerprint = sourceFingerprint(remote);
        const needsDailyRefresh = !remote.modified && !remote.contenthash && Date.now() - Date.parse(file.source?.checkedAt || "1970-01-01") > 24 * 60 * 60 * 1000;
        if (file.blobId && !file.error && file.source?.fingerprint === fingerprint && !needsDailyRefresh) { saved++; continue; }
        let blobId: string | null = null;
        try {
          const downloaded = await this.connect(AbortSignal.timeout(60_000), async session => {
            if (!session.download) throw new MediaError("moodle_download", "Le téléchargement Moodle est indisponible.", 503);
            return session.download(course.id, remote.id);
          });
          const validated = validateFile(downloaded.filename, downloaded.bytes);
          if (downloaded.filename !== remote.filename) throw new MediaError("moodle_changed", "Le fichier Moodle a changé. Il sera repris à la prochaine synchronisation.", 409);
          blobId = await this.store.blobs.put(downloaded.bytes);
          await this.commit(username, token, library => {
            const current = library.files.find(row => row.id === id)!;
            Object.assign(current, validated, { size: downloaded.bytes.length, blobId, previewId: null, updatedAt: new Date().toISOString(), error: "" });
            Object.assign(current.source!, { fingerprint, checkedAt: new Date().toISOString(), available: true });
            library.sync.saved = saved + 1;
            library.sync.message = `${saved + 1} / ${work.length} fichiers enregistrés`;
          });
          saved++;
          for (const old of [file.blobId, file.previewId]) if (old && old !== blobId) await this.store.blobs.remove(old).catch(() => {});
        } catch (error) {
          if (blobId) await this.store.blobs.remove(blobId).catch(() => {});
          if (error instanceof MediaError && ["moodle_access", "sync_superseded"].includes(error.code)) throw error;
          failed++;
          await this.commit(username, token, library => {
            const current = library.files.find(row => row.id === id);
            if (current) current.error = error instanceof MediaError && ["format", "too_large", "moodle_changed"].includes(error.code) ? error.message : "Téléchargement interrompu. Une nouvelle tentative sera effectuée automatiquement.";
          });
        }
      }
      await this.commit(username, token, library => { library.sync.saved = saved; });
      await this.finish(username, token, failed ? "warning" : "idle", failed ? `${saved} fichiers enregistrés. ${failed} fichier${failed > 1 ? "s" : ""} à reprendre.` : courses.length ? "Tous les fichiers sont à jour." : "Aucun cours du semestre sélectionné n’est accessible sur Moodle.", !failed);
    } catch {
      await this.store.mutate(username, library => {
        if (library.sync.token !== token) return;
        Object.assign(library.sync, { status: "error", message: "La connexion Moodle est indisponible. Les fichiers déjà enregistrés restent accessibles.", token: "", leaseUntil: "" });
      }).catch(() => {});
    }
  }
  private async finish(username: string, token: string, status: "idle" | "warning", message: string, success: boolean) {
    await this.commit(username, token, library => Object.assign(library.sync, { status, message, token: "", ...(success ? { lastSuccess: new Date().toISOString() } : {}) }));
  }
}
export const moodleSync = new MoodleSync();
let scheduler: ReturnType<typeof setInterval> | undefined;
export function startLibraryScheduler() {
  if (scheduler) return;
  const tick = async () => {
    if (!process.env.MOODLE_MCP_URL) return;
    for (const username of moodleUsers()) await moodleSync.start(username).catch(() => {});
  };
  scheduler = setInterval(() => { void tick(); }, 60_000); scheduler.unref();
  const initial = setTimeout(() => { void tick(); }, 15_000); initial.unref();
}
