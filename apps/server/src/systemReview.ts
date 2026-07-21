import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HOME_DIR, WORKSPACE_DIR, nowIso } from "./config.js";
import { gatewayCall, gatewaySummary } from "./connectors/gateway.js";
import { sourceStatus } from "./connectors/knowledge.js";

const execFileAsync = promisify(execFile);

type ReviewCheck = {
  category: string;
  name: string;
  status: "ok" | "warn" | "error" | "unknown";
  summary: string;
  details?: unknown;
};

export async function buildConfigReview() {
  const [gatewayRaw, memory, plugins, sandbox, agentsList, resources] = await Promise.all([
    gatewaySummary(),
    runOpenClaw(["memory", "status", "--deep", "--json"], 12_000),
    runOpenClaw(["plugins", "list", "--json"], 10_000),
    runOpenClaw(["sandbox", "explain", "--json"], 10_000),
    gatewayCall("agents.list", {}),
    systemResources(),
  ]);
  const gateway = compactGateway(gatewayRaw);
  const config = readOpenClawConfig();
  const agents = agentWorkspaceReview(config.data);
  const sources = sourceStatus();
  const checks: ReviewCheck[] = [
    {
      category: "gateway",
      name: "OpenClaw Gateway",
      status: gateway.health.ok ? "ok" : "warn",
      summary: gateway.health.ok ? "Gateway 可连接" : "Gateway 不可用或命令失败",
      details: gateway.health,
    },
    {
      category: "config",
      name: "openclaw.json",
      status: config.exists ? "ok" : "warn",
      summary: config.exists ? "运行配置文件存在，已脱敏读取" : "未找到 ~/.openclaw/openclaw.json",
      details: config.data,
    },
    {
      category: "memory",
      name: "Memory deep status",
      status: memory.ok ? "ok" : "warn",
      summary: memory.ok ? "memory status 命令可执行" : "memory status 不可用或返回错误",
      details: memory,
    },
    {
      category: "plugins",
      name: "Plugins",
      status: plugins.ok ? "ok" : "warn",
      summary: plugins.ok ? "plugins list 命令可执行" : "plugins list 不可用或返回错误",
      details: plugins,
    },
    {
      category: "sandbox",
      name: "Sandbox",
      status: sandbox.ok ? "ok" : "unknown",
      summary: sandbox.ok ? "sandbox explain 命令可执行" : "sandbox explain 暂不可用",
      details: sandbox,
    },
    {
      category: "knowledge",
      name: "Knowledge Sources",
      status: Object.values(sources).some((source) => source.status === "connected") ? "ok" : "warn",
      summary: "OpenClaw memory、NAS、IMA 连接状态",
      details: sources,
    },
    {
      category: "agents",
      name: "Agent bindings",
      status: agentsList.ok ? "ok" : "warn",
      summary: agentsList.ok ? "agents.list 可读取" : "agents.list 暂不可用",
      details: agentsList,
    },
  ];
  return {
    ok: true,
    generatedAt: nowIso(),
    workspace: WORKSPACE_DIR,
    resources,
    gateway,
    agents,
    sources,
    checks,
  };
}

function readOpenClawConfig() {
  const configPath = path.join(HOME_DIR, ".openclaw/openclaw.json");
  if (!fs.existsSync(configPath)) return { exists: false, path: configPath, data: null };
  try {
    const data = sanitize(JSON.parse(fs.readFileSync(configPath, "utf8")));
    return { exists: true, path: configPath, data };
  } catch (err) {
    return { exists: true, path: configPath, data: { error: err instanceof Error ? err.message : String(err) } };
  }
}

function agentWorkspaceReview(config: unknown) {
  return ["main", "boss", "worker"].map((id) => {
    const workspace = id === "main" ? WORKSPACE_DIR : path.join(WORKSPACE_DIR, `${id}_workspace`);
    const model = findAgentModel(config, id);
    return {
      id,
      workspace,
      model,
      agentFile: fileState(path.join(workspace, "AGENTS.md")),
      memoryFile: fileState(path.join(workspace, "MEMORY.md")),
      tasksDir: fileState(path.join(workspace, "tasks")),
      archiveDir: fileState(path.join(workspace, "archive")),
      knowledgeDir: fileState(path.join(workspace, "knowledge")),
    };
  });
}

function fileState(target: string) {
  return { path: target, exists: fs.existsSync(target), type: fs.existsSync(target) ? (fs.statSync(target).isDirectory() ? "dir" : "file") : "missing" };
}

function findAgentModel(config: unknown, agentId: string) {
  if (!config || typeof config !== "object") return "unknown";
  const candidates = [
    ["agents", agentId, "model"],
    ["agentBindings", agentId, "model"],
    ["bindings", agentId, "model"],
    [agentId, "model"],
  ];
  for (const pathParts of candidates) {
    let cursor: unknown = config;
    for (const part of pathParts) cursor = cursor && typeof cursor === "object" ? (cursor as Record<string, unknown>)[part] : undefined;
    if (typeof cursor === "string") return cursor;
  }
  const text = JSON.stringify(config);
  if (text.includes("MiniMax-M3")) return "MiniMax-M3";
  if (text.includes("MiniMax-M2.5")) return "MiniMax-M2.5";
  return "unknown";
}

