#!/usr/bin/env bash
set -euo pipefail

export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:5173}"
export AUTH_CALLBACK_URL="${AUTH_CALLBACK_URL:-http://127.0.0.1:5173/auth/callback}"
export AUTH_EMAIL_MAX_FREQUENCY="${AUTH_EMAIL_MAX_FREQUENCY:-1s}"
export SMTP_HOST="${SMTP_HOST:-inbucket}"
export SMTP_PORT="${SMTP_PORT:-1025}"
export SMTP_USER="${SMTP_USER:-local}"
export SMTP_PASS="${SMTP_PASS:-local-not-a-secret}"
export SMTP_FROM_ADDRESS="${SMTP_FROM_ADDRESS:-local@example.invalid}"
export SMTP_FROM_NAME="${SMTP_FROM_NAME:-Lägermat local}"
export DO_NOT_TRACK="${DO_NOT_TRACK:-1}"

# Supabase's pgTAP runner expects this exact project-scoped network name.
# Pre-creating it lets us retain CLI compatibility while forcing published
# container ports to bind to loopback rather than every host interface.
network_name="supabase_network_scoutmat"

if ! docker network inspect "$network_name" >/dev/null 2>&1; then
  docker network create \
    --driver bridge \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
    "$network_name" >/dev/null
fi

exec ./node_modules/.bin/supabase start --network-id "$network_name"
