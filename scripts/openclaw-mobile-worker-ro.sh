#!/bin/sh
set -eu

REPO="/Users/njx/openclaw/copilot"
cd "$REPO"

allowed_path() {
  case "$1" in
    apps/mobile/*|apps/server/src/index.ts|apps/server/src/config.ts|apps/server/src/db.ts|apps/server/src/mobileRecorder.ts|apps/server/src/mobileTranscription.ts|apps/server/src/workbenchV11.ts|apps/server/src/connectors/nasRoot.ts|apps/server/src/cloudbaseForwarder.ts|scripts/mobile-*|scripts/openclaw-mobile-*|tasks/openclaw/20260702-r5a-recorder-preflight/*|tasks/openclaw/20260702-r5b-recorder-storage-api/*|tasks/openclaw/20260630-mobile-r5-voice-live-panel-fix/*|tasks/openclaw/20260701-mobile-voice-*/*|tasks/mobile-r4-bugfix-20260626/*|tasks/mobile-app-priority-ui-openclaw-handoff-20260622.md|tasks/mobile-app-100-point-recovery-openclaw-handoff-20260624.md|tasks/mobile-app-p0-note-vault-openclaw-handoff-20260624.md|tasks/mobile-first-screen-ui-openclaw-handoff-20260624.md|tasks/mobile-p1-acceptance-gaps-openclaw-handoff-20260624.md|package.json|apps/mobile/package.json|apps/mobile/app.json)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

safe_path() {
  path="$1"
  case "$path" in
    /*|*..*|"")
      echo "DENIED path=$path" >&2
      exit 2
      ;;
  esac
  if ! allowed_path "$path"; then
    echo "DENIED path=$path" >&2
    exit 2
  fi
}

case "${1:-}" in
  canary)
    pwd
    git status --short -- apps/mobile apps/server/src/index.ts apps/server/src/config.ts apps/server/src/db.ts apps/server/src/mobileRecorder.ts apps/server/src/mobileTranscription.ts apps/server/src/workbenchV11.ts apps/server/src/connectors/nasRoot.ts apps/server/src/cloudbaseForwarder.ts scripts/mobile-* scripts/openclaw-mobile-* tasks/openclaw/20260702-r5a-recorder-preflight tasks/openclaw/20260702-r5b-recorder-storage-api tasks/openclaw/20260630-mobile-r5-voice-live-panel-fix tasks/openclaw/20260701-mobile-voice-* tasks/mobile-r4-bugfix-20260626 tasks/mobile-app-100-point-recovery-openclaw-handoff-20260624.md tasks/mobile-app-p0-note-vault-openclaw-handoff-20260624.md tasks/mobile-first-screen-ui-openclaw-handoff-20260624.md tasks/mobile-p1-acceptance-gaps-openclaw-handoff-20260624.md
    sed -n '1,160p' tasks/mobile-app-p0-note-vault-openclaw-handoff-20260624.md
    ;;
  list)
    find apps/mobile/src apps/mobile/scripts apps/mobile/plugins -maxdepth 4 -type f | sort
    ;;
  show)
    safe_path "${2:-}"
    sed -n "${3:-1,220p}" "$2"
    ;;
  rg)
    pattern="${2:-}"
    if [ -z "$pattern" ]; then
      echo "DENIED empty pattern" >&2
      exit 2
    fi
    rg -n "$pattern" apps/mobile/src apps/server/src/index.ts apps/server/src/config.ts apps/server/src/db.ts apps/server/src/mobileRecorder.ts apps/server/src/mobileTranscription.ts apps/server/src/workbenchV11.ts apps/server/src/connectors/nasRoot.ts apps/server/src/cloudbaseForwarder.ts scripts/mobile-* scripts/openclaw-mobile-* tasks/openclaw/20260702-r5a-recorder-preflight tasks/openclaw/20260702-r5b-recorder-storage-api tasks/openclaw/20260630-mobile-r5-voice-live-panel-fix tasks/openclaw/20260701-mobile-voice-* tasks/mobile-r4-bugfix-20260626 tasks/mobile-app-100-point-recovery-openclaw-handoff-20260624.md tasks/mobile-app-p0-note-vault-openclaw-handoff-20260624.md tasks/mobile-first-screen-ui-openclaw-handoff-20260624.md tasks/mobile-p1-acceptance-gaps-openclaw-handoff-20260624.md
    ;;
  diff)
    git diff -- apps/mobile apps/server/src/index.ts apps/server/src/config.ts apps/server/src/db.ts apps/server/src/mobileRecorder.ts apps/server/src/mobileTranscription.ts apps/server/src/workbenchV11.ts apps/server/src/connectors/nasRoot.ts apps/server/src/cloudbaseForwarder.ts scripts/mobile-* scripts/openclaw-mobile-* tasks/openclaw/20260702-r5a-recorder-preflight tasks/openclaw/20260702-r5b-recorder-storage-api tasks/openclaw/20260630-mobile-r5-voice-live-panel-fix tasks/openclaw/20260701-mobile-voice-* tasks/mobile-r4-bugfix-20260626 tasks/mobile-app-100-point-recovery-openclaw-handoff-20260624.md tasks/mobile-app-p0-note-vault-openclaw-handoff-20260624.md tasks/mobile-first-screen-ui-openclaw-handoff-20260624.md tasks/mobile-p1-acceptance-gaps-openclaw-handoff-20260624.md
    ;;
  verify-light)
    npm run check --workspace @openclaw-workbench/mobile
    npm run test:mobile-ui-contract
    ;;
  verify-server)
    npm run check --workspace @openclaw-workbench/server
    npm run test:mobile-api
    ;;
  *)
    cat <<'USAGE' >&2
Usage:
  openclaw-mobile-worker-ro.sh canary
  openclaw-mobile-worker-ro.sh list
  openclaw-mobile-worker-ro.sh show <allowed-path> [sed-range]
  openclaw-mobile-worker-ro.sh rg <pattern>
  openclaw-mobile-worker-ro.sh diff
  openclaw-mobile-worker-ro.sh verify-light
USAGE
    exit 2
    ;;
esac