async function runOpenClaw(args: string[], timeoutMs: number) {
  const cli = String(process.env.OPENCLAW_GATEWAY_CLI || "").trim() || "openclaw-cn";
  try {
    const { stdout, stderr } = await execFileAsync(cli, args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
    return { ok: true, command: [cli, ...args].join(" "), data: summarizeCommand(args, parseMaybeJson(stdout)), stderr: redact(stderr).slice(0, 1000) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, command: [cli, ...args].join(" "), error: redact(message).slice(0, 1000) };
  }
}

async function systemResources() {
  const disk = await diskUsage(WORKSPACE_DIR);
  return {
    hostname: safeSystemValue("hostname", () => os.hostname()),
    platform: safeSystemValue("platform", () => os.platform()),
    arch: safeSystemValue("arch", () => os.arch()),
    uptimeSec: safeSystemValue("uptime", () => os.uptime()),
    loadavg: safeSystemValue("loadavg", () => os.loadavg()),
    memory: {
      total: safeSystemValue("totalmem", () => os.totalmem()),
      free: safeSystemValue("freemem", () => os.freemem()),
    },
    disk,
  };
}

function safeSystemValue<T>(name: string, read: () => T): T | { unavailable: true; source: string; error: string } {
  try {
    return read();
  } catch (err) {
    return {
      unavailable: true,
      source: name,
      error: redact(err instanceof Error ? err.message : String(err)).slice(0, 300),
    };
  }
}

async function diskUsage(target: string) {
  try {
    const { stdout } = await execFileAsync("df", ["-k", target], { timeout: 5000, maxBuffer: 256 * 1024 });
    const [, row] = stdout.trim().split(/\r?\n/);
    const parts = row?.split(/\s+/) || [];
    return parts.length >= 6 ? { filesystem: parts[0], totalKb: Number(parts[1]), usedKb: Number(parts[2]), availableKb: Number(parts[3]), capacity: parts[4], mount: parts.slice(5).join(" ") } : { raw: stdout };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function parseMaybeJson(value: string) {
  const text = redact(value.trim());
  if (!text) return null;
  try {
    return sanitize(JSON.parse(text));
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return sanitize(JSON.parse(text.slice(start, end + 1)));
      } catch {
        return text.slice(0, 2000);
      }
    }
    return text.slice(0, 2000);
  }
}

function summarizeCommand(args: string[], data: unknown) {
  if (args[0] === "plugins" && data && typeof data === "object") {
    const plugins = Array.isArray((data as { plugins?: unknown }).plugins) ? (data as { plugins: Array<Record<string, unknown>> }).plugins : [];
    return {
      workspaceDir: (data as { workspaceDir?: unknown }).workspaceDir,
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        enabled: plugin.enabled,
        status: plugin.status,
        origin: plugin.origin,
        toolCount: Array.isArray(plugin.toolNames) ? plugin.toolNames.length : 0,
      })),
    };
  }
  if (args[0] === "memory" && Array.isArray(data)) {
    return data.map((row) => {
      const item = row as Record<string, any>;
      return {
        agentId: item.agentId,
        files: item.status?.files,
        chunks: item.status?.chunks,
        dirty: item.status?.dirty,
        backend: item.status?.backend,
        vector: item.status?.vector?.available,
        fts: item.status?.fts?.available,
        embeddingProbe: item.embeddingProbe?.ok,
        scanIssues: item.scan?.issues?.length || 0,
      };
    });
  }
  return data;
}

function compactGateway(summary: Awaited<ReturnType<typeof gatewaySummary>>) {
  const agents = Array.isArray((summary.agents.data as { agents?: unknown })?.agents)
    ? ((summary.agents.data as { agents: Array<{ id?: string }> }).agents || []).map((agent) => ({ id: agent.id }))
    : [];
  const sessions = Array.isArray((summary.sessions.data as { sessions?: unknown })?.sessions)
    ? (summary.sessions.data as { sessions: unknown[] }).sessions.length
    : undefined;
  const cron = Array.isArray((summary.cron.data as { jobs?: unknown })?.jobs)
    ? (summary.cron.data as { jobs: unknown[] }).jobs.length
    : undefined;
  return {
    health: { ok: summary.health.ok, status: summary.health.status, error: summary.health.error },
    agents: { ok: summary.agents.ok, status: summary.agents.status, agents },
    sessions: { ok: summary.sessions.ok, status: summary.sessions.status, count: sessions },
    cron: { ok: summary.cron.ok, status: summary.cron.status, count: cron },
  };
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return typeof value === "string" ? redact(value) : value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = /token|secret|password|credential|api[_-]?key|session|auth/i.test(key) ? "[redacted]" : sanitize(inner);
  }
  return out;
}

function redact(value: string) {
  return value
    .replace(/[a-f0-9]{32,}/gi, "[redacted]")
    .replace(/(token|api[_-]?key|secret|password|credential|authorization)=\S+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}
