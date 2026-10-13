export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCalendarMoodleScheduler } = await import("./lib/calendar/moodle-sync.ts");
    startCalendarMoodleScheduler();
    const { startLibraryScheduler } = await import("./lib/library/sync.ts");
    startLibraryScheduler();
    const { startTempoScanScheduler } = await import("./lib/library/scans.ts");
    startTempoScanScheduler();
  }
}
