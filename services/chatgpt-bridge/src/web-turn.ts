import type { Page } from 'playwright';
import { AppError, type GenerateRequest, type GenerateResult } from 'tab2api';
import { setTimeout as delay } from 'node:timers/promises';

// Playwright accepts document MIME types beyond the pinned provider's union.
export type WebTurnRequest = Omit<GenerateRequest, 'attachments'> & {
  attachments?: readonly { filename: string; mimeType: string; data: Buffer }[];
};

export const assistantSelector = '[data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]';
export const stopSelector = 'button[data-testid="stop-button"], form button[aria-label*="Stop" i], form button[aria-label*="Arrêter" i]';
const conversationId = (page: Page) => /^https:\/\/chatgpt\.com\/c\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:[/?#]|$)/.exec(page.url())?.[1];
export type TurnObservation = { submission: 'form_request_submit'; remote_id?: string; stop_endpoint_observed: boolean; phase: string; observed_at: string };
type Baseline = { count: number; messageId?: string };
const messageIdentity = (element: Element) => element.closest('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id') ?? element.getAttribute('data-message-id') ?? undefined;

async function uploadDocuments(page: Page, composer: ReturnType<Page['locator']>, request: WebTurnRequest) {
  if (!request.attachments?.length) return;
  const form = composer.locator('xpath=ancestor::form[1]');
  // Prefer the composer's input. Avoid image-only inputs belonging to other tools.
  const inputs = page.locator('input[type="file"]');
  let input;
  for (const candidates of [form.locator('input[type="file"]'), inputs]) {
    for (let i = 0; i < await candidates.count(); i++) {
      const candidate = candidates.nth(i);
      const accept = (await candidate.getAttribute('accept') ?? '').toLowerCase();
      if (!accept || accept.split(',').some(type => /^(\*\/\*|application\/|text\/|\.(pdf|docx?|txt|csv|xlsx?|pptx?|md|json|odt|rtf))/.test(type.trim()))) { input = candidate; break; }
    }
    if (input) break;
  }
  if (!input) throw new AppError('ui_changed', 'The ChatGPT document input is unavailable; no prompt was submitted.');
  if (request.signal.aborted) throw new AppError('cancelled', 'Cancelled before document upload.');
  await input.setInputFiles(request.attachments.map(file => ({ name: file.filename, mimeType: file.mimeType, buffer: file.data })), { timeout: 30_000 });
  const expires = Date.now() + 120_000;
  let readySince = 0;
  while (!request.signal.aborted) {
    const alerts = await page.locator('[role="alert"], [data-testid*="toast"]').allTextContents();
    if (alerts.some(text => /upload.*(fail|error|limit)|unable to upload|unsupported file|file.*(too large|not supported)|échec.*(fichier|téléversement)|limite.*fichier/i.test(text)))
      throw new AppError('invalid_request', 'ChatGPT rejected a document upload; no prompt was submitted.');
    const ready = await form.evaluate((element, names) => {
      const container = element as HTMLElement;
      const labels = [container.innerText, ...Array.from(container.querySelectorAll('[title], [aria-label]'), node => `${node.getAttribute('title') ?? ''} ${node.getAttribute('aria-label') ?? ''}`)].join('\n');
      const busy = container.querySelector('[aria-busy="true"], [role="progressbar"], [data-state="uploading"], [data-testid*="upload-progress"], .animate-spin');
      const send = Array.from(container.querySelectorAll('button')).find(button => button.type === 'submit' && /^(Send(?: message| prompt)?|Envoyer(?: le message)?)$/i.test(button.getAttribute('aria-label') ?? ''));
      return names.every(name => labels.includes(name)) && !busy && !!send && !send.disabled;
    }, request.attachments.map(file => file.filename));
    // A render may briefly expose file names before asynchronous progress UI is
    // mounted. Require sustained readiness rather than submitting on that frame.
    if (ready) { readySince ||= Date.now(); if (Date.now() - readySince >= 1000) return; }
    else readySince = 0;
    if (Date.now() >= expires) throw new AppError('ui_changed', 'Document upload readiness could not be confirmed; no prompt was submitted.');
    await delay(250, undefined, { signal: request.signal });
  }
  throw new AppError('cancelled', 'Cancelled during document upload; no prompt was submitted.');
}

export async function readCompletedAnswer(page: Page, baseline: number | Baseline, signal: AbortSignal) {
  const before = typeof baseline === 'number' ? { count: baseline } : baseline;
  let previous = '', stable = 0, emptySince = 0, copied = false;
  while (!signal.aborted) {
    const nodes = page.locator(assistantSelector);
    const count = await nodes.count();
    const stop = page.locator(stopSelector);
    let generating = false;
    for (let i = 0; i < await stop.count(); i++) if (await stop.nth(i).isVisible()) generating = true;
    const latestId = count ? await nodes.last().evaluate(messageIdentity) : undefined;
    if (count > before.count || (count && latestId && before.messageId && latestId !== before.messageId)) {
      const last = nodes.last();
      const pending = await last.locator('[aria-busy="true"], [class*="loading-shimmer"], [class*="result-thinking"]').count();
      const text = (await last.innerText()).trim();
      if (text && !generating && !pending) {
        stable = text === previous ? stable + 1 : 1;
        previous = text;
        if (stable >= 3) return text;
      } else { stable = 0; previous = ''; }
      // Current ChatGPT can expose a complete Copy action while a renderer is empty.
      // Copy once, never click a generation/stop control or resend the prompt.
      if (!text && !generating && !pending) {
        if (!emptySince) emptySince = Date.now();
        const copy = page.locator('.turn-action-controls button[aria-label="Copy"], button[data-testid="copy-turn-action-button"]').last();
        if (!copied && Date.now() - emptySince > 4000 && await copy.isVisible().catch(() => false)) {
          copied = true;
          await page.context().grantPermissions(['clipboard-read','clipboard-write'], { origin: 'https://chatgpt.com' });
          await page.evaluate(() => navigator.clipboard.writeText(''));
          await copy.click();
          const content = await page.evaluate(() => navigator.clipboard.readText());
          if (content.trim()) return content.trim();
        }
        if (Date.now() - emptySince > 10_000) throw new AppError('ui_changed', 'ChatGPT exposed an empty completed answer. No resubmission was attempted.');
      } else emptySince = 0;
    }
    await delay(500, undefined, { signal });
  }
  throw new AppError('cancelled', 'Generation interrupted.');
}

export async function generateWebTurn(page: Page, request: WebTurnRequest, observe: (value: TurnObservation) => void): Promise<GenerateResult> {
  const observation: TurnObservation = { submission: 'form_request_submit', phase: 'opening', observed_at: new Date().toISOString(), stop_endpoint_observed: false };
  const checkpoint = (phase: string) => {
    observation.phase = phase; observation.observed_at = new Date().toISOString();
    observation.remote_id = conversationId(page); observe({ ...observation });
  };
  page.on('request', outgoing => {
    if (outgoing.method() === 'POST' && /\/(stop|cancel)(?:[/?]|$)/i.test(new URL(outgoing.url()).pathname)) {
      observation.stop_endpoint_observed = true; checkpoint('stop_endpoint_observed');
    }
  });
  try {
    if (request.projectId) throw new AppError('invalid_request', 'This service supports normal chat only, without projects.');
    if (request.signal.aborted) throw new AppError('cancelled', 'Request cancelled before submission.');
    await page.goto(request.conversationId ? `https://chatgpt.com/c/${request.conversationId}` : 'https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const composer = page.locator('#prompt-textarea, form [contenteditable="true"][data-virtualkeyboard="true"], main textarea').first();
    await composer.waitFor({ state: 'visible', timeout: 30_000 });
    if (request.conversationId) await page.locator('[data-chatgpt-search-unit-key], [data-message-author-role]').first().waitFor({ state: 'attached', timeout: 30_000 });
    // Never press Enter while an existing generation is running.
    const stop = page.locator(stopSelector);
    for (let i = 0; i < await stop.count(); i++) if (await stop.nth(i).isVisible()) throw new AppError('ui_changed', 'A generation is already in progress; no prompt was submitted.');
    const answers = page.locator(assistantSelector);
    const count = await answers.count();
    const baseline = { count, messageId: count ? await answers.last().evaluate(messageIdentity) : undefined };
    const userSelector = '[data-chatgpt-search-unit-key$=":user"], [data-message-author-role="user"]';
    const usersBefore = await page.locator(userSelector).count();
    await composer.fill(request.prompt);
    if (request.attachments?.length) {
      checkpoint('uploading_documents');
      await uploadDocuments(page, composer, request);
      checkpoint('documents_ready');
    }
    checkpoint('before_submit');
    if (request.signal.aborted) throw new AppError('cancelled', 'Request cancelled before submission.');
    const form = composer.locator('xpath=ancestor::form[1]');
    const send = form.getByRole('button', { name: /^(Send(?: message| prompt)?|Envoyer(?: le message)?)$/i }).first();
    await send.waitFor({ state: 'visible', timeout: 5000 });
    // Atomically validate the current control and submit the form, without a click
    // and without depending on the owner's Enter/newline keyboard preference.
    const submitted = await send.evaluate(element => {
      const button = element as HTMLButtonElement;
      if (button.tagName !== 'BUTTON' || button.disabled || button.type !== 'submit' || !button.form || !/^(Send(?: message| prompt)?|Envoyer(?: le message)?)$/i.test(button.getAttribute('aria-label') ?? '')) return false;
      button.form.requestSubmit(button);
      return true;
    });
    if (!submitted) throw new AppError('ui_changed', 'Send control changed before submission; nothing was clicked.');
    checkpoint('submission_requested');
    await page.waitForFunction(({ selector, before, prompt }) => {
      const users = [...document.querySelectorAll(selector)];
      const newest = users.at(-1);
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
      return users.length > before && newest && normalize((newest as HTMLElement).innerText).includes(normalize(prompt));
    }, { selector: userSelector, before: usersBefore, prompt: request.prompt }, { timeout: 15_000 });
    checkpoint('submitted');
    const text = await readCompletedAnswer(page, baseline, request.signal);
    checkpoint('completed');
    return { text, providerModel: 'chatgpt-web', ...(observation.remote_id && { conversationId: observation.remote_id }) };
  } catch (error) {
    checkpoint('interrupted');
    if (error && typeof error === 'object') Object.assign(error, { conversation_id: observation.remote_id });
    throw error;
  } finally { await page.close().catch(() => {}); }
}
