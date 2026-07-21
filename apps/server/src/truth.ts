import fs from "node:fs";
import path from "node:path";
import { HOME_DIR, WORKSPACE_DIR, nowIso } from "./config.js";
import type { Db } from "./db.js";
import type { GatewayResult } from "./connectors/gateway.js";

export type TruthMetric<T = unknown> = {
  value: T;
  status: "ok" | "connected" | "unavailable" | "not_configured" | "empty" | "unknown" | "derived";
  source: string;
  updatedAt: string;
  reason?: string;
};

type GatewaySummaryShape = {
  health?: GatewayResult;
  agents?: GatewayResult;
  sessions?: GatewayResult;
  cron?: GatewayResult;
};

const AGENT_ROLES: Record<string, { role: string; name: string; subtitle: string; avatar: string }> = {
  main: { name: "OpenClaw Main", avatar: "OC", role: "系统管理员", subtitle: "系统运维、安全审计、任务调度和最终验收" },
  boss: { name: "AOG Boss", avatar: "B", role: "战略决策者", subtitle: "战略规划、项目管理、价值审计和投资人沟通" },
  worker: { name: "AOG Worker", avatar: "W", role: "执行代理", subtitle: "任务执行闭环、自动化、知识治理和系统运维执行" },
};

export function truthMetric<T>(value: T, status: TruthMetric["status"], source: string, reason?: string): TruthMetric<T> {
  return { value, status, source, updatedAt: nowIso(), ...(reason ? { reason } : {}) };
}

export function isSyntheticRecord(row: unknown) {
  const record = row as Record<string, unknown>;
  const text = safeJson(row);
  if (/PRD11_TEST_/i.test(text)) return true;
  if (String(record?.name || "").trim() === "New cron" && !String(record?.prompt || "").trim()) return true;
  if (String(record?.title || "").trim() === "Untitled task" && !String(record?.description || "").trim()) return true;
  return false;
}

export function filterSyntheticRows<T>(rows: T[]): T[] {
  return rows.filter((row) => !isSyntheticRecord(row));
}

