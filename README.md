# HomeLab

One repository contains the dashboard, TV & Movies, Tempo, and Mémo.
Use `feat/memo-integration` for development and server deployment. All changes
use one commit → push → pull workflow; see [SERVER-UPDATE.md](SERVER-UPDATE.md).

**HomeLab** opens with its own HTTPS login page and lists the existing Mémo accounts.
One Mémo session opens Tempo, TV & Movies, and Mémo; no duplicate accounts are created.
The cinema profile can switch without a password while the HomeLab login stays unchanged.
See [shared accounts](docs/accounts.md).

**Tempo** is the default page after login. Its source is in [apps/calendar](apps/calendar/README.md).
See [Tempo setup](docs/calendar.md).

**Mémo** is the flashcard app in [apps/memo](apps/memo/README.md), with
password-protected accounts. See [Memo setup](docs/memo.md) for private HTTPS
and persistent data. Original Git histories are preserved; see
[repository structure and history](docs/repository.md).

The browser dashboard contains only Tempo, TV & Movies, and Mémo. The apps
fill the content area; fullscreen is available from the sidebar.

**TV & Movies** adds an optional TMDB catalogue,
Prowlarr search and TorrServer playback through backend APIs. It requires private
network configuration and your own credentials. Follow the
[TV & Movies setup and verification guide](docs/tv-media.md). Live media services
still need verification on your homelab; implementation tests used mocks.

Fire Stick users get a separate TV browser layout with larger controls and
remote navigation. Open `/?tv=1` to enable it manually; desktop keeps its
existing layout. See the [Fire TV browser guide](docs/fire-tv.md).

## How it fits into a home lab

The reference setup runs Docker Engine in an Ubuntu Server VM on Proxmox VE.
Browsers on your home network reach the dashboard through a single published
port. Optional remote access uses a separate Tailscale subnet router.

```mermaid
flowchart LR
  LAN[Browser on your home network] -->|Port 3000| Frontend
  Remote[Permitted Tailscale client] --> Router[Separate subnet router]
  Router -->|LAN route to port 3000| Frontend
  subgraph VM[Ubuntu Server VM on Proxmox]
    Frontend[Caddy and built React frontend] -->|/api preserved| Backend[Next.js API]
  end
```

| Component | What it does | Container port |
| --- | --- | --- |
| `frontend` | Caddy serves the Vite build, handles SPA routes, and proxies `/api` | 8080, published as host port 3000 |
| `backend` | Next.js standalone server hosts API routes | 3001, unpublished |
| `calendar` | Authored static app from `apps/calendar` | 4173, unpublished |
| `memo` | FastAPI and React app from `apps/memo/web-app` | 8000, unpublished |

All four containers run as non-root users. The backend uses outbound network access
for configured media integrations.

## Try it locally with Docker

