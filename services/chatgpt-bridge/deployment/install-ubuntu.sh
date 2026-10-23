#!/usr/bin/env bash
# Run INSIDE the dedicated Ubuntu guest, from an extracted source-only archive.
set -euo pipefail
umask 022
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
base=/opt/chatgpt-bridge
account=chatgpt-bridge
unit=chatgpt-bridge.service
config=/etc/chatgpt-bridge/bridge.env
node_version=24.22.1
dry_run=false
start=true
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --no-start) start=false ;;
    --help|-h)
      echo 'Usage : sudo bash deployment/install-ubuntu.sh [--dry-run] [--no-start]'
      echo 'Ubuntu Server 24.04 uniquement ; refuse une installation sur l’hôte Proxmox.'
      exit 0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done
[[ -f "$source_dir/package-lock.json" && -f "$source_dir/src/main.ts" ]] || { echo 'Archive source incomplète.' >&2; exit 1; }
if [[ -d /etc/pve ]] || command -v pveversion >/dev/null 2>&1; then
  echo 'Exécuter cet installateur dans la VM, jamais sur l’hôte Proxmox.' >&2
  exit 1
fi
if $dry_run; then
  cat <<'PLAN'
Plan sans modification ni accès réseau :
- Vérifier Ubuntu 24.04 avec systemd, x86-64 ou arm64.
- Installer les dépendances Linux et Node.js 24 depuis nodejs.org, SHA-256 vérifié.
- Construire une nouvelle version sous /opt/chatgpt-bridge/releases.
- Conserver configuration, jetons et profil sous /etc et /var/lib/chatgpt-bridge.
- Conserver Chromium sous /var/cache/chatgpt-bridge/browsers.
- Installer le compte non privilégié, la CLI et l’unité systemd.
- Basculer la version après construction ; restaurer l’ancienne si le démarrage échoue.
- Vérifier uniquement /healthz ; aucune question envoyée à ChatGPT.
PLAN
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Relancer avec sudo dans la VM Ubuntu.' >&2; exit 1; }
. /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 ]] || { echo 'Cible prise en charge : Ubuntu Server 24.04.' >&2; exit 1; }
[[ $(cat /proc/1/comm) == systemd ]] || { echo 'systemd doit être PID 1.' >&2; exit 1; }
case "$(uname -m)" in x86_64) node_arch=x64 ;; aarch64) node_arch=arm64 ;; *) echo 'Architecture non prise en charge.' >&2; exit 1 ;; esac
[[ "$source_dir" != "$base/app" && "$source_dir" != "$base/releases/"* ]] || { echo 'Extraire la nouvelle archive ailleurs que dans /opt/chatgpt-bridge.' >&2; exit 1; }
[[ ! -e "$base/app" || -L "$base/app" ]] || { echo '/opt/chatgpt-bridge/app existe et n’est pas un lien géré ; arrêt.' >&2; exit 1; }
install -d -m 0755 "$base" "$base/releases" "$base/runtimes"
exec 9>"$base/install.lock"
flock -n 9 || { echo 'Une installation est déjà en cours.' >&2; exit 1; }
tmp=$(mktemp -d /tmp/chatgpt-bridge-install.XXXXXX)
chmod 0755 "$tmp"
changed=false
old_app=$(readlink "$base/app" || true)
old_node=$(readlink "$base/node" || true)
was_active=false
systemctl is-active --quiet "$unit" && was_active=true
if [[ -f /etc/systemd/system/$unit ]]; then cp "/etc/systemd/system/$unit" "$tmp/previous.service"; fi
finish() {
  local result=$?
  trap - EXIT
  if [[ $result -ne 0 ]] && $changed; then
    echo 'Échec du déploiement ; arrêt et restauration des liens précédents.' >&2
    systemctl stop "$unit" || true
    if [[ -n "$old_app" ]]; then ln -sfn "$old_app" "$base/app"; else rm -f "$base/app"; fi
    if [[ -n "$old_node" ]]; then ln -sfn "$old_node" "$base/node"; else rm -f "$base/node"; fi
    if [[ -f "$tmp/previous.service" ]]; then cp "$tmp/previous.service" "/etc/systemd/system/$unit"; fi
    systemctl daemon-reload
    if $was_active; then systemctl restart "$unit" || true; fi
    echo 'Les données et la configuration existantes sont conservées.' >&2
  fi
  rm -rf -- "$tmp"
  exit "$result"
}
trap finish EXIT
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils rsync python3 \
  xvfb xauth x11vnc novnc websockify fonts-liberation qemu-guest-agent
if ! id "$account" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/chatgpt-bridge --shell /usr/sbin/nologin "$account"
fi
[[ $(id -u "$account") -ne 0 ]] || { echo 'Le compte du service ne doit pas être root.' >&2; exit 1; }
install -d -o "$account" -g "$account" -m 0700 /var/lib/chatgpt-bridge /var/cache/chatgpt-bridge
install -d -o root -g "$account" -m 0750 /etc/chatgpt-bridge
if [[ ! -e "$config" ]]; then install -o root -g "$account" -m 0640 "$source_dir/deployment/bridge.env" "$config"; fi

