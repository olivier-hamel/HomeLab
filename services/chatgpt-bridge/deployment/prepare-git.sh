#!/usr/bin/env bash
# Fetch a bundle into the VM's Git cache and create a detached worktree.
set -euo pipefail
[[ $# -eq 4 ]] || { echo 'Usage: prepare-git.sh REPOSITORY BUNDLE COMMIT NEW_WORKTREE' >&2; exit 2; }
repository=$1
bundle=$2
commit=$3
checkout=$4
[[ $repository == /* && $bundle == /* && $checkout == /* && -f $bundle && ! -e $checkout && $commit =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid Git source arguments.' >&2; exit 2; }
if [[ ! -d $repository ]]; then git init --bare --quiet "$repository"; fi
[[ $(git --git-dir="$repository" rev-parse --is-bare-repository) == true ]] || exit 1
git --git-dir="$repository" bundle verify "$bundle"
git --git-dir="$repository" -c fetch.fsckObjects=true fetch --quiet --prune --no-tags "$bundle" '+refs/heads/*:refs/remotes/bundle/*'
[[ $(git --git-dir="$repository" rev-parse --verify "$commit^{commit}") == "$commit" ]] || exit 1
[[ -n $(git --git-dir="$repository" for-each-ref --contains "$commit" --format='%(refname)' refs/remotes/bundle) ]] || { echo 'Commit not included in the transferred branches.' >&2; exit 1; }
git --git-dir="$repository" worktree add --quiet --detach "$checkout" "$commit"