export function loadOpenClawConfig() {
  const file = path.join(HOME_DIR, ".openclaw/openclaw.json");
  if (!fs.existsSync(file)) return { ok: false as const, path: file, config: null, error: "openclaw_config_missing" };
  try {
    return { ok: true as const, path: file, config: JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> };
  } catch (err) {
    return { ok: false as const, path: file, config: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export function agentRuntimeCards(summary: GatewaySummaryShape, tasks: Array<Record<string, unknown>>) {
  return ["main", "boss", "worker"].map((id) => buildAgentRuntime(id, summary, tasks));
}

export function buildAgentRuntime(agentId: string, summary: GatewaySummaryShape, tasks: Array<Record<string, unknown>>) {
  const config = loadOpenClawConfig();
  const cfgAgent = openClawAgentConfig(agentId, config.config);
  const gwAgent = gatewayAgent(agentId, summary);
  const ownTasks = filterSyntheticRows(tasks).filter((task) => task.agent_id === agentId);
  const currentTask = ownTasks.find((task) => ["queued", "running", "pending_approval", "paused", "gateway_unavailable"].includes(String(task.status))) || null;
  const role = AGENT_ROLES[agentId] || { name: agentId, avatar: agentId.slice(0, 2).toUpperCase(), role: "OpenClaw Agent", subtitle: "未配置角色说明" };
  const modelValue = modelLabel(gwAgent) || modelLabel(cfgAgent) || modelLabel(openClawDefaults(config.config)) || "未配置";
  const modelSource = modelLabel(gwAgent) ? "gateway:agents.list" : modelLabel(cfgAgent) ? `${config.path}:agents` : modelLabel(openClawDefaults(config.config)) ? `${config.path}:defaults` : "none";
  const status = summary.health?.ok ? (currentTask ? "busy" : "online") : "offline";
  return {
    id: agentId,
    ...role,
    status,
    currentTask,
    gateway: summary.health?.status || "unknown",
    model: truthMetric(modelValue, modelValue === "未配置" ? "not_configured" : "ok", modelSource, modelValue === "未配置" ? "未找到真实模型绑定" : undefined),
    workspace: truthMetric(String(cfgAgent?.workspace || defaultWorkspace(agentId)), cfgAgent?.workspace ? "ok" : "derived", cfgAgent?.workspace ? `${config.path}:agents` : "workspace-default"),
    agentDir: cfgAgent?.agentDir || cfgAgent?.agent_dir || null,
    capabilities: capabilitiesForAgent(agentId),
    recentMessage: currentTask ? `${currentTask.title || currentTask.id} / ${currentTask.status}` : "暂无运行中任务",
    abnormal: status === "offline"
      ? "Gateway unavailable"
      : ownTasks.some((task) => ["failed", "gateway_unavailable", "blocked"].includes(String(task.status)))
        ? "任务异常"
        : null,
    taskCounts: countBy(ownTasks, "status"),
  };
}

export function buildAgentTruth(db: Db, agentId: string, summary: GatewaySummaryShape) {
  const tasks = filterSyntheticRows(db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT 500").all() as Array<Record<string, unknown>>);
  const runtime = buildAgentRuntime(agentId, summary, tasks);
  const today = localDateKey();
  const messageCount = scalarCount(db, "SELECT COUNT(*) count FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id WHERE s.agent_id = ? AND m.deleted_at IS NULL", agentId);
  const sessionCount = scalarCount(db, "SELECT COUNT(*) count FROM chat_sessions WHERE agent_id = ?", agentId);
  const startedAt = agentStartedAt(agentId);
  return {
    runtime,
    stats: {
      today: scalarCount(db, "SELECT COUNT(*) count FROM tasks WHERE agent_id = ? AND created_at >= ? AND title NOT LIKE 'PRD11_TEST_%'", agentId, today),
      completed: scalarCount(db, "SELECT COUNT(*) count FROM tasks WHERE agent_id = ? AND status = 'completed' AND title NOT LIKE 'PRD11_TEST_%'", agentId),
      running: scalarCount(db, "SELECT COUNT(*) count FROM tasks WHERE agent_id = ? AND status IN ('running', 'queued', 'pending_approval') AND title NOT LIKE 'PRD11_TEST_%'", agentId),
      failed: scalarCount(db, "SELECT COUNT(*) count FROM tasks WHERE agent_id = ? AND status IN ('failed', 'gateway_unavailable', 'blocked') AND title NOT LIKE 'PRD11_TEST_%'", agentId),
      messages: messageCount,
      sessions: sessionCount,
      days: startedAt.days,
      source: {
        messages: "sqlite:chat_messages/chat_sessions",
        sessions: "sqlite:chat_sessions",
        tasks: "sqlite:tasks",
        days: startedAt.source,
      },
    },
    activityBuckets: activityBuckets(db, agentId),
  };
}

export function gatewayCronJobs(summary: GatewaySummaryShape): Array<Record<string, unknown>> {
  const data = summary.cron?.data as Record<string, unknown> | undefined;
  const raw = Array.isArray(data?.jobs) ? data.jobs as Array<Record<string, unknown>> : Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const jobs = raw.length ? raw.map((job, index) => normalizeGatewayCronJob(job, index, "gateway:cron.list")) : gatewayCronFileJobs();
  return jobs;
}

export function localCronJobs(db: Db, agentId?: string) {
  const rows = agentId
    ? db.prepare("SELECT * FROM cron_jobs WHERE agent_id = ? ORDER BY updated_at DESC").all(agentId) as Array<Record<string, unknown>>
    : db.prepare("SELECT * FROM cron_jobs ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...row,
    source: "sqlite:cron_jobs",
    synthetic: isSyntheticRecord(row),
  }));
}

function gatewayCronFileJobs() {
  const file = path.join(HOME_DIR, ".openclaw/cron/jobs.json");
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { jobs?: Array<Record<string, unknown>> };
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    return jobs.map((job, index) => normalizeGatewayCronJob(job, index, `filesystem:${file}`));
  } catch {
    return [];
  }
}

function normalizeGatewayCronJob(job: Record<string, unknown>, index: number, source: string) {
  const id = String(job.id || job.name || `gateway-cron-${index}`);
  const schedule = typeof job.schedule === "object" && job.schedule ? job.schedule as Record<string, unknown> : {};
  const state = typeof job.state === "object" && job.state ? job.state as Record<string, unknown> : {};
  const payload = typeof job.payload === "object" && job.payload ? job.payload as Record<string, unknown> : {};
  const run = latestGatewayCronRun(id);
  const runSummary = String(run?.summary || "");
  const runWarning = /(?:⚠️|failed|error|timed out|失败)/i.test(runSummary) ? runSummary : "";
  const agentId = String(job.agentId || job.agent_id || job.owner || "");
  const enabled = job.enabled;
  const status = String(job.status || (enabled === false ? "disabled" : enabled === true ? "active" : state.lastStatus || run?.status || "unknown"));
  return {
    ...job,
    id,
    agentId,
    owner: job.owner || job.agentId || job.agent_id || "",
    expression: String(job.expression || schedule.expr || schedule.expression || ""),
    status,
    prompt: String(job.prompt || payload.message || ""),
    lastStatus: state.lastStatus || run?.status || "",
    lastError: state.lastError || run?.error || "",
    deliveryWarning: runWarning,
    runSummary,
    lastRunAtMs: state.lastRunAtMs || run?.runAtMs || null,
    nextRunAtMs: state.nextRunAtMs || run?.nextRunAtMs || null,
    source,
  };
}

function latestGatewayCronRun(jobId: string) {
  const file = path.join(HOME_DIR, ".openclaw/cron/runs", `${path.basename(jobId)}.jsonl`);
  if (!fs.existsSync(file)) return null;
  try {
    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function configuredTools() {
  const config = loadOpenClawConfig();
  const tools = config.ok && config.config && typeof config.config.tools === "object" && config.config.tools
    ? Object.entries(config.config.tools as Record<string, unknown>).map(([id, value]) => ({
      id,
      name: id,
      source: `${config.path}:tools`,
      status: value ? "configured" : "disabled",
      toggleable: false,
      enabled: Boolean(value),
      description: "OpenClaw 配置文件中声明的工具入口。",
    }))
    : [];
  const plugins = config.ok && config.config && Array.isArray(config.config.plugins)
    ? (config.config.plugins as Array<Record<string, unknown>>).map((plugin) => ({
      id: String(plugin.id || plugin.name || "plugin"),
      name: String(plugin.name || plugin.id || "plugin"),
      source: `${config.path}:plugins`,
      status: plugin.enabled === false ? "disabled" : "configured",
      toggleable: false,
      enabled: plugin.enabled !== false,
      description: "OpenClaw 插件配置项，前端仅显示真实配置状态。",
    }))
    : [];
  return [...tools, ...plugins];
}

export function enrichSkills<T extends Record<string, unknown>>(skills: T[]) {
  return skills.map((skill) => ({
    ...skill,
    enabled: false,
    toggleable: false,
    enableStatus: "not_configured",
    truthSource: skill.path ? String(skill.path) : String(skill.source || "workspace-rule"),
    reason: "尚未发现 per-agent Skill allowlist；当前只展示可用性，不提供伪启用开关。",
  }));
}

export function unimplementedOutputTypes() {
  return new Set(["audio", "voice", "video", "ppt"]);
}

function scalarCount(db: Db, sql: string, ...params: any[]) {
  return Number((db.prepare(sql).get(...params) as { count?: number } | undefined)?.count || 0);
}

function activityBuckets(db: Db, agentId: string) {
  const dates = Array.from({ length: 49 }, (_, index) => {
    const d = new Date();
    d.setDate(d.getDate() - (48 - index));
    return localDateKey(d);
  });
  const counts = new Map(dates.map((date) => [date, 0]));
  const rows = db.prepare(`
    SELECT substr(m.created_at, 1, 10) day, COUNT(*) count
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE s.agent_id = ? AND m.deleted_at IS NULL AND m.created_at >= ?
    GROUP BY substr(m.created_at, 1, 10)
  `).all(agentId, dates[0]) as Array<{ day: string; count: number }>;
  for (const row of rows) counts.set(row.day, (counts.get(row.day) || 0) + Number(row.count || 0));
  const taskRows = db.prepare(`
    SELECT substr(updated_at, 1, 10) day, COUNT(*) count
    FROM tasks
    WHERE agent_id = ? AND updated_at >= ? AND title NOT LIKE 'PRD11_TEST_%'
    GROUP BY substr(updated_at, 1, 10)
  `).all(agentId, dates[0]) as Array<{ day: string; count: number }>;
  for (const row of taskRows) counts.set(row.day, (counts.get(row.day) || 0) + Number(row.count || 0));
  return dates.map((date) => ({
    date,
    count: counts.get(date) || 0,
    source: "sqlite:chat_messages+tasks",
  }));
}

function agentStartedAt(agentId: string) {
  const candidates = [
    defaultWorkspace(agentId),
    path.join(defaultWorkspace(agentId), "AGENTS.md"),
    path.join(defaultWorkspace(agentId), "MEMORY.md"),
    path.join(HOME_DIR, ".openclaw/agents", agentId),
  ];
  const stats = candidates
    .filter((item) => fs.existsSync(item))
    .map((item) => ({ item, stat: fs.statSync(item) }))
    .filter(({ stat }) => stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs)
    .sort((a, b) => Math.min(a.stat.birthtimeMs || Infinity, a.stat.ctimeMs || Infinity, a.stat.mtimeMs || Infinity) - Math.min(b.stat.birthtimeMs || Infinity, b.stat.ctimeMs || Infinity, b.stat.mtimeMs || Infinity));
  if (!stats.length) return { days: "未接入", source: "none" };
  const best = stats[0];
  const timestamp = Math.min(best.stat.birthtimeMs || Infinity, best.stat.ctimeMs || Infinity, best.stat.mtimeMs || Infinity);
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000) + 1);
  return { days: String(days), source: `filesystem:${best.item}` };
}

function openClawAgentConfig(agentId: string, config: Record<string, unknown> | null) {
  if (!config) return null;
  const agentsRoot = config.agents as Record<string, unknown> | unknown[] | undefined;
  const list = Array.isArray(agentsRoot)
    ? agentsRoot as Array<Record<string, unknown>>
    : Array.isArray((agentsRoot as Record<string, unknown> | undefined)?.list)
      ? (agentsRoot as { list: Array<Record<string, unknown>> }).list
      : [];
  return list.find((agent) => String(agent.id || agent.name || "").toLowerCase() === agentId.toLowerCase()) || null;
}

function openClawDefaults(config: Record<string, unknown> | null) {
  if (!config) return null;
  const agentsRoot = config.agents as Record<string, unknown> | undefined;
  return (agentsRoot?.defaults || config.defaults || config.model || null) as Record<string, unknown> | string | null;
}

function gatewayAgent(agentId: string, summary: GatewaySummaryShape) {
  const data = summary.agents?.data as Record<string, unknown> | unknown[] | undefined;
  const list = Array.isArray(data)
    ? data as Array<Record<string, unknown>>
    : Array.isArray((data as Record<string, unknown> | undefined)?.agents)
      ? (data as { agents: Array<Record<string, unknown>> }).agents
      : [];
  return list.find((agent) => String(agent.id || agent.name || "").toLowerCase() === agentId.toLowerCase()) || null;
}

function modelLabel(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const row = value as Record<string, unknown>;
  const nestedModel = typeof row.model === "object" && row.model ? modelLabel(row.model) : "";
  const provider = String(row.modelProvider || row.provider || row.model_provider || "").trim();
  const model = String(
    (typeof row.model === "string" ? row.model : "") ||
    row.modelId ||
    row.model_id ||
    row.primary ||
    row.primaryModel ||
    row.primary_model ||
    row.defaultModel ||
    row.default_model ||
    nestedModel ||
    ""
  ).trim();
  if (provider && model) return `${provider}/${model}`;
  return model || provider || "";
}

function capabilitiesForAgent(agentId: string) {
  if (agentId === "main") return ["ops", "audit", "memory"];
  if (agentId === "boss") return ["planning", "review", "research"];
  return ["execution", "system_ops", "automation", "nas_recovery", "cron_watchdog"];
}

function defaultWorkspace(agentId: string) {
  if (agentId === "boss") return path.join(WORKSPACE_DIR, "boss_workspace");
  if (agentId === "worker") return path.join(WORKSPACE_DIR, "worker_workspace");
  return WORKSPACE_DIR;
}

function countBy(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] || "unknown");
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return String(value);
  }
}
