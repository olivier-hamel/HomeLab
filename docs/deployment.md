# Deploy HomeLab on your home server

This guide takes you from an Ubuntu Server VM to a running HomeLab dashboard.
The reference layout uses Proxmox VE for the VM, Docker Compose for the app, and
an optional Tailscale subnet router in a separate guest for remote access.
You can also use an existing Ubuntu server without Proxmox.

The repository supplies the dashboard and its deployment files. Your hypervisor,
other guests, storage, backups, and remote-access service are separate parts of
your lab. The Proxmox sections show sample data and the dashboard has no login
system. Start with access from your home network. The optional TV & Movies
integration has its own [setup and verification guide](tv-media.md), including
backend-to-media Tailscale connectivity, credentials and private-access controls.

## Choose your own settings

The values below are an example network configuration.
Replace the username and IP address in commands with the values for your VM.

| Setting | Example used in this guide |
| --- | --- |
| VM hostname | `homelab-apps` |
| Ubuntu administrator | `labadmin` |
| VM LAN address | `192.168.1.50` |
| Application URL | `http://192.168.1.50:3000` |
| Git checkout | `/opt/stacks/homelab` |
| Compose project name | `homelab` |


## 1. Prepare the VM

Create an Ubuntu Server 24.04 LTS VM on your Proxmox host. 

