import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isPrivateLanCidr } from './access.js';

export const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const integer = (fallback: number, min = 1, max = 65535) => z.coerce.number().int().min(min).max(max).default(fallback);
const csv = (item: z.ZodType<string, string>) => z.string().default('').transform(value => value.split(',').map(entry => entry.trim()).filter(Boolean)).pipe(z.array(item));
const hostname = z.string().refine(value => {
  try {
    const url = new URL(`http://${value}`);
    return url.hostname === value.toLowerCase() && !url.port && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash && !value.includes('*');
  } catch { return false; }
}, 'Utiliser un nom d’hôte ou une adresse IP, sans port ni joker.').transform(value => value.toLowerCase());
const origin = z.string().refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch { return false; }
}, 'Utiliser une origine HTTP(S) exacte, sans chemin ni joker.');
const schema = z.object({
  // Wildcard LAN listeners also serve loopback, which the local CLI needs.
  BRIDGE_HOST: z.enum(['127.0.0.1', '0.0.0.0', '::']).default('127.0.0.1'),
  BRIDGE_LAN_CIDRS: csv(z.string().refine(isPrivateLanCidr, 'Utiliser un sous-réseau LAN privé (par exemple 192.168.1.0/24).')),
  BRIDGE_ALLOWED_HOSTS: csv(hostname),
  BRIDGE_ALLOWED_ORIGINS: csv(origin),
  BRIDGE_PORT: integer(3211),
  BRIDGE_ENGINE_PORT: integer(3210),
  BRIDGE_VNC_PORT: integer(5901),
  BRIDGE_MAINTENANCE_PORT: integer(6081),
  BRIDGE_TIMEOUT_MS: integer(300_000, 1_000, 600_000),
  BRIDGE_MAINTENANCE_TTL_MS: integer(900_000, 10_000, 3_600_000),
  BRIDGE_DATA_DIR: z.string().min(1).optional(),
  BRIDGE_BROWSERS_DIR: z.string().min(1).optional(),
});

export function privateDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

export function privateToken(path: string) {
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  chmodSync(path, 0o600);
  const token = readFileSync(path, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error(`Fichier de jeton invalide : ${path}`);
  return token;
}

export function loadConfig(environment = process.env) {
  const env = schema.parse(environment);
  if (env.BRIDGE_HOST !== '127.0.0.1' && env.BRIDGE_LAN_CIDRS.length === 0)
    throw new Error('BRIDGE_LAN_CIDRS est requis pour une écoute API sur le LAN.');
  const ports = [env.BRIDGE_PORT, env.BRIDGE_ENGINE_PORT, env.BRIDGE_VNC_PORT, env.BRIDGE_MAINTENANCE_PORT];
  if (new Set(ports).size !== ports.length) throw new Error('Les quatre ports du service doivent être distincts.');
  const dataDir = resolve(projectDir, env.BRIDGE_DATA_DIR ?? '.local-data');
  if (dataDir === '/' || dataDir === projectDir) throw new Error('Choisir un répertoire de données dédié.');
  privateDir(dataDir);
  const toolsDir = join(projectDir, '.local-data', 'system');
  const browsersDir = resolve(projectDir, env.BRIDGE_BROWSERS_DIR ?? '.local-data/browsers');
  return {
    projectDir, dataDir, toolsDir, browsersDir,
    host: env.BRIDGE_HOST,
    lanCidrs: env.BRIDGE_LAN_CIDRS,
    allowedHosts: [...new Set(['127.0.0.1', 'localhost', '[::1]', ...env.BRIDGE_ALLOWED_HOSTS])],
    allowedOrigins: env.BRIDGE_ALLOWED_ORIGINS,
    port: env.BRIDGE_PORT,
    enginePort: env.BRIDGE_ENGINE_PORT,
    vncPort: env.BRIDGE_VNC_PORT,
    maintenancePort: env.BRIDGE_MAINTENANCE_PORT,
    timeoutMs: env.BRIDGE_TIMEOUT_MS,
    maintenanceTtlMs: env.BRIDGE_MAINTENANCE_TTL_MS,
    token: privateToken(join(dataDir, 'api-token')),
    engineToken: privateToken(join(dataDir, 'engine-token')),
  };
}
export type Config = ReturnType<typeof loadConfig>;
