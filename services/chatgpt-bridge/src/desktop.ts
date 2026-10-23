import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from './config.js';
import { Processes } from './processes.js';
import { BridgeError } from './errors.js';

export class Desktop {
  display?: string;
  private authority: string;
  constructor(readonly config: Config, private processes: Processes) {
    this.authority = join(config.dataDir, 'Xauthority');
  }
  binary(name: string) {
    const candidates = [join(this.config.toolsDir, 'usr/bin', name), ...String(process.env.PATH ?? '').split(delimiter).map(dir => join(dir, name))];
    for (const path of candidates) {
      try { accessSync(path, constants.X_OK); return path; } catch { /* Next candidate. */ }
    }
    throw new BridgeError('missing_dependency', `${name} absent. Exécuter npm run setup -- --portable-system, ou installer les paquets Linux documentés.`, 503);
  }
  noVncDir() {
    for (const path of [join(this.config.toolsDir, 'usr/share/novnc'), '/usr/share/novnc']) {
      if (existsSync(join(path, 'vnc.html'))) return path;
    }
    throw new BridgeError('missing_dependency', 'Les fichiers noVNC sont absents. Exécuter npm run setup -- --portable-system.', 503);
  }
  environment(): NodeJS.ProcessEnv {
    // No HomeLab configuration, OpenAI key, NODE_OPTIONS, or personal browser settings.
    return {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? 'C.UTF-8',
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      DISPLAY: this.display,
      XAUTHORITY: this.authority,
      LD_LIBRARY_PATH: [join(this.config.toolsDir, 'usr/lib/x86_64-linux-gnu'), join(this.config.toolsDir, 'usr/lib/aarch64-linux-gnu')].join(':'),
      PYTHONPATH: join(this.config.toolsDir, 'usr/lib/python3/dist-packages'),
      PYTHONNOUSERSITE: '1',
      PLAYWRIGHT_BROWSERS_PATH: this.config.browsersDir,
    };
  }
  async start() {
    if (this.processes.has('display')) return;
    const binary = this.binary('Xvfb');
    this.binary('xauth'); this.binary('x11vnc'); this.binary('websockify'); this.noVncDir();
    let number = 91;
    while (number < 191 && (existsSync(`/tmp/.X${number}-lock`) || existsSync(`/tmp/.X11-unix/X${number}`))) number++;
    if (number === 191) throw new BridgeError('display_busy', 'Aucun écran virtuel libre.', 503);
    this.display = `:${number}`;
    writeFileSync(this.authority, '', { mode: 0o600 });
    execFileSync(this.binary('xauth'), ['-f', this.authority, 'add', this.display, 'MIT-MAGIC-COOKIE-1', randomBytes(16).toString('hex')], { env: this.environment(), stdio: 'ignore' });
    const process = this.processes.start('display', binary, [this.display, '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-auth', this.authority], this.environment());
    for (let i = 0; i < 100; i++) {
      if (!this.processes.has('display')) { await process.exited; throw new BridgeError('display_failed', 'Échec du démarrage Xvfb.', 503); }
      if (existsSync(`/tmp/.X11-unix/X${number}`)) return;
      await delay(50);
    }
    await this.processes.stop('display');
    throw new BridgeError('display_timeout', 'L’écran virtuel ne répond pas.', 503);
  }
  async openAccess() {
    const password = randomBytes(6).toString('base64url'); // VNC authentication uses 8 characters.
    const path = join(this.config.dataDir, 'vnc-password');
    writeFileSync(path, password + '\n', { mode: 0o600 });
    this.processes.start('vnc', this.binary('x11vnc'), [
      '-display', this.display!, '-auth', this.authority, '-localhost', '-listen', '127.0.0.1',
      '-rfbport', String(this.config.vncPort), '-passwdfile', path, '-forever', '-shared', '-noxdamage', '-quiet',
    ], this.environment());
    this.processes.start('websockify', this.binary('websockify'), [
      '--web', this.noVncDir(), `127.0.0.1:${this.config.maintenancePort}`, `127.0.0.1:${this.config.vncPort}`,
    ], this.environment());
    for (let i = 0; i < 100; i++) {
      if (!this.processes.has('vnc') || !this.processes.has('websockify')) throw new BridgeError('maintenance_failed', 'Échec du lancement VNC/websockify.', 503);
      try {
        const response = await fetch(`http://127.0.0.1:${this.config.maintenancePort}/vnc.html`, { signal: AbortSignal.timeout(500), redirect: 'error' });
        await response.body?.cancel();
        if (response.ok) return { url: `http://127.0.0.1:${this.config.maintenancePort}/vnc.html?resize=scale`, password };
      } catch { /* Wait for local listener. */ }
      await delay(50);
    }
    throw new BridgeError('maintenance_timeout', 'Le point d’accès noVNC ne répond pas.', 503);
  }
  async closeAccess() {
    await this.processes.stop('websockify');
    await this.processes.stop('vnc');
    const path = join(this.config.dataDir, 'vnc-password');
    if (existsSync(path)) unlinkSync(path);
  }
}
