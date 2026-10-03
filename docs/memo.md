# Mémo

The desktop and mobile browser dashboard includes a Mémo section. It embeds
`/memo/` on the same HTTPS origin; its styles and study state remain isolated
from HomeLab and the movie app. Fire TV/native navigation remains unchanged.

Clone Memo beside this checkout as `memo`, or set `MEMO_SOURCE_DIR` in `.env`.
The `memo` Compose service builds `memo/web-app/Dockerfile` and publishes no
backend ports. Caddy strips `/memo` before proxying to that service. Memo's
frontend build and ASGI root path both account for the prefix.

Configure private HTTP/HTTPS bind addresses and `HTTPS_LAN_HOST` / `HTTPS_TAILSCALE_HOST` in `.env`.
The browser HTTPS port defaults to 3443; the Caddy container uses 8443 for LAN and 8444 for Tailscale. Separate
listeners select the correct IP certificate when browsers omit TLS SNI. Keep
machine-specific values and all credentials out of Git. Existing HTTP access
remains available for other sections; selecting Mémo switches the whole page
to HTTPS before login.

Caddy issues certificates through its local authority. Export the public root
certificate from `/data/caddy/pki/authorities/local/root.crt` in the frontend
container and install it as a trusted authority on users' devices. Keep the
`caddy_data` volume so trust remains stable across deployments. Do not expose
its private keys. The application remains private to LAN/Tailscale interfaces;
no public forwarding or Tailscale Funnel is configured.

Build and validate before deploying:

```sh
docker compose config --quiet
docker compose build memo frontend
docker compose run --rm --no-deps frontend caddy validate --config /config/runtime.json
docker compose up -d --no-deps --wait memo
docker compose exec memo python -m backend.accounts create oli --display-name Oli --generate-password
docker compose up -d --no-deps --wait frontend
```

Only create a user once. Account creation and password reset are administrator
commands; there is no public registration. Generated initial passwords are
stored privately and must be changed before studying. To locate Oli's password:

```sh
docker compose exec memo python -m backend.accounts credential-path oli
```

The `memo_data` volume stores accounts, revocable sessions, and a separate
atomic progress file for each user. Import an existing save explicitly before
the user's first study request; existing progress is never overwritten by an
import or image update.

Full commands, certificate instructions, tests, backups, and rollback are in
[Memo's deployment guide](https://github.com/olivier-hamel/Memo/blob/main/web-app/DEPLOYMENT.md).
Keep previous frontend images and configuration for rollback. Recreate only
the changed services; preserve the movie backend. Never remove the data volumes
as part of an update.
