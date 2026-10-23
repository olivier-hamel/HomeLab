import { join } from 'node:path';
import { loadConfig } from './config.js';
import { acquireLock, Processes } from './processes.js';
import { Desktop } from './desktop.js';
import { Engine } from './engine.js';
import { Store } from './store.js';
import { Scheduler } from './scheduler.js';
import { Maintenance } from './maintenance.js';
import { buildServer } from './server.js';
import { errorInfo } from './errors.js';

process.umask(0o077);
let stop: (() => Promise<void>) | undefined;
try {
  if (process.platform !== 'linux') throw new Error('Cette première version nécessite Linux.');
  const config = loadConfig();
  const unlock = acquireLock(config.dataDir);
  let processes: Processes | undefined;
  let store: Store | undefined;
  let scheduler: Scheduler | undefined;
  let maintenance: Maintenance | undefined;
  let app: ReturnType<typeof buildServer> | undefined;
  let stopping: Promise<void> | undefined;
  stop = () => stopping ??= (async () => {
    // Stop intake before closing the database or touching the browser profile.
    scheduler?.pause();
    await scheduler?.close();
    await maintenance?.close(true);
    await app?.close();
    await processes?.stopAll();
    store?.close();
    unlock();
  })();
  processes = new Processes(config.dataDir);
  store = new Store(join(config.dataDir, 'state.sqlite'));
  const desktop = new Desktop(config, processes);
  const engine = new Engine(config, desktop, processes);
  scheduler = new Scheduler(store, engine);
  maintenance = new Maintenance(config, desktop, engine, scheduler);
  app = buildServer({ config, store, scheduler, maintenance, probe: force => engine.probe(force) });
  await desktop.start();
  await engine.start();
  const address = await app.listen({ host: config.host, port: config.port });
  scheduler.kick();
  process.stdout.write(`Service réel prêt : ${address}\nJeton local : ${join(config.dataDir, 'api-token')} (valeur non affichée)\nConnexion : npm run cli -- session open\n`);
  const requestStop = () => { void stop!().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);
} catch (error) {
  if (stop) { try { await stop(); } catch { /* Preserve original startup error. */ } }
  const info = errorInfo(error);
  process.stderr.write(JSON.stringify({ error: { ...info, message: error instanceof Error && info.code === 'internal_error' ? error.message : info.message } }) + '\n');
  process.exitCode = 1;
}
