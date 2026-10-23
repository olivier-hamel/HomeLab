#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const rootFiles = ['package.json', 'package-lock.json', 'tsconfig.json', '.env.example', '.gitignore', '.nvmrc', 'README.md', 'API.md', 'PROXMOX.md', 'MAINTENANCE.md', 'VALIDATION.md', 'openapi.yaml'];
const directories = ['src', 'scripts', 'test', 'deployment'];

export function packageServer(root, destination) {
  root = resolve(root);
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'chatgpt-plus-bridge') throw new Error('Le dossier source ne correspond pas au service autonome.');
  const files = [];
  function add(relative, rootFile = false) {
    const path = join(root, relative), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Lien symbolique interdit dans l’archive source : ${relative}`);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path).sort()) {
        if (['node_modules', '.local-data', 'dist', '.git', '.env'].includes(child)) continue;
        add(join(relative, child));
      }
    } else if (stat.isFile() && (rootFile || ['.ts','.mjs','.sh','.service','.md'].includes(extname(relative)) || relative === 'deployment/chatgpt-bridge' || relative === 'deployment/bridge.env')) {
      files.push(relative);
    }
  }
  for (const file of rootFiles) add(file, true);
  for (const directory of directories) add(directory);
  const output = resolve(destination ?? join(root, '.local-data/packages', `chatgpt-bridge-server-${metadata.version}.tar.gz`));
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const result = spawnSync('tar', ['--create', '--gzip', '--file', output, '--directory', root, '--', ...files], { encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Échec de tar.');
  chmodSync(output, 0o600);
  const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(output + '.sha256', `${digest}  ${output.split('/').at(-1)}\n`, { mode: 0o600 });
  return { archive: output, sha256: digest, files: files.length, includes_private_state: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length > 3) throw new Error('Usage : npm run package:server -- [destination.tar.gz]');
    console.log(JSON.stringify(packageServer(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv[2]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
