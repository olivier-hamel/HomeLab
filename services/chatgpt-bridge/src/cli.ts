import { readFileSync, existsSync, openSync, fstatSync, closeSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { client } from './client.js';
import { errorInfo } from './errors.js';
import { attachmentsSchema, MAX_ATTACHMENTS, MAX_FILE_BYTES } from './attachments.js';

process.umask(0o077);
const help = `Service ChatGPT Plus autonome — moteur réel uniquement

npm run cli -- status [--refresh] [--json]
npm run cli -- conversations create [titre] | list | show <id>
npm run cli -- ask [--conversation <id>] [--attach <document>]... [--request-id <clé>] [--no-wait] [--json] <question>
npm run cli -- ask --conversation <id> --stdin
npm run cli -- runs show <id>
npm run cli -- approve <action-id> | deny <action-id> [--no-wait] [--json]
npm run cli -- cancel <run-id>
npm run cli -- session open [--inspect] | show | close [--json]
npm run doctor

Une action en attente affiche ses arguments puis rend la main. approve/deny reprend l’échange.
session open affiche une URL noVNC et un mot de passe temporaire : ne pas les partager.
Les identifiants, conversations et résultats restent privés dans .local-data.
`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    json: { type: 'boolean' }, refresh: { type: 'boolean' }, 'no-wait': { type: 'boolean' }, stdin: { type: 'boolean' }, inspect: { type: 'boolean' },
    conversation: { type: 'string' }, 'request-id': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    attach: { type: 'string', multiple: true },
  } });
  const [command, subcommand, ...rest] = positionals;
  if (!command || command === 'help' || values.help) { process.stdout.write(help); }
  else {
    const config = loadConfig(), call = client(config);
    const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, values.json ? 0 : 2) + '\n');
    const id = (value?: string) => {
      if (!value || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Identifiant UUID requis.');
      return value;
    };
    const waitRun = async (runId: string) => {
      let result;
      do {
        result = await call('GET', `/v1/runs/${id(runId)}`);
        if (!['queued','running'].includes(result.status)) break;
        await delay(1000);
      } while (true);
      if (values.json || result.status !== 'completed') print(result);
      else {
        process.stdout.write(result.answer + '\n');
        process.stderr.write(`conversation=${result.conversation_id} run=${result.id}\n`);
        if (result.warning) process.stderr.write(result.warning + '\n');
      }
      if (['failed','interrupted','cancelled'].includes(result.status)) process.exitCode = 1;
    };
    if (command === 'status') print(await call('GET', `/v1/status${values.refresh ? '?refresh=true' : ''}`));
    else if (command === 'conversations') {
      if (subcommand === 'create') print(await call('POST', '/v1/conversations', { title: rest.join(' ') || 'Nouvelle conversation' }));
      else if (subcommand === 'list') print(await call('GET', '/v1/conversations'));
      else if (subcommand === 'show') print(await call('GET', `/v1/conversations/${id(rest[0])}`));
      else throw new Error('Utiliser conversations create/list/show.');
    } else if (command === 'ask') {
      const text = values.stdin ? readFileSync(0, 'utf8').trim() : positionals.slice(1).join(' ').trim();
      if (!text || text.length > 32000) throw new Error('Question requise (1 à 32 000 caractères).');
      if ((values.attach?.length ?? 0) > MAX_ATTACHMENTS) throw new Error('Quatre documents maximum.');
      const attachments = attachmentsSchema.parse((values.attach ?? []).map(path => {
        const fd = openSync(path, 'r');
        try {
          const stat = fstatSync(fd);
          if (!stat.isFile() || !stat.size || stat.size > MAX_FILE_BYTES) throw new Error('Document local requis, non vide, de 10 Mio maximum.');
          return { filename: basename(path), data_base64: readFileSync(fd).toString('base64') };
        } finally { closeSync(fd); }
      }));
      const conversationId = values.conversation ? id(values.conversation) : (await call('POST', '/v1/conversations', { title: text.slice(0, 100) })).id;
      const result = await call('POST', `/v1/conversations/${conversationId}/messages`, { text, attachments }, values['request-id'] ?? randomUUID());
      if (values['no-wait']) print({ ...result, conversation_id: conversationId });
      else { process.stderr.write(`conversation=${conversationId} run=${result.run_id}\n`); await waitRun(result.run_id); }
    } else if (command === 'approve' || command === 'deny') {
      const result = await call('POST', `/v1/actions/${id(subcommand)}/decision`, { approved: command === 'approve' });
      if (values['no-wait']) print(result); else await waitRun(result.run_id);
    } else if (command === 'runs' && subcommand === 'show') print(await call('GET', `/v1/runs/${id(rest[0])}`));
    else if (command === 'cancel') print(await call('POST', `/v1/runs/${id(subcommand)}/cancel`));
    else if (command === 'session') {
      if (subcommand === 'close') print(await call('DELETE', '/v1/session/maintenance'));
      else if (subcommand === 'show') print(await call('GET', '/v1/session/maintenance'));
      else if (subcommand === 'open') {
        let session = await call('POST', '/v1/session/maintenance', { inspect: values.inspect ?? false });
        if (!values.json) process.stderr.write('Préparation de la session ; attente de la génération en cours si nécessaire…\n');
        while (session.state === 'opening') { await delay(500); session = await call('GET', '/v1/session/maintenance'); }
        print(session);
        if (session.state === 'failed') process.exitCode = 1;
      } else throw new Error('Utiliser session open/show/close.');
    } else if (command === 'doctor') {
      const checks: Record<string, unknown> = { node: process.version, platform: process.platform, data_directory: config.dataDir,
        chromium_downloaded: existsSync(config.browsersDir) };
      const { Desktop } = await import('./desktop.js');
      const desktop = new Desktop(config, {} as any);
      for (const binary of ['Xvfb','xauth','x11vnc','websockify']) {
        try { checks[binary] = desktop.binary(binary); } catch { checks[binary] = 'absent'; process.exitCode = 1; }
      }
      try { checks.novnc = desktop.noVncDir(); } catch { checks.novnc = 'absent'; process.exitCode = 1; }
      try { checks.service = await call('GET', '/v1/status?refresh=true'); }
      catch (error) { checks.service = errorInfo(error); process.exitCode = 1; }
      print(checks);
    } else throw new Error('Commande inconnue. Utiliser --help.');
  }
} catch (error) {
  const info = errorInfo(error);
  process.stderr.write(JSON.stringify({ error: { ...info, message: error instanceof Error && info.code === 'internal_error' ? error.message : info.message } }) + '\n');
  process.exitCode = 1;
}
