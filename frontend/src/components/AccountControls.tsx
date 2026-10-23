import { KeyRound, LogOut, UserRound } from "lucide-react";
import { useAccount } from "../lib/account-context";

export default function AccountControls() {
  const { user, busy, logout, changePassword } = useAccount();
  return <div className="homelab-account-controls" aria-label="Compte HomeLab">
    <span className="homelab-account-name"><UserRound aria-hidden="true" /><span>{user.display_name}<small>Compte HomeLab</small></span></span>
    <button type="button" onClick={changePassword} disabled={busy} aria-label="Changer le mot de passe HomeLab" title="Changer le mot de passe"><KeyRound aria-hidden="true" /></button>
    <button type="button" onClick={logout} disabled={busy} aria-label="Se déconnecter de HomeLab" title="Se déconnecter"><LogOut aria-hidden="true" /></button>
  </div>;
}
