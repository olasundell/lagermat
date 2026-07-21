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

exec ./node_modules/.bin/supabase "$@"
