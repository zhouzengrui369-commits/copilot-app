#!/usr/bin/env bash
# wb-12h-metrics.sh
# 12小时持续监控 —— 每 5 分钟采集 workbench 关键指标
# 设计原则：完全只读（curl GET + sqlite3 只读查询），不修改 DB
# 输出：/tmp/workbench-12h-monitor/metrics-<timestamp>.json
# 告警：/tmp/workbench-12h-monitor/ALERT-*.md

set -u

# ---------- 配置 ----------
MONITOR_DIR="/tmp/workbench-12h-monitor"
STATE_FILE="${MONITOR_DIR}/.state.json"
DB_PATH="/Users/njx/openclaw_data/openclaw_workbench/data/workbench.sqlite"
BASE_URL="${OPENCLAW_WORKBENCH_URL:-http://127.0.0.1:38888}"
TIMEOUT="${OPENCLAW_WORKBENCH_HEALTH_TIMEOUT_MS:-8000}"
# 阈值常量
SERVICE_FAIL_THRESHOLD=3          # 连续失败次数
STALE_TICK_THRESHOLD_SEC=1800     # 30 分钟无 auto tick 视为 stale
FLAPPING_EVENT_THRESHOLD=600      # 一小时内事件数 > 600 视为抖动 (10 events/min)

mkdir -p "${MONITOR_DIR}"

# ---------- 工具 ----------
# 用 python 算时间，避免 BSD date 没有 %3N
now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }
iso_now() { python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))'; }
iso_filename() { python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))'; }
iso_ago_seconds() {
  # $1 = 秒数; 输出 ISO8601 with Z
  python3 -c "import datetime,time; s=int(time.time())-${1}; print(datetime.datetime.fromtimestamp(s, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))"
}
iso_to_ms() {
  # $1 = ISO8601 with Z; 输出 ms since epoch；失败输出空
  python3 -c "
import sys, datetime
try:
    s='${1}'.strip()
    if not s:
        print('')
        sys.exit(0)
    s = s.replace('Z','+00:00')
    dt = datetime.datetime.fromisoformat(s)
    print(int(dt.timestamp()*1000))
except Exception as e:
    print('')
"
}

# safe curl GET; echo "<http_code> <body>"
http_get() {
  local url="$1"
  local code
  local body
  code=$(curl -sS -o /tmp/.wb_monitor_body.$$ -w "%{http_code}" --max-time $((TIMEOUT/1000)) "$url" 2>/dev/null || echo "000")
  body=$(cat /tmp/.wb_monitor_body.$$ 2>/dev/null || echo "")
  rm -f /tmp/.wb_monitor_body.$$
  echo "${code}|${body}"
}

# 用 jq 解析 JSON; 没有 jq 就退化
json_get() {
  local body="$1"
  local path="$2"
  if command -v jq >/dev/null 2>&1; then
    echo "$body" | jq -r "$path" 2>/dev/null
  else
    echo "$body"
  fi
}

