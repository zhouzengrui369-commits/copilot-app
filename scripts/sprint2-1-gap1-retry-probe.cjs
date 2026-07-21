#!/usr/bin/env node
/**
 * Sprint2.1 Gap 1 探针 — 验证 dispatch retry 逻辑可行性
 * 不改 compiled index.js, 只用 sqlite3 CLI 验证 "retry_count cap=3" 行为
 * retry 状态编码到 blockers JSON: ["retry:N:retry_at:ISO:probe", ...]
 *
 * 跑法: node scripts/sprint2-1-gap1-retry-probe.cjs [status|simulate-fail|reset|verify]
 */
const { execSync } = require('child_process');

const DB = '/Users/njx/openclaw_data/openclaw_workbench/data/workbench.sqlite';
const SUBTASK_ID = process.env.SUBTASK_ID || 'subtask-openclaw-workbench-001';
const HEARTBEAT_INTERVAL_MIN = 5;
const MAX_RETRY = 3;

function sql(query) {
  return execSync(`sqlite3 "${DB}" "${query.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

function safeJson(s, fallback) {
  try { return JSON.parse(s || 'null') || fallback; } catch (e) { return fallback; }
}

function now() { return new Date().toISOString(); }

function readSubtask() {
  const status = sql(`SELECT status FROM development_subtasks WHERE id='${SUBTASK_ID}'`);
  const blockers = safeJson(sql(`SELECT blockers FROM development_subtasks WHERE id='${SUBTASK_ID}'`), []);
  const updatedAt = sql(`SELECT updated_at FROM development_subtasks WHERE id='${SUBTASK_ID}'`);
  return { status, blockers, updatedAt };
}

function parseRetryBlocker(blockers) {
  const retryLine = blockers.find((b) => /^retry:/.test(b));
  if (!retryLine) return { attempt: 0, retryAt: null };
  const parts = retryLine.split(':');
  // retry:N:retry_at:ISO:probe
  return {
    attempt: parseInt(parts[1] || '0', 10),
    retryAt: parts[3] || null,
  };
}

function appendRetryEvent(attempt, reason) {
  const evId = `subtask-retry-probe-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const projectId = sql(`SELECT project_id FROM development_subtasks WHERE id='${SUBTASK_ID}'`) || 'unknown';
  const eventType = attempt >= MAX_RETRY ? 'subtask_dispatch_permanent_blocked' : 'subtask_dispatch_retry';
  const severity = attempt >= MAX_RETRY ? 'high' : 'warn';
  const message = attempt >= MAX_RETRY
    ? `Sprint2.1 Gap 1 探针: retry 达到上限 (${attempt}/${MAX_RETRY}), 永久 blocked`
    : `Sprint2.1 Gap 1 探针: dispatch 失败, attempt ${attempt}/${MAX_RETRY}, 等下次 heartbeat retry`;
  const retryAt = new Date(Date.now() + HEARTBEAT_INTERVAL_MIN * 60000).toISOString();
  const payload = JSON.stringify({ attempt, maxRetry: MAX_RETRY, retryAt, reason, probe: 'sprint2-1-gap1' }).replace(/'/g, "''");
  const msgEsc = message.replace(/'/g, "''");
  sql(`INSERT INTO development_run_events (id, run_id, project_id, task_id, subtask_id, event_type, actor, severity, message, artifact_id, payload, created_at) VALUES ('${evId}', '', '${projectId}', '', '${SUBTASK_ID}', '${eventType}', 'main', '${severity}', '${msgEsc}', '', '${payload}', '${now()}')`);
  console.log(`  ✍ event ${evId} → ${eventType}`);
}

function setSubtaskRetry(attempt, blockers) {
  const retryAt = new Date(Date.now() + HEARTBEAT_INTERVAL_MIN * 60000).toISOString();
  const filtered = blockers.filter((b) => !/^retry:/.test(b));
  filtered.push(`retry:${attempt}:retry_at:${retryAt}:probe`);
  const blockersJson = JSON.stringify(filtered).replace(/'/g, "''");
  sql(`UPDATE development_subtasks SET blockers='${blockersJson}', updated_at='${now()}' WHERE id='${SUBTASK_ID}'`);
  console.log(`  ✍ subtask updated: retry=${attempt}, retry_at=${retryAt}`);
}

function main() {
  const action = process.argv[2] || 'status';
  const t = readSubtask();
  const retry = parseRetryBlocker(t.blockers);
  console.log(`\n=== Sprint2.1 Gap 1 Retry 探针 ===`);
  console.log(`subtask: ${SUBTASK_ID}`);
  console.log(`status: ${t.status}`);
  console.log(`blockers: ${JSON.stringify(t.blockers).slice(0, 200)}`);
  console.log(`retry attempt: ${retry.attempt}/${MAX_RETRY}`);
  console.log(`retry_at: ${retry.retryAt || '(none)'}`);

  if (action === 'status') return;

  if (action === 'simulate-fail') {
    const attempt = retry.attempt + 1;
    console.log(`\n→ 模拟 dispatch 失败, attempt ${attempt}/${MAX_RETRY}`);
    appendRetryEvent(attempt, 'simulated_failure');
    setSubtaskRetry(attempt, t.blockers);
    if (attempt >= MAX_RETRY) {
      console.log(`  ⛔ retry 达到上限 ${MAX_RETRY}, 永久 blocked (探针不会动 auto_run_enabled)`);
    } else {
      console.log(`  ⏳ 临时 blocked, retry_at = now + ${HEARTBEAT_INTERVAL_MIN}min`);
    }
  }

  if (action === 'reset') {
    console.log(`\n→ 重置 retry 状态`);
    const filtered = t.blockers.filter((b) => !/^retry:/.test(b));
    const blockersJson = JSON.stringify(filtered).replace(/'/g, "''");
    sql(`UPDATE development_subtasks SET blockers='${blockersJson}', updated_at='${now()}' WHERE id='${SUBTASK_ID}'`);
    console.log(`  ✓ reset done`);
  }

  if (action === 'verify') {
    const nowMs = Date.now();
    const retryAtMs = retry.retryAt ? Date.parse(retry.retryAt) : 0;
    const isPermanent = retry.attempt >= MAX_RETRY;
    const isDue = retryAtMs > 0 && retryAtMs <= nowMs;
    console.log(`\n→ 验证:`);
    console.log(`  attempt=${retry.attempt}, maxRetry=${MAX_RETRY}, retry_at=${retry.retryAt || '(none)'}`);
    console.log(`  isPermanent=${isPermanent}, isDue=${isDue}`);
    if (isPermanent) {
      console.log(`  结论: PERMANENT BLOCKED — auto-loop 应该不再 retry, owner 介入`);
    } else if (isDue) {
      console.log(`  结论: DUE — auto-loop 下次扫描会扫到这个 subtask, 触发 retry`);
    } else {
      const waitMin = retryAtMs ? Math.ceil((retryAtMs - nowMs) / 60000) : 0;
      console.log(`  结论: WAITING — ${waitMin}min 后 retry`);
    }
  }
}

main();
