import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BridgeError } from './errors.js';

type RecordEntry = { pid: number; start: string; name: string };
export interface ManagedProcess { child: ChildProcess; exited: Promise<number | null> }

function startTime(pid: number) {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').slice(1).join(') ').split(' ')[19]; }
  catch { return undefined; }
}

export function acquireLock(dataDir: string) {
  const path = join(dataDir, 'service.lock');
  if (existsSync(path)) {
    const owner = JSON.parse(readFileSync(path, 'utf8')) as { pid: number; start: string };
    if (startTime(owner.pid) === owner.start) throw new BridgeError('already_running', 'Une instance utilise déjà ce répertoire de données.', 409);
    unlinkSync(path);
  }
  writeFileSync(path, JSON.stringify({ pid: process.pid, start: startTime(process.pid) }), { mode: 0o600, flag: 'wx' });
  return () => { if (existsSync(path)) unlinkSync(path); };
}

export class Processes {
  private children = new Map<string, ManagedProcess>();
  private records: RecordEntry[] = [];
  private readonly path: string;
  constructor(private dataDir: string) {
    this.path = join(dataDir, 'children.json');
    if (existsSync(this.path)) {
      const entries = JSON.parse(readFileSync(this.path, 'utf8')) as RecordEntry[];
      for (const entry of entries) {
        if (entry.start && startTime(entry.pid) === entry.start) {
          try { process.kill(-entry.pid, 'SIGKILL'); } catch { /* Process already gone. */ }
        }
      }
    }
    this.save();
  }
  private save() {
    writeFileSync(this.path + '.tmp', JSON.stringify(this.records), { mode: 0o600 });
    renameSync(this.path + '.tmp', this.path);
  }
  has(name: string) { return this.children.has(name); }
  start(name: string, binary: string, args: string[], env: NodeJS.ProcessEnv): ManagedProcess {
    if (this.has(name)) throw new BridgeError('process_busy', `Processus déjà actif : ${name}`, 409);
    const child = spawn(binary, args, { cwd: this.dataDir, env, detached: true, stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    // Do not log child output: it can contain account/session information.
    child.stderr?.resume();
    let resolveExit!: (value: number | null) => void;
    let rejectExit!: (error: Error) => void;
    const exited = new Promise<number | null>((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
    void exited.catch(() => {});
    const managed = { child, exited };
    this.children.set(name, managed);
    const record = child.pid ? { pid: child.pid, start: startTime(child.pid) ?? '', name } : undefined;
    if (record) this.records.push(record);
    this.save();
    const cleanup = () => {
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Includes remaining descendants. */ } }
      if (this.children.get(name) === managed) this.children.delete(name);
      this.records = this.records.filter(item => item !== record);
      this.save();
    };
    child.once('error', error => { cleanup(); rejectExit(error); });
    child.once('exit', code => { cleanup(); resolveExit(code); });
    return managed;
  }
  async stop(name: string) {
    const managed = this.children.get(name);
    if (!managed) return;
    if (managed.child.pid) { try { process.kill(-managed.child.pid, 'SIGTERM'); } catch { /* Already stopped. */ } }
    await Promise.race([managed.exited.catch(() => {}), delay(5000, undefined, { ref: false })]);
    if (this.children.has(name) && managed.child.pid) {
      try { process.kill(-managed.child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
      await Promise.race([managed.exited.catch(() => {}), delay(2000, undefined, { ref: false })]);
    }
  }
  async stopAll() {
    for (const name of [...this.children.keys()].reverse()) await this.stop(name);
  }
}
