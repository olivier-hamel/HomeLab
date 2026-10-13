export type AccountName = { username: string; display_name: string };
export type HomeLabUser = AccountName & { must_change_password: boolean };
export type AccountState = { enabled: boolean; user: HomeLabUser | null; accounts: AccountName[] };

export async function accountApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/memo/api/auth/${path}`, {
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Memo-Request": "1" }, body: JSON.stringify(body) }),
  });
  if (response.status === 401 && path === "me") return { enabled: true, user: null, accounts: [] } as T;
  const data = await response.json().catch(() => { throw new Error("La connexion HomeLab est indisponible. Réessaie dans un instant."); });
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Vérifie les informations saisies.");
  return data as T;
}
