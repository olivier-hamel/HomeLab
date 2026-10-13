export type LibraryFolder = { id: string; name: string; parentId: string | null; managed: boolean; createdAt: string };
export type LibraryFile = {
  id: string; name: string; folderId: string | null; kind: "pdf" | "powerpoint"; size: number;
  createdAt: string; updatedAt: string; error: string; ready: boolean; hasPreview: boolean;
  source: null | { courseId: number; fileId: string; module: string; available: boolean };
};
export type LibraryData = {
  folders: LibraryFolder[]; files: LibraryFile[]; moodleAvailable: boolean; semester: string; intervalMinutes: number; maxFileBytes: number;
  sync: { status: "idle" | "running" | "warning" | "error"; lastAttempt: string | null; lastSuccess: string | null; message: string; saved: number; total: number };
};
export async function libraryRequest<T>(path = "", method = "GET", body?: unknown, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(`/api/library${path}`, { method, credentials: "same-origin", cache: "no-store",
    headers: { ...(method !== "GET" ? { "X-Library-Request": "1", ...(body instanceof File ? {} : { "Content-Type": "application/json" }) } : {}), ...headers },
    ...(method !== "GET" ? { body: body instanceof File ? body : JSON.stringify(body ?? {}) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "La demande n’a pas pu être terminée. Réessaie.");
  return data as T;
}
export const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-CA");
export const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString("fr-CA", { maximumFractionDigits: 1 })} Mo` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("fr-CA")} Ko`;
export function folderPath(folders: LibraryFolder[], id: string | null): LibraryFolder[] {
  const path: LibraryFolder[] = [], seen = new Set<string>(); let next = id;
  while (next && !seen.has(next)) {
    seen.add(next); const folder = folders.find(row => row.id === next); if (!folder) break;
    path.unshift(folder); next = folder.parentId;
  }
  return path;
}
export function descendants(folders: LibraryFolder[], id: string) {
  const result = new Set([id]);
  for (let i = 0; i < folders.length; i++) {
    const before = result.size;
    for (const folder of folders) if (folder.parentId && result.has(folder.parentId)) result.add(folder.id);
    if (before === result.size) break;
  }
  return result;
}
