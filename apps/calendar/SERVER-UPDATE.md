# Update Calendar on the server

Calendar uses `olivier-hamel/calendar-app` (`main`). HomeLab uses
`olivier-hamel/HomeLab` (`feat/memo-integration`).

## 1. Commit and push locally

```sh
cd /home/user/Documents/Calendar/calendar-app
npm test && npm run check
git diff --check
git add <changed-files>
git commit -m "Describe the update"
git push origin HEAD:main
```

## 2. Pull and update on apps01

Connect with `ssh agent@<server-address>`, then run:

```sh
set -e
sudo -n -u olivier git -C /opt/stacks/calendar pull --ff-only origin main
sudo -n docker compose --project-directory /opt/stacks/homelab config --quiet
sudo -n docker compose --project-directory /opt/stacks/homelab build calendar
sudo -n docker compose --project-directory /opt/stacks/homelab up -d --no-deps --wait calendar
sudo -n docker compose --project-directory /opt/stacks/homelab ps
```

Refresh the dashboard and check `/calendar/healthz` returns `ok`.
There is no app compilation step: `dist/` contains the authored source.

If HomeLab navigation or proxy settings changed, validate and commit those files
in the HomeLab checkout, push with `git push origin HEAD:feat/memo-integration`,
then on the server also run:

```sh
sudo -n -u olivier git -C /opt/stacks/homelab pull --ff-only origin feat/memo-integration
sudo -n docker compose --project-directory /opt/stacks/homelab config --quiet
sudo -n docker compose --project-directory /opt/stacks/homelab build frontend
sudo -n docker compose --project-directory /opt/stacks/homelab run --rm --no-deps frontend caddy validate --config /config/runtime.json
sudo -n docker compose --project-directory /opt/stacks/homelab up -d --no-deps --wait frontend
```

Deploy only after the push succeeds. Check each checkout is clean before pulling.
No backups are created; existing environment files and volumes stay in place.
