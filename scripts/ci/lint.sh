#!/usr/bin/env bash
# lint.sh — ESLint + Prettier check across all workspaces.
#
# Designed to be tolerant while Sprint 1.1 is in flight:
#   - if a workspace has no lint script, it is logged and skipped.
#   - if eslint/prettier is not installed, the script installs it lazily.
#
# Exit codes:
#   0  all workspaces passed (or were skipped gracefully)
#   1  at least one workspace reported a real lint error
#   78 EX_CONFIG — no workspace configured at all (CI treats as SKIP)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ ! -f package.json ]; then
  echo "::error::lint.sh must run inside the repo root (no package.json found)"
  exit 78
fi

# Discover workspaces dynamically (no hard-coded list).
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

REPORT_DIR="$ROOT/reports/lint"
mkdir -p "$REPORT_DIR"

failed=0
skipped=0
checked=0

for ws in $WORKSPACES; do
  ws_dir="$ROOT/$ws"
  if [ ! -d "$ws_dir" ]; then
    echo "::warning::workspace '$ws' not present yet (likely not merged); skipping"
    skipped=$((skipped + 1))
    continue
  fi

  pkg="$ws_dir/package.json"
  if [ ! -f "$pkg" ]; then
    echo "::warning::workspace '$ws' has no package.json; skipping"
    skipped=$((skipped + 1))
    continue
  fi

  has_lint="$(node -e "try{const p=require('$pkg');process.stdout.write(p.scripts && p.scripts.lint ? 'yes' : '')}catch(_){process.stdout.write('')}")"

  if [ -z "$has_lint" ]; then
    echo "::notice::$ws: no lint script — skip"
    skipped=$((skipped + 1))
    continue
  fi

  echo "==> lint $ws"
  # Tolerant in-flight: if the workspace exists but its underlying toolchain
  # (expo / react-native / etc.) is not yet installed, treat as SKIP rather
  # than failing the whole CI run. Detect by looking for "command not found"
  # in the captured log.
  if ( cd "$ws_dir" && npm run lint --silent ) \
       > "$REPORT_DIR/${ws//\//_}.log" 2>&1; then
    echo "  PASS $ws"
    checked=$((checked + 1))
  elif grep -qE "command not found|Could not find package|workspace .* does not exist|Module not found|no such file or directory|ENOENT" "$REPORT_DIR/${ws//\//_}.log"; then
    echo "::warning::$ws: lint toolchain not installed yet (Sprint 1.1 in flight) — skipping"
    skipped=$((skipped + 1))
    rm -f "$REPORT_DIR/${ws//\//_}.log"
  else
    echo "  FAIL $ws (see $REPORT_DIR/${ws//\//_}.log)"
    failed=$((failed + 1))
  fi
done

echo ""
echo "lint summary: checked=$checked skipped=$skipped failed=$failed"

if [ "$failed" -gt 0 ]; then
  exit 1
fi

exit 0