write_alert() {
  local kind="$1"
  local title="$2"
  local body="$3"
  local ts
  ts=$(iso_filename)
  local file="${MONITOR_DIR}/ALERT-${kind}-${ts}.md"
  cat > "$file" <<EOF
# ALERT: ${title}

- **kind**: ${kind}
- **ts**: ${iso_now()}
- **body**:
\`\`\`
${body}
\`\`\`
EOF
  echo "WROTE_ALERT: ${file}"
}

# ---------- 1. service health ----------
HEALTH_RAW=$(http_get "${BASE_URL}/api/health")
HEALTH_CODE="${HEALTH_RAW%%|*}"
HEALTH_BODY="${HEALTH_RAW#*|}"
SERVICE_OK=false
if [ "${HEALTH_CODE}" = "200" ]; then
  SERVICE_OK=true
fi

# ---------- 2. DB 直读（只读查询）----------
DB_OK=false
DB_ERR=""
GOALS_ACTIVE=""
GOALS_BY_STATUS_JSON=""
SCHED_RUNNING=""
SCHED_LAST_TICK=""
SCHED_LAST_DECISION=""
SCHED_LAST_ERROR=""
SCHED_ROW_ID="default"
EVENTS_LAST_1H=""
EVENTS_LAST_1M=""
EVENTS_BY_TYPE_JSON=""
AUDIT_LAST_1H=""
GOALS_OVER_BUDGET=""
GOAL_BLOCK_FLIPS=""

if command -v sqlite3 >/dev/null 2>&1; then
  # Probe: sqlite open test（避免把 SELECT 结果当 error）
  DB_ERR=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT 1;" >/dev/null 2>&1)
  if [ $? -eq 0 ]; then
    DB_OK=true
    # goal 状态聚合
    GOALS_ACTIVE=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT COUNT(*) FROM development_goals WHERE status IN ('active','running','blocked');" 2>/dev/null)
    GOALS_BY_STATUS_JSON=$(sqlite3 -readonly -cmd ".timeout 5000" -json "${DB_PATH}" "SELECT status, COUNT(*) AS count FROM development_goals GROUP BY status;" 2>/dev/null)
    # scheduler state（row id 是 'default'，不是 'singleton'）
    SCHED_ROW_ID="default"
    SCHED_RUNNING=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT running FROM development_scheduler_state WHERE id='${SCHED_ROW_ID}';" 2>/dev/null)
    SCHED_LAST_TICK=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT last_auto_tick_at FROM development_scheduler_state WHERE id='${SCHED_ROW_ID}';" 2>/dev/null)
    SCHED_LAST_DECISION=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT last_decision FROM development_scheduler_state WHERE id='${SCHED_ROW_ID}';" 2>/dev/null)
    SCHED_LAST_ERROR=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT last_error FROM development_scheduler_state WHERE id='${SCHED_ROW_ID}';" 2>/dev/null)
    SCHED_PROCESS_ID=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT process_id FROM development_scheduler_state WHERE id='${SCHED_ROW_ID}';" 2>/dev/null)
    # events 时间窗
    HOUR_AGO=$(iso_ago_seconds 3600)
    MIN_AGO=$(iso_ago_seconds 60)
    EVENTS_LAST_1H=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT COUNT(*) FROM development_run_events WHERE created_at >= '${HOUR_AGO}';" 2>/dev/null)
    EVENTS_LAST_1M=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT COUNT(*) FROM development_run_events WHERE created_at >= '${MIN_AGO}';" 2>/dev/null)
    EVENTS_BY_TYPE_JSON=$(sqlite3 -readonly -cmd ".timeout 5000" -json "${DB_PATH}" "SELECT event_type, severity, COUNT(*) AS count FROM development_run_events WHERE created_at >= '${HOUR_AGO}' GROUP BY event_type, severity ORDER BY count DESC LIMIT 20;" 2>/dev/null)
    AUDIT_LAST_1H=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT COUNT(*) FROM audit_logs WHERE ts >= '${HOUR_AGO}';" 2>/dev/null)
    # over budget
    GOALS_OVER_BUDGET=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT COUNT(*) FROM development_goals WHERE status IN ('active','running','blocked') AND token_budget > 0 AND COALESCE(tokens_used,0) >= token_budget;" 2>/dev/null)
    # goal.status blocked ↔ active 抖动 (rough proxy)
    GOAL_BLOCK_FLIPS=$(sqlite3 -readonly -cmd ".timeout 5000" "${DB_PATH}" "SELECT COUNT(*) FROM development_run_events WHERE created_at >= '${HOUR_AGO}' AND event_type IN ('goal_blocked','goal_unblocked','goal_status_changed');" 2>/dev/null)
  else
    DB_ERR=$(echo "$DB_ERR" | head -3)
  fi
fi

# ---------- 3. 计算派生指标 ----------
NOW_MS=$(now_ms)
LAST_TICK_MS=""
TICK_STALE_SEC=""
if [ -n "${SCHED_LAST_TICK}" ] && [ "${SCHED_LAST_TICK}" != "" ]; then
  LAST_TICK_MS=$(iso_to_ms "${SCHED_LAST_TICK}")
  if [ -n "$LAST_TICK_MS" ]; then
    TICK_STALE_SEC=$(( (NOW_MS - LAST_TICK_MS) / 1000 ))
  fi
fi

# ---------- 4. 写状态文件 / 告警判定 ----------
# 初始化 state
if [ ! -f "${STATE_FILE}" ]; then
  echo '{"service_fail_streak":0,"alert_history":[]}' > "${STATE_FILE}"
fi

# 读旧状态
SVC_FAIL_STREAK=$(grep -o '"service_fail_streak":[0-9]*' "${STATE_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*$' || echo 0)

if [ "$SERVICE_OK" = "true" ]; then
  SVC_FAIL_STREAK=0
else
  SVC_FAIL_STREAK=$((SVC_FAIL_STREAK + 1))
fi

# 写新状态（atomic）
TMP_STATE=$(mktemp)
cat > "${TMP_STATE}" <<EOF
{"service_fail_streak":${SVC_FAIL_STREAK},"last_update":"$(iso_now)"}
EOF
mv "${TMP_STATE}" "${STATE_FILE}"

# 告警 1: service 连续失败
if [ "$SVC_FAIL_STREAK" -ge "${SERVICE_FAIL_THRESHOLD}" ]; then
  write_alert "service-down" "workbench service health degraded (streak=${SVC_FAIL_STREAK})" \
    "Service /api/health returned ${HEALTH_CODE} for ${SVC_FAIL_STREAK} consecutive probes.\n\nURL: ${BASE_URL}/api/health\nCode: ${HEALTH_CODE}\nBody: ${HEALTH_BODY:0:500}"
fi

# 告警 2: scheduler last_auto_tick_at 超过 30 分钟
if [ -n "$TICK_STALE_SEC" ] && [ "$TICK_STALE_SEC" -gt "${STALE_TICK_THRESHOLD_SEC}" ]; then
  write_alert "scheduler-stale" "scheduler last_auto_tick_at is ${TICK_STALE_SEC}s old (>${STALE_TICK_THRESHOLD_SEC}s)" \
    "last_auto_tick_at: ${SCHED_LAST_TICK}\nprocess_id: ${SCHED_PROCESS_ID}\nlast_decision: ${SCHED_LAST_DECISION}\nlast_error: ${SCHED_LAST_ERROR}"
fi

# 告警 3: 抖动 (events last 1h > 600)
if [ -n "$EVENTS_LAST_1H" ] && [ "$EVENTS_LAST_1H" -gt "${FLAPPING_EVENT_THRESHOLD}" ]; then
  write_alert "scheduler-flapping" "events last 1h = ${EVENTS_LAST_1H} (>${FLAPPING_EVENT_THRESHOLD}) — possible goal status thrashing" \
    "events_last_1h: ${EVENTS_LAST_1H}\nevents_last_1m: ${EVENTS_LAST_1M}\ngoal_block_flips: ${GOAL_BLOCK_FLIPS}\nevents_by_type:\n${EVENTS_BY_TYPE_JSON}"
fi

# 告警 4: DB 不可读
if [ "$DB_OK" = "false" ]; then
  write_alert "db-unreachable" "sqlite read failed" \
    "DB path: ${DB_PATH}\nError: ${DB_ERR}"
fi

# 告警 5: scheduler.last_error 非空（持续 5 次都非空才报，否则一次性偶发不告警）
if [ -n "${SCHED_LAST_ERROR}" ] && [ "${SCHED_LAST_ERROR}" != "" ]; then
  # 用日志简单记录，不立即告警（每 12 分钟/次），避免噪音
  echo "[$(iso_now)] scheduler.last_error present: ${SCHED_LAST_ERROR}" >> "${MONITOR_DIR}/scheduler-error.log"
fi

# ---------- 5. 输出 JSON ----------
OUT_FILE="${MONITOR_DIR}/metrics-$(iso_filename).json"

# 构造 JSON（手工构造，避免依赖 jq）
cat > "${OUT_FILE}" <<EOF
{
  "ts": "$(iso_now)",
  "ts_ms": ${NOW_MS},
  "service": {
    "url": "${BASE_URL}",
    "ok": ${SERVICE_OK},
    "http_code": "${HEALTH_CODE}",
    "fail_streak": ${SVC_FAIL_STREAK}
  },
  "db": {
    "ok": ${DB_OK},
    "path": "${DB_PATH}",
    "error": $(printf '%s' "${DB_ERR}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
  },
  "goals": {
    "active_count": ${GOALS_ACTIVE:-0},
    "over_budget_count": ${GOALS_OVER_BUDGET:-0},
    "by_status": ${GOALS_BY_STATUS_JSON:-[]}
  },
  "scheduler": {
    "running": $([ "${SCHED_RUNNING}" = "1" ] && echo "true" || echo "false"),
    "last_tick_at": "${SCHED_LAST_TICK}",
    "last_decision": "${SCHED_LAST_DECISION}",
    "last_error": $(printf '%s' "${SCHED_LAST_ERROR}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""'),
    "process_id": "${SCHED_PROCESS_ID}",
    "tick_stale_seconds": $([ -n "$TICK_STALE_SEC" ] && echo "$TICK_STALE_SEC" || echo "null")
  },
  "events": {
    "written_last_hour": ${EVENTS_LAST_1H:-0},
    "written_last_minute": ${EVENTS_LAST_1M:-0},
    "by_type_top": ${EVENTS_BY_TYPE_JSON:-[]}
  },
  "audit": {
    "written_last_hour": ${AUDIT_LAST_1H:-0}
  },
  "flapping": {
    "goal_block_flips_last_hour": ${GOAL_BLOCK_FLIPS:-0}
  },
  "alerts_triggered": []
}
EOF

# 清理 7 天前的 metrics（保留 7 天 = 10080 分钟 ≈ 2016 个 5min 文件；保险起见删 > 5000 个）
TOTAL=$(ls -1 "${MONITOR_DIR}"/metrics-*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "${TOTAL}" -gt 3000 ]; then
  ls -1t "${MONITOR_DIR}"/metrics-*.json | tail -n +2001 | while read -r f; do
    rm -f "$f"
  done
fi

# 清理超过 14 天的 ALERT
find "${MONITOR_DIR}" -maxdepth 1 -name "ALERT-*.md" -mtime +14 -delete 2>/dev/null || true

echo "OK ${OUT_FILE}"