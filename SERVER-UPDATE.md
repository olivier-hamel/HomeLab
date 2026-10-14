# Update HomeLab on the server

All apps live in `olivier-hamel/HomeLab`, branch `feat/memo-integration`.
Once the timer below is installed, pushing to this branch automatically deploys
the latest pushed commit on the server. No deployment command is needed after
each push.

## 1. Commit and push locally

```sh
cd /home/user/Documents/HomeLab
# Run the checks for the apps you changed (see README.md).
git diff --check
git add <changed-files>
git commit -m "Describe the update"
git push origin HEAD:feat/memo-integration
```

## 2. Install automatic deployment on apps01 (once)

Commit and push the deployment script and units first. Connect with
`ssh agent@<server-address>`, then run:

```sh
set -e
test -z "$(sudo -n -u olivier git -C /opt/stacks/homelab status --porcelain --untracked-files=normal)"
sudo -n -u olivier git -C /opt/stacks/homelab pull --ff-only origin feat/memo-integration
sudo -n install -m 0644 /opt/stacks/homelab/deployment/auto-deploy/homelab-deploy.service /etc/systemd/system/homelab-deploy.service
sudo -n install -m 0644 /opt/stacks/homelab/deployment/auto-deploy/homelab-deploy.timer /etc/systemd/system/homelab-deploy.timer
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now homelab-deploy.timer
sudo -n systemctl start homelab-deploy.service
sudo -n systemctl list-timers homelab-deploy.timer --all --no-pager
```

The service uses root for Docker and the checkout owner (`olivier` on apps01)
for Git, including that account's credentials. Git authentication must work
without a password prompt; an SSH remote needs a usable key and an already
trusted host key. Keep the existing `.env` and `backend/.env` in the checkout.

The server keeps `deploy/memo-dashboard` tracking `origin/feat/memo-integration`.
The script preserves that local branch and fast-forwards it to the pushed
branch. It refuses detached checkouts, local changes, and ahead or divergent
history instead of discarding them.

The timer checks one minute after each run finishes and resumes after reboot.
Each run fetches the branch, skips an already deployed commit, validates Compose,
builds every service sequentially to limit memory use, validates Caddy, and waits
up to 180 seconds for healthy containers. Overlapping runs are prevented by a
lock. The first run deploys even if the checkout already contains the latest
commit.

A successful commit is recorded in
`/opt/stacks/homelab/.git/homelab-deploy/last-successful-commit` only after the
health checks pass. Failed builds leave the current containers running; a failed
rollout may partially update them. The next timer run retries failures, including
when Git already reached the new commit. There is no automatic rollback.
No backups are created; private environment files and named volumes are retained.

Refresh the dashboard. Check `/healthz`, `/api/health`, `/calendar/healthz`,
and `/memo/api/health` (HTTPS). Repeat the unit installation and `daemon-reload`
if a future commit changes the service or timer files; script changes take effect
on the next run automatically.

## 3. Run now, inspect, or pause automatic updates

Run the same deployment immediately on the server:

```sh
sudo -n bash /opt/stacks/homelab/scripts/deploy-server.sh
```

Rebuild and recreate even an already deployed commit, for example after editing
a private environment file:

```sh
sudo -n bash /opt/stacks/homelab/scripts/deploy-server.sh --force
```

Inspect deployment output and service health:

```sh
sudo -n journalctl -u homelab-deploy.service -n 100 --no-pager
sudo -n docker compose --project-directory /opt/stacks/homelab ps
```

Optional overrides go in `/etc/default/homelab-deploy`, for example
`DEPLOY_WAIT_TIMEOUT=300` for slower startup. Other supported settings are
`DEPLOY_BRANCH`, `DEPLOY_REMOTE`, and `DEPLOY_GIT_USER`; see
`bash /opt/stacks/homelab/scripts/deploy-server.sh --help`. The service reads the
environment file on its next run. Keep the Compose project name stable in `.env`
so the existing volumes continue to be used.

Stop or resume checking for pushed commits:

```sh
sudo -n systemctl disable --now homelab-deploy.timer
# Resume later:
sudo -n systemctl enable --now homelab-deploy.timer
```

## 4. Check the script locally

The tests use temporary Git repositories and a fake Docker CLI; they do not
start containers or connect to the server:

```sh
bash -n scripts/deploy-server.sh
python3 -m unittest discover -s scripts -p test_deploy_server.py -v
```
