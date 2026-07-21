#!/usr/bin/env bash
# Strict Phase 1 integration gate. Every declared owner must provide and run
# a non-empty, integration-only Vitest suite; unit tests are never substitutes.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPORT_DIR="$ROOT/reports/integration"
mkdir -p "$REPORT_DIR"

LANES=(
  "desktop|apps/copilot-desktop"
  "cloud|apps/copilot-cloud"
  "kb|packages/kb"
  "kg|packages/kg"
  "llm-client|packages/llm-client"
  "rag|packages/rag"
)

failed=0
passed=0
total_tests=0

for lane in "${LANES[@]}"; do
  IFS='|' read -r owner workspace <<< "$lane"
  workspace_dir="$ROOT/$workspace"
  package_file="$workspace_dir/package.json"
  result_file="$REPORT_DIR/$owner.json"
  log_file="$REPORT_DIR/$owner.log"

  if [ ! -d "$workspace_dir" ] || [ ! -f "$package_file" ]; then
    echo "  FAIL $owner — required workspace is missing: $workspace"
    failed=$((failed + 1))
    continue
  fi

  script="$(node -e "const p=require(process.argv[1]); process.stdout.write(p.scripts?.['test:integration'] ?? '')" "$package_file")"
  if [ -z "$script" ]; then
    echo "  FAIL $owner — required test:integration script is missing"
    failed=$((failed + 1))
    continue
  fi

  echo "==> integration $owner ($workspace)"
  rm -f "$result_file" "$log_file"
  start_ts="$(date +%s)"
  if (cd "$workspace_dir" && npm run --silent test:integration -- --reporter=json --outputFile="$result_file") >"$log_file" 2>&1; then
    run_rc=0
  else
    run_rc=$?
  fi

  if [ "$run_rc" -ne 0 ]; then
    echo "  FAIL $owner — test command exited $run_rc; see $log_file"
    failed=$((failed + 1))
    continue
  fi

  counts="$(node -e "
    const fs=require('node:fs');
    const file=process.argv[1];
    if (!fs.existsSync(file)) process.exit(2);
    const r=JSON.parse(fs.readFileSync(file, 'utf8'));
    const total=Number(r.numTotalTests);
    const passed=Number(r.numPassedTests);
    const failed=Number(r.numFailedTests);
    const pending=Number(r.numPendingTests);
    if (![total, passed, failed, pending].every(Number.isFinite)) process.exit(3);
    process.stdout.write([total, passed, failed, pending].join(' '));
  " "$result_file")"
  parse_rc=$?
  if [ "$parse_rc" -ne 0 ]; then
    echo "  FAIL $owner — missing or invalid Vitest JSON result"
    failed=$((failed + 1))
    continue
  fi

  read -r lane_total lane_passed lane_failed lane_pending <<< "$counts"
  if [ "$lane_total" -le 0 ]; then
    echo "  FAIL $owner — zero integration tests discovered"
    failed=$((failed + 1))
    continue
  fi
  if [ "$lane_failed" -ne 0 ] || [ "$lane_pending" -ne 0 ] || [ "$lane_passed" -ne "$lane_total" ]; then
    echo "  FAIL $owner — total=$lane_total passed=$lane_passed failed=$lane_failed pending=$lane_pending"
    failed=$((failed + 1))
    continue
  fi

  elapsed=$(( $(date +%s) - start_ts ))
  echo "  PASS $owner — $lane_passed/$lane_total tests (${elapsed}s)"
  passed=$((passed + 1))
  total_tests=$((total_tests + lane_total))
done

echo ""
echo "integration summary: lanes_passed=$passed/6 tests_passed=$total_tests failed_lanes=$failed"

if [ "$failed" -ne 0 ] || [ "$passed" -ne 6 ] || [ "$total_tests" -le 0 ]; then
  exit 1
fi

exit 0
