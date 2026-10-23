import type { ChatEngine } from './engine.js';
import { BridgeError, errorInfo } from './errors.js';
import { parseAnswer, userPayload } from './protocol.js';
import { Store } from './store.js';
import type { Attachment } from './attachments.js';

export class Scheduler {
  private pumping = false;
  private closed = false;
  private controller?: AbortController;
  activeId?: string;
  paused = false;
  private idleWaiters: (() => void)[] = [];
  constructor(readonly store: Store, private engine: ChatEngine) {}
  submit(conversationId: string, text: string, key?: string, attachments: readonly Attachment[] = []) {
    if (this.paused || this.closed) throw new BridgeError('maintenance', 'La maintenance suspend les nouvelles demandes.', 503);
    const run = this.store.createRun(conversationId, text, userPayload(text), key, attachments);
    this.kick();
    return run;
  }
  decide(id: string, approved: boolean) {
    const run = this.store.decide(id, approved);
    this.kick(); return run;
  }
  cancel(id: string) {
    const run = this.store.cancel(id);
    if (this.activeId === id) this.controller?.abort();
    return run;
  }
  pause() { this.paused = true; }
  resume() { if (!this.closed) { this.paused = false; this.kick(); } }
  async waitIdle() {
    if (!this.pumping) return;
    await new Promise<void>(resolve => this.idleWaiters.push(resolve));
  }
  kick() {
    if (this.pumping || this.paused || this.closed) return;
    this.pumping = true;
    void this.pump().catch(() => {
      // Preserve queued work; unexpected local errors are surfaced by health/status.
      this.paused = true;
    }).finally(() => {
      this.pumping = false; this.activeId = undefined; this.controller = undefined;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    });
  }
  private async pump() {
    while (!this.paused && !this.closed) {
      let run = this.store.claim();
      if (!run) break;
      this.activeId = run.id;
      this.controller = new AbortController();
      try {
        run = this.store.prepareToolResult(run.id);
        const remote = this.store.conversation(run.conversation_id).remote_id;
        // Tool results continue the existing remote thread; never upload the same
        // documents again when resuming after an approval or denial.
        const attachments = run.tool_count === 0 ? this.store.attachments(run.id) : [];
        const result = await this.engine.generate(run.next_payload, remote, this.controller.signal, attachments);
        const answer = parseAnswer(result.text);
        this.store.recordAnswer(run.id, result.conversationId, result.text, answer.type === 'final' ? answer.text : answer, answer.type === 'final' ? answer.warning : undefined);
      } catch (error) {
        this.store.fail(run.id, errorInfo(error), error instanceof BridgeError ? error.ambiguous : false);
      }
      this.activeId = undefined;
      this.controller = undefined;
    }
  }
  async close() {
    this.closed = true; this.paused = true;
    // Do not cancel persisted state on shutdown: recovery marks in-flight work interrupted.
    this.controller?.abort();
    await this.waitIdle();
  }
}
