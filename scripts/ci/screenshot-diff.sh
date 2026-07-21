#!/usr/bin/env bash
# screenshot-diff.sh — entry point used by `.github/workflows/ci.yml`.
#
# Decides whether to run the Node diff driver or fall back to a no-op when
# the visual-regression toolchain is not yet installed (Sprint 1.3 T-1.3.3
# will land pixelmatch + pngjs as workspace devDependencies).

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REPORT_DIR="$ROOT/reports/screenshot-diff"
mkdir -p "$REPORT_DIR"

# Allow maintainers to skip visually with SCREENSHOT_DIFF=skip.
if [ "${SCREENSHOT_DIFF:-}" = "skip" ]; then
  echo "::notice::SCREENSHOT_DIFF=skip — writing empty result and exiting"
  echo '{"skipped":true}' > "$REPORT_DIR/result.json"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "::warning::node not on PATH — treating screenshot-diff as SKIP"
  echo '{"skipped":"no_node"}' > "$REPORT_DIR/result.json"
  exit 0
fi

if node -e "import('pixelmatch').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1 \
   && node -e "import('pngjs').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  :
else
  echo "::warning::pixelmatch/pngjs not installed — installing them as dev deps"
  npm install --no-save --no-audit --no-fund pixelmatch pngjs >/dev/null 2>&1 || true
fi

node scripts/ci/screenshot-diff.mjs
rc=$?

# On feature branches we always exit 0; on main we propagate the failure.
branch="${GITHUB_REF_NAME:-${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}}"
case "$branch" in
  main|sp1.*) exit $rc ;;
  *) echo "::notice::branch '$branch' is not main/sp1.* — treating screenshot-diff failures as warnings"; exit 0 ;;
esac
