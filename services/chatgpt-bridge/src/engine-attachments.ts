import type { buildServer, GenerateRequest, GenerateResult } from 'tab2api';
import { AppError } from 'tab2api';
import { attachmentsSchema, type Attachment } from './attachments.js';
import type { WebTurnRequest } from './web-turn.js';

/** Private extension to the pinned gateway. Upstream still authenticates, validates
 * the remaining chat body and serializes all generations through its own queue. */
export function attachmentHandoff(app: ReturnType<typeof buildServer>, generate: (request: WebTurnRequest) => Promise<GenerateResult>) {
  const pending = new Map<string, Attachment[]>();
  app.addHook('preValidation', async request => {
    if (request.routeOptions.url !== '/v1/chat/completions' || !request.body || typeof request.body !== 'object' || !('bridge_attachments' in request.body)) return;
    const { bridge_attachments, ...body } = request.body;
    const parsed = attachmentsSchema.safeParse(bridge_attachments);
    if (!parsed.success) throw new AppError('invalid_request', 'Invalid document attachments.');
    pending.set(request.id, parsed.data);
    request.body = body;
  });
  app.addHook('onResponse', async request => { pending.delete(request.id); });
  app.addHook('onRequestAbort', async request => { pending.delete(request.id); });
  app.addHook('onTimeout', async request => { pending.delete(request.id); });
  return async (request: GenerateRequest) => {
    const documents = pending.get(request.requestId);
    pending.delete(request.requestId);
    const attachments = documents?.map(file => ({ filename: file.filename, mimeType: file.mime_type,
      data: Buffer.from(file.data_base64, 'base64') }));
    return generate({ ...request, ...(attachments && { attachments }) });
  };
}