archive="node-v${node_version}-linux-${node_arch}.tar.xz"
node_url="https://nodejs.org/dist/v${node_version}"
curl --fail --location --proto '=https' --tlsv1.2 "$node_url/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
curl --fail --location --proto '=https' --tlsv1.2 "$node_url/$archive" -o "$tmp/$archive"
hash=$(awk -v name="$archive" '$2 == name {print $1}' "$tmp/SHASUMS256.txt")
[[ $hash =~ ^[a-f0-9]{64}$ ]] || { echo 'Somme SHA-256 officielle absente.' >&2; exit 1; }
printf '%s  %s\n' "$hash" "$tmp/$archive" | sha256sum --check --status
mkdir "$tmp/node"
tar --extract --xz --file "$tmp/$archive" --directory "$tmp/node" --strip-components=1
node_bin="$tmp/node/bin"
build_dir="$tmp/app"
install -d -m 0755 "$build_dir"
for entry in package.json package-lock.json tsconfig.json .env.example .gitignore .nvmrc README.md API.md PROXMOX.md MAINTENANCE.md VALIDATION.md openapi.yaml src scripts test deployment; do
  rsync -a --no-owner --no-group -- "$source_dir/$entry" "$build_dir/"
done
chown -R "$account:$account" "$build_dir"
as_service() {
  runuser -u "$account" -- env "PATH=$node_bin:/usr/bin:/bin" \
    NPM_CONFIG_CACHE=/var/cache/chatgpt-bridge/npm \
    /bin/bash -c 'cd -- "$1"; shift; exec "$@"' bash "$build_dir" "$@"
}
as_service "$node_bin/npm" ci --no-audit --no-fund
# Install only the browser libraries that match the locked Playwright version.
"$node_bin/node" "$build_dir/node_modules/playwright/cli.js" install-deps chromium
as_service env BRIDGE_DATA_DIR=/var/lib/chatgpt-bridge \
  BRIDGE_BROWSERS_DIR=/var/cache/chatgpt-bridge/browsers "$node_bin/node" scripts/setup.mjs
as_service "$node_bin/npm" run build
as_service "$node_bin/npm" prune --omit=dev --ignore-scripts --no-audit --no-fund

# Only these writable locations are supported by the supplied systemd unit.
as_service "$node_bin/node" "--env-file=$config" --input-type=module -e \
  'if(process.env.BRIDGE_DATA_DIR!=="/var/lib/chatgpt-bridge"||process.env.BRIDGE_BROWSERS_DIR!=="/var/cache/chatgpt-bridge/browsers")throw new Error("Chemins de stockage incompatibles avec cette unité systemd");'
port=$(as_service "$node_bin/node" "--env-file=$config" --input-type=module -e \
  'const p=Number(process.env.BRIDGE_PORT??3211);if(!Number.isInteger(p)||p<1||p>65535)throw new Error("Port invalide");console.log(p);')

release="$(date -u +%Y%m%dT%H%M%SZ)-$$"
runtime="$base/runtimes/node-v${node_version}-linux-${node_arch}"
if [[ ! -d "$runtime" ]]; then mv "$tmp/node" "$runtime"; chown -R root:root "$runtime"; fi
mv "$build_dir" "$base/releases/$release"
# Sources may have arrived as mode 0600/0700 from a private development checkout.
# Keep code root-owned, but explicitly grant the service group read/traverse access.
chown -R "root:$account" "$base/releases/$release"
chmod -R u=rwX,g=rX,o= "$base/releases/$release"
changed=true
systemctl stop "$unit" 2>/dev/null || true
ln -sfn "$base/releases/$release" "$base/app"
ln -sfn "$runtime" "$base/node"
install -o root -g root -m 0644 "$source_dir/deployment/chatgpt-bridge.service" "/etc/systemd/system/$unit"
install -o root -g root -m 0755 "$source_dir/deployment/chatgpt-bridge" /usr/local/bin/chatgpt-bridge
install -o root -g root -m 0755 "$source_dir/deployment/backup.sh" /usr/local/sbin/chatgpt-bridge-backup
systemctl daemon-reload
systemctl enable qemu-guest-agent "$unit"
systemctl start qemu-guest-agent || true
if $start; then
  systemctl reset-failed "$unit"
  systemctl start "$unit"
  ready=false
  for attempt in $(seq 1 45); do
    if systemctl is-active --quiet "$unit" &&
      curl --fail --silent --max-time 2 "http://127.0.0.1:$port/healthz" -o "$tmp/health.json" &&
      "$base/node/bin/node" --input-type=module -e \
        'import{readFileSync}from"node:fs";try{const h=JSON.parse(readFileSync(process.argv[1],"utf8"));process.exit(h.status==="ok"&&h.service==="chatgpt-plus-bridge"?0:1)}catch{process.exit(1)}' "$tmp/health.json"; then
      ready=true
      break
    fi
    sleep 1
  done
  $ready || { echo "Le service ne répond pas ; consulter journalctl -u $unit." >&2; exit 1; }
fi
changed=false
echo 'Installation terminée. Le profil et les jetons locaux n’ont pas été transférés.'
echo 'Connexion initiale sur la VM : sudo chatgpt-bridge session open'
echo 'Diagnostic : sudo chatgpt-bridge status --refresh'
