#!/usr/bin/env bash
# run-ci-local.sh — convenience wrapper that mirrors .github/workflows/ci.yml on
# the developer's machine. Runs lint -> unit -> integration -> e2e ->
# screenshot-diff -> bench in sequence, caching node_modules where possible.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

step() {
  echo ""
  echo "============================================================"
  echo "  $1"
  echo "============================================================"
}

step "lint"
bash scripts/ci/lint.sh || { echo "lint failed"; exit 1; }

step "unit"
bash scripts/ci/unit-test.sh || { echo "unit failed"; exit 1; }

step "integration"
bash scripts/ci/integration-test.sh || { echo "integration failed"; exit 1; }

step "e2e"
bash scripts/ci/e2e-test.sh || { echo "e2e failed"; exit 1; }

step "screenshot-diff"
SCREENSHOT_DIFF="${SCREENSHOT_DIFF:-warn}" bash scripts/ci/screenshot-diff.sh || true

step "bench"
bash scripts/ci/bench-collect.sh

step "validate"
node scripts/ci/bench-validate.mjs

echo ""
echo "ci:local OK"
