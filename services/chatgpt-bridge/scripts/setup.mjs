#!/usr/bin/env node
// Only installs dependencies into this project's private runtime directories.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(root, process.env.BRIDGE_DATA_DIR ?? '.local-data');
const browsers = resolve(root, process.env.BRIDGE_BROWSERS_DIR ?? '.local-data/browsers');
mkdirSync(runtime, { recursive: true, mode: 0o700 });
chmodSync(runtime, 0o700);
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} a échoué (${result.status}).`);
}
try {
  if (process.platform !== 'linux') throw new Error('Cette version utilise Linux et Xvfb.');
  if (process.argv.includes('--portable-system')) {
    const destination = join(root, '.local-data/system');
    const download = mkdtempSync(join(runtime, 'packages-'));
    try {
      mkdirSync(destination, { recursive: true, mode: 0o700 });
      const aptDir = join(runtime, 'apt');
      for (const path of ['lists/partial', 'cache/archives/partial', 'log']) mkdirSync(join(aptDir, path), { recursive: true, mode: 0o700 });
      const aptOptions = ['-o', `Dir::State::Lists=${join(aptDir, 'lists')}`, '-o', `Dir::Cache=${join(aptDir, 'cache')}`,
        '-o', `Dir::Log=${join(aptDir, 'log')}`, '-o', `APT::Sandbox::User=${process.env.USER ?? 'user'}`];
      // Refresh private indexes: the host's cached package versions may have expired.
      run('apt-get', [...aptOptions, 'update']);
      // Debian/Ubuntu packages, authenticated by apt's configured package indexes.
      // Existing base Linux/Python/X11 libraries remain system prerequisites.
      run('apt-get', [...aptOptions, 'download', 'xvfb', 'xserver-common', 'x11-xkb-utils', 'libxfont2', 'x11vnc', 'libvncserver1', 'libvncclient1', 'novnc', 'websockify', 'python3-websockify', 'python3-jwcrypto'], { cwd: download });
      for (const file of readdirSync(download).filter(file => file.endsWith('.deb'))) run('dpkg-deb', ['--extract', join(download, file), destination]);
      const env = { ...process.env, LD_LIBRARY_PATH: join(destination, 'usr/lib/x86_64-linux-gnu') + ':' + join(destination, 'usr/lib/aarch64-linux-gnu'),
        PYTHONPATH: join(destination, 'usr/lib/python3/dist-packages') };
      for (const name of ['Xvfb', 'x11vnc']) {
        const result = spawnSync('ldd', [join(destination, 'usr/bin', name)], { env, encoding: 'utf8' });
        if (result.status !== 0 || result.stdout.includes('not found')) throw new Error(`Bibliothèque Linux manquante pour ${name} :\n${result.stdout}`);
      }
      run(join(destination, 'usr/bin/websockify'), ['--help'], { env, stdio: 'ignore' });
      if (!existsSync(join(destination, 'usr/share/novnc/vnc.html'))) throw new Error('Client noVNC absent du paquet.');
      console.log('Dépendances graphiques privées prêtes. Aucun paquet système installé.');
    } finally { rmSync(download, { recursive: true, force: true }); }
  }
  const playwright = join(root, 'node_modules/playwright/cli.js');
  run(process.execPath, [playwright, 'install', 'chromium'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers } });
  console.log('Chromium prêt. Exécuter npm run build, puis npm start.');
} catch (error) {
  console.error(error.message);
  console.error('Alternative système : sudo apt-get install xvfb xauth x11vnc novnc websockify');
  process.exitCode = 1;
}
