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

TV mode includes animated poster focus and artwork zoom, staggered catalogue
entrances, page and loading fades, smooth D-pad scrolling, and opening/closing
transitions for title dialogs and expandable panels. The existing layout stays
the same, with warmer accents and darker surfaces. Motion uses short CSS
transitions and native browser animations, with no additional animation library.
The device/browser's **Reduce motion** preference disables the decorative motion
and makes scrolling and dismissal immediate. Watch actions start immediately;
closing details retains the modal focus trap until its brief exit finishes.

TV mode provides larger text, five poster columns at 720p and seven at 1080p,
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
  and Fullscreen buttons. Left / Right on the timeline seeks 10 seconds per press; Up / Down leaves
  it. Delivered media-key events also control play/pause and 10-second seeking.
  Exit fullscreen to change subtitles using the enlarged subtitle controls.

Silk can handle the D-pad as a browser cursor instead of sending arrow keys to
the page. The same large controls work with that cursor. Browser-owned Back,
Home, voice input, and native menus remain controlled by Silk/Fire OS; a web
page can only handle events the browser delivers.

The build targets Chrome 87 syntax and supplies missing `AbortSignal.any` and
`AbortSignal.timeout` helpers. Browser playback probes the formats reported by
Silk. The Android APK uses Media3 ExoPlayer with a dedicated SurfaceView and
aspect-ratio fitting. Native decoder queries check codec profiles, resolution,
and frame rate before requesting a stream. Compatible sources play directly;
otherwise the server copies compatible video and converts only what is needed.
A runtime decoder failure gets one H.264/AAC compatibility retry. Older APKs
without native capability queries keep their conservative conversion path.
Configure media services as described in [TV & Movies](tv-media.md).

### Fullscreen watching session

Version code 5, version name `1.3.0-player-menus`, keeps the initial torrent
search on the page. Once ready, Watch opens the native fullscreen player.
Deploy the hosted frontend changes together with the APK: the native menus
use the page's authenticated media API client.

- Press **Menu**, or **Up** then select **Options**, to open the player menu.
- Use the **Subtitles: Off / On** button beside Options to toggle English captions.
  It uses the same automatic matching as desktop: try matching subtitle files
  included with the torrent first, then fall back to the subtitle API. No search
  or file selection is needed. While Loading is shown, press again to cancel.
  Changing sources keeps subtitles enabled and finds a match for the new video.
  Subtitle loading leaves playback running.
- **Audio track** selects among supported tracks present in the stream.
  A converted stream may contain only the audio track selected by the server.
- **Picture size** defaults to Fit; Zoom is an explicit choice that crops edges.
- **Try another source** keeps the fullscreen activity open, shows progress
  while the existing source queue is searched, and resumes at the current time.
  Exhausted sources show Retry and Quit inside the player. This action is
  available for the automatic Watch flow.
- **Quit to main page**, or **Back** when no dialog is open, saves progress and
  returns to the catalogue. Back within a menu dismisses that menu.

