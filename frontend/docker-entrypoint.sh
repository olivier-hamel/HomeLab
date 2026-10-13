#!/bin/sh
set -eu

# IP-address clients omit SNI. Each private interface uses its own internal
# listener so Caddy can choose the correct certificate before HTTP begins.
caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile > /config/adapted.json
jq --arg lan "${HTTPS_LAN_HOST:-localhost}" --arg tail "${HTTPS_TAILSCALE_HOST:-localhost}" '
  .apps.http.servers |= with_entries(
    if (.value.listen | index(":8443")) then
      .value.tls_connection_policies = [{"default_sni": $lan}]
    elif (.value.listen | index(":8444")) then
      .value.tls_connection_policies = [{"default_sni": $tail}]
    else . end
  )
' /config/adapted.json > /config/runtime.json
exec "$@"
