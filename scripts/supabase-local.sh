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
export DEMO_MODE="${DEMO_MODE:-false}"
# Cloudflare's published "always passes" test secret is safe for local
# development only. Hosted environments must provide their own secret.
export TURNSTILE_SECRET_KEY="${TURNSTILE_SECRET_KEY:-1x0000000000000000000000000000000AA}"
# Clearly synthetic and local-only. Hosted private environments must inject a
# stable independent value through the protected server-secret boundary.
export SCOUTNET_SOURCE_REFERENCE_SECRET="${SCOUTNET_SOURCE_REFERENCE_SECRET:-scoutmat-local-synthetic-source-reference-secret-v1}"
# Reconciliation is deliberately fixture-only until a separate external-data
# approval enables and verifies a live server adapter.
export SCOUTNET_RECONCILIATION_MODE="${SCOUTNET_RECONCILIATION_MODE:-fixture}"
export DO_NOT_TRACK="${DO_NOT_TRACK:-1}"

exec ./node_modules/.bin/supabase "$@"
