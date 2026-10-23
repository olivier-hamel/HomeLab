import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.js';
import { toolPayload, tools, type ToolName, type ToolRequest } from './protocol.js';
import type { Conversation, RunStatus } from './api-types.js';
import type { DocumentAttachment } from './api-types.js';
import { attachmentMetadata, attachmentsSchema, type Attachment } from './attachments.js';
export type { Conversation, RunStatus } from './api-types.js';

export interface Run {
  id: string; conversation_id: string; prompt: string; next_payload: string; status: RunStatus;
  answer: string | null; error: string | null; warning: string | null; tool_count: number;
  request_key: string | null; created_at: string; updated_at: string;
}
export interface Action {
  id: string; run_id: string; name: ToolName; arguments: string;
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'cancelled';
  result: string | null; created_at: string;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, remote_id TEXT UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), prompt TEXT NOT NULL,
        next_payload TEXT NOT NULL, status TEXT NOT NULL, answer TEXT, error TEXT, warning TEXT,
        tool_count INTEGER NOT NULL DEFAULT 0, request_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(conversation_id)
        WHERE status IN ('queued','running','awaiting_approval','interrupted');
      CREATE TABLE IF NOT EXISTS messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id), run_id TEXT NOT NULL REFERENCES runs(id),
        role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL,
        arguments TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE REFERENCES actions(id), text TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_attachments (run_id TEXT PRIMARY KEY REFERENCES runs(id), content TEXT NOT NULL, metadata TEXT NOT NULL);
      PRAGMA user_version=2;`);
    this.db.prepare("UPDATE runs SET status='interrupted', error=?, updated_at=? WHERE status='running'")
      .run(JSON.stringify({ code: 'process_interrupted', message: 'Processus interrompu : vérifier la conversation distante avant toute nouvelle soumission.', may_have_been_sent: true }), new Date().toISOString());
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  conversation(id: string): Conversation {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as unknown as Conversation;
    if (!row) throw new BridgeError('not_found', 'Conversation introuvable.', 404);
    return row;
  }
  createConversation(title: string) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO conversations VALUES (?,?,NULL,?)').run(id, title, new Date().toISOString());
    return this.conversation(id);
  }
  conversations() { return this.db.prepare('SELECT * FROM conversations ORDER BY created_at DESC, id').all(); }
  messages(id: string) {
    this.conversation(id);
    return this.db.prepare('SELECT sequence,run_id,role,content,created_at FROM messages WHERE conversation_id=? ORDER BY sequence').all(id)
      .map(row => ({ ...row, attachments: row.role === 'user' ? this.attachmentMetadata(String(row.run_id)) : [] }));
  }
  attachments(id: string): Attachment[] {
    const row = this.db.prepare('SELECT content FROM run_attachments WHERE run_id=?').get(id);
    return row ? JSON.parse(String(row.content)) : [];
  }
  attachmentMetadata(id: string): DocumentAttachment[] {
    const row = this.db.prepare('SELECT metadata FROM run_attachments WHERE run_id=?').get(id);
    return row ? JSON.parse(String(row.metadata)) : [];
  }
  run(id: string): Run {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as unknown as Run;
    if (!row) throw new BridgeError('not_found', 'Opération introuvable.', 404);
    return row;
  }
  action(id: string): Action {
    const row = this.db.prepare('SELECT * FROM actions WHERE id=?').get(id) as unknown as Action;
    if (!row) throw new BridgeError('not_found', 'Action introuvable.', 404);
    return row;
  }
  actions(id: string) { return this.db.prepare('SELECT * FROM actions WHERE run_id=? ORDER BY created_at,id').all(id) as unknown as Action[]; }
  viewRun(id: string) {
    const run = this.run(id);
    return { ...run, attachments: this.attachmentMetadata(id), next_payload: undefined, error: run.error ? JSON.parse(run.error) : null,
      actions: this.actions(id).map(action => ({ ...action, arguments: JSON.parse(action.arguments), result: action.result ? JSON.parse(action.result) : null })) };
  }
  message(run: Run, role: string, content: string) {
    this.db.prepare('INSERT INTO messages(conversation_id,run_id,role,content,created_at) VALUES (?,?,?,?,?)')
      .run(run.conversation_id, run.id, role, content, new Date().toISOString());
  }
  createRun(conversationId: string, prompt: string, payload: string, key?: string, files: readonly Attachment[] = []) {
    const attachments = attachmentsSchema.parse(files), metadata = attachmentMetadata(attachments);
    return this.transaction(() => {
      this.conversation(conversationId);
      if (key) {
        const previous = this.db.prepare('SELECT * FROM runs WHERE request_key=?').get(key) as unknown as Run | undefined;
        if (previous) {
          if (previous.conversation_id !== conversationId || previous.prompt !== prompt || JSON.stringify(this.attachmentMetadata(previous.id)) !== JSON.stringify(metadata)) throw new BridgeError('idempotency_conflict', 'Cette clé désigne une autre demande.', 409);
          return previous;
        }
      }
      if (this.db.prepare("SELECT id FROM runs WHERE conversation_id=? AND status IN ('queued','running','awaiting_approval','interrupted')").get(conversationId))
        throw new BridgeError('conversation_busy', 'Terminer la décision ou annuler l’opération précédente ; vérifier toute interruption ambiguë.', 409);
      if (this.counts().queued + this.counts().running >= 16) throw new BridgeError('queue_full', 'La file est pleine.', 429);
      const id = randomUUID(), now = new Date().toISOString();
      this.db.prepare("INSERT INTO runs(id,conversation_id,prompt,next_payload,status,request_key,created_at,updated_at) VALUES (?,?,?,?,'queued',?,?,?)")
        .run(id, conversationId, prompt, payload, key ?? null, now, now);
      const run = this.run(id);
      if (attachments.length) this.db.prepare('INSERT INTO run_attachments VALUES (?,?,?)').run(id, JSON.stringify(attachments), JSON.stringify(metadata));
      this.message(run, 'user', prompt);
      return run;
    });
  }
  counts() {
    const counts = { queued: 0, running: 0, awaiting_approval: 0, interrupted: 0 };
    for (const row of this.db.prepare('SELECT status,COUNT(*) AS n FROM runs GROUP BY status').all()) {
      if (row.status && String(row.status) in counts) counts[row.status as keyof typeof counts] = Number(row.n);
    }
    return counts;
  }
  claim(): Run | undefined {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT id FROM runs WHERE status='queued' ORDER BY updated_at,created_at,id LIMIT 1").get();
      if (!row) return undefined;
      this.db.prepare("UPDATE runs SET status='running',updated_at=? WHERE id=?").run(new Date().toISOString(), row.id!);
      return this.run(String(row.id));
    });
  }
  recordAnswer(runId: string, remoteId: string, raw: string, answer: string | ToolRequest, warning?: string) {
    this.transaction(() => {
      const run = this.run(runId);
      if (run.status !== 'running') return;
      const conversation = this.conversation(run.conversation_id);
      if (conversation.remote_id && conversation.remote_id !== remoteId) throw new BridgeError('conversation_mismatch', 'La conversation distante a changé ; vérifier la session.', 502, true);
      this.db.prepare('UPDATE conversations SET remote_id=? WHERE id=?').run(remoteId, conversation.id);
      this.message(run, 'assistant', raw);
      if (typeof answer === 'string') {
        this.db.prepare("UPDATE runs SET status='completed',answer=?,warning=?,updated_at=? WHERE id=?")
          .run(answer, warning ?? null, new Date().toISOString(), runId);
      } else {
        if (run.tool_count >= 8) throw new BridgeError('tool_limit_exceeded', 'Limite de huit actions atteinte.', 422);
        this.db.prepare("INSERT INTO actions VALUES (?,?,?,?,'pending',NULL,?)")
          .run(randomUUID(), runId, answer.name, JSON.stringify(answer.arguments), new Date().toISOString());
        this.db.prepare("UPDATE runs SET status='awaiting_approval',tool_count=tool_count+1,updated_at=? WHERE id=?")
          .run(new Date().toISOString(), runId);
      }
    });
  }
  decide(id: string, approved: boolean) {
    return this.transaction(() => {
      const action = this.action(id), run = this.run(action.run_id);
      if (action.status !== 'pending') {
        const sameDecision = approved ? ['approved','executed'].includes(action.status) : action.status === 'denied';
        if (sameDecision) return run;
        throw new BridgeError('decision_conflict', 'Cette action a déjà reçu une autre décision ou a été annulée.', 409);
      }
      if (run.status !== 'awaiting_approval') throw new BridgeError('run_not_waiting', 'Cette opération n’attend plus de décision.', 409);
      if (this.counts().queued >= 16) throw new BridgeError('queue_full', 'La file est pleine ; réessayer la décision plus tard.', 429);
      this.db.prepare('UPDATE actions SET status=? WHERE id=?').run(approved ? 'approved' : 'denied', id);
      this.db.prepare("UPDATE runs SET status='queued',updated_at=? WHERE id=?").run(new Date().toISOString(), run.id);
      return this.run(run.id);
    });
  }
  prepareToolResult(runId: string): Run {
    return this.transaction(() => {
      const run = this.run(runId);
      const action = this.actions(runId).find(action => ['approved', 'denied'].includes(action.status) && action.result === null);
      if (!action) return run;
      let result: unknown;
      if (action.status === 'denied') result = { ok: false, error: 'user_denied', message: 'Action refusée par l’utilisateur.' };
      else {
        const args = tools[action.name].parse(JSON.parse(action.arguments));
        if (action.name === 'demo.create_note') {
          const id = randomUUID();
          this.db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run(id, action.id, (args as { text: string }).text, new Date().toISOString());
          result = { ok: true, note: this.db.prepare('SELECT id,text,created_at FROM notes WHERE id=?').get(id) };
        } else {
          const limit = (args as { limit?: number }).limit ?? 10;
          result = { ok: true, notes: this.db.prepare('SELECT id,text,created_at FROM notes ORDER BY created_at DESC,id LIMIT ?').all(limit) };
        }
      }
      this.db.prepare('UPDATE actions SET status=?,result=? WHERE id=?')
        .run(action.status === 'approved' ? 'executed' : 'denied', JSON.stringify(result), action.id);
      const payload = toolPayload(action.id, action.name, result);
      this.message(run, 'tool', payload);
      this.db.prepare('UPDATE runs SET next_payload=? WHERE id=?').run(payload, runId);
      return this.run(runId);
    });
  }
  fail(id: string, error: unknown, interrupted: boolean) {
    this.transaction(() => {
      const run = this.run(id);
      if (run.status !== 'running') return;
      const remote = error && typeof error === 'object' && 'remote_id' in error ? error.remote_id : undefined;
      if (typeof remote === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(remote))
        this.db.prepare('UPDATE conversations SET remote_id=? WHERE id=? AND remote_id IS NULL').run(remote, run.conversation_id);
      this.db.prepare("UPDATE runs SET status=?,error=?,updated_at=? WHERE id=?")
        .run(interrupted ? 'interrupted' : 'failed', JSON.stringify(error), new Date().toISOString(), id);
    });
  }
  cancel(id: string) {
    this.transaction(() => {
      const run = this.run(id);
      if (['completed','failed','cancelled'].includes(run.status)) return;
      const ambiguous = ['running','interrupted'].includes(run.status);
      this.db.prepare("UPDATE runs SET status='cancelled',error=?,updated_at=? WHERE id=?")
        .run(JSON.stringify({ code: 'cancelled', message: ambiguous ? 'Annulé localement ; le message peut déjà avoir été envoyé. Aucune relance automatique.' : 'Opération annulée.', may_have_been_sent: ambiguous }), new Date().toISOString(), id);
      this.db.prepare("UPDATE actions SET status='cancelled' WHERE run_id=? AND status IN ('pending','approved') AND result IS NULL").run(id);
    });
    return this.run(id);
  }
}
