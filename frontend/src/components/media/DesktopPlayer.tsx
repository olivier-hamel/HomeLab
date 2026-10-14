import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Captions, Check, ChevronDown, LoaderCircle, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Settings2, Volume1, Volume2, VolumeX, X } from "lucide-react";
import PlaybackTimeline from "./PlaybackTimeline";
import SubtitleOverlay from "./SubtitleOverlay";
import "./desktop-player.css";

type Props = {
  video: RefObject<HTMLVideoElement | null>;
  screen: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  title: string;
  state: string;
  error: string;
  notice: string;
  duration: number | null;
  position: number;
  buffered: [number, number][];
  captionsEnabled: boolean;
  subtitles: ReactNode;
  options: ReactNode;
  onPlay: () => void;
  onSeek: (seconds: number) => void;
  onClose: () => void;
  onVolume: (value: number) => void;
  onMute: () => void;
  onSpeed: (value: number) => void;
};

export default function DesktopPlayer({ video, screen, children, title, state, error, notice, duration, position, buffered, captionsEnabled, subtitles, options, onPlay, onSeek, onClose, onVolume, onMute, onSpeed }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<"captions" | "settings" | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [issue, setIssue] = useState("");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const lastVolume = useRef(1);
  const lastPointer = useRef({ x: -1, y: -1 });
  const captionsButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  const playing = state === "playing" || (state === "buffering" && video.current?.paused === false);
  const loading = state === "checking format" || state === "buffering";
  const controlsVisible = visible || !playing || loading || !!menu || !!error;
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const reveal = () => {
    setVisible(true);
    cancelHide();
    hideTimer.current = setTimeout(() => {
      if (dragging.current || screen.current?.querySelector(":focus-visible, [data-player-keep-visible]:hover")) return;
      setVisible(false);
    }, 2800);
  };

  useEffect(() => {
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); if (clickTimer.current) clearTimeout(clickTimer.current); };
  }, []);
  useEffect(() => {
    if (!playing || menu) return;
    const timer = setTimeout(() => {
      if (!dragging.current && !screen.current?.querySelector(":focus-visible, [data-player-keep-visible]:hover")) setVisible(false);
    }, 2800);
    return () => { clearTimeout(timer); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [playing, menu, screen]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const audio = () => { setVolume(element.volume); setMuted(element.muted); };
    const rate = () => setSpeed(element.playbackRate);
    const size = () => setFullscreen(document.fullscreenElement === screen.current);
    const picture = () => setPip(document.pictureInPictureElement === element);
    element.addEventListener("volumechange", audio);
    element.addEventListener("ratechange", rate);
    element.addEventListener("enterpictureinpicture", picture);
    element.addEventListener("leavepictureinpicture", picture);
    document.addEventListener("fullscreenchange", size);
    return () => {
      element.removeEventListener("volumechange", audio);
      element.removeEventListener("ratechange", rate);
      element.removeEventListener("enterpictureinpicture", picture);
      element.removeEventListener("leavepictureinpicture", picture);
      document.removeEventListener("fullscreenchange", size);
    };
  }, [video, screen]);
  useEffect(() => {
    if (!menu) return;
    menuPanel.current?.querySelector<HTMLElement>("button, select, input")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuPanel.current?.contains(event.target) && !captionsButton.current?.contains(event.target) && !settingsButton.current?.contains(event.target)) setMenu(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);

  const togglePlayback = () => {
    reveal();
    const element = video.current;
    if (!element) return;
    if (!element.paused) element.pause();
    else if (!loading) onPlay();
  };
  const setAudio = (value: number) => {
    onVolume(Math.max(0, Math.min(1, value)));
    if (value > 0) lastVolume.current = value;
  };
  const toggleMute = () => {
    const element = video.current;
    if (!element) return;
    if (element.volume === 0) setAudio(lastVolume.current);
    else onMute();
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === screen.current) await document.exitFullscreen();
      else await screen.current?.requestFullscreen();
    } catch { setIssue("Fullscreen isn't available in this browser."); }
  };
  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch { setIssue("Picture in picture isn't available for this video."); }
  };
  const skip = (seconds: number) => {
    if (duration && !loading) onSeek(Math.max(0, Math.min(duration - 1, position + seconds)));
    reveal();
  };
  const closeMenu = () => {
    (menu === "captions" ? captionsButton : settingsButton).current?.focus({ preventScroll: true });
    setMenu(null);
    reveal();
  };
  const toggleMenu = (value: "captions" | "settings") => { reveal(); setMenu(current => current === value ? null : value); };
  const activeVolume = muted ? 0 : volume;

  return <div ref={screen} className="cinema-player" role="region" aria-label={`Video player: ${title}`} tabIndex={0}
    data-controls-visible={controlsVisible} data-menu-open={!!menu}
    onPointerMove={event => {
      if (event.clientX === lastPointer.current.x && event.clientY === lastPointer.current.y) return;
      lastPointer.current = { x: event.clientX, y: event.clientY }; reveal();
    }}
    onPointerDownCapture={event => { if ((event.target as HTMLElement).matches("input[type='range']")) dragging.current = true; }}
    onPointerUpCapture={() => { dragging.current = false; reveal(); }}
    onPointerCancelCapture={() => { dragging.current = false; reveal(); }}
    onPointerLeave={() => { cancelHide(); if (playing && !menu && !dragging.current && !screen.current?.querySelector(":focus-visible")) setVisible(false); }}
    onFocusCapture={reveal}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) reveal(); }}
    onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (event.key === "Escape" && menu) { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
      if (event.altKey || event.ctrlKey || event.metaKey || target.matches("input, select, textarea, [contenteditable='true']")) return;
      if (menuPanel.current?.contains(target)) return;
      if (event.repeat && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const key = event.key.toLowerCase();
      if (key === " " && target.closest("button, a")) return;
      if (![" ", "k", "f", "m", "c", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) return;
      event.preventDefault(); event.stopPropagation(); reveal();
      if (key === " " || key === "k") togglePlayback();
      else if (key === "f") void toggleFullscreen();
      else if (key === "m") toggleMute();
      else if (key === "c") toggleMenu("captions");
      else if (key === "arrowleft") skip(-10);
      else if (key === "arrowright") skip(10);
      else setAudio(activeVolume + (key === "arrowup" ? 0.05 : -0.05));
    }}>
    {children}
    <div className="cinema-hit-area" aria-hidden="true" onClick={event => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
      if (event.detail > 1) return;
      screen.current?.focus({ preventScroll: true });
      if (menu) { closeMenu(); return; }
      clickTimer.current = setTimeout(togglePlayback, 200);
    }} onDoubleClick={() => { if (clickTimer.current) clearTimeout(clickTimer.current); void toggleFullscreen(); }} />
    <SubtitleOverlay video={video} />
    <div className="cinema-topbar cinema-chrome" inert={!controlsVisible}>
      <div className="cinema-title"><span>NOW PLAYING</span><h3>{title}</h3></div>
      <button type="button" className="cinema-icon-button cinema-close" aria-label="Close player" title="Close player" onClick={onClose}><X size={20} /></button>
    </div>
    {(loading || error) && <div className="cinema-state" role={error ? "alert" : "status"}>
      {error ? <><p>{error}</p><button type="button" className="cinema-retry" onClick={onPlay}><RotateCcw size={16} />Retry playback</button></> : <><LoaderCircle size={32} className="cinema-spinner" /><p>{state === "checking format" ? "Getting your video ready" : "Loading video"}</p></>}
    </div>}
    {!playing && !loading && !error && !menu && <button type="button" className="cinema-center-play" aria-label="Play video" onClick={togglePlayback}><Play size={30} fill="currentColor" /></button>}
    <div className="cinema-bottom cinema-chrome" inert={!controlsVisible} data-player-keep-visible="" onPointerEnter={reveal} onPointerLeave={reveal}>
      <PlaybackTimeline compact duration={duration ?? 0} position={position} onSeek={onSeek} buffered={buffered} disabled={loading || !!error} />
      <div className="cinema-control-row">
        <div className="cinema-control-group">
          <button type="button" className="cinema-icon-button cinema-play" aria-label={playing ? "Pause video" : "Play video"} title={playing ? "Pause (Space)" : "Play (Space)"} disabled={loading && !playing} onClick={togglePlayback}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button type="button" className="cinema-icon-button cinema-skip" aria-label="Rewind 10 seconds" title="Back 10 seconds (←)" disabled={!duration || loading} onClick={() => skip(-10)}><RotateCcw size={26} /><span>10</span></button>
          <button type="button" className="cinema-icon-button cinema-skip" aria-label="Forward 10 seconds" title="Forward 10 seconds (→)" disabled={!duration || loading} onClick={() => skip(10)}><RotateCw size={26} /><span>10</span></button>
          <div className="cinema-volume">
            <button type="button" className="cinema-icon-button" aria-label={activeVolume === 0 ? "Unmute video" : "Mute video"} title="Mute (M)" onClick={toggleMute}>{activeVolume === 0 ? <VolumeX size={21} /> : activeVolume < 0.5 ? <Volume1 size={21} /> : <Volume2 size={21} />}</button>
            <input type="range" min={0} max={1} step={0.01} value={activeVolume} aria-label="Volume" aria-valuetext={`${Math.round(activeVolume * 100)}%`} onChange={event => setAudio(Number(event.target.value))} />
          </div>
        </div>
        <div className="cinema-control-group">
          <button ref={captionsButton} type="button" className="cinema-icon-button" data-active={captionsEnabled || menu === "captions"} aria-label="Subtitles" aria-expanded={menu === "captions"} aria-controls={`${id}-captions`} title="Subtitles (C)" onClick={() => toggleMenu("captions")}><Captions size={23} /></button>
          <button ref={settingsButton} type="button" className="cinema-icon-button cinema-settings-button" data-active={menu === "settings"} aria-label="Playback settings" aria-expanded={menu === "settings"} aria-controls={`${id}-settings`} title="Playback settings" onClick={() => toggleMenu("settings")}><Settings2 size={20} /><span>{speed}×</span></button>
          {document.pictureInPictureEnabled && <button type="button" className="cinema-icon-button cinema-pip" data-active={pip} aria-label={pip ? "Exit picture in picture" : "Picture in picture"} title="Picture in picture" disabled={!video.current?.readyState} onClick={() => { void togglePip(); }}><PictureInPicture2 size={21} /></button>}
          {document.fullscreenEnabled && <button type="button" className="cinema-icon-button" aria-label={fullscreen ? "Exit fullscreen video" : "Fullscreen video"} title="Fullscreen (F)" onClick={() => { void toggleFullscreen(); }}>{fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}</button>}
        </div>
      </div>
    </div>
    <div ref={menuPanel} className="cinema-menu" role="dialog" aria-label={menu === "captions" ? "Subtitle settings" : "Player settings"} hidden={!menu} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select, input:not([type='file']), a[href]")).filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="cinema-menu-heading"><h4>{menu === "captions" ? "Subtitles" : "Playback settings"}</h4><button type="button" className="cinema-icon-button" aria-label="Close settings" onClick={closeMenu}><ChevronDown size={18} /></button></div>
      <div id={`${id}-captions`} hidden={menu !== "captions"}>{subtitles}</div>
      <div id={`${id}-settings`} hidden={menu !== "settings"}>
        <div className="cinema-speed"><p>Playback speed</p><div role="group" aria-label="Playback speed">{[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <button type="button" key={value} aria-pressed={speed === value} onClick={() => onSpeed(value)}>{value === 1 && <Check size={13} />}{value}×</button>)}</div></div>
        {options}
        <div className="cinema-shortcuts"><p>Keyboard shortcuts</p><span>Play / pause <kbd>Space</kbd></span><span>Skip 10 seconds <span><kbd>←</kbd> <kbd>→</kbd></span></span><span>Fullscreen <kbd>F</kbd></span><span>Mute <kbd>M</kbd></span><span>Subtitles <kbd>C</kbd></span></div>
      </div>
    </div>
    {(notice || issue) && <div className="cinema-toast" role="status" key={notice || issue}>{issue || notice}<button type="button" aria-label="Dismiss message" onClick={() => { setIssue(""); }} hidden={!issue}><X size={14} /></button></div>}
  </div>;
}
