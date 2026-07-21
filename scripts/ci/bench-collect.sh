#!/usr/bin/env bash
# bench-collect.sh — entry point used by `.github/workflows/ci.yml`.
#
# Snapshot the current baseline into benchmarks/baseline.previous.json, run
# the Node collector, and emit the diff as a machine-readable artifact.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "::error::node is required for bench-collect"
  exit 1
fi

REPORT_DIR="$ROOT/reports/bench"
mkdir -p "$REPORT_DIR"

# 1. Snapshot the prior baseline (no-op on first run).
if [ -f benchmarks/baseline.json ]; then
  cp benchmarks/baseline.json benchmarks/baseline.previous.json
fi

# 2. Run the collector.
node scripts/ci/bench-collect.mjs

# 3. Compute a simple delta against the previous snapshot.
node scripts/ci/bench-compare.mjs
