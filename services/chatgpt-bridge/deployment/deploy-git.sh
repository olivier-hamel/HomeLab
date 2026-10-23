#!/usr/bin/env bash
# Transfer committed Git history over SSH, then install one exact revision.
set -euo pipefail
umask 077
dry_run=false
if [[ ${1:-} == --dry-run ]]; then dry_run=true; shift; fi
if [[ ${1:-} == --help || $# -lt 1 || $# -gt 2 ]]; then
  echo 'Usage: bash deployment/deploy-git.sh [--dry-run] USER@HOST [COMMIT_OR_REF]'
  echo 'Optional BRIDGE_SSH_KEY selects a local SSH key. No GitHub push is performed.'
  [[ ${1:-} == --help ]] && exit 0
  exit 2
fi
target=$1
ref=${2:-HEAD}
[[ $target =~ ^([a-zA-Z_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid SSH destination.' >&2; exit 2; }
service_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
repository=$(git -C "$service_dir" rev-parse --show-toplevel)
prefix=$(git -C "$service_dir" rev-parse --show-prefix)
commit=$(git -C "$repository" rev-parse --verify --end-of-options "$ref^{commit}")
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo 'A full Git commit is required.' >&2; exit 1; }
[[ -n $(git -C "$repository" for-each-ref --contains "$commit" --format='%(refname)' refs/heads) ]] || { echo 'The revision must be reachable from a local branch.' >&2; exit 1; }
if [[ -n $(git -C "$repository" status --porcelain --untracked-files=normal -- "${prefix:-.}") ]]; then
  echo 'Commit the bridge changes before deploying; uncommitted files are never transferred.' >&2
  exit 1
fi
git -C "$repository" cat-file -e "$commit:${prefix}deployment/install-from-git.sh"
source_path=${prefix%/}
source_path=${source_path:-.}
[[ $source_path =~ ^[a-zA-Z0-9_./-]+$ && $source_path != *..* ]] || exit 1
if $dry_run; then
  printf 'Git deployment: %s -> %s (%s)\n' "$commit" "$target" "$source_path"
  echo 'No changes or network access. A Git bundle transfers committed history only; no GitHub push.'
  echo 'The VM keeps a Git repository, backs up private data, and installs the pinned commit.'
  exit 0
fi
ssh_options=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
if [[ -n ${BRIDGE_SSH_KEY:-} ]]; then ssh_options+=(-o IdentitiesOnly=yes -i "$BRIDGE_SSH_KEY"); fi
local_tmp=$(mktemp -d)
remote_tmp=''
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n $remote_tmp ]]; then ssh "${ssh_options[@]}" "$target" "rm -rf -- '$remote_tmp'" || true; fi
  rm -rf -- "$local_tmp"
  exit "$result"
}
trap cleanup EXIT
git -C "$repository" bundle create "$local_tmp/source.bundle" --branches
git -C "$repository" show "$commit:${prefix}deployment/install-from-git.sh" > "$local_tmp/install-from-git.sh"
remote_tmp=$(ssh "${ssh_options[@]}" "$target" 'mktemp -d /tmp/chatgpt-bridge-git.XXXXXX')
[[ $remote_tmp =~ ^/tmp/chatgpt-bridge-git\.[a-zA-Z0-9]{6}$ ]] || { remote_tmp=''; echo 'Unexpected remote staging directory.' >&2; exit 1; }
scp "${ssh_options[@]}" "$local_tmp/source.bundle" "$local_tmp/install-from-git.sh" "$target:$remote_tmp/"
ssh "${ssh_options[@]}" "$target" \
  "sudo -n bash '$remote_tmp/install-from-git.sh' --bundle '$remote_tmp/source.bundle' --commit '$commit' --source-path '$source_path'"
