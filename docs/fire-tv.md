# Fire Stick / Fire TV browser view

Open your usual HomeLab address in the Fire Stick's **Internet (Amazon Silk)**
browser. Fire TV device identifiers automatically enable TV mode and open
**TV & Movies**. Desktop and phone browsers keep the original dashboard.

If the browser hides its device identity or uses desktop mode, add `?tv=1`:

```text
http://YOUR-HOMELAB-IP:3000/?tv=1
```

You can also use that URL on a desktop to preview the TV layout. Use the
**Desktop view** link, or `?tv=0`, to switch back. An explicit choice is saved
only in that browser; `?tv=1` always overrides a saved desktop choice.
The URL works even when browser storage is blocked.

TV mode provides larger text, four poster columns at 720p and five at 1080p,
extra space around the screen edges, a strong orange focus outline, and access
to the other dashboard sections through the header menu.

- **Arrows / D-pad:** move between controls; focused items scroll into view.
- **Scrolling:** the TV view uses normal browser page scrolling. Use Silk's
  scroll controls, Page Up / Page Down, or the fixed **Up / Down** buttons.
  When there is no next control, Up / Down arrows scroll through remaining text.
- **Cursor scrolling:** hold the cursor near the bottom of the screen to scroll
  down, or just below the top navigation to scroll up. Move away to stop.
  It starts after a brief pause and stops during clicks, typing, or fullscreen.
- **Select / Enter:** activate a button or open a menu. Use the visible Search
  button after entering text with the on-screen keyboard.
- **Text fields:** Left / Right edits text; Up / Down leaves the field.
- **Menus:** Up / Down changes the selection; Left / Right leaves the menu.
- **Back / Escape:** close details, close an expanded panel, close playback,
  or return from source search to the catalogue. In fullscreen, Back exits
  fullscreen first. At the top level, normal browser Back remains available.
- **Playback:** use the large Play / Pause, rewind / forward 10 seconds, Stop,
  and Fullscreen buttons. Left / Right on the timeline seeks; Up / Down leaves
  it. Delivered media-key events also control play/pause and 10-second seeking.
  Exit fullscreen to change subtitles using the enlarged subtitle controls.

Silk can handle the D-pad as a browser cursor instead of sending arrow keys to
the page. The same large controls work with that cursor. Browser-owned Back,
Home, voice input, and native menus remain controlled by Silk/Fire OS; a web
page can only handle events the browser delivers.

The build targets Chrome 87 syntax and supplies missing `AbortSignal.any` and
`AbortSignal.timeout` helpers. This does not guarantee decoding support on every
Fire Stick: playback still probes the browser and uses the existing preparation
flow. Configure media services as described in [TV & Movies](tv-media.md).

## Verification

From `frontend`, run `npm run lint`, `npm test`, and `npm run build`.
From the repository root, run `node scripts/test-tv-ui.mjs` after building.
The browser check uses a local server with mock media responses and headless
Chrome (`CHROME_BIN` can override its executable); it does not contact your media
services. It checks TV and desktop layouts, browser/cursor/button scrolling,
remote navigation, dialog focus,
source/file selection, player controls, and fallback APIs. It simulates media
events rather than verifying video decoding.

On a physical Fire Stick, verify search using the on-screen keyboard, scrolling
the catalogue, selecting a source and file, play/pause, seeking, fullscreen,
subtitles, and Back. Browser emulation cannot verify physical remote delivery
or device-specific video decoding.

References: [Amazon's Fire TV device identifiers](https://developer.amazon.com/docs/fire-tv/user-agent-strings.html),
[Silk browser controls](https://digprjsurvey.amazon.co.uk/csad/help/node/TZ6CJ7nVQJW26yiItl).
