import { MediaError, type Fetcher } from "./media/core.ts";

export type HomeLabAccount = { username: string; display_name: string; must_change_password: boolean };
export type AccountSession = { user: HomeLabAccount; accounts: Pick<HomeLabAccount, "username" | "display_name">[] };
export type AccountVerifier = (request: Request) => Promise<AccountSession>;

export function memoSessionCookie(request: Request) {
  return request.headers.get("cookie")?.split(";").map(value => value.trim())
    .find(value => /^memo_session=[A-Za-z0-9_-]{20,256}$/.test(value));
}

export function createAccountVerifier(fetcher: Fetcher = fetch): AccountVerifier {
  return async request => {
    const cookie = memoSessionCookie(request);
    if (!cookie) throw new MediaError("account_session", "Connecte-toi à HomeLab pour continuer.", 401);
    const host = request.headers.get("host") ?? new URL(request.url).host;
    const origin = process.env.MEDIA_ALLOWED_ORIGINS?.split(",").map(value => value.trim()).find(value => {
      try { return new URL(value).host === host; } catch { return false; }
    });
    let response: Response;
    try {
      response = await fetcher(new URL("/api/auth/me", process.env.MEMO_AUTH_URL || "http://127.0.0.1:8000"), {
        headers: { Cookie: cookie, Host: host, "X-Forwarded-Proto": new URL(origin || request.url).protocol.slice(0, -1) },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]), cache: "no-store", redirect: "error",
      });
    } catch {
      throw new MediaError("account_unavailable", "La connexion HomeLab est indisponible. Réessaie dans un instant.", 503);
    }
    if (response.status === 401) throw new MediaError("account_session", "Ta session HomeLab a expiré. Reconnecte-toi.", 401);
    if (!response.ok) throw new MediaError("account_unavailable", "Impossible de vérifier la connexion HomeLab.", 503);
    const data = await response.json().catch(() => null);
    if (data?.enabled !== true || !data.user || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(data.user.username)
        || !Array.isArray(data.accounts) || !data.accounts.some((account: HomeLabAccount) => account.username === data.user.username)) {
      throw new MediaError("account_unavailable", "Active les comptes Mémo pour accéder à HomeLab.", 503);
    }
    if (data.user.must_change_password) throw new MediaError("password_change", "Change ton mot de passe HomeLab pour continuer.", 403);
    return { user: data.user, accounts: data.accounts };
  };
}

export const requireHomeLabAccount = createAccountVerifier();
