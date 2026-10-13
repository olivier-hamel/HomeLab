import { useCallback, useEffect, useRef, useState } from "react";
import { Aperture, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera as CameraIcon, Check, ChevronRight, CircleHelp, Crosshair, Download, Image, LoaderCircle, Maximize2, Minimize2, Move, Pause, Play, Plus, Radio, RefreshCw, Settings2, ShieldCheck, Square, Trash2, Video, Volume2, VolumeX, Wifi, WifiOff, X, ZoomIn } from "lucide-react";
import CameraVideo from "../components/camera/CameraVideo";
import type { VideoState } from "../components/camera/CameraVideo";
import CameraSettings from "../components/camera/CameraSettings";
import { cameraRequest, captureFrame, initialCamera } from "../lib/camera";
import type { CameraStatus } from "../lib/camera";
import "./camera.css";

type Capture = { id: string; image: string; at: Date; filename: string };
const time = (date: Date) => date.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function CameraDrawing() {
  return <svg className="camera-drawing" viewBox="0 0 200 200" fill="none" aria-hidden="true">
    <ellipse cx="100" cy="168" rx="55" ry="10" fill="currentColor" opacity=".08" />
    <path d="M66 139h68l9 15c3 6-2 11-9 11H66c-7 0-12-5-9-11l9-15Z" fill="#202a2a" stroke="#41524f" />
    <rect x="51" y="37" width="98" height="110" rx="46" fill="#25302f" stroke="#51615d" />
    <path d="M55 78c0-20 20-37 45-37s45 17 45 37v30c0 20-20 37-45 37s-45-17-45-37V78Z" fill="#141b1c" />
    <circle cx="100" cy="87" r="28" fill="#263c38" stroke="#587269" />
    <circle cx="100" cy="87" r="19" fill="#132624" stroke="#748f81" />
    <circle cx="100" cy="87" r="10" fill="#7ca58b" opacity=".35" /><circle cx="94" cy="81" r="4" fill="#b9efcd" opacity=".65" />
    <circle cx="100" cy="126" r="2.5" fill="#a8d8b8" />
    <path d="M152 46a15 15 0 0 1 9 13M157 34a28 28 0 0 1 17 24" stroke="#95cbaa" strokeWidth="2" strokeLinecap="round" opacity=".55" />
  </svg>;
}

