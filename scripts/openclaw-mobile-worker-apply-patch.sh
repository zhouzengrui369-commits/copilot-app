#!/bin/sh
set -eu

REPO="/Users/njx/openclaw/copilot"
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
    apps/mobile/*|apps/server/src/db.ts|apps/server/src/index.ts|apps/server/src/config.ts|apps/server/src/mobileRecorder.ts|apps/server/src/mobileTranscription.ts|apps/server/src/connectors/nasRoot.ts|apps/server/src/cloudbaseForwarder.ts|scripts/mobile-*|scripts/openclaw-mobile-*|release/mobile-priority-ui-evidence/*)
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
