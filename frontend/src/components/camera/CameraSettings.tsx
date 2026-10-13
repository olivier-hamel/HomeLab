import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, LoaderCircle, Network, ShieldCheck, X } from "lucide-react";
import { cameraRequest } from "../../lib/camera";
import type { CameraStatus } from "../../lib/camera";

export default function CameraSettings({ camera, onClose, onSaved }: { camera: CameraStatus; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(camera.name), [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false), [replace, setReplace] = useState(!camera.configured);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await cameraRequest("settings", { name, ...(replace && !camera.credentialsFromEnv ? { username, password } : {}) });
      onSaved(); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Impossible d’enregistrer les paramètres."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="camera-dialog camera-settings" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="camera-settings-title">
    <div className="camera-dialog-head"><span className="camera-kicker">CONNEXION LOCALE</span><button className="camera-icon-button" aria-label="Fermer les paramètres" onClick={onClose}><X size={20} /></button></div>
    <div className="camera-dialog-symbol"><LockKeyhole size={26} /></div>
    <h2 id="camera-settings-title">{camera.configured ? "Paramètres de la caméra" : "Bienvenue chez vous."}</h2>
    <p>Connecte ton C200 une fois, puis retrouve son direct et ses commandes dans HomeLab.</p>
    <form onSubmit={save}>
      <label>Nom de la caméra<input value={name} onChange={event => setName(event.target.value)} required maxLength={48} autoComplete="off" placeholder="Ex. Salon" /></label>
      {camera.credentialsFromEnv ? <p className="camera-settings-note"><ShieldCheck size={18} /> Le compte caméra est configuré sur le serveur dans backend/.env.</p> : <>
        {camera.configured && <button type="button" className="camera-text-button" onClick={() => setReplace(!replace)}>{replace ? "Conserver le compte actuel" : "Changer le compte caméra"}<ArrowRight size={15} /></button>}
        {replace && <div className="camera-credentials">
          <div className="camera-setup-steps"><span className="camera-step-number">1</span><p>Dans l’application <strong>Tapo</strong>, ouvre ta caméra → Paramètres → Paramètres avancés → <strong>Compte caméra</strong>.</p></div>
          <div className="camera-setup-steps"><span className="camera-step-number">2</span><p>Crée un compte caméra, puis renseigne ses identifiants ici.</p></div>
          <label>Utilisateur du compte caméra<input value={username} onChange={event => setUsername(event.target.value)} required maxLength={128} autoComplete="off" spellCheck={false} /></label>
          <label>Mot de passe du compte caméra<span className="camera-password"><input value={password} onChange={event => setPassword(event.target.value)} type={visible ? "text" : "password"} required maxLength={128} autoComplete="new-password" /><button type="button" aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          <p className="camera-field-hint">Utilise le compte caméra créé dans Tapo. Ton adresse courriel et ton mot de passe TP-Link servent à un autre compte.</p>
        </div>}
      </>}
      <details className="camera-network"><summary><Network size={17} /> Réseau de la caméra <span>{camera.network.host}</span></summary><dl>
        <div><dt>Adresse IP</dt><dd>{camera.network.host}</dd></div><div><dt>Masque</dt><dd>{camera.network.mask}</dd></div><div><dt>Passerelle</dt><dd>{camera.network.gateway}</dd></div><div><dt>DNS</dt><dd>{camera.network.dns}</dd></div>
      </dl><p>Ces informations décrivent le réseau fourni. Les réglages réseau de la caméra se gèrent dans Tapo ou sur le routeur.</p></details>
      <p className="camera-settings-note"><ShieldCheck size={18} /> Les identifiants restent sur le serveur HomeLab. La vidéo transite par ton réseau local.</p>
      {error && <p className="camera-form-error" role="alert">{error}</p>}
      <button type="submit" className="camera-primary" disabled={busy}>{busy ? <LoaderCircle className="camera-spin" size={18} /> : <Check size={18} />}{busy ? "Enregistrement…" : camera.configured ? "Enregistrer" : "Connecter ma caméra"}</button>
    </form>
  </dialog>;
}