export default function Camera() {
  const [camera, setCamera] = useState<CameraStatus>(initialCamera), [loaded, setLoaded] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState(false), [tab, setTab] = useState<"live" | "captures">("live");
  const [quality, setQuality] = useState<"hd" | "sd">("hd"), [muted, setMuted] = useState(true), [paused, setPaused] = useState(false), [zoom, setZoom] = useState(1);
  const [videoState, setVideoState] = useState<VideoState>("connecting"), [videoIssue, setVideoIssue] = useState(""), [attempt, setAttempt] = useState(0);
  const [speed, setSpeed] = useState(0.5), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [addingPreset, setAddingPreset] = useState(false), [presetName, setPresetName] = useState("");
  const [captures, setCaptures] = useState<Capture[]>([]), [preview, setPreview] = useState<Capture | null>(null), [fullscreen, setFullscreen] = useState(false);
  const video = useRef<HTMLVideoElement>(null), viewer = useRef<HTMLDivElement>(null), previewDialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true), pending = useRef(false);
  const [now, setNow] = useState(() => new Date());
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const status = await cameraRequest<CameraStatus>("status", undefined, signal);
      if (!signal?.aborted && mounted.current) { setCamera(status); setLoaded(true); setError(""); }
    } catch (failure) { if (!signal?.aborted && mounted.current) { setError(failure instanceof Error ? failure.message : "Le serveur est inaccessible."); setLoaded(true); } }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(); const initial = setTimeout(() => { void refresh(controller.signal); }, 0);
    const timer = setInterval(() => { void refresh(controller.signal); }, 20_000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => { mounted.current = false; controller.abort(); clearTimeout(initial); clearInterval(timer); clearInterval(clock); document.removeEventListener("fullscreenchange", changed); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(timeout); }, [notice]);
  useEffect(() => { if (preview) previewDialog.current?.showModal(); }, [preview]);
  const onVideoState = useCallback((state: VideoState, issue?: string) => { setVideoState(state); setVideoIssue(issue || ""); }, []);
  async function command(path: string, data: Record<string, unknown>, success?: string) {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError("");
    try { await cameraRequest(path, data); if (success && mounted.current) setNotice(success); return true; }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "La commande a échoué."); return false; }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function reconnect() {
    setRefreshing(true); setPaused(false); setVideoState("connecting"); setVideoIssue(""); setAttempt(value => value + 1);
    await refresh(); if (mounted.current) setRefreshing(false);
  }
  function snapshot() {
    try {
      if (!video.current) return;
      const at = new Date(), image = captureFrame(video.current);
      setCaptures(items => [{ id: crypto.randomUUID(), image, at, filename: `tapo-${at.toISOString().replace(/[:.]/g, "-")}.jpg` }, ...items].slice(0, 24));
      setNotice("Capture ajoutée. Retrouve-la dans Captures pour la télécharger.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "La capture a échoué."); }
  }
  async function toggleFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await viewer.current?.requestFullscreen(); }
    catch { setError("Le plein écran est indisponible dans ce navigateur."); }
  }
  const streaming = loaded && camera.configured && camera.connected && !paused && tab === "live";
  const playing = streaming && videoState === "playing";
  const controlsEnabled = loaded && camera.connected && camera.ptz;
  const statusLabel = !loaded ? "Vérification…" : !camera.configured ? "À connecter" : !camera.connected ? "Hors ligne" : "Connectée";
  return <div className="camera-app">
    <header className="camera-topbar"><div className="camera-brand"><span className="camera-brand-icon"><Aperture size={25} strokeWidth={1.6} /></span><span>veille<span className="camera-brand-dot">.</span><small>LA MAISON, EN UN REGARD</small></span></div><div className="camera-top-actions"><span className="camera-local"><ShieldCheck size={15} /> Accès local</span><button className="camera-secondary" onClick={() => setSettings(true)}><Settings2 size={16} /><span>Paramètres</span></button></div></header>
    <div className="camera-heading"><div><p className="camera-kicker">VOTRE ESPACE, EN DIRECT</p><h1>Un œil sur la maison<span>.</span></h1><p>Le calme de savoir que tout va bien.</p></div><div className="camera-date"><span>{now.toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}</span><strong>{time(now)}</strong></div></div>
    <div className="camera-page-tabs"><nav aria-label="Vues de la caméra"><button aria-current={tab === "live" ? "page" : undefined} className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}><Radio size={17} /> Vue en direct</button><button aria-current={tab === "captures" ? "page" : undefined} className={tab === "captures" ? "active" : ""} onClick={() => setTab("captures")}><Image size={17} /> Captures<span className="camera-count">{captures.length}</span></button></nav><span className={`camera-device-status ${camera.connected ? "connected" : ""}`}><i />{statusLabel}</span></div>
    {error && <div className="camera-alert" role="alert"><WifiOff size={18} /><p>{error}</p><button aria-label="Fermer le message" onClick={() => setError("")}><X size={17} /></button></div>}
    {notice && <div className="camera-toast" role="status"><Check size={18} />{notice}</div>}
    {tab === "live" ? <div className="camera-workspace">
      <div className="camera-main">
        <section className="camera-feed-card" aria-label="Vue en direct">
          <div className="camera-feed-heading"><span className="camera-device-icon"><Video size={20} /></span><div><h2>{camera.name}</h2><p>{camera.model} <span>·</span> {camera.network.host}</p></div><span className={`camera-live-badge ${playing ? "is-live" : ""}`}><i />{playing ? "DIRECT" : paused ? "EN PAUSE" : "CAMÉRA 01"}</span></div>
          <div className={`camera-viewer ${playing ? "is-playing" : ""}`} ref={viewer}>
            {streaming && <CameraVideo videoRef={video} quality={quality} muted={muted} zoom={zoom} attempt={attempt} onState={onVideoState} />}
            {(!streaming || videoState !== "playing") && <div className="camera-viewer-state" role="status">
              {!loaded || (streaming && ["connecting", "buffering"].includes(videoState)) ? <><span className="camera-loader-orbit"><Aperture size={34} className="camera-spin" /></span><h3>{!loaded ? "À la recherche de ta caméra…" : videoState === "buffering" ? "Le direct reprend…" : "La maison arrive à l’écran…"}</h3><p>La connexion peut prendre quelques secondes.</p></> : <>
                <CameraDrawing /><h3>{!camera.configured ? "Ta maison, bientôt ici." : paused ? "Une petite pause." : "La caméra fait une pause."}</h3><p>{!camera.configured ? "Connecte ton Tapo C200 pour voir le direct et orienter la caméra depuis un seul endroit." : paused ? "Le direct est suspendu dans ce navigateur. La caméra continue de fonctionner." : videoIssue || camera.issue || "La caméra est inaccessible. Vérifie son alimentation et sa connexion au réseau."}</p>
                <button className="camera-primary" disabled={refreshing} onClick={!camera.configured ? () => setSettings(true) : reconnect}>{!camera.configured ? <Plus size={17} /> : refreshing ? <LoaderCircle size={17} className="camera-spin" /> : <Play size={17} />}{!camera.configured ? "Connecter ma caméra" : paused ? "Reprendre le direct" : "Relancer le direct"}</button>
                {!camera.configured && <span className="camera-viewer-address"><Wifi size={13} /> {camera.network.host} <span>·</span> Prête à être configurée</span>}
              </>}
            </div>}
            {playing && <><div className="camera-video-overlay"><span><i />{camera.name}</span><span>{time(now)}</span></div><span className="camera-resolution">{quality === "hd" ? "HAUTE QUALITÉ" : "FLUX LÉGER"}{zoom > 1 ? ` · ${zoom.toFixed(1)}×` : ""}</span></>}
            {fullscreen && <button className="camera-fullscreen-exit camera-icon-button" aria-label="Quitter le plein écran" onClick={toggleFullscreen}><Minimize2 size={21} /></button>}
          </div>
          <div className="camera-player-toolbar"><div><button className="camera-icon-button" aria-label={paused ? "Reprendre le direct" : "Mettre le direct en pause"} disabled={!camera.connected} onClick={() => { setPaused(!paused); setVideoState("connecting"); }}>{paused ? <Play size={19} /> : <Pause size={19} />}</button><button className={`camera-icon-button ${!muted ? "is-selected" : ""}`} aria-label={muted ? "Activer le son" : "Couper le son"} aria-pressed={!muted} disabled={!camera.connected} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button><span className="camera-toolbar-divider" /><label className="camera-quality"><span className="sr-only">Qualité du flux</span><select value={quality} onChange={event => { setQuality(event.target.value as "hd" | "sd"); setVideoState("connecting"); }}><option value="hd">HD · Haute qualité</option><option value="sd">SD · Flux léger</option></select></label></div><div><button className="camera-capture-button" disabled={!playing} onClick={snapshot}><CameraIcon size={17} /><span>Capture</span></button><button className="camera-icon-button" aria-label="Relancer le direct" disabled={!camera.configured || refreshing} onClick={reconnect}><RefreshCw size={17} className={refreshing ? "camera-spin" : ""} /></button><button className="camera-icon-button" aria-label="Afficher le flux en plein écran" disabled={!playing} onClick={toggleFullscreen}><Maximize2 size={18} /></button></div></div>
        </section>
        <div className="camera-below-feed"><ShieldCheck size={16} /><p>Un direct qui reste chez vous.<span> La vidéo passe par votre serveur HomeLab.</span></p><span className="camera-latency">Quelques secondes de décalage</span></div>
        <section className="camera-recent"><div className="camera-section-heading"><div><p className="camera-kicker">UN INSTANT À GARDER</p><h2>Dernières captures</h2></div><button className="camera-text-button" onClick={() => setTab("captures")}>Tout voir <ChevronRight size={15} /></button></div>{captures.length ? <div className="camera-recent-grid">{captures.slice(0, 3).map(item => <button key={item.id} onClick={() => setPreview(item)}><img src={item.image} alt={`Capture de ${camera.name} à ${time(item.at)}`} /><span><CameraIcon size={13} />{time(item.at)}</span></button>)}</div> : <div className="camera-captures-empty"><span><Image size={25} strokeWidth={1.4} /></span><div><strong>Les petits moments commencent ici.</strong><p>Prends une capture du direct pour la retrouver et la télécharger.</p></div><CameraIcon size={19} /></div>}</section>
      </div>
      <aside className="camera-control-column" aria-label="Commandes de la caméra">
        <section className="camera-panel camera-direction-panel"><div className="camera-panel-heading"><span className="camera-panel-icon"><Move size={19} /></span><div><h2>Le bon angle</h2><p>Oriente la caméra à ton rythme.</p></div></div>
          <div className="camera-dpad" role="group" aria-label="Direction de la caméra. Utilise les flèches du clavier." onKeyDown={event => { const direction = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as Record<string, string>)[event.key]; if (direction && controlsEnabled && !busy && !event.repeat) { event.preventDefault(); void command("move", { direction, speed }); } }}>
            <div className="camera-dpad-rings" aria-hidden="true" />
            {[{ direction: "up", label: "Orienter vers le haut", Icon: ArrowUp }, { direction: "left", label: "Orienter vers la gauche", Icon: ArrowLeft }, { direction: "right", label: "Orienter vers la droite", Icon: ArrowRight }, { direction: "down", label: "Orienter vers le bas", Icon: ArrowDown }].map(({ direction, label, Icon }) => <button key={direction} className={`camera-direction camera-direction-${direction}`} aria-label={label} disabled={!controlsEnabled || busy} onClick={() => { void command("move", { direction, speed }); }}><Icon size={21} /></button>)}
            <button className="camera-dpad-stop" aria-label="Arrêter le mouvement" title="Arrêter le mouvement" disabled={!controlsEnabled} onClick={() => { void cameraRequest("stop", {}).catch(failure => setError(failure.message)); }}><Square size={15} fill="currentColor" /></button>
          </div>
          <p className="camera-control-hint">{!camera.configured ? "Les commandes s’activent après connexion." : !camera.connected ? "Reconnecte la caméra pour l’orienter." : !camera.ptz ? "Le contrôle moteur n’est pas disponible." : "Un clic, un petit mouvement. Les flèches du clavier fonctionnent aussi."}</p>
          <div className="camera-speed"><span>Vitesse</span><div role="group" aria-label="Vitesse de déplacement">{[{ value: 0.25, label: "Douce" }, { value: 0.5, label: "Normale" }, { value: 0.8, label: "Rapide" }].map(item => <button key={item.value} aria-pressed={speed === item.value} className={speed === item.value ? "active" : ""} onClick={() => setSpeed(item.value)}>{item.label}</button>)}</div></div>
          <div className="camera-zoom"><label htmlFor="camera-zoom"><ZoomIn size={16} /> Zoom numérique <span>{zoom.toFixed(1)}×</span></label><input id="camera-zoom" type="range" min="1" max="3" step="0.1" value={zoom} disabled={!playing} onChange={event => setZoom(Number(event.target.value))} aria-valuetext={`${zoom.toFixed(1)} fois`} /><div><span>Vue entière</span><button onClick={() => setZoom(1)} disabled={zoom === 1}>Réinitialiser</button></div></div>
        </section>
        <section className="camera-panel camera-presets"><div className="camera-panel-heading"><span className="camera-panel-icon"><Crosshair size={19} /></span><div><h2>Points de vue</h2><p>Retrouve tes angles préférés.</p></div><button className="camera-icon-button" aria-label="Enregistrer le point de vue actuel" disabled={!controlsEnabled || !camera.presetsSupported || busy} onClick={() => setAddingPreset(!addingPreset)}><Plus size={18} /></button></div>
          {camera.presets.length ? <ul>{camera.presets.map((preset, index) => <li key={preset.token}><button disabled={!controlsEnabled || busy} onClick={() => { void command("preset", { action: "go", value: preset.token }, `Point de vue « ${preset.name} » sélectionné.`); }}><span>{String(index + 1).padStart(2, "0")}</span>{preset.name}<ChevronRight size={16} /></button><button className="camera-icon-button" aria-label={`Supprimer le point de vue ${preset.name}`} disabled={busy || !controlsEnabled} onClick={async () => { if (await command("preset", { action: "remove", value: preset.token })) await refresh(); }}><Trash2 size={14} /></button></li>)}</ul> : <div className="camera-presets-empty"><Crosshair size={24} strokeWidth={1.2} /><p>{camera.connected && !camera.presetsSupported ? "Les points de vue ne sont pas pris en charge par ce firmware." : "Ton angle préféré, à un clic."}</p><span>{camera.connected && camera.presetsSupported ? "Oriente la caméra, puis enregistre ce point de vue." : "Les angles enregistrés apparaîtront ici."}</span></div>}
          {addingPreset ? <form className="camera-preset-form" onSubmit={async event => { event.preventDefault(); if (!await command("preset", { action: "save", value: presetName.trim() }, "Point de vue enregistré.")) return; await refresh(); setAddingPreset(false); setPresetName(""); }}><label htmlFor="camera-preset-name">Nom du point de vue</label><input id="camera-preset-name" value={presetName} autoFocus maxLength={32} required placeholder="Ex. Entrée" onChange={event => setPresetName(event.target.value)} /><div><button type="button" className="camera-secondary" onClick={() => setAddingPreset(false)}>Annuler</button><button className="camera-primary" disabled={busy || !presetName.trim()}>Enregistrer</button></div></form> : <button className="camera-preset-add" disabled={!controlsEnabled || !camera.presetsSupported || busy} onClick={() => setAddingPreset(true)}><Plus size={16} /> Enregistrer cet angle</button>}
        </section>
        <div className="camera-help"><CircleHelp size={18} /><div><strong>Un peu de confidentialité ?</strong><p>Le mode Confidentialité de Tapo coupe l’image et le son à la source. Gère-le dans l’application Tapo.</p></div></div>
      </aside>
    </div> : <section className="camera-gallery"><div className="camera-section-heading"><div><p className="camera-kicker">LES INSTANTS CONSERVÉS</p><h2>Vos captures</h2><p>Conservées pendant cette visite. Télécharge celles que tu souhaites garder.</p></div><button className="camera-secondary" onClick={() => setTab("live")}><Radio size={16} /> Retour au direct</button></div>{captures.length ? <div className="camera-gallery-grid">{captures.map(item => <article key={item.id}><button className="camera-gallery-image" onClick={() => setPreview(item)}><img src={item.image} alt={`Capture à ${time(item.at)}`} /></button><div><span><strong>{camera.name}</strong><small>{item.at.toLocaleDateString("fr-CA")} · {time(item.at)}</small></span><a href={item.image} download={item.filename} aria-label={`Télécharger la capture de ${time(item.at)}`} className="camera-icon-button"><Download size={18} /></a><button className="camera-icon-button" aria-label={`Supprimer la capture de ${time(item.at)}`} onClick={() => setCaptures(items => items.filter(capture => capture.id !== item.id))}><Trash2 size={16} /></button></div></article>)}</div> : <div className="camera-gallery-empty"><span><Image size={42} strokeWidth={1} /></span><h3>Le premier instant est à venir.</h3><p>Depuis le direct, appuie sur Capture pour garder une image de la maison.</p><button className="camera-primary" onClick={() => setTab("live")}><Radio size={17} /> Ouvrir le direct</button></div>}</section>}
    <footer className="camera-footer"><span><Aperture size={13} /> veille. <i>par HomeLab</i></span><span>Une caméra. Votre réseau. L’esprit tranquille.</span><span><ShieldCheck size={13} /> Connexion privée</span></footer>
    {settings && <CameraSettings camera={camera} onClose={() => setSettings(false)} onSaved={() => { void reconnect(); }} />}
    {preview && <dialog ref={previewDialog} className="camera-dialog camera-preview" onCancel={() => setPreview(null)} onClick={event => { if (event.target === event.currentTarget) setPreview(null); }} aria-label="Aperçu de la capture"><div className="camera-dialog-head"><h2>{camera.name} · {time(preview.at)}</h2><button className="camera-icon-button" aria-label="Fermer l’aperçu" onClick={() => setPreview(null)}><X size={20} /></button></div><img src={preview.image} alt={`Capture de ${camera.name} à ${time(preview.at)}`} /><div className="camera-preview-footer"><p>{preview.at.toLocaleDateString("fr-CA")}</p><a className="camera-primary" href={preview.image} download={preview.filename}><Download size={17} /> Télécharger</a></div></dialog>}
  </div>;
}
