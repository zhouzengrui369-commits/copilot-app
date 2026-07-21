#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OPENCLAW_MOBILE_VERIFY_PORT:-38891}"
DATA_DIR="${OPENCLAW_MOBILE_VERIFY_DATA_DIR:-/private/tmp/openclaw-mobile-smoke-data}"
WORKSPACE_DIR="${OPENCLAW_MOBILE_VERIFY_WORKSPACE_DIR:-/private/tmp/openclaw-mobile-smoke-workspace}"
KB_DIR="${OPENCLAW_MOBILE_VERIFY_KB_DIR:-/private/tmp/openclaw-mobile-smoke-kb}"

cd "$ROOT_DIR"

npm run check --workspace @openclaw-workbench/server
npm run check --workspace @openclaw-workbench/mobile
npm run test:mobile-release
npm run test:mobile-apk-release
npm run test:mobile-ui-contract
npm run build --workspace @openclaw-workbench/server

rm -rf "$DATA_DIR" "$WORKSPACE_DIR" "$KB_DIR"
mkdir -p "$DATA_DIR" "$WORKSPACE_DIR" "$KB_DIR"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
      kill "$SERVER_PID" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
          break
        fi
        sleep 0.25
      done
      if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
        kill -9 "$SERVER_PID" >/dev/null 2>&1 || true
      fi
    fi
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

OPENCLAW_WORKBENCH_PORT="$PORT" \
OPENCLAW_WORKBENCH_HOST=127.0.0.1 \
OPENCLAW_DATA_DIR="$DATA_DIR" \
OPENCLAW_WORKSPACE="$WORKSPACE_DIR" \
OPENCLAW_KB_VAULT_DIR="$KB_DIR" \
OPENCLAW_WORKBENCH_REMINDER_SYNC=0 \
OPENCLAW_WORKBENCH_DISABLE_WIKI_SCHEDULER=1 \
OPENCLAW_WORKBENCH_NAS_ROOT_SCAN=0 \
OPENCLAW_WORKBENCH_NAS_MOUNT_SCAN=0 \
OPENCLAW_WORKBENCH_NOTE_GATEWAY_AGENT=main \
node --experimental-sqlite apps/server/dist/index.js &
SERVER_PID="$!"

for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null

OPENCLAW_WORKBENCH_URL="http://127.0.0.1:${PORT}" \
OPENCLAW_DATA_DIR="$DATA_DIR" \
OPENCLAW_KB_VAULT_DIR="$KB_DIR" \
npm run test:mobile-api

OPENCLAW_WORKBENCH_URL="http://127.0.0.1:${PORT}" \
OPENCLAW_MOBILE_USABILITY_MODE=local \
OPENCLAW_MOBILE_USABILITY_PASSWORD="${OPENCLAW_MOBILE_SMOKE_PASSWORD:-openclaw-mobile-smoke}" \
OPENCLAW_MOBILE_USABILITY_DB_PATH="$DATA_DIR/workbench.sqlite" \
OPENCLAW_KB_VAULT_DIR="$KB_DIR" \
npm run test:mobile-usability

cleanup
trap - EXIT
