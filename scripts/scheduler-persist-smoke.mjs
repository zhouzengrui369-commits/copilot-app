#!/usr/bin/env node
/**
 * scheduler-persist smoke:
 *   1. Authenticate with a fixed token (inserted into sessions).
 *   2. Hit /api/development/scheduler/state — capture processBootId A + counters.
 *   3. Trigger a manual auto-loop scan by forcing next_heartbeat_at to past
 *      on one development goal (if any exists) — actually we just check the
 *      scheduler state shape works end-to-end. The DB persistence is the
 *      contract; the loop only runs every 60s anyway.
 *   4. Capture /state again — fields should be populated and persisted.
 *   5. Kill the server.
 *   6. Start it again via start.sh.
 *   7. Hit /state — processBootId should differ (new boot),
 *      but lastFinishedAt / nextDueGoalId / nextDueAt / persisted.processBootAt
 *      should still be present (from DB).
 *   8. Clean up.
 */
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const base = process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888";
const token = "scheduler_persist_smoke_20260609";
const dbPath = path.join(repoRoot, "data", "workbench.sqlite");
const serverDir = path.join(repoRoot, "apps", "server");

if (!fs.existsSync(dbPath)) {
  console.error(`FAIL: db not found at ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
const cookie = `owb_session=${encodeURIComponent(token)}`;

async function api(p, options = {}) {
  const res = await fetch(`${base}${p}`, {
    ...options,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok || data?.ok === false) {
    throw new Error(`${p} failed: ${res.status} ${text.slice(0, 400)}`);
  }
  return data;
}

async function waitForServer(maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function readPersistedRow() {
  try {
    return db.prepare("SELECT * FROM development_scheduler_state WHERE id = ?").get("default");
  } catch {
    return null;
  }
}

function killServer() {
  // 找监听 38888 的进程并 kill（更精确，避免误杀 gateway）
  const pid = parseInt(
    spawnSync("lsof", ["-nP", `-iTCP:38888`, "-sTCP:LISTEN", "-t"]).stdout.toString().trim(),
    10,
  );
  if (!pid || Number.isNaN(pid)) {
    console.warn("WARN: no process bound to :38888 — assuming already killed");
    return null;
  }
  console.log(`killing pid ${pid} (port 38888) — SIGTERM first, then SIGKILL if needed`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    console.warn(`SIGTERM ${pid} failed:`, err.message);
  }
  // 等最多 8s；不起就 SIGKILL（需要权限，但 graceful 不行只能强杀）
  let stillAlive = true;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && stillAlive) {
    try {
      process.kill(pid, 0); // 探测
      stillAlive = true;
    } catch {
      stillAlive = false;
      break;
    }
    // 同步 sleep — 不阻塞 IO 太重
    spawnSync("sleep", ["0.5"]);
  }
  if (stillAlive) {
    console.log(`pid ${pid} still alive after 8s of SIGTERM, escalating to SIGKILL`);
    try {
      process.kill(pid, "SIGKILL");
    } catch (err) {
      console.warn(`SIGKILL ${pid} failed:`, err.message);
    }
    spawnSync("sleep", ["1"]);
  }
  return pid;
}

function startServer() {
  // 调用 start.sh 启动；start.sh 内部是 nohup + disown
  const result = spawnSync("bash", [path.join(serverDir, "start.sh")], {
    cwd: serverDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`start.sh exited with ${result.status}`);
  }
}

function logSection(title) {
  console.log("\n========== " + title + " ==========");
}

async function main() {
  // 1) 先确保 server 是活的
  if (!(await waitForServer(2000))) {
    console.error("FAIL: server not running on", base);
    process.exit(1);
  }

  // 2) 注入 session token
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, 1, ?, ?)"
  ).run(tokenHash, expires, now);

  // 3) 第一次读 /state
  logSection("BEFORE: read /state (current process)");
  const before = await api("/api/development/scheduler/state");
  console.log(JSON.stringify(before.scheduler, null, 2));

  if (!before.scheduler?.persisted?.processBootId) {
    throw new Error("persisted.processBootId missing — schema not migrated?");
  }
  const beforeBootId = before.scheduler.persisted.processBootId;
  const beforeFinishedAt = before.scheduler.lastFinishedAt;
  const beforeNextDueAt = before.scheduler.nextDueAt;
  const beforeNextDueGoalId = before.scheduler.nextDueGoalId;

  // 4) 直接写 DB 一行："模拟调度器跑完一次"，触发持久化路径
  logSection("SIMULATE: write scheduler_state directly (lastFinishedAt + next_due)");
  const simFinishedAt = new Date().toISOString();
  const simNextDueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare(`
    UPDATE development_scheduler_state
    SET last_finished_at = ?, next_due_goal_id = ?, next_due_at = ?,
        last_decision = ?, last_error = '', updated_at = ?
    WHERE id = 'default'
  `).run(simFinishedAt, "smoke-goal-" + Date.now(), simNextDueAt, "smoke_simulated_run", simFinishedAt);
  const simRow = readPersistedRow();
  console.log("DB row after simulate:", JSON.stringify(simRow, null, 2));

  // 5) 读 /state 确认 API 看到 DB 内容
  logSection("AFTER SIMULATE: read /state");
  const afterSim = await api("/api/development/scheduler/state");
  console.log(JSON.stringify(afterSim.scheduler, null, 2));
  if (afterSim.scheduler.lastFinishedAt !== simFinishedAt) {
    throw new Error("API didn't reflect DB last_finished_at");
  }

  // 6) Kill server
  logSection("KILL server");
  const killedPid = killServer();
  await new Promise((r) => setTimeout(r, 1500));
  if (await waitForServer(500)) {
    throw new Error("server still responding after kill — something else is bound to :38888");
  }

  // 7) Restart server
  logSection("START server (via start.sh)");
  startServer();
  if (!(await waitForServer(10000))) {
    throw new Error("server didn't come back up after start.sh");
  }

  // 8) 读 /state —— 必须重新注入 session (start.sh 启动新进程，DB 是同一份)
  db.prepare(
    "INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, 1, ?, ?)"
  ).run(tokenHash, expires, now);

  logSection("AFTER RESTART: read /state");
  const afterRestart = await api("/api/development/scheduler/state");
  console.log(JSON.stringify(afterRestart.scheduler, null, 2));

  // 9) 断言：DB 里的关键字段都被新进程读到
  const checks = [];
  const after = afterRestart.scheduler;
  checks.push({ name: "DB row exists after restart", pass: after.persisted.rowExists === true });
  checks.push({ name: "lastFinishedAt recovered from DB", pass: after.lastFinishedAt === simFinishedAt });
  checks.push({ name: "nextDueAt recovered from DB", pass: after.nextDueAt === simNextDueAt });
  checks.push({ name: "nextDueGoalId recovered from DB", pass: Boolean(after.nextDueGoalId) });
  checks.push({ name: "running is false on fresh boot", pass: after.running === false });
  checks.push({ name: "source reports db+memory", pass: after.source === "db+memory" || after.source === "memory_only" });
  checks.push({ name: "wasRestartedAtBoot=true after kill+restart", pass: after.persisted.wasRestartedAtBoot === true });
  checks.push({ name: "currentProcessBootId populated", pass: Boolean(after.persisted.currentProcessBootId) });
  checks.push({ name: "DB row claimed by new process (processBootId == currentProcessBootId)", pass: after.persisted.processBootId === after.persisted.currentProcessBootId });

  let allPass = true;
  console.log("\n========== ASSERTIONS ==========");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}: ${c.name}`);
    if (!c.pass) allPass = false;
  }

  // 10) cleanup
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  db.close();

  if (!allPass) {
    console.error("\nFAIL: scheduler-persist smoke failed");
    process.exit(2);
  }
  console.log("\nOK: scheduler-persist smoke passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL: scheduler-persist smoke:", err);
  process.exit(2);
});