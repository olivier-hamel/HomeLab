import { readFile, writeFile, rm } from 'node:fs/promises';

// Next's route exclusions do not apply to the instrumentation trace. Runtime
// documents must never accompany a standalone source handoff, even in a local
// build made after syncing Moodle. Docker also excludes this data from context.
const trace = new URL('../.next/server/instrumentation.js.nft.json', import.meta.url);
try {
  const data = JSON.parse(await readFile(trace, 'utf8'));
  data.files = data.files.filter(file => !/(^|[\\/])\.local-data([\\/]|$)/.test(file));
  await writeFile(trace, JSON.stringify(data));
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(new URL('../.next/standalone/.local-data/', import.meta.url), { recursive: true, force: true });
