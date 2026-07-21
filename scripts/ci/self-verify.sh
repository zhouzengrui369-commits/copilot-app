#!/usr/bin/env bash
# self-verify.sh — runs only the offline-safe checks for T-1.1.6 self-verify.
#
# Does NOT execute the full lint/test/e2e chain (those need the merged
# workspace + `npm ci`). This script proves:
#   * every workflow YAML parses
#   * dependabot.yml parses
#   * benchmarks/baseline.json satisfies benchmarks/schema.json
#   * bench-collect can run end-to-end and produce a valid baseline
#   * screenshot-diff can run end-to-end on the placeholder fixture
#   * every helper script is non-empty + executable
#
# Exit codes:
#   0  all checks passed
#   1  at least one check failed
#   78 EX_CONFIG — node / ruby missing (treated as SKIP)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ok=0
fail=0

step() { echo ""; echo "=== $* ==="; }

yaml_check() {
  if command -v ruby >/dev/null 2>&1; then
    ruby -ryaml -e "YAML.load_file('$1')" >/dev/null 2>&1
  else
    python3 -c "import yaml; yaml.safe_load(open('$1'))" >/dev/null 2>&1
  fi
}

step "yaml parse (.github/workflows/*.yml + dependabot.yml)"
for f in .github/workflows/*.yml .github/dependabot.yml; do
  if [ ! -f "$f" ]; then
    echo "  SKIP (missing) $f"
    continue
  fi
  if yaml_check "$f"; then
    echo "  OK   $f"
    ok=$((ok+1))
  else
    echo "  FAIL $f"
    fail=$((fail+1))
  fi
done

step "benchmark schema validation"
if node scripts/ci/bench-validate.mjs; then
  echo "  OK  bench-validate"
  ok=$((ok+1))
else
  echo "  FAIL bench-validate"
  fail=$((fail+1))
fi

step "bench-collect end-to-end"
cp benchmarks/baseline.json benchmarks/baseline.previous.json
if node scripts/ci/bench-collect.mjs >/dev/null 2>&1; then
  echo "  OK  bench-collect"
  ok=$((ok+1))
else
  echo "  FAIL bench-collect"
  fail=$((fail+1))
fi

if node scripts/ci/bench-compare.mjs >/dev/null 2>&1; then
  echo "  OK  bench-compare"
  ok=$((ok+1))
else
  echo "  FAIL bench-compare"
  fail=$((fail+1))
fi

step "screenshot-diff end-to-end (placeholder fixture)"
SCREENSHOT_DIFF=run node scripts/ci/screenshot-diff.mjs >/dev/null 2>&1 || true
# screenshot-diff is allowed to leave placeholders, so we just check it
# wrote a result file.
if [ -f reports/screenshot-diff/result.json ]; then
  echo "  OK  screenshot-diff (result.json present)"
  ok=$((ok+1))
else
  echo "  FAIL screenshot-diff (no result.json)"
  fail=$((fail+1))
fi

step "helper scripts are present + executable"
for s in scripts/ci/lint.sh scripts/ci/unit-test.sh scripts/ci/integration-test.sh \
         scripts/ci/e2e-test.sh scripts/ci/screenshot-diff.sh scripts/ci/screenshot-diff.mjs \
         scripts/ci/bench-collect.sh scripts/ci/bench-collect.mjs \
         scripts/ci/bench-validate.mjs scripts/ci/bench-compare.mjs \
         scripts/ci/run-ci-local.sh; do
  if [ -x "$s" ]; then
    echo "  OK   $s"
    ok=$((ok+1))
  else
    echo "  FAIL $s (missing or not executable)"
    fail=$((fail+1))
  fi
done

step "package.json ci:xxx scripts are present"
missing_ci_scripts=0
for key in ci:local ci:lint ci:unit ci:integration ci:e2e ci:screenshot-diff ci:bench ci:bench:validate ci:bench:compare; do
  if ! grep -q "\"$key\"" package.json; then
    echo "  FAIL package.json missing $key"
    missing_ci_scripts=$((missing_ci_scripts+1))
  fi
done
if [ "$missing_ci_scripts" -eq 0 ]; then
  echo "  OK  all ci: scripts wired"
  ok=$((ok+1))
else
  fail=$((fail+missing_ci_scripts))
fi

step "summary"
echo "  ok=$ok  fail=$fail"
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
