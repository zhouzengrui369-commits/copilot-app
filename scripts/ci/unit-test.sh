#!/usr/bin/env bash
# unit-test.sh — run `npm test` across every workspace that exposes one.
#
# Each workspace is run in isolation. Reports are written under
# reports/unit/<ws>.json (when the underlying test runner emits a JSON report)
# and reports/unit/<ws>.log (raw stdout/stderr).
#
# Exit codes:
#   0  all workspaces passed (or were skipped gracefully)
#   1  at least one workspace reported a real test failure
#   78 EX_CONFIG — no workspace configured

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -f package.json ]; then
  echo "::error::unit-test.sh must run inside the repo root"
  exit 78
fi

WORKSPACES="$(node -e "
  try {
    const p = require('./package.json');
    const list = Array.isArray(p.workspaces) ? p.workspaces : [];
    console.log(list.join('\n'));
  } catch (e) {
    process.exit(0);
  }
" 2>/dev/null)"

if [ -z "$WORKSPACES" ]; then
  echo "::warning::no workspaces declared in package.json; treating as SKIP"
  exit 0
fi

REPORT_DIR="$ROOT/reports/unit"
mkdir -p "$REPORT_DIR"

failed=0
skipped=0
passed=0
totals_json="$REPORT_DIR/_summary.json"
echo '{"results":[' > "$totals_json"

first=1
for ws in $WORKSPACES; do
  ws_dir="$ROOT/$ws"
  if [ ! -d "$ws_dir" ]; then
    echo "::warning::$ws not present; skipping"
    skipped=$((skipped + 1))
    continue
  fi

  pkg="$ws_dir/package.json"
  if [ ! -f "$pkg" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  has_test="$(node -e "try{const p=require('$pkg');process.stdout.write(p.scripts && p.scripts.test ? 'yes' : '')}catch(_){process.stdout.write('')}")"

  if [ -z "$has_test" ]; then
    echo "::notice::$ws has no test script — skip"
    skipped=$((skipped + 1))
    continue
  fi

  echo "==> test $ws"
  log_file="$REPORT_DIR/${ws//\//_}.log"
  start_ts="$(date +%s)"
  if ( cd "$ws_dir" && npm test --silent -- --reporter=json --outputFile="$REPORT_DIR/${ws//\//_}.json" > "$log_file" 2>&1 ); then
    end_ts="$(date +%s)"
    duration=$((end_ts - start_ts))
    echo "  PASS $ws (${duration}s)"
    passed=$((passed + 1))
    status="pass"
  else
    end_ts="$(date +%s)"
    duration=$((end_ts - start_ts))
    echo "  FAIL $ws (${duration}s) — see $log_file"
    failed=$((failed + 1))
    status="fail"
  fi

  if [ $first -eq 1 ]; then first=0; else echo "," >> "$totals_json"; fi
  printf '{"workspace":"%s","status":"%s","duration_s":%d,"log":"reports/unit/%s.log"}\n' \
    "$ws" "$status" "$duration" "${ws//\//_}" >> "$totals_json"
done

echo ']}' >> "$totals_json"

echo ""
echo "unit-test summary: passed=$passed skipped=$skipped failed=$failed"

if [ "$failed" -gt 0 ]; then
  exit 1
fi

exit 0
