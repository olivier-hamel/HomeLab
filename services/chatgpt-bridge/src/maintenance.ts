import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Desktop } from './desktop.js';
import type { Engine } from './engine.js';
import type { Scheduler } from './scheduler.js';
import { errorInfo } from './errors.js';

export class Maintenance {
  private session?: { id: string; state: string; purpose?: string; url?: string; password?: string; expires_at?: string; error?: unknown };
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private shuttingDown = false;
  constructor(private config: Config, private desktop: Desktop, private engine: Engine, private scheduler: Scheduler) {}
  status() { return this.session ? { ...this.session } : { state: 'closed' }; }
  open(inspect = false) {
    if (this.session && ['opening','open','closing'].includes(this.session.state)) return this.status();
    this.session = { id: randomUUID(), state: 'opening', purpose: inspect ? 'inspect' : 'login' };
    this.scheduler.pause();
    this.opening = this.activate().finally(() => { this.opening = undefined; });
    return this.status();
  }
  private async activate() {
    try {
      await this.scheduler.waitIdle();
      if (this.shuttingDown) return;
      await this.engine.stop();
      const access = await this.desktop.openAccess();
      if (this.shuttingDown) return;
      this.session = { id: this.session!.id, purpose: this.session!.purpose, state: 'open', ...access, expires_at: new Date(Date.now() + this.config.maintenanceTtlMs).toISOString() };
      this.timer = setTimeout(() => { void this.close(); }, this.config.maintenanceTtlMs);
      this.timer.unref();
      void (this.session.purpose === 'inspect' ? this.engine.inspect() : this.engine.login()).then(() => {
        if (this.session?.state === 'open') void this.close();
      }).catch(error => {
        if (this.session?.state === 'open') {
          this.session.error = errorInfo(error);
          void this.close();
        }
      });
    } catch (error) {
      this.session = { id: this.session!.id, state: 'failed', error: errorInfo(error) };
      await this.desktop.closeAccess();
      if (!this.shuttingDown) {
        try { await this.engine.start(); this.scheduler.resume(); } catch { /* status exposes engine failure. */ }
      }
    }
  }
  async close(shutdown = false) {
    if (shutdown) this.shuttingDown = true;
    if (this.closing) return this.closing;
    this.closing = this.deactivate().finally(() => { this.closing = undefined; });
    return this.closing;
  }
  private async deactivate() {
    await this.opening;
    if (this.timer) clearTimeout(this.timer);
    const error = this.session?.error;
    if (this.session) this.session.state = 'closing';
    await this.engine.stopLogin();
    await this.desktop.closeAccess();
    this.session = undefined;
    if (!this.shuttingDown) {
      try { await this.engine.start(); this.scheduler.resume(); }
      catch (failure) { this.session = { id: randomUUID(), state: 'failed', error: errorInfo(failure) }; }
    }
    if (error && !this.session) this.session = { id: randomUUID(), state: 'failed', error };
  }
}
