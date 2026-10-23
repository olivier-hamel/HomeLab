import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { z } from 'zod';
import type { DocumentAttachment } from './api-types.js';

export const MAX_ATTACHMENTS = 4;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const MESSAGE_BODY_LIMIT_BYTES = Math.ceil(MAX_TOTAL_BYTES * 4 / 3) + 262144;
export const documentTypes: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json',
  '.html': 'text/html', '.xml': 'application/xml', '.yaml': 'text/yaml', '.yml': 'text/yaml',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text', '.rtf': 'application/rtf',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const attachmentSchema = z.object({
  filename: z.string().min(1).max(200).refine(name =>
    !/[\x00-\x1f\x7f/\\]/.test(name) && name === name.trim() && !name.startsWith('.') &&
    Object.hasOwn(documentTypes, extname(name).toLowerCase()), 'Nom ou extension de document invalide.'),
  mime_type: z.string().max(150).optional(),
  data_base64: z.string().min(4).max(Math.ceil(MAX_FILE_BYTES / 3) * 4),
}).strict().superRefine((file, ctx) => {
  const mime = documentTypes[extname(file.filename).toLowerCase()];
  if (file.mime_type !== undefined && file.mime_type !== mime)
    ctx.addIssue({ code: 'custom', path: ['mime_type'], message: 'Le type MIME doit correspondre à l’extension.' });
  const encoded = file.data_base64;
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      Buffer.from(encoded, 'base64').toString('base64') !== encoded)
    ctx.addIssue({ code: 'custom', path: ['data_base64'], message: 'Base64 canonique requis, sans préfixe data:.' });
  const size = Buffer.byteLength(encoded, 'base64');
  if (!size || size > MAX_FILE_BYTES)
    ctx.addIssue({ code: 'custom', path: ['data_base64'], message: 'Document vide ou supérieur à 10 Mio.' });
}).transform(file => ({ ...file, mime_type: documentTypes[extname(file.filename).toLowerCase()]! }));

export const attachmentsSchema = z.array(attachmentSchema).max(MAX_ATTACHMENTS).default([]).superRefine((files, ctx) => {
  if (files.reduce((size, file) => size + Buffer.byteLength(file.data_base64, 'base64'), 0) > MAX_TOTAL_BYTES)
    ctx.addIssue({ code: 'custom', message: 'Les documents dépassent 20 Mio au total.' });
  if (new Set(files.map(file => file.filename)).size !== files.length)
    ctx.addIssue({ code: 'custom', message: 'Chaque document doit avoir un nom distinct.' });
});
export type Attachment = z.output<typeof attachmentsSchema>[number];

export function attachmentMetadata(files: readonly Attachment[]): DocumentAttachment[] {
  return files.map(file => {
    const data = Buffer.from(file.data_base64, 'base64');
    return { filename: file.filename, mime_type: file.mime_type, size_bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex') };
  });
}
