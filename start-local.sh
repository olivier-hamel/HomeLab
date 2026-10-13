#!/usr/bin/env bash
set -euo pipefail
script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v node >/dev/null; then
  echo "Installe Node.js 24, puis relance ./start-local.sh." >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) === 24 ? 0 : 1)'; then
  echo "Active Node.js 24 (nvm use), puis relance ./start-local.sh." >&2
  exit 1
fi
exec node "$script_root/scripts/start-local.mjs" "$@"
