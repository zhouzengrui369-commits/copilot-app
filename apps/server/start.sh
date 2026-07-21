#!/bin/bash
# Stable server starter for OpenClaw Workbench.
# Detaches via double-fork (nohup + disown + &) so the server survives
# the parent shell session exiting (e.g. OpenCode rotation).
set -e

cd "$(dirname "$0")"

LOG_FILE="${WB_SERVER_LOG:-/tmp/wb-server.log}"
PORT="${WB_SERVER_PORT:-38888}"

# Free port if anything is still bound (best effort).
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "WARN: port $PORT already in use, leaving existing process alone" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  exit 0
fi

# v3.4 修复：先清掉残留的 Gateway CLI 锁文件。
# 旧 server (PPID=1, detached) 崩溃时 finally 不会跑，锁文件残留 → 9 分钟 stale 才清。
# start.sh 启动前先 unlink，stale 锁不阻塞本次启动。
LOCK_FILE="${TMPDIR:-/tmp}/openclaw-workbench-gateway-cli.lock"
if [ -f "$LOCK_FILE" ]; then
  echo "WARN: removing stale gateway CLI lock: $LOCK_FILE" >&2
  rm -f "$LOCK_FILE" 2>/dev/null || mavis-trash "$LOCK_FILE" 2>/dev/null || true
fi

# Double-fork: inner subshell forks node, exits immediately,
# leaving node reparented to init (PPID=1).
(
  cd "$(dirname "$0")"
  env \
    OPENCLAW_WORKBENCH_NOTE_GATEWAY_AGENT=main \
    nohup node --experimental-sqlite dist/index.js \
      < /dev/null >> "$LOG_FILE" 2>&1 &
  disown
)

# Wait for the server to actually start accepting connections.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "started (port $PORT) — log: $LOG_FILE"
    exit 0
  fi
  sleep 0.5
done

echo "ERROR: server did not start within 5s — check $LOG_FILE" >&2
tail -20 "$LOG_FILE" >&2
exit 1
