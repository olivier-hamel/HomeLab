# Update HomeLab on the server

All apps live in `olivier-hamel/HomeLab`, branch `feat/memo-integration`.
The deployment helper runs locally on your development machine and connects to
the server through the configured `agent` SSH account. The helper, its tests, and
previous timer files are private local utilities and are intentionally excluded
from Git.

## 1. Commit and push locally

```sh
cd /home/user/Documents/HomeLab
# Run the checks for the apps you changed (see README.md).
git diff --check
git add <changed-files>
git commit -m "Describe the update"
git push origin HEAD:feat/memo-integration
```

## 2. Deploy from this machine

Run the local helper from the repository root **without `sudo`**:

```sh
./scripts/deploy-server.sh
```

Local `sudo` switches Git and SSH to root's credentials and trusted hosts, which
can cause `Host key verification failed` before deployment starts. The helper
uses `sudo` on the server automatically and refuses local root invocations.

It fetches the latest pushed commit using your local Git credentials, transfers a
Git bundle and a temporary copy of itself over SSH, then runs the deployment on
the server. The server imports the bundle, so it does not need its own GitHub
key. Local uncommitted changes and unpushed commits are not deployed. No script
installation or manual Git pull on the server is needed.

Keep the local copy of `scripts/deploy-server.sh`; it is not included in fresh
clones. Git authentication on this machine and SSH access to the server must work
without password prompts. The SSH host key must already be trusted, and `agent`
must have noninteractive sudo access for deployment.

To override the SSH destination or server checkout:

```sh
DEPLOY_SSH_TARGET=agent@<server-address> DEPLOY_REPO_DIR=/opt/stacks/homelab ./scripts/deploy-server.sh
```

Use `./scripts/deploy-server.sh --help` for the other settings. The helper defaults
to `origin/feat/memo-integration` and a 180-second container health timeout.

## 3. Deployment behaviour

The server checkout keeps its local branch (`deploy/memo-dashboard` on apps01)
and fast-forwards to the transferred pushed commit. Local source changes,
detached HEAD, and ahead or divergent history are refused. Git runs as the checkout
owner; Docker runs through sudo. The existing private environment files and named
volumes are retained. No backups are created.

The script validates Compose, builds all services sequentially, validates Caddy,
and waits for healthy containers. A lock prevents overlapping deployments. A
successful commit is recorded in `.git/homelab-deploy/last-successful-commit`;
subsequent runs skip that commit. Failures are not marked successful, so rerunning
the command retries even when Git already reached the new commit. Failed builds
leave current containers running; failed rollouts can partially update them.
There is no automatic rollback.

To rebuild and recreate an already deployed commit, for example after changing
a private environment file:

```sh
./scripts/deploy-server.sh --force
```

Refresh the dashboard and check `/healthz`, `/api/health`, `/calendar/healthz`, and
`/memo/api/health` over HTTPS. Temporary bundle and script files are cleaned up
after the command finishes.

## 4. Check the local helper

The private tests use temporary Git repositories, real bundles, and fake SSH and
Docker commands. They do not connect to the server or start containers:

```sh
bash -n scripts/deploy-server.sh
python3 -m unittest discover -s scripts -p test_deploy_server.py -v
```
