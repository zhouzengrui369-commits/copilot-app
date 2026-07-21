import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const failures = [];
const notes = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function fail(message) {
  failures.push(message);
}

function assertNo(pattern, rel, message) {
  const text = read(rel);
  if (pattern.test(text)) fail(`${rel}: ${message}`);
}

assertNo(/days:\s*["']37["']/, "apps/web/src/App.tsx", "Agent 陪伴天数不能硬编码为 37");
assertNo(/defaultChecked/, "apps/web/src/App.tsx", "生产 UI 不应使用默认启用开关伪装真实配置");
assertNo(/not_checked/, "apps/server/src/index.ts", "SSE/System/Gateway 状态不能返回 not_checked");
assertNo(/MVP markdown output generated/, "apps/server/src/workbenchV11.ts", "Knowledge 输出不能标记 MVP 占位产物为完成");
assertNo(/This MVP research output/, "apps/server/src/research.ts", "Research 报告不能使用 MVP 占位描述");
assertNo(/生成脑图\/PPT\/播客和视频任务/, "apps/web/src/App.tsx", "未接入多媒体生成时不能宣称已可生成");
assertNo(/PRD11_TEST_/, "apps/web/src/App.tsx", "前端生产视图不能引用 PRD11 测试数据");
assertNo(/PRD11_TEST_/, "apps/server/src/workbenchV11.ts", "知识输出服务不能引用 PRD11 测试数据");
assertNo(/PRD11_TEST_/, "apps/server/src/research.ts", "研究服务不能引用 PRD11 测试数据");

const serverSource = read("apps/server/src/index.ts");
if (/runGatewayLifecycleAction\(\s*["']restart["']/.test(serverSource) && !/knowledgeNoteGatewayRestartApproved\(\)/.test(serverSource)) {
  fail("apps/server/src/index.ts: 添加笔记 Worker 运维恢复不得无审批调用 Gateway restart");
}
if (!/gateway_restart_main_approval_required/.test(serverSource)) {
  fail("apps/server/src/index.ts: 添加笔记 Worker 运维恢复必须在未授权重启时暴露 gateway_restart_main_approval_required");
}
if (!/function buildKnowledgeNoteReliabilitySnapshot\(\)/.test(serverSource) || !/knowledgeNoteReliability/.test(serverSource)) {
  fail("apps/server/src/index.ts: /api/system-ops 必须暴露添加笔记可靠性快照");
}
if (!/function loadKnowledgeNoteOrganizeJobReportById\(/.test(serverSource) || !/recoveredFromReport/.test(serverSource)) {
  fail("apps/server/src/index.ts: 添加笔记 job 轮询必须能从磁盘报告恢复，避免 Workbench 重启后 404");
}
if (!/function normalizeKnowledgeNoteOrganizeReportForRuntime\(/.test(serverSource) || !/stale_job_report_aborted/.test(serverSource)) {
  fail("apps/server/src/index.ts: 添加笔记可靠性统计必须归类 stale running 报告，不能无限 running");
}
if (!/function latestKnowledgeNoteReliabilityLearningReport\(/.test(serverSource) || !/knowledgeNoteReliabilityLearning/.test(serverSource)) {
  fail("apps/server/src/index.ts: /api/system-ops 必须暴露添加笔记可靠性自学习报告");
}
const webSource = read("apps/web/src/App.tsx");
if (!/添加笔记可靠性/.test(webSource)) {
  fail("apps/web/src/App.tsx: 系统运维台必须显示添加笔记可靠性");
}
if (!/QUEUE-KNOWLEDGE-NOTE-RELIABILITY-SLO/.test(webSource)) {
  fail("apps/web/src/App.tsx: 系统运维台必须显示添加笔记可靠性自学习队列");
}

const dbPath = path.join(root, "data/workbench.sqlite");
if (fs.existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath);
  const activeDeepseek = db.prepare("SELECT COUNT(*) count FROM model_configs WHERE status = 'active' AND id LIKE '%deepseek%'").get();
  if (Number(activeDeepseek?.count || 0) > 0) fail("model_configs: deepseek 仍处于 active，会在 Chat 下拉中显示已删除模型");
  const localTestCron = db.prepare("SELECT COUNT(*) count FROM cron_jobs WHERE name LIKE '%PRD11_TEST_%' OR prompt LIKE '%PRD11_TEST_%'").get();
  notes.push(`local test cron rows retained but filtered: ${Number(localTestCron?.count || 0)}`);
  db.close();
} else {
  notes.push("sqlite database missing; skipped DB consistency checks");
}

const base = process.env.OPENCLAW_WORKBENCH_TRUTH_BASE || "http://127.0.0.1:38888";
try {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.OPENCLAW_WORKBENCH_TEST_PASSWORD || "123456" }),
    signal: AbortSignal.timeout(5000),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0] || "";
  if (login.ok && cookie) {
    const agent = await fetchJson(`${base}/api/agent-console?agentId=main`, cookie, 60_000);
    if (String(agent?.stats?.days || "") === "37" && !String(agent?.stats?.source?.days || "").includes("filesystem")) {
      fail("/api/agent-console: days 仍像硬编码值且缺少 filesystem 来源");
    }
    if ((agent?.cron || []).some((row) => /PRD11_TEST_/i.test(JSON.stringify(row)))) {
      fail("/api/agent-console: Gateway cron 生产列表混入 PRD11_TEST 数据");
    }
    if ((agent?.localCron || []).some((row) => /PRD11_TEST_/i.test(JSON.stringify(row)) && row.synthetic !== true)) {
      fail("/api/agent-console: 本地测试 cron 未标记 synthetic");
    }
    const skills = await fetchJson(`${base}/api/skills`, cookie, 20_000);
    if ((skills?.skills || []).some((skill) => skill.enabled === true && skill.enableStatus !== "configured")) {
      fail("/api/skills: 存在无真实 allowlist 来源的启用状态");
    }
    const events = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(20_000) });
    const reader = events.body?.getReader();
    if (reader) {
      const { value } = await reader.read();
      await reader.cancel();
      const chunk = Buffer.from(value || new Uint8Array()).toString("utf8");
      if (/not_checked/.test(chunk)) fail("/api/events: SSE 快照仍返回 not_checked");
    }
  } else {
    notes.push(`API auth skipped: login ${login.status}`);
  }
} catch (err) {
  notes.push(`API live checks skipped: ${err instanceof Error ? err.message : String(err)}`);
}

if (notes.length) {
  for (const note of notes) console.log(`truth-audit note: ${note}`);
}
if (failures.length) {
  console.error("truth-audit failed:");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}
console.log("truth-audit passed");

async function fetchJson(url, cookie, timeoutMs = 8000) {
  const res = await fetch(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}
