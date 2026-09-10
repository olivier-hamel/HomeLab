import { MediaError, type Fetcher } from "./core.ts";

export async function readLimited(response: Response | Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel();
    throw new MediaError("too_large", "Response exceeds the allowed size.", 413);
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new MediaError("too_large", "Response exceeds the allowed size.", 413);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function bounded<T>(service: string, timeout: number, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await work(AbortSignal.any([signal, controller.signal])); }
  catch (error) {
    if (signal.aborted) throw new MediaError("cancelled", "Request cancelled.", 499);
    if (controller.signal.aborted) throw new MediaError("timeout", `${service} timed out. Check connectivity and retry.`, 504);
    if (error instanceof MediaError) throw error;
    // Never serialize upstream messages, URLs, response bodies or fetch errors.
    throw new MediaError("unavailable", `${service} is unavailable. Check its address, credentials and backend connectivity.`, 502);
  } finally { clearTimeout(timer); }
}

export async function jsonRequest(fetcher: Fetcher, service: string, url: URL, init: RequestInit, timeout: number, signal: AbortSignal): Promise<unknown> {
  return bounded(service, timeout, signal, async s => {
    const response = await fetcher(url, { ...init, signal: s, cache: "no-store", redirect: "manual" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new MediaError(response.status === 404 ? "not_found" : "upstream", `${service} returned HTTP ${response.status}. Check configuration or retry.`, response.status === 404 ? 404 : 502);
    }
    return JSON.parse(new TextDecoder().decode(await readLimited(response, 4 * 1024 * 1024)));
  });
}
