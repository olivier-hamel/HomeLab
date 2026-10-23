import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { buildServer, loadConfig, AppError } from 'tab2api';
import { generateWebTurn } from './web-turn.js';
import { attachmentHandoff } from './engine-attachments.js';

// Only three internal module paths from the pinned 0.3.0 package are used.
// Public HTTP/schema/security/queue implementation remains upstream tab2api.
const upstream = dirname(createRequire(import.meta.url).resolve('tab2api'));
const { createBrowserController } = await import(pathToFileURL(join(upstream, 'browser/factory.js')).href);
const { ChatGptAdapter } = await import(pathToFileURL(join(upstream, 'adapters/chatgpt/adapter.js')).href);
const { createLogger } = await import(pathToFileURL(join(upstream, 'observability/logger.js')).href);
const config = await loadConfig();
const logger = createLogger('warn');
const browser = createBrowserController(config);
const provider = new ChatGptAdapter(browser, config, logger);
const generate = async (request: Parameters<typeof generateWebTurn>[1]) => {
  const page = await browser.getPage();
  return generateWebTurn(page, request, observation => {
    writeFileSync(join(config.dataDir, 'last-turn-observation.json'), JSON.stringify(observation), { mode: 0o600 });
  });
};
const app = buildServer({ config, provider, logger });
provider.generate = attachmentHandoff(app, generate);
app.setErrorHandler((error: unknown, _request, reply) => {
  const safe = error instanceof AppError ? error : new AppError('ui_changed', 'Browser request failed; no resubmission was attempted.');
  const remote = error && typeof error === 'object' && 'conversation_id' in error ? error.conversation_id : undefined;
  return reply.code(safe.statusCode).send({ error: { code: safe.code, message: safe.message, ...(typeof remote === 'string' && { conversation_id: remote }) } });
});
let stopping: Promise<void> | undefined;
const stop = () => { stopping ??= app.close(); void stopping.catch(() => { process.exitCode = 1; }); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
await app.listen({ host: config.host, port: config.port });
