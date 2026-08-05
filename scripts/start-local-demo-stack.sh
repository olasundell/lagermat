#!/usr/bin/env bash
set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly profile_root="${repository_root}/.tmp/demo-e2e-profile"
readonly network_name="supabase_network_scoutmat_demo_e2e"

export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:5173}"
export AUTH_CALLBACK_URL="${AUTH_CALLBACK_URL:-${APP_ORIGIN}/auth/callback}"
export AUTH_EMAIL_MAX_FREQUENCY="${AUTH_EMAIL_MAX_FREQUENCY:-1s}"
export DEMO_MODE="true"
export TURNSTILE_SECRET_KEY="${TURNSTILE_SECRET_KEY:-1x0000000000000000000000000000000AA}"
export DO_NOT_TRACK="${DO_NOT_TRACK:-1}"

cd "${repository_root}"
node scripts/prepare-demo-e2e-profile.mjs >/dev/null

if ! docker network inspect "${network_name}" >/dev/null 2>&1; then
  docker network create \
    --driver bridge \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
    "${network_name}" >/dev/null
fi

./node_modules/.bin/supabase start \
  --workdir "${profile_root}" \
  --network-id "${network_name}" 2>&1 |
  sed -E \
    's/^([[:space:]]*"([^" ]*(KEY|SECRET|TOKEN|PASSWORD)[^" ]*|DB_URL)":).*/\1 "[redacted]",/'
