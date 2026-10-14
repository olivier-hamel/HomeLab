#!/usr/bin/env bash
# Run on the Docker host. The timer invokes this once per minute.
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: deploy-server.sh [--force]

Fetch the latest pushed commit, fast-forward the server checkout, rebuild the
Compose services, validate Caddy, and wait for healthy containers.
Already deployed commits are skipped. --force rebuilds and recreates them.

Environment:
  DEPLOY_REPO_DIR       Checkout path (default: this script's repository)
  DEPLOY_REMOTE         Git remote (default: origin)
  DEPLOY_BRANCH         Pushed branch (default: feat/memo-integration)
  DEPLOY_GIT_USER       Git account (default: owner of the checkout's .git)
  DEPLOY_WAIT_TIMEOUT   Container health timeout in seconds (default: 180)
EOF
}

fail() { printf 'Deployment refused: %s\n' "$*" >&2; exit 1; }

# Parse the complete deployment before running it: fetching may update this script.
main() {
  force=false
  for argument in "$@"; do
    case "$argument" in
      --force) force=true ;;
      --help|-h) usage; exit 0 ;;
      *) usage >&2; exit 2 ;;
    esac
  done

  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  repository="${DEPLOY_REPO_DIR:-$script_dir/..}"
  remote="${DEPLOY_REMOTE:-origin}"
  branch="${DEPLOY_BRANCH:-feat/memo-integration}"
  wait_timeout="${DEPLOY_WAIT_TIMEOUT:-180}"
  [[ "$wait_timeout" =~ ^[1-9][0-9]*$ ]] || fail 'DEPLOY_WAIT_TIMEOUT must be a positive integer.'

  for command in git flock stat; do
    command -v "$command" >/dev/null || fail "Install $command before deploying."
  done
  cd -- "$repository" || fail "Checkout not found: $repository"
  repository="$(pwd -P)"
  [[ -e .git ]] || fail 'The deployment directory must be a Git checkout root.'
  [[ "$remote" != -* ]] || fail 'Invalid Git remote.'
  git check-ref-format "refs/heads/$branch" >/dev/null || fail 'Invalid deployment branch.'
  git check-ref-format "refs/remotes/$remote/$branch" >/dev/null || fail 'Invalid Git remote.'

  # Root owns Docker operations, but Git must use the checkout owner's SSH keys.
  git_user="${DEPLOY_GIT_USER:-$(stat -c '%U' .git)}"
  git_command=(git -C "$repository")
  if [[ "$git_user" != "$(id -un)" ]]; then
    (( EUID == 0 )) || fail "Run with sudo so Git can run as $git_user."
    command -v runuser >/dev/null || fail 'Install runuser before deploying as root.'
    git_command=(runuser -u "$git_user" -- git -C "$repository")
  fi
  export GIT_TERMINAL_PROMPT=0
  export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=15}"

  git_directory="$("${git_command[@]}" rev-parse --absolute-git-dir)"
  state_directory="$git_directory/homelab-deploy"
  mkdir -p -- "$state_directory"
  exec 9>"$state_directory/deploy.lock"
  if ! flock -n 9; then
    printf 'Another deployment is running; skipping this check.\n'
    exit 0
  fi

  phase='checking the checkout'
  trap 'printf "Deployment failed while %s; the commit was not marked deployed.\n" "$phase" >&2' ERR
  "${git_command[@]}" symbolic-ref -q HEAD >/dev/null || fail 'The server checkout has a detached HEAD.'
  checkout_status="$("${git_command[@]}" status --porcelain --untracked-files=normal)"
  [[ -z "$checkout_status" ]] || fail 'Commit or remove local changes in the server checkout first.'

  phase='fetching the pushed branch'
  "${git_command[@]}" fetch --no-tags -- "$remote" "refs/heads/$branch:refs/remotes/$remote/$branch"
  target_commit="$("${git_command[@]}" rev-parse --verify "refs/remotes/$remote/$branch^{commit}")"
  "${git_command[@]}" merge-base --is-ancestor HEAD "$target_commit" || fail 'The server history is ahead of or diverges from the pushed branch; resolve it manually.'
  if [[ "$("${git_command[@]}" rev-parse HEAD)" != "$target_commit" ]]; then
    phase='fast-forwarding the server checkout'
    "${git_command[@]}" merge --ff-only "$target_commit"
  fi

  last_successful_commit=''
  if [[ -f "$state_directory/last-successful-commit" ]]; then
    IFS= read -r last_successful_commit < "$state_directory/last-successful-commit" || true
  fi
  if [[ "$force" == false && "$last_successful_commit" == "$target_commit" ]]; then
    printf 'Already deployed %s; nothing to do.\n' "$target_commit"
    exit 0
  fi

  phase='checking Docker access'
  command -v docker >/dev/null || fail 'Install Docker Engine and the Compose plugin first.'
  docker_command=(docker)
  if ! docker info >/dev/null 2>&1; then
    if (( EUID != 0 )) && command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then
      docker_command=(sudo -n docker)
    else
      fail 'Docker is unavailable. Start Docker and run this script with sudo or Docker access.'
    fi
  fi
  compose=("${docker_command[@]}" compose --project-directory "$repository")
  "${compose[@]}" version >/dev/null
  [[ -f .env && -f backend/.env ]] || fail 'Keep the existing .env and backend/.env in the server checkout.'

  printf 'Deploying %s from %s/%s...\n' "$target_commit" "$remote" "$branch"
  phase='validating Compose configuration'
  "${compose[@]}" config --quiet
  services="$("${compose[@]}" config --services)"

  # Build sequentially to avoid exhausting the home server's memory. Existing
  # containers keep running until every image and the Caddy config are ready.
  phase='building images'
  while IFS= read -r service; do
    "${compose[@]}" build "$service"
  done <<< "$services"
  phase='validating Caddy configuration'
  "${compose[@]}" run --rm --no-deps -T frontend caddy validate --config /config/runtime.json </dev/null

  phase='starting containers and waiting for health checks'
  up_arguments=(up -d --no-build --wait --wait-timeout "$wait_timeout")
  if [[ "$force" == true ]]; then up_arguments+=(--force-recreate); fi
  "${compose[@]}" "${up_arguments[@]}"
  "${compose[@]}" ps

  # HEAD alone is not evidence of a successful deployment: build/health failures
  # must be retried on the next timer run, even if Git already reached this commit.
  phase='recording the successful deployment'
  printf '%s\n' "$target_commit" > "$state_directory/last-successful-commit.tmp"
  mv -- "$state_directory/last-successful-commit.tmp" "$state_directory/last-successful-commit"
  printf 'Successfully deployed %s.\n' "$target_commit"
}

# Keep exit in the same parsed command so Bash never rereads a changed script.
main "$@"; exit
