# Maintaining the standalone ChatGPT bridge

Run the server commands below in an SSH session on the dedicated Ubuntu VM.
Use your administrator account with `sudo`; the application itself runs as the
unprivileged `chatgpt-bridge` account. The private SSH connection instructions
are in the local, Git-ignored `SSH.local.md` on the development machine.

## Routine checks

```sh
sudo systemctl status chatgpt-bridge --no-pager
curl --fail http://127.0.0.1:3211/healthz
sudo chatgpt-bridge status
sudo chatgpt-bridge doctor
sudo journalctl -u chatgpt-bridge -n 100 --no-pager
free -h
df -h / /var/lib/chatgpt-bridge
```

`/healthz` checks the local process. `status` and `doctor` can inspect the ChatGPT
page without sending a question. `session: ready` means the browser recognizes
the logged-in session; `login_required` requires manual login. Check `queue`
before maintenance: avoid stopping the service during a generation.

The service starts automatically at VM boot. To control it:

```sh
sudo systemctl restart chatgpt-bridge
sudo systemctl stop chatgpt-bridge
sudo systemctl start chatgpt-bridge
sudo systemctl is-enabled chatgpt-bridge
```

After a start or restart, allow a few seconds for `/healthz` to respond before
calling the CLI. systemd can report `active` while the HTTP listener is starting.

An interrupted submission is not sent again automatically. Inspect its run and
the remote conversation before explicitly starting another request. Pending
approvals and conversation mappings are stored in SQLite and survive restarts.

## Log in or reconnect to ChatGPT

From a terminal **on your PC, outside the VM's SSH shell**, keep an SSH tunnel
open to the VM. See `SSH.local.md` for the exact
key and host command. Forward local port `16081` to VM port `6081`.

In the VM's SSH session:

```sh
sudo chatgpt-bridge session open
```

Open `http://127.0.0.1:16081/vnc.html?resize=scale` on your PC and use the temporary
VNC password printed by the command. Enter ChatGPT credentials only in the
remote browser. Login may close the maintenance session automatically.

```sh
sudo chatgpt-bridge status --refresh
sudo chatgpt-bridge session close
```

For visual inspection of an already connected account, use
`sudo chatgpt-bridge session open --inspect`. Close it when finished; access
expires after fifteen minutes. Routine requests and action approvals use the
CLI/API and do not require opening this browser.

## Questions, conversations, and approvals

These commands send real ChatGPT messages. Use them deliberately, one request
at a time; do not schedule repeated smoke tests or retry an ambiguous submission.

```sh
sudo chatgpt-bridge ask "A short question"
sudo chatgpt-bridge conversations list
sudo chatgpt-bridge conversations show CONVERSATION_ID
sudo chatgpt-bridge ask --conversation CONVERSATION_ID "A follow-up"
sudo chatgpt-bridge runs show RUN_ID
sudo chatgpt-bridge approve ACTION_ID
sudo chatgpt-bridge deny ACTION_ID
```

Review an action's stored name and arguments before approving. Only the built-in
allowlisted tools can run; shell commands from responses are never executed.

## Locations and configuration

| Item | Location |
| --- | --- |
| Active application | `/opt/chatgpt-bridge/app` (versioned symlink) |
| Previous applications | `/opt/chatgpt-bridge/releases/` |
| Git source cache | `/opt/chatgpt-bridge/repository.git` (root only) |
| Node.js | `/opt/chatgpt-bridge/node` → `runtimes/` |
| Configuration | `/etc/chatgpt-bridge/bridge.env` |
| Conversations, tokens, browser profile | `/var/lib/chatgpt-bridge/` |
| Chromium and npm cache | `/var/cache/chatgpt-bridge/` |
| systemd unit | `/etc/systemd/system/chatgpt-bridge.service` |
| CLI / backup | `/usr/local/bin/chatgpt-bridge`, `/usr/local/sbin/chatgpt-bridge-backup` |

Edit settings with `sudoedit /etc/chatgpt-bridge/bridge.env`, then restart.
Keep the supplied data/cache locations unless you also adapt the systemd unit.
By default API `3211`, engine `3210`, VNC `5901`, and noVNC `6081` bind to loopback.
For an app on the same LAN, [API.md](API.md) explains how to enable the API LAN
listener and require a private subnet and host allowlist. Engine, VNC and
noVNC remain on loopback. Use SSH for maintenance, which only accepts local
non-browser clients even when the API is configured for LAN access.

The initial service quota is one CPU core and `MemoryHigh=1536M`. This memory
setting applies pressure rather than imposing a hard limit. If memory pressure
or swap use persists, increase VM RAM to 3–4 GB and adjust the service override
with `sudo systemctl edit chatgpt-bridge`. If adding a second vCPU, change
`CPUQuota=200%` in that override. Check OOM messages with:

```sh
sudo journalctl -k -b --grep='Out of memory|Killed process'
sudo systemctl show chatgpt-bridge -p MemoryCurrent -p MemoryPeak -p NRestarts
```

## Back up and restore

Configure regular Proxmox backups of the entire VM. Before an application update,
also make a cold backup of the application data and configuration:

```sh
sudo install -d -m 0700 /var/backups/chatgpt-bridge
sudo chatgpt-bridge-backup /var/backups/chatgpt-bridge/before-update-YYYYMMDD.tar.gz
sudo tar -tzf /var/backups/chatgpt-bridge/before-update-YYYYMMDD.tar.gz
```

