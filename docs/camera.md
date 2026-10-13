# Caméra / Veille

Open **Caméra** in the HomeLab sidebar or use `/?section=camera`.
Veille streams the Tapo C200 and provides pan/tilt controls, sound, HD/SD
selection, digital zoom, saved viewpoints (when supported by the firmware),
fullscreen playback and downloadable snapshots. It uses the existing HomeLab login.

## Connect the camera

In the phone's Tapo app, select the C200, then **Settings → Advanced Settings →
Camera Account** and create a camera username and password. This is a separate
account from the TP-Link cloud login. In HomeLab's Caméra app, choose **Connecter
ma caméra**, enter that camera account, and save. The server stores the account
in a private file; credentials are never returned to the browser or put in a
browser playback URL. All signed-in household accounts share this camera.

Alternatively, set `TAPO_USERNAME` and `TAPO_PASSWORD` in `backend/.env` and restart
the backend. Environment credentials take precedence and can only be changed
on the server. `TAPO_NAME` optionally overrides the camera name.

The defaults match the supplied network:

| Setting | Value |
| --- | --- |
| IP / `TAPO_HOST` | `192.168.0.188` |
| Mask / `TAPO_MASK` | `255.255.255.0` |
| Gateway / `TAPO_GATEWAY` | `192.168.0.1` |
| DNS / `TAPO_DNS` | `192.168.0.202` |

The network panel displays these values. It does not change the camera's IP,
gateway or DNS. Manage those in Tapo or through the router's DHCP reservation.
`TAPO_HOST` must be a private IPv4 address; host changes require a backend restart.

## Runtime and deployment

The backend must reach the camera on TCP **554** (RTSP) and **2020** (ONVIF).
Docker's existing bridge network can reach the LAN; no extra camera port is
published. Build and start the updated stack with your usual Compose workflow.
FFmpeg is already included in the backend image. For local development, install
FFmpeg or set `FFMPEG_PATH` to its executable.

Compose mounts the new `camera_data` volume at `/data/camera`; camera account
settings survive container rebuilds. Local development stores settings under
`.local-data/camera/account.json` (outside Git). `CAMERA_STORAGE_PATH` can override
the directory. The directory uses mode 0700 and the account file uses mode 0600.
The file contains the camera password and should be treated like `backend/.env`.
FFmpeg input arguments contain the RTSP credential, so server process access
should be limited to trusted administrators. Diagnostics are not logged.

H.264 video is encoded with FFmpeg's ultrafast, zero-latency preset at 20 fps,
with independently decodable 500 ms segments. The decoder is limited to one
thread before the RTSP input, avoiding FFmpeg's automatic frame queue. The short
probe keeps its packets so the first keyframe is available to the decoder. The
encoder uses two threads and filters use one. Camera audio starts on the same
relay clock as video, then advances by sample count so batched packet arrivals
cannot collapse the audio timeline. Optional audio is converted to AAC. Output
normalization is required with FFmpeg 5 in the Debian backend image: input
normalization alone can place audio and video many hours apart. Each quality
shares one encoder. The playlist keeps 12 segments, with six additional expired
segments retained for requests already in flight; retention does not set the
player's delay. The relay stops after 45 seconds without video
requests, releases its RTSP session with a graceful FFmpeg shutdown, and deletes
its temporary files. Every playlist and segment request
requires a valid HomeLab session. Browsers with Media Source support use locally
bundled HLS.js, which normalizes the C200's timestamps; native HLS is a fallback.
Chromium's native player can report HLS support while rejecting the camera's DTS
ordering, so the app prefers HLS.js. The player targets one second behind the
published live edge and bounds its buffer. Catch-up seeks only use downloaded
audio/video, leaving 400 ms of playable media after the target. Transient fragment
failures have bounded retries; a fatal network error reloads the current playlist
up to twice instead of repeatedly requesting an expired segment. The refresh
icon becomes **Revenir au direct** while
video is playing. The full image delay also includes camera and transport time.
The one-second target is relative to published media, not a guarantee of
subsecond camera-to-screen delay. Camera capture, encoding and transport add to it.
Each pan/tilt click sends only the supported PanTilt fields,
uses the C200's minimum one-second camera timeout, then sends Stop after 350 ms.
The camera timeout limits movement if the server cannot send the earlier Stop;
the center button also sends Stop. This was verified on firmware 1.9.1.

Snapshots capture the full original frame (digital zoom only changes the live
display). Up to 24 snapshots remain in browser memory during the visit; download
them to keep them before switching apps, changing HomeLab accounts or reloading.
Snapshots are not continuously recorded or uploaded to the server.

Privacy mode, night vision, firmware updates and SD-card recordings are managed
in the Tapo app. If privacy mode is on, switch it off there to restore the feed.
If viewpoints are unsupported, the app disables them; streaming and pan/tilt
remain independent.

## Verification

Run the frontend/backend lint, type checks, tests and production builds. Camera
API tests cover session and origin protection, private settings, command routing,
input validation and a real FFmpeg relay using synthetic video. For browser QA:

```sh
cd frontend
npm run build
cd ..
node scripts/test-camera-ui.mjs
node scripts/test-camera-live.mjs
```

To check the running development server instead of the production build, set
`HOMELAB_CAMERA_DEV_URL=http://127.0.0.1:3000`. Set `CAMERA_UI_BROWSER=firefox` to
use Playwright's installed Firefox browser. This checks the real module responses
and requires HLS.js to return JavaScript with HTTP 200. The Vite config serves the
standalone HLS.js ES module directly; the proxy unit test uses a separate temporary
dependency cache so it cannot invalidate an active development server.

The UI check uses synthetic HLS and simulated camera APIs, covering setup,
offline recovery, movement, preset errors, HD/SD playback, sound, zoom, snapshots,
gallery downloads and responsive layouts at desktop, 390 px and 320 px. The live
regression uses a rolling synthetic playlist with audio, two-hour MPEG-TS
timestamps, 350 ms request delays and an expired fragment. It checks sustained
frame decoding, automatic recovery, buffered return to live and HD/SD playback.
Use `CAMERA_UI_BROWSER=firefox` for this regression as well. Real
camera authentication, firmware capabilities and movement require the camera
account and a server that can reach the camera. The supplied C200 was verified
with read-only ONVIF, both RTSP streams (1280×720 HD and 640×360 SD), the FFmpeg
relay, and actual moving video frames through HLS.js. Pan/tilt commands and
position changes were verified on firmware 1.9.1 Build 260326 Rel.26771n. Native
HLS fallback on Safari still needs device-specific verification.

Protocol references: [TP-Link RTSP/ONVIF setup](https://www.tapo.com/en/faq/34/),
[ONVIF client API](https://github.com/agsh/onvif/tree/v0.x),
[HLS.js](https://github.com/video-dev/hls.js).
