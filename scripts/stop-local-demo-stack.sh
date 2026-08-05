#!/usr/bin/env bash
set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly profile_root="${repository_root}/.tmp/demo-e2e-profile"
readonly marker_path="${profile_root}/.generated-by-lagermat-demo-e2e"
readonly network_name="supabase_network_scoutmat_demo_e2e"

export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:5173}"
export AUTH_CALLBACK_URL="${AUTH_CALLBACK_URL:-${APP_ORIGIN}/auth/callback}"
export AUTH_EMAIL_MAX_FREQUENCY="${AUTH_EMAIL_MAX_FREQUENCY:-1s}"
export DEMO_MODE="true"
export TURNSTILE_SECRET_KEY="${TURNSTILE_SECRET_KEY:-1x0000000000000000000000000000000AA}"
export DO_NOT_TRACK="${DO_NOT_TRACK:-1}"

cd "${repository_root}"
if [[ -f "${marker_path}" ]]; then
  ./node_modules/.bin/supabase stop \
    --workdir "${profile_root}" \
    --no-backup
  node scripts/prepare-demo-e2e-profile.mjs --clean
fi

if docker network inspect "${network_name}" >/dev/null 2>&1; then
  docker network rm "${network_name}" >/dev/null
fi
