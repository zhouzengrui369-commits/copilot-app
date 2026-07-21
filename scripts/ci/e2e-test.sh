#!/usr/bin/env bash
# Required Phase 1 E2E gate: one Web Playwright lane and one real Electron lane.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REPORT_DIR="$ROOT/reports/e2e"
WEB_LOG="$REPORT_DIR/web.log"
WEB_JSON="$REPORT_DIR/web-results.json"
WEB_ARTIFACTS="$REPORT_DIR/web-artifacts"
ELECTRON_LOG="$REPORT_DIR/electron.log"
ELECTRON_JSON="$REPORT_DIR/electron-results.json"
ELECTRON_EVIDENCE="$REPORT_DIR/electron-evidence.json"

mkdir -p "$REPORT_DIR"
rm -f "$WEB_LOG" "$WEB_JSON" "$ELECTRON_LOG" "$ELECTRON_JSON" "$ELECTRON_EVIDENCE"

if [ ! -f "$ROOT/node_modules/@playwright/test/cli.js" ]; then
  echo "::error::local pinned @playwright/test CLI is missing; run npm install"
  exit 1
fi

if ! node -e "const p=require('./package.json'); process.exit(p.scripts?.['test:e2e:web'] ? 0 : 1)"; then
  echo "::error::required test:e2e:web script is missing"
  exit 1
fi

if ! node -e "const p=require('./package.json'); process.exit(p.scripts?.['test:e2e:electron'] ? 0 : 1)"; then
  echo "::error::required test:e2e:electron script is missing"
  exit 1
fi

echo "==> Web Playwright lane"
PLAYWRIGHT_JSON_OUTPUT_FILE="$WEB_JSON" \
  npm run --silent test:e2e:web -- \
    --reporter=line,json \
    --output="$WEB_ARTIFACTS" >"$WEB_LOG" 2>&1
web_rc=$?
if [ "$web_rc" -ne 0 ]; then
  echo "::error::Web E2E failed with exit $web_rc (log: reports/e2e/web.log)"
fi

echo "==> Electron Playwright lane"
COPILOT_E2E_PLAYWRIGHT_JSON_PATH="$ELECTRON_JSON" \
COPILOT_E2E_EVIDENCE_PATH="$ELECTRON_EVIDENCE" \
  npm run --silent test:e2e:electron >"$ELECTRON_LOG" 2>&1
electron_rc=$?
if [ "$electron_rc" -ne 0 ]; then
  echo "::error::Electron E2E failed with exit $electron_rc (log: reports/e2e/electron.log)"
fi

missing=0
for required in "$WEB_LOG" "$WEB_JSON" "$ELECTRON_LOG" "$ELECTRON_JSON" "$ELECTRON_EVIDENCE"; do
  if [ ! -s "$required" ]; then
    echo "::error::required E2E output missing or empty: ${required#$ROOT/}"
    missing=1
  fi
done

if [ "$web_rc" -ne 0 ] || [ "$electron_rc" -ne 0 ] || [ "$missing" -ne 0 ]; then
  echo "E2E summary: FAIL web=$web_rc electron=$electron_rc missing=$missing"
  exit 1
fi

echo "E2E summary: PASS web=0 electron=0"