1. Upload the Ubuntu Server ISO to Proxmox and create a VM with its own disk.
2. Attach its network interface to the bridge serving your home LAN. Confirm
   the bridge and any VLAN settings match your network; see
   [Proxmox's network guide](https://pve.proxmox.com/wiki/Network_Configuration).
3. Follow the [Ubuntu Server installer](https://ubuntu.com/tutorials/install-ubuntu-server),
   create your administrator account, and enable OpenSSH Server.
4. Give the VM a stable LAN address using a DHCP reservation or an appropriate
   static configuration. Use an available address in your own subnet.
5. If you want the app to return after a Proxmox host restart, enable the VM's
   **Start at boot** option as well as Docker startup inside the VM.

From a terminal on **your own computer**, connect using your chosen account:

```sh
ssh labadmin@192.168.1.50
```

## 2. Install and verify Docker

Install the basic tools on the VM:

```sh
sudo apt update
sudo apt install -y git ca-certificates curl
```

Follow Docker's [Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/)
using its official apt repository. Install Docker Engine, the Docker CLI,
containerd, the Buildx plugin, and the Compose plugin. The official guide also
explains how to handle conflicting packages if Docker was previously installed.

Then verify the engine and enable it at boot:

```sh
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

## 3. Clone the repository

Keep `compose.yml`, `frontend/`, and `backend/` directly inside
`/opt/stacks/homelab`. 

For a new checkout, create a directory owned by the account you are using:

```sh
sudo install -d -m 0750 -o "$(id -un)" -g "$(id -gn)" /opt/stacks/homelab
git clone https://github.com/olivier-hamel/HomeLab.git /opt/stacks/homelab
cd /opt/stacks/homelab
git branch --show-current
git status --short
ls compose.yml frontend/Dockerfile backend/Dockerfile
```

## 4. Configure your instance

Create missing configuration files without replacing existing ones:

```sh
cd /opt/stacks/homelab
umask 077
test -e .env || cp .env.example .env
test -e backend/.env || cp backend/.env.example backend/.env
chmod 600 .env backend/.env
nano .env
```

The tracked example defaults to `127.0.0.1` for local testing. For access from
your home network, change the bind address to **your VM's LAN IP**. With the
example address used in this guide, `.env` would contain:

```dotenv
COMPOSE_PROJECT_NAME=homelab
FRONTEND_BIND_ADDRESS=192.168.1.50
FRONTEND_PORT=3000
```

The bind address must exist on the VM. `127.0.0.1` accepts only local connections;
`0.0.0.0` listens on all IPv4 interfaces. Keep the project name stable across
updates so Compose continues managing the same stack. If you change port 3000,
use that port in the browser URLs and checks below too.

| File or setting | Used by | What to configure |
| --- | --- | --- |
| Root `.env` | Compose, when resolving `compose.yml` | Project name, frontend bind address, and published port |
| `backend/.env` | The backend container, when it is created | Optional TV/media URLs, server-side credentials, origins and timeouts; see [TV setup](tv-media.md) |
| `frontend/.env.example` | Documentation for future frontend settings | No frontend env file is needed for this deployment |
| Future `VITE_*` settings | Vite, while building browser assets | Public values only; explicitly wire any new setting into the build |

Compose fixes backend `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3001`, and
`NEXT_TELEMETRY_DISABLED=1`. These values override matching entries in
`backend/.env`. Add future integration secrets to that runtime file only when
backend code needs them. TV/media settings are documented in `backend/.env.example`.
Single-quote literal values containing `$` to avoid
Compose interpolation. Never place secrets in build arguments or Next.js `env`
configuration.

Vite variables are embedded in browser assets, and changing a container's
runtime environment cannot alter an already built frontend. No public build
arguments are currently needed or configured. See
[Vite's environment documentation](https://vite.dev/guide/env-and-mode).

Real `.env` files are ignored by Git and excluded from Docker builds. The root
file is for Compose substitution and is not injected into either application.
Resolved Compose configuration and full container inspection can expose runtime
values, so avoid posting them publicly when your instance contains secrets.

## 5. Build and start

From the repository root on the VM:

```sh
docker compose config --quiet
docker compose build --pull
docker compose up -d --wait --wait-timeout 180
docker compose ps
```

Both services should become `healthy`. The first build downloads base images
and npm packages, so it needs internet access and can take several minutes.
`config --quiet` validates configuration without printing resolved environment
values. If a command fails, resolve that error before proceeding to the next one.

Each multi-stage Dockerfile runs `npm ci` from its own lockfile and the actual
production build on Node 24. Native npm dependencies are installed for Linux
inside the build stages. Caddy serves the resulting Vite files. The backend uses
[Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
including its traced dependencies, `.next/static`, and `public` assets; an absent
`public` directory is handled during the build.

Base-image tags stay on Node 24 and Caddy 2. `--pull` refreshes those images;
application packages remain governed by the committed npm lockfiles. If parallel
builds exhaust the VM's memory, build sequentially:

```sh
docker compose build --pull backend
docker compose build --pull frontend
```

### How the services communicate

Only frontend port 8080 is published, as VM port 3000 by default. Caddy handles
requests in this order:

| Request | Result |
| --- | --- |
| `/healthz` | Lightweight Caddy health response |
| `/api/media/stream/*`, `/api/media/external/*` | Private media streaming proxy with separate timeouts and disconnect cancellation |
| `/api` or `/api/*` | Proxy to `backend:3001`, preserving the `/api` prefix |
| `/assets`, `/assets/*`, or a path with a dotted component | Serve a real file or return a file-server error |
| Other paths | Serve a matching file or fall back to the SPA's `index.html` |

Browser code uses relative paths such as `fetch('/api/health')`.
`backend:3001` is Docker service DNS for server-side use. There is no published
backend port and no extra edge proxy in this stack. The project-scoped bridge
network permits backend outbound traffic, subject to your VM's network policy.
Access through a separate subnet router does not prove the backend container
can reach a media VM's Tailscale IP. Run the container check in [TV setup](tv-media.md#6-verify-from-the-backend-container).

Both services run as UID/GID `10001:10001`, with capabilities dropped and
privilege escalation disabled. Caddy's low-port binary capability is removed,
and its runtime directories are writable by that user. HTTP is served on 8080;
automatic HTTPS and the Caddy admin API are disabled in this stack.

Compose provides an init process and a 30-second shutdown grace period. Caddy
allows up to 10 seconds for requests to drain. Logs use `json-file`, capped at
`10m` per file with three files retained per service. The `unless-stopped` policy
restarts exited containers and allows them to start with Docker after a reboot.
It does not restart a container just because its health check becomes unhealthy.

## 6. Verify the deployment

Check logs on the VM:

```sh
docker compose ps
docker compose logs --tail=100 frontend backend
docker compose logs -f --tail=50
```

Ctrl+C stops following logs without stopping the detached containers.

Test HTTP on the VM, then repeat from another computer on your home network.
Set the URL to your own VM address:

```sh
APP_URL=http://192.168.1.50:3000
curl -fsS "$APP_URL/healthz"
curl -fsS "$APP_URL/api/health"
curl -I "$APP_URL/"
curl -I "$APP_URL/guests"
curl -i "$APP_URL/api"
curl -i "$APP_URL/api/does-not-exist"
curl -i "$APP_URL/api/missing.js"
curl -i "$APP_URL/assets/missing.js"
curl -i "$APP_URL/assets/missing"
curl -i "$APP_URL/missing.css"
```

Expect `ok` from `/healthz` and `{"status":"ok"}` from `/api/health`.
`/` and `/guests` return HTML with status 200. The current dashboard selects its
view through component state, so a fallback URL loads the default view.
All missing API and asset paths listed above should return 404. A Next.js 404
may contain HTML, but it must not be the dashboard's index page or a 200 response.
Future extensionless assets outside `/assets` need their own reserved prefix
if they also need to bypass SPA fallback.

On Windows PowerShell, use `$APP_URL = 'http://192.168.1.50:3000'` and `curl.exe`
instead of the Bash assignment and `curl` command shown above.

Open your application URL in a browser. In its developer-tools console, run:

```js
const response = await fetch('/api/health');
console.log(response.status, response.headers.get('content-type'), await response.json());
```

Expect status 200, a JSON content type, and `{status: 'ok'}`. The Network tab
should show a request to the frontend's origin on port 3000. This proves browser
to Caddy to Next.js connectivity. Live Proxmox metrics and other integrations
still require application work; they are not enabled by this test.

Verify container identities, health, and backend isolation on the VM:

```sh
docker compose exec -T --interactive=false frontend id
docker compose exec -T --interactive=false backend id
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q frontend)"
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q backend)"
docker inspect --format '{{json .HostConfig.PortBindings}}' "$(docker compose ps -q backend)"
docker compose exec -T --interactive=false frontend wget -qO- http://backend:3001/api/health
```

Both identities should show UID 10001, both health states should be `healthy`,
and backend port bindings should be empty (`{}` or `null`). Bare entries such as
`3001/tcp` in `docker compose ps` are exposed-port metadata. Host publication is
shown with an address and an arrow, such as `192.168.1.50:3000->8080/tcp`.

## 7. Reach it remotely with Tailscale

Local clients use the VM's LAN URL. Optional remote access can use the same URL
through a **separate Tailscale subnet router**, for example in another Proxmox
guest. LAN-only deployments can skip this section.

Follow Tailscale's [subnet-router guide](https://tailscale.com/docs/features/subnet-routers)
for that separate guest. If your lab already has a working subnet router, reuse
it. This application stack does not install Tailscale in the Ubuntu Docker VM
or either app container.

The advertised and approved route must cover the VM's address. Remote clients
must use that route, and your tailnet policy must allow the destination and TCP
port 3000. Test the dashboard URL and `/api/health` from a permitted remote client;
a successful LAN test alone does not verify the Tailscale path.

Keep access limited to your intended home-network and remote clients. No WAN
port forwarding is needed. Docker-published ports can bypass ordinary UFW input
rules because Docker handles forwarded/NAT traffic. Binding to one interface
controls where the service listens, but does not identify which clients may use
it. Apply access restrictions at your router, Proxmox firewall, or appropriate
Docker forwarding rules, and in your tailnet policy. See
[Docker's firewall explanation](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw).

## 8. Pull changes and redeploy

Make source changes on your development machine or fork, review and commit them,
and publish them to the branch your server tracks. Keep local settings and keys
out of Git. On the VM, inspect before pulling:

```sh
cd /opt/stacks/homelab
git status --short
git diff --stat
git diff --cached --stat
git branch -vv
```

## 9. Restart, recreate, and stop

| Change or task | Command |
| --- | --- |
| Restart an unchanged backend process | `docker compose restart backend` |
| Load changes to `backend/.env` | `docker compose up -d --no-deps --force-recreate --wait backend` |
| Apply frontend bind-address or port changes in root `.env` | `docker compose up -d --no-deps --force-recreate --wait frontend` |
| Follow backend logs | `docker compose logs -f --tail=100 backend` |
| Stop processes while retaining containers | `docker compose stop` |
| Start the stack again | `docker compose up -d --wait` |
| Remove containers and the project network | `docker compose down` |

A restart retains the existing image and environment. Source, Dockerfile, Caddy
configuration, and any future frontend build-setting changes require an image
rebuild followed by `docker compose up -d --wait`.

`docker compose down` without `--volumes` preserves named volumes. Do not add
`-v` or run volume-pruning commands as a shutdown step. This app has no persistent
application data yet; when you add it, define explicit named volumes and a backup
and restore procedure. Keep a private backup of your configuration too.
