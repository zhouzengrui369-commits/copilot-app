#!/bin/sh
set -eu

REPO="/Users/njx/openclaw/copilot"
TASK_PREFIX="tasks/openclaw/2026-07-02T02-40-njx-knowledge-add-note-v1/"
PATCH="${1:-}"

if [ -z "$PATCH" ]; then
  echo "DENIED missing patch path" >&2
  exit 2
fi

case "$PATCH" in
  /Users/njx/openclaw_data/worker_workspace/*|/private/tmp/*|/tmp/*)
    ;;
  *)
    echo "DENIED patch must live in worker workspace or tmp: $PATCH" >&2
    exit 2
    ;;
esac

if [ ! -f "$PATCH" ]; then
  echo "DENIED patch not found: $PATCH" >&2
  exit 2
fi

check_target() {
  target="$1"
  case "$target" in
    /dev/null)
      return 0
      ;;
    a/*)
      target="${target#a/}"
      ;;
    b/*)
      target="${target#b/}"
      ;;
  esac

  case "$target" in
    /*|*..*|"")
      echo "DENIED target=$target" >&2
      exit 2
      ;;
  esac

  case "$target" in
    apps/server/src/index.ts|apps/server/src/workbenchV11.ts|apps/server/src/yuanbaoSync.ts|apps/server/src/config.ts|apps/server/src/connectors/nasRoot.ts)
      ;;
    apps/web/src/App.tsx|apps/web/src/styles.css)
      ;;
    apps/mobile/src/lib/api.ts|apps/mobile/src/lib/types.ts|apps/mobile/src/screens/KnowledgeScreen.tsx|apps/mobile/src/screens/CalendarScreen.tsx)
      ;;
    scripts/openclaw-knowledge-*|scripts/knowledge-*|scripts/yuanbao-*|scripts/mobile-api-smoke.mjs|scripts/web-dev-verify.cjs)
      ;;
    ${TASK_PREFIX}*)
      ;;
    *)
      echo "DENIED target=$target" >&2
      exit 2
      ;;
  esac
}

while IFS= read -r line; do
  case "$line" in
    "diff --git "*)
      set -- $line
      check_target "$3"
      check_target "$4"
      ;;
    "--- "*|"+++ "*)
      target="${line#??? }"
      target="${target%%	*}"
      check_target "$target"
      ;;
  esac
done < "$PATCH"

cd "$REPO"
git apply --check "$PATCH"
git apply "$PATCH"
echo "PATCH_APPLIED $PATCH"
