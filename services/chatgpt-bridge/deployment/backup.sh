#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Utiliser sudo chatgpt-bridge-backup /chemin/backup.tar.gz' >&2; exit 1; }
[[ $# -eq 1 && $1 == /* && ! -e $1 ]] || { echo 'Fournir un nouveau chemin absolu pour la sauvegarde.' >&2; exit 1; }
destination=$1
case "$destination" in /var/lib/chatgpt-bridge/*|/etc/chatgpt-bridge/*) echo 'Sauvegarder hors des répertoires source.' >&2; exit 1 ;; esac
restart=false
systemctl is-active --quiet chatgpt-bridge.service && restart=true
restore_service() { if $restart; then systemctl start chatgpt-bridge.service; fi; }
trap restore_service EXIT
systemctl stop chatgpt-bridge.service
tar --create --gzip --file "$destination" --directory / \
  var/lib/chatgpt-bridge etc/chatgpt-bridge
chmod 0600 "$destination"
echo "Sauvegarde privée créée : $destination"
