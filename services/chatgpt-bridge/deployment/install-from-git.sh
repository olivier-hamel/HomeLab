#!/usr/bin/env bash
# Bootstrap Git on the dedicated VM, then build from an exact committed snapshot.
set -euo pipefail
umask 077
bundle=''
commit=''
source_path=services/chatgpt-bridge
dry_run=false
while (( $# )); do
  case "$1" in
    --bundle|--commit|--source-path)
      [[ $# -ge 2 ]] || exit 2
      case "$1" in --bundle) bundle=$2 ;; --commit) commit=$2 ;; --source-path) source_path=$2 ;; esac
      shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --help|-h) echo 'Usage: sudo bash install-from-git.sh --bundle FILE --commit FULL_SHA [--source-path services/chatgpt-bridge] [--dry-run]'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ $bundle == /* && -f $bundle && $commit =~ ^[0-9a-f]{40}$ && $source_path =~ ^[a-zA-Z0-9_./-]+$ && $source_path != /* && $source_path != *..* ]] || { echo 'A local Git bundle, full commit SHA and relative source path are required.' >&2; exit 2; }
if $dry_run; then
  printf 'Git commit: %s; source: %s\n' "$commit" "$source_path"
  echo 'No changes or network access: verify Git bundle, create pinned checkout, require idle queue, back up data and install.'
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Run with sudo inside the dedicated Ubuntu VM.' >&2; exit 1; }
[[ ! -d /etc/pve ]] && ! command -v pveversion >/dev/null 2>&1 || { echo 'Do not deploy on the Proxmox host.' >&2; exit 1; }
. /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 && $(cat /proc/1/comm) == systemd ]] || { echo 'Ubuntu Server 24.04 with systemd is required.' >&2; exit 1; }
base=/opt/chatgpt-bridge
install -d -m 0755 "$base"
exec 8>"$base/git-deploy.lock"
flock -n 8 || { echo 'Another Git deployment is running.' >&2; exit 1; }
if ! command -v git >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends git ca-certificates
fi
tmp=$(mktemp -d /tmp/chatgpt-bridge-checkout.XXXXXX)
repository="$base/repository.git"
checkout="$tmp/source"
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -d $checkout ]]; then git --git-dir="$repository" worktree remove --force "$checkout" || true; fi
  rm -rf -- "$tmp"
  exit "$result"
}
trap cleanup EXIT
# Read the helper from this exact bundle, not an existing release or working copy.
git init --bare --quiet "$tmp/bootstrap.git"
git --git-dir="$tmp/bootstrap.git" bundle verify "$bundle"
git --git-dir="$tmp/bootstrap.git" fetch --quiet --no-tags "$bundle" '+refs/heads/*:refs/remotes/bundle/*'
git_prefix="$source_path/"
if [[ $source_path == . ]]; then git_prefix=''; fi
git --git-dir="$tmp/bootstrap.git" show "$commit:${git_prefix}deployment/prepare-git.sh" > "$tmp/prepare-git.sh"
bash "$tmp/prepare-git.sh" "$repository" "$bundle" "$commit" "$checkout"
source_dir="$checkout/$source_path"
[[ -f $source_dir/src/main.ts && -f $source_dir/package-lock.json && -f $source_dir/deployment/install-ubuntu.sh ]] || { echo 'Incomplete bridge source in Git commit.' >&2; exit 1; }
if [[ -x /usr/local/bin/chatgpt-bridge ]]; then
  /usr/local/bin/chatgpt-bridge status > "$tmp/status.json"
  python3 -c 'import json,sys; q=json.load(open(sys.argv[1]))["queue"]; sys.exit("Bridge queue must be empty before deployment.") if any(q[k] for k in ("queued","running","awaiting_approval","interrupted")) else None' "$tmp/status.json"
  install -d -m 0700 /var/backups/chatgpt-bridge
  backup="/var/backups/chatgpt-bridge/before-git-$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}-$$.tar.gz"
  bash "$source_dir/deployment/backup.sh" "$backup"
  tar -tzf "$backup" >/dev/null
fi
BRIDGE_GIT_REVISION="$commit" bash "$source_dir/deployment/install-ubuntu.sh"
[[ $(cat "$base/app/GIT_REVISION") == "$commit" ]] || { echo 'Installed revision mismatch.' >&2; exit 1; }
git --git-dir="$repository" update-ref "refs/deployments/$(date -u +%Y%m%dT%H%M%SZ)-${commit:0:12}-$$" "$commit"
git --git-dir="$repository" update-ref refs/deployments/current "$commit"
printf 'Deployed Git commit: %s\n' "$commit"
/usr/local/bin/chatgpt-bridge status --refresh