Install Docker Engine with the Compose plugin on Linux, or
[Docker Desktop](https://docs.docker.com/desktop/) on Windows/macOS. For Windows,
use its Linux container engine and keep Docker Desktop running. You do not need
Node.js installed on the host for Docker builds.

Clone the repository:

```sh
git clone --branch feat/memo-integration https://github.com/olivier-hamel/HomeLab.git homelab
cd homelab
```

Create missing environment files. These commands preserve existing files.

On Linux/macOS:

```sh
umask 077
test -e .env || cp .env.example .env
test -e backend/.env || cp backend/.env.example backend/.env
```

On Windows PowerShell:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

The root example binds to `127.0.0.1:3000` for local use. If you already have a
`.env`, check its address and port before starting. HomeLab requires an existing Mémo account and switches to HTTPS before login.
TV & Movies also requires its media-service configuration, including the HTTPS
dashboard URL in `MEDIA_ALLOWED_ORIGINS`.

Build and start the stack from the repository root:

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d --wait --wait-timeout 180
docker compose ps
```

Open [http://localhost:3000](http://localhost:3000). Check
[/healthz](http://localhost:3000/healthz) for frontend health and
[/api/health](http://localhost:3000/api/health) for the API response
`{"status":"ok"}`. A successful API check verifies the proxy connection; the
dashboard displays the HomeLab account chooser, then opens Tempo after login.
Account setup is described in [shared accounts](docs/accounts.md).

View logs with `docker compose logs -f --tail=100`. Stop the stack with
`docker compose stop`; start it again with `docker compose up -d --wait`.
In Docker Desktop, the project and its four services appear under **Containers**.

## Run it on your home server

Follow the [deployment guide](docs/deployment.md) for:

- Preparing an Ubuntu VM on Proxmox and installing Docker.
- Creating a checkout owned by your administrator account.
- Configuring your own LAN address and optional Tailscale access.
- Checking health, proxy routing, and container permissions.
- Pulling updates, restarting services, and preserving future data.
- Safely migrating a checkout nested under a `services/` directory.
- Planning a shared HTTPS proxy as your lab grows.

The guide uses example hostnames, usernames, and private IP addresses. Substitute
your own settings. Publishing the source code does not require making your
running dashboard internet-accessible; this setup is intended for your home
network and permitted remote clients.

## Develop without Docker

Install [Node.js 24](https://nodejs.org/en/download), including npm. The root
`.nvmrc` selects Node 24. Each app keeps its own dependencies and npm lockfile;
Tempo uses locally served PDF.js assets, prepared by `npm run dev`.

From the repository root, start the frontend in one terminal:

```sh
cd frontend
npm ci
npm run dev
```

In a second terminal, start the backend:

```sh
cd backend
npm ci
npm run dev
```

Open `http://localhost:3000`. Vite proxies `/api` and `/api/*` to the local backend
on port 3001, preserving the path. Start Mémo on port 8000 with
`FLASHCARD_WEB_AUTH=1`; `/memo/*` is proxied to that service and supplies the shared login.
For loopback HTTP development only, set `FLASHCARD_WEB_REQUIRE_HTTPS=0`.
Production still requires HTTPS. Set `MEMO_AUTH_URL=http://127.0.0.1:8000` in the local backend. Browser API calls should use relative URLs,
such as `fetch('/api/health')`. Docker service names belong in server-side proxy
configuration.

Run the checks inside **each** app directory:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

For Tempo, run `npm run dev` or `npm test` in `apps/calendar/`.
For Memo, run `./start.sh --dev` in `apps/memo/web-app/`; see its
[README](apps/memo/web-app/README.md) for Python dependencies and checks.

To verify real Gemini PDF extraction before deploying, run `npm run test:pdf`
in `backend/`, or `npm run test:pdf -- "/path/document.pdf"` for your own PDF.
Configure `GEMINI_API_KEY` in the private `backend/.env` first. This uses the
production extractor and performs no database writes. See the
[local Tempo testing guide](docs/calendar-local.md) for the full browser setup.

The existing `npm start` commands remain available for manual production previews.
The frontend preview serves `dist` and has no API proxy; use Docker Compose to
test the full production path. Stop a local Docker stack using port 3000 before
starting Vite on that same port.

## Repository layout

```text
compose.yml                  Production services and network
.env.example                 Compose settings for your local copy
docs/deployment.md           Home-server setup and operations guide
frontend/
  src/                       Dashboard navigation and TV & Movies UI
  vite.config.ts             Development server and API proxy
  Caddyfile                  Production static serving and API proxy
  Dockerfile                 Node build and non-root Caddy runtime
  package.json               Frontend scripts and dependencies
backend/
  src/app/api/health/route.ts Health endpoint
  next.config.mjs            Next.js standalone output
  Dockerfile                 Node build and non-root standalone runtime
  .env.example               Backend runtime configuration template
  package.json               Backend scripts and dependencies
apps/
  calendar/                  Authored static app, Dockerfile, and tests
  memo/                      Memo desktop app and original study engine
    web-app/                 FastAPI backend, React frontend, and Dockerfile
SERVER-UPDATE.md              Single-repository update procedure
```

Keep real `.env` files, SSH keys, and application data out of Git. `VITE_*`
variables are public values compiled into browser assets, so they must never
contain credentials. See the deployment guide's
[configuration section](docs/deployment.md#4-configure-your-instance) for the
difference between Compose settings, backend runtime variables, and frontend
build-time values.
