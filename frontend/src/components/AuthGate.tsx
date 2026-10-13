import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole, LogOut, UserRound } from "lucide-react";
import { accountApi, type AccountName, type AccountState, type HomeLabUser } from "../lib/accounts";
import { AccountContext } from "../lib/account-context";
import { configureMediaAccount } from "../lib/media";
import { useTvMode } from "../lib/tv";
import useTvNavigation from "./useTvNavigation";
import { isNativeApp, saveNativeServer } from "../native";
import { reportStartupError } from "../startup";

function useSecureDashboard() {
  const secure = location.protocol === "https:" || (import.meta.env.DEV && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname));
  useEffect(() => {
    if (secure) return;
    const url = new URL(location.href);
    url.protocol = "https:";
    url.port = location.port === (import.meta.env.VITE_TAILSCALE_HTTP_PORT || "3002")
      ? import.meta.env.VITE_TAILSCALE_HTTPS_PORT || "3444" : import.meta.env.VITE_MEMO_HTTPS_PORT || "3443";
    if (isNativeApp()) {
      // The APK otherwise sends an HTTPS page back to its saved HTTP address.
      void saveNativeServer(url.href).catch(error => reportStartupError("HTTPS server setup failed", error));
    } else location.replace(url.href);
  }, [secure]);
  return secure;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const secure = useSecureDashboard();
  const [user, setUser] = useState<HomeLabUser | null>(null);
  const [accounts, setAccounts] = useState<AccountName[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const announce = () => { try { localStorage.setItem("homelab:account-changed", String(Date.now())); } catch { /* Focus and polling also refresh sessions. */ } };

  const receive = useCallback((state: AccountState) => {
    if (!state.enabled) throw new Error("Les comptes Mémo doivent être activés pour accéder à HomeLab.");
    configureMediaAccount(state.user?.username || null, state.accounts || []);
    setUser(state.user);
    setAccounts(state.accounts || []);
    setReady(true);
  }, []);

  const load = useCallback(async () => {
    if (!secure || inFlight.current) return;
    inFlight.current = true;
    try {
      const state = await accountApi<AccountState>("me");
      if (!state.user) {
        const listed = await accountApi<{ enabled: boolean; accounts: AccountName[] }>("accounts");
        state.enabled = listed.enabled;
        state.accounts = listed.accounts;
      }
      receive(state);
      setError("");
    } catch (caught) { setReady(false); setError((caught as Error).message); }
    finally { inFlight.current = false; }
  }, [receive, secure]);

  useEffect(() => {
    const startup = window.setTimeout(() => { void load(); }, 0);
    const refresh = () => { if (!document.hidden) void load(); };
    const storage = (event: StorageEvent) => { if (event.key === "homelab:account-changed") void load(); };
    const expired = () => { setUser(null); setChanging(false); setSelected(null); configureMediaAccount(null, []); void load(); };
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== document.querySelector<HTMLIFrameElement>(".memo-frame")?.contentWindow) return;
      if (event.data?.type === "homelab:account-changed") expired();
      if (event.data?.type === "homelab:change-password") { setChanging(true); setError(""); }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("homelab:session-expired", expired);
    window.addEventListener("message", message);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("homelab:session-expired", expired);
      window.removeEventListener("message", message);
    };
  }, [load]);

  const logout = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await accountApi("logout", {});
      configureMediaAccount(null, []);
      setUser(null); setChanging(false); setSelected(null); setError("");
      announce();
    } catch (caught) { setError((caught as Error).message); }
    finally { inFlight.current = false; setBusy(false); void load(); }
  };

  const passwordForm = !!user && (user.must_change_password || changing);
  const tvMode = useTvMode();
  useTvNavigation(tvMode && (!ready || !user || passwordForm));
  if (secure && ready && user && !passwordForm) return <AccountContext.Provider key={user.username} value={{ user, accounts, busy, logout: () => void logout(), changePassword: () => { setChanging(true); setError(""); } }}>
    {error && <p className="homelab-auth-notice" role="alert">{error}</p>}
    {children}
  </AccountContext.Provider>;

  return <main className="homelab-auth-screen">
    <section className="homelab-auth-panel" aria-labelledby="auth-heading">
      <p className="homelab-auth-brand">HOMELAB</p>
      <div className="homelab-auth-icon"><LockKeyhole aria-hidden="true" /></div>
      <h1 id="auth-heading">{!secure || !ready ? "Ton espace se prépare…" : passwordForm ? "Un espace bien à toi." : "Heureux de te retrouver."}</h1>
      <p>{passwordForm ? "Choisis un nouveau mot de passe pour ton compte HomeLab." : "Un seul compte pour Tempo, les films et Mémo."}</p>
      {error && <p className="homelab-auth-error" role="alert">{error}</p>}
      {!ready ? error && <button type="button" onClick={() => void load()}>Réessayer</button> : !passwordForm && !selected ? <>
        <div className="homelab-auth-accounts" aria-label="Comptes existants">
          {accounts.map(account => <button type="button" key={account.username} onClick={() => { setSelected(account.username); setError(""); }}>
            <UserRound aria-hidden="true" /><span>{account.display_name}<small>@{account.username}</small></span><ArrowRight aria-hidden="true" />
          </button>)}
        </div>
        {!accounts.length && <p>Aucun compte pour le moment. La personne qui gère HomeLab peut en créer un avec Mémo.</p>}
      </> : <form key={passwordForm ? `password:${user?.username}` : selected} onSubmit={async event => {
        event.preventDefault();
        if (inFlight.current) return;
        const form = event.currentTarget;
        const values = new FormData(form);
        if (passwordForm && values.get("new_password") !== values.get("confirm_password")) { setError("Les nouveaux mots de passe ne correspondent pas."); return; }
        inFlight.current = true; setBusy(true); setError("");
        try {
          const result = await accountApi<AccountState>(passwordForm ? "password" : "login", passwordForm
            ? { current_password: values.get("password"), new_password: values.get("new_password") }
            : { username: selected, password: values.get("password") });
          // Login/password responses use Mémo's unchanged authentication contract.
          receive({ ...result, accounts });
          form.reset(); setChanging(false); announce();
        } catch (caught) { setError((caught as Error).message); }
        finally { inFlight.current = false; setBusy(false); }
      }}>
        <p className="homelab-auth-selected">{user?.display_name || accounts.find(account => account.username === selected)?.display_name}</p>
        <input name="username" value={user?.username || selected || ""} autoComplete="username" readOnly className="sr-only" tabIndex={-1} />
        <label>{passwordForm ? "Mot de passe actuel" : "Mot de passe"}<input name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={busy} autoFocus /></label>
        {passwordForm && <>
          <label>Nouveau mot de passe<input name="new_password" type="password" autoComplete="new-password" required minLength={6} maxLength={256} disabled={busy} /></label>
          <label>Confirmer le nouveau mot de passe<input name="confirm_password" type="password" autoComplete="new-password" required minLength={6} maxLength={256} disabled={busy} /></label>
        </>}
        <button type="submit" disabled={busy}>{busy ? "Un instant…" : passwordForm ? "Enregistrer le mot de passe" : "Se connecter"}<ArrowRight aria-hidden="true" /></button>
        {!passwordForm && <button type="button" className="homelab-auth-secondary" disabled={busy} onClick={() => { setSelected(null); setError(""); }}><ArrowLeft aria-hidden="true" />Changer de compte</button>}
        {changing && !user?.must_change_password && <button type="button" className="homelab-auth-secondary" disabled={busy} onClick={() => setChanging(false)}>Revenir à HomeLab</button>}
        {passwordForm && <button type="button" className="homelab-auth-secondary" disabled={busy} onClick={() => void logout()}><LogOut aria-hidden="true" />Se déconnecter</button>}
      </form>}
    </section>
  </main>;
}