Use a new filename each time. The script stops the service, archives the data and
configuration, and restarts it if it was running. The archive contains ChatGPT
cookies and API tokens. Keep it private and copy backups off the VM into private
backup storage. Backup retention is manual; the installer does not configure a
Proxmox backup schedule or delete old archives.

To restore on the same VM, first stop the service and preserve its current data
in a separate backup. Replace `/var/lib/chatgpt-bridge` and
`/etc/chatgpt-bridge` with the matching directories from the chosen archive.
Extract into empty target directories to avoid mixing old and restored files.
Restore ownership `chatgpt-bridge:chatgpt-bridge` on the data directory and mode
`0700`; configuration must be root-owned, readable by the service group, with
`bridge.env` mode `0640`. Start the service and check `status --refresh`.
On a replacement VM, install the application first; a new manual login may be
needed even when restoring the browser profile.

## Update the application from Git

Run checks on the development machine, then commit the bridge changes. Deployment
uses the exact commit you select; it rejects uncommitted bridge files.

```sh
cd services/chatgpt-bridge
npm ci
npm run check
npm test
# Commit the validated changes, then return to the repository root:
cd ../..
bash services/chatgpt-bridge/deployment/deploy-git.sh --dry-run admin@IP_VM main
BRIDGE_SSH_KEY="$HOME/.ssh/id_ed25519" \
  bash services/chatgpt-bridge/deployment/deploy-git.sh admin@IP_VM main
```

Replace `admin@IP_VM` with the dedicated VM's SSH account and address. The source
ref defaults to `HEAD`; a full commit SHA or another local branch can also be
selected. `BRIDGE_SSH_KEY` is optional when SSH already finds the correct key.
Host-key verification stays enabled, and the administrator needs non-interactive
`sudo` for this command. Keep the private key on the development machine.

The procedure creates a **Git bundle**, transfers it over SSH, and fetches it
into `/opt/chatgpt-bridge/repository.git` on the VM. This transfers committed
repository history, including imported application history; ignored browser
profiles, tokens, databases, `.env` files and uncommitted files are not included.
It does not push to GitHub, so locally rewritten history can be deployed without
changing the remote branches. Each installation uses a detached checkout of one
full commit, never an in-place `git pull` inside the running application.

The VM installs Git if needed, verifies the bundle, requires an empty queue and
creates a cold backup under `/var/backups/chatgpt-bridge` before invoking the
installer. The installer builds as the unprivileged service user before switching
the active release, preserves data/settings, and restores the previous application,
runtime and unit if startup health checks fail. The Git cache records successful
revisions under `refs/deployments/`; releases contain `GIT_REVISION` and include
the abbreviated commit in their directory name.

Verify the installed version **on the VM**:

```sh
sudo cat /opt/chatgpt-bridge/app/GIT_REVISION
sudo git --git-dir=/opt/chatgpt-bridge/repository.git rev-parse refs/deployments/current
sudo chatgpt-bridge status --refresh
```

The two commit IDs must agree. The automatic checks send no question to ChatGPT.
The normal tests also use local fixtures; `smoke:live` is separate and uses the
real account. A successful health check does not establish that ChatGPT's current
interface accepts document uploads. Keep the backup until a deliberate exchange
has been checked. A code rollback does not reverse database migrations; restore
the matching private backup when needed.

To reinstall a previous committed version, run the same development command with
that full commit SHA. Previous releases remain under `/opt/chatgpt-bridge/releases`;
review disk usage and remove only specific inactive releases after validation and
backup. Do not edit files under the active release directly. The old
`package:server` archive command remains available for offline handoff, but Git is
the standard deployment path.

## Update Ubuntu and the runtime

```sh
sudo apt-get update
sudo apt-get upgrade
test -f /var/run/reboot-required && cat /var/run/reboot-required
```

If a reboot is needed, finish active conversations, make a backup, and reboot the
VM with `sudo reboot`. Reconnect and check the service and QEMU Guest Agent.
The installer's Node.js version is pinned; apt does not update it. To upgrade it,
update `node_version` in `deployment/install-ubuntu.sh`, validate locally and
deploy the committed revision. Chromium follows the locked Playwright dependency and is
downloaded by the installer. Do not run an unreviewed global npm upgrade on the VM.

## Troubleshooting

- **SSH works, API does not:** check `systemctl status`, `journalctl`, and `/healthz`.
- **`login_required` or a security challenge:** open the temporary noVNC session
  and complete the required account interaction manually.
- **`ui_changed`, empty response, timeout:** inspect the conversation; do not
  automatically resubmit. A ChatGPT DOM change may require an adapter update.
- **noVNC page unavailable:** keep the SSH tunnel running, confirm
  `session show` reports open, and use the forwarded PC port `16081`, rather than
  the VM-local port `6081` printed by the CLI. The tunnel command runs on the PC.
- **Guest Agent unavailable:** verify its Proxmox checkbox and
  `sudo systemctl status qemu-guest-agent --no-pager` inside the VM.
- **Disk full:** inspect `df -h` and release/backup/cache sizes; preserve
  `/var/lib/chatgpt-bridge`. On Ubuntu LVM, the installer may initially allocate
  only part of the virtual disk. Review `sudo vgs` and `sudo lvs` before resizing;
  the application installer itself does not change partitions or filesystems.
