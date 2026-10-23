import { chromium } from 'playwright';

// Used only for explicit inspection. It opens the already-authenticated profile
// without sending a prompt, reading credentials, or closing as soon as login is ready.
const profile = process.argv[2];
if (!profile) throw new Error('Profil dédié requis.');
const context = await chromium.launchPersistentContext(profile, {
  headless: false, acceptDownloads: false, viewport: { width: 1280, height: 900 }, timeout: 30_000,
});
let finish!: () => void;
const done = new Promise<void>(resolve => { finish = resolve; });
context.once('close', finish);
const stop = () => { void context.close().finally(finish); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const page = context.pages()[0] ?? await context.newPage();
try { await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
catch { /* Keep the inspection browser open so the owner can inspect/reload manually. */ }
await done;
