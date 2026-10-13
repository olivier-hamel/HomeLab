export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startLibraryScheduler } = await import("./lib/library/sync.ts");
    startLibraryScheduler();
  }
}
