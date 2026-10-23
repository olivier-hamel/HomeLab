/** Public HTTP response types. This module has no Node.js or server dependencies. */
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface ApiError {
  code: string;
  message: string;
  may_have_been_sent?: boolean;
  remote_id?: string;
  fields?: string[];
}
export interface Conversation { id: string; title: string; remote_id: string | null; created_at: string }
export interface DocumentInput { filename: string; mime_type?: string; data_base64: string }
export interface DocumentAttachment { filename: string; mime_type: string; size_bytes: number; sha256: string }
export interface Message {
  sequence: number;
  run_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  attachments: DocumentAttachment[];
  created_at: string;
}
export interface ConversationDetail extends Conversation { messages: Message[] }
export interface Submission { run_id: string; status: RunStatus }
export interface Action {
  id: string;
  run_id: string;
  name: 'demo.create_note' | 'demo.list_notes';
  arguments: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'executed' | 'cancelled';
  result: Record<string, unknown> | null;
  created_at: string;
}
export interface Run {
  id: string;
  conversation_id: string;
  prompt: string;
  attachments: DocumentAttachment[];
  status: RunStatus;
  answer: string | null;
  error: ApiError | null;
  warning: string | null;
  tool_count: number;
  request_key: string | null;
  created_at: string;
  updated_at: string;
  actions: Action[];
}
export interface BridgeStatus {
  service: 'chatgpt-plus-bridge';
  engine: 'tab2api';
  engine_version: string;
  mode: 'real';
  session: string;
  queue: {
    queued: number;
    running: number;
    awaiting_approval: number;
    interrupted: number;
    paused: boolean;
    active_run_id: string | null;
  };
  maintenance: { state: string; expires_at?: string; error?: ApiError };
}
