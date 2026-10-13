# Update HomeLab on the server

All apps live in `olivier-hamel/HomeLab`, branch `feat/memo-integration`.

## 1. Commit and push locally

```sh
cd /home/user/Documents/HomeLab
# Run the checks for the apps you changed (see README.md).
git diff --check
git add <changed-files>
git commit -m "Describe the update"
git push origin HEAD:feat/memo-integration
```

## 2. Pull and update on apps01

Connect with `ssh agent@<server-address>`, then run:

```sh
set -e
test -z "$(sudo -n -u olivier git -C /opt/stacks/homelab status --porcelain)"
sudo -n -u olivier git -C /opt/stacks/homelab pull --ff-only origin feat/memo-integration
sudo -n docker compose --project-directory /opt/stacks/homelab config --quiet
sudo -n docker compose --project-directory /opt/stacks/homelab build
sudo -n docker compose --project-directory /opt/stacks/homelab run --rm --no-deps frontend caddy validate --config /config/runtime.json </dev/null
sudo -n docker compose --project-directory /opt/stacks/homelab up -d --wait
sudo -n docker compose --project-directory /opt/stacks/homelab ps
```

Refresh the dashboard. Check `/healthz`, `/api/health`, `/calendar/healthz`,
and `/memo/api/health` (HTTPS). For a focused update, specify `calendar`, `memo`,
`frontend`, or `backend` in the build command and use `up -d --no-deps --wait`
with those service names. If memory is limited, build services one at a time.

The server keeps `deploy/memo-dashboard` tracking `origin/feat/memo-integration`.
Push must succeed before pulling. No backups are created; keep the existing
private environment files and named volumes.