Media3 is pinned to 1.4.1 to retain the existing SDK 34 / Fire OS 5+ build
baseline. See [Media3 surface guidance](https://developer.android.com/media/media3/ui/surface)
and [track selection](https://developer.android.com/media/media3/exoplayer/track-selection).

## Movie discovery

In TV mode, choose **Don't know what to watch?** to see four movie suggestions.
Use Left / Right and Select to choose the movie that interests you more, or move
down to **Watch now** to start the existing playback flow. **I'm all set** and
the remote's Back button return to the catalogue. The **Don't know** button in
the middle skips the current four movies without recording a preference. It is
focused by default whenever a new group appears, including after loading a new batch.

Gemini receives exactly two lists: `interested` contains up to 25 recent watched
movies and every movie picked during this discovery session; `alreadyProposed`
contains the other suggestions, including skipped movies. Only `interested`
informs recommendations. `alreadyProposed` is neutral and used only for exclusions.
Gemini is instructed to return exactly 16 different movies absent from both lists.
After four choices or skips, one fresh request produces the next complete batch,
verified against TMDB. The page keeps these batches hidden. A rotating ring and pulsing dots animate while
suggestions load, including between batches; Reduce motion disables the animation.
Skipped groups indicate uncertainty, not dislike. Recent movie watch history seeds the first suggestions
when available. Discovery also works without watch history or MongoDB.
It requires the existing `GEMINI_API_KEY` and `TMDB_READ_ACCESS_TOKEN` settings.
IMDb ratings use `OMDB_API_KEY`; missing ratings display **IMDb unavailable**.

Choices belong to the active account and browser session. They are temporary,
held in server memory for up to two hours per batch, and reset when leaving the
page. Both lists retain all unique movies from the session. Picking a previously
proposed movie moves it into `interested`. Failed refinement can be retried without losing the current choices;
after a server restart or session expiry, use **Start over**.

Each submission makes one Gemini request. A short, invalid or incompletely matched
response returns an error; **Try again** requests a fresh set of 16 using the same
two lists. Responses are never combined, and unshown partial results are discarded.
Discovery checks release-year ambiguity
within a one-year window, so unrelated same-name films from other years do not
reject the intended movie. Original and alternative TMDB titles are also checked
when the search returns a different canonical name. Batches remain
16 verified Gemini selections; random catalogue fillers are not used. Gemini is
instructed to avoid repeats, but verified repeated movies are accepted within and
across batches so duplicates do not block discovery.
Quota, configuration, timeout and catalogue errors have distinct messages. Backend logs prefixed
`[movie-discovery]` report error codes and counts without viewing history or credentials.
`MEDIA_DISCOVERY_AI_TIMEOUT_MS` defaults to 30000 per Gemini request; the complete
request remains bounded to two minutes.

After building, run `node scripts/test-tv-ui.mjs --discovery` for the mocked
browser check of remote navigation, four-movie refinement, skips, loading animation, retries, cancellation,
playback handoff, TV layouts, and desktop isolation.

## Verification

From `frontend`, run `npm run lint`, `npm test`, and `npm run build`.
From the repository root, run `node scripts/test-tv-ui.mjs` after building.
The browser check uses a local server with mock media responses and headless
Chrome (`CHROME_BIN` can override its executable); it does not contact your media
services. It checks TV and desktop layouts, browser/cursor/button scrolling,
remote navigation, dialog focus,
source/file selection, player controls, and fallback APIs. It simulates media
events rather than verifying video decoding.
Motion checks also cover rapid D-pad navigation, interrupted panel toggles,
dialog exit/focus restoration, and reduced-motion behavior.

`node scripts/test-tv-ui.mjs --native-player` runs the fullscreen bridge flow
independently: subtitle search/download/archive selection, source replacement
with position preservation, source exhaustion, and quit to the catalogue.
It uses a simulated Capacitor bridge and does not validate native rendering.

On a physical Fire Stick, verify search using the on-screen keyboard, scrolling
the catalogue, selecting a source and file, play/pause, seeking, fullscreen,
subtitles, and Back. Browser emulation cannot verify physical remote delivery
or device-specific video decoding.

References: [Amazon's Fire TV device identifiers](https://developer.amazon.com/docs/fire-tv/user-agent-strings.html),
[Silk browser controls](https://digprjsurvey.amazon.co.uk/csad/help/node/TZ6CJ7nVQJW26yiItl).

## Fire OS APK

The React application also ships as a Fire TV-compatible Android APK without
changing the normal desktop-browser deployment. The APK is a small native shell
that loads the dashboard from its existing LAN or tailnet address. Keeping the
hosted page and `/api` on the same origin preserves the backend's origin and
session checks, and frontend deployments appear on the TV without rebuilding
the APK.

The first launch asks for the dashboard URL, for example:

```text
http://192.168.1.50:3000
```

Use the address that already works from another device on the same network.
The Compose `FRONTEND_BIND_ADDRESS` must be the server's LAN address or an
intentional all-interface bind—not `127.0.0.1`. The APK saves the address in
Android preferences and always requests TV mode. Choose **Server** in the TV
header to change it later.

The native project uses Capacitor 6 and `minSdkVersion 22`, covering Fire OS 5
and later. It declares the Leanback launcher, landscape orientation, and no
touchscreen requirement. Cleartext HTTP is enabled for private home-network
deployments; prefer HTTPS when the service is reachable beyond a trusted LAN or
tailnet.

### Build

Install Node.js 24, JDK 17, and Android SDK Platform/Build Tools 34. Set
`JAVA_HOME` and `ANDROID_SDK_ROOT`, or place portable installations under
`.tools/jdk17/<jdk-directory>` and `.tools/android-sdk`. Then run:

```powershell
cd frontend
npm.cmd install
npm.cmd run android:apk
```

The script builds the web application, synchronizes Capacitor, compiles a
debug-signed APK, and copies it to:

```text
artifacts/HomeLab-TV-debug.apk
```

The debug APK is suitable for personal sideloading and testing. Publishing to
the Amazon Appstore requires a separately protected release signing key and
store artwork.

To clean the previous build, build a fresh APK, reconnect ADB, and install it
on the configured Fire TV in one step, run from the repository root:

```bash
bash ./scripts/build-and-deploy-fire-tv.sh
```

The script defaults to `192.168.92.255:5555`. Override an address that changes:

```bash
bash ./scripts/build-and-deploy-fire-tv.sh 192.168.92.42
```

### Sideload

Enable developer options and ADB debugging on the Fire TV, find its IP address,
and run:

```powershell
adb connect FIRE_TV_IP:5555
adb install -r artifacts\HomeLab-TV-debug.apk
```

If using the project-local SDK, replace `adb` with
`.tools\android-sdk\platform-tools\adb.exe`. The Fire TV and computer must be
on a network that permits the ADB connection.

### Remote page startup diagnostics (native-4)

The APK setup screen and hosted frontend both identify themselves as
`BUILD 2026.09.10-native-4`; the Android package is version code `3`, version
name `1.1.0-native-4`. Rebuild/redeploy the hosted frontend as well as the APK
to get the new diagnostics on both origins.

The native-3 black screen was reproduced on the AFTKA WebView (Chrome 138).
Its remote HTML and JavaScript loaded, but `prepareNativeApp()` rejected with
`"Preferences" plugin is not implemented on android`. Capacitor's native
callbacks also reported missing `fromNative` and `triggerEvent` functions.
In the installed Capacitor 6.2.2 Android source, `Bridge.loadWebView()` registers
document-start injection only for the local app origin, then disables the HTML
injector. An allowed remote navigation therefore receives no bridge script.

`RemoteBridgeWebViewClient` registers the bridge at document start for the
saved server's exact origin before navigation. It exports App, Preferences,
NativeVideoPlayer and Capacitor's built-in plugins. Keep that export list in
sync if another native plugin is added. Older WebViews retain Capacitor's
HTML injection fallback. The normal Capacitor navigation and request handlers
are preserved.

The HTML now displays a static loading build before modules run. An independent
error panel captures JavaScript, stylesheet/module loading, promise rejection,
bootstrap and React render failures. A 15-second watchdog shows the last
startup stage if a bridge call or bundle load stalls. Retry reloads the page.
If even the loading text is absent, inspect native navigation and HTTP errors.

For a bounded capture after reproducing the problem, from the repository root:

```powershell
$adb = '.\.tools\android-sdk\platform-tools\adb.exe'
# The device was connected at this address during the native-4 investigation.
& $adb connect 192.168.0.92:5555
& $adb -s 192.168.0.92:5555 shell am start -n ca.olivierhamel.homelab/.MainActivity
& $adb -s 192.168.0.92:5555 logcat -d -t 3000 'HomeLabWebView:V' 'Capacitor:V' 'Capacitor/Console:V' 'chromium:V' 'AndroidRuntime:E' '*:S' > artifacts/fire-tv-startup.log
& $adb -s 192.168.0.92:5555 shell dumpsys package ca.olivierhamel.homelab | Select-String 'versionCode|versionName'
```

`HomeLabWebView` logs the APK version, actual WebView user agent, bridge
registration, page loads, HTTP/load errors and plugin headers. Use the Fire
TV's current IP if it changes; `192.168.92.255:5555` timed out during this
investigation.
