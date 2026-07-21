import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { WORKSPACE_DIR } from "./config.js";

/**
 * Task2 (Sprint1 Day2-3): 桌面验收 Harness 通用化层
 *
 * 旧的 computerUse.ts 仅给微信发消息场景写死(82 行)。
 * 重构目标:把 computer use 抽象成可参数化的 DesktopAction 序列,任何场景
 * (wechat / chrome / vscode / system) 都能用同一套接口跑。每个 action 返回
 * 标准化 evidence,evidence pack 只落 DB(不存 NAS 避免路径耦合)。
 *
 * 设计边界:
 *  - 旧的 computerUseWechatPrepare / computerUseWechatSendApproved / computerUseStatus /
 *    computerUseAudit / computerUsePendingApprovals / computerUseWorkbenchSummary 保持原签名,
 *    路由到新 runComputerUseMcp() 统一 CLI 路径;微信 approve 仍然走 openclaw-computer-use CLI。
 *  - 新的 runDesktopActionSequence() 走 cu MCP,每步拿证据(screenshot + before/after state)。
 *  - 出错必须 throw + 留 stack,不让 goal auto-loop 误以为 ok。
 */

const COMPUTER_USE_DIR = path.join(WORKSPACE_DIR, "openclaw-computer-use");
const LEGACY_CLI_PATH = path.join(COMPUTER_USE_DIR, "cli.mjs");

/** 单个桌面操作的抽象配置。goal metadata 里以 JSON 数组形式存。 */
export type DesktopActionSpec = {
  /** cu MCP 工具名,例如 desktop_screenshot / desktop_window_focus / desktop_left_click */
  tool: string;
  /** cu MCP 工具参数(0-1000 normalized coordinates) */
  args?: Record<string, unknown>;
  /** action 的人类可读标签,用于 evidence pack 展示 */
  label?: string;
  /** 是否把这一步的截图作为最终交付(默认 true;非 screenshot action 也可手动 trigger screenshot-after) */
  captureScreenshot?: boolean;
  /** action 之间的停顿(毫秒),给 UI 动画 / 窗口切换留时间 */
  delayMs?: number;
  /** 自定义超时(毫秒),默认 15s,screenshot 30s */
  timeoutMs?: number;
};

/** 单个 action 执行后产出的标准化证据(可以写进 evidence pack) */
export type DesktopActionEvidence = {
  index: number;
  tool: string;
  label: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  /** base64-encoded PNG;非截图 action 仍可保留(若 captureScreenshot=true) */
  screenshot?: string;
  /** action 前的简短状态描述(尺寸 / 焦点窗口 title / 鼠标位置 等) */
  beforeState?: string;
  /** action 后的简短状态描述 */
  afterState?: string;
  /** 工具原始文本响应(截屏时是 "screenshot ok (WxH)...") */
  textResponse?: string;
  /** 失败时记录的 stack / 错误 */
  error?: string;
};

/** 一个 goal 的桌面验收 evidence pack 整体 */
export type DesktopEvidencePack = {
  goalId: string;
  sessionId: string;
  scenario: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  actions: DesktopActionEvidence[];
  summary: {
    totalActions: number;
    successCount: number;
    failCount: number;
    totalScreenshots: number;
  };
  decisionLog: Array<{
    ts: string;
    phase: "start" | "action" | "fail" | "complete";
    reason: string;
    actionIndex?: number;
  }>;
};

/* ============================================================
 * Legacy CLI bridge (微信 hardcode 路径) — 保持原签名
 * ============================================================ */

function runComputerUse(command: string, params: Record<string, unknown> = {}, timeoutMs = 15_000) {
  const result = spawnSync(process.execPath, [LEGACY_CLI_PATH, command, JSON.stringify(params)], {
    cwd: COMPUTER_USE_DIR,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, error: result.error.message, command, stderr: result.stderr || "" };
  }
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return { ok: false, error: "invalid_json", command, stdout: (result.stdout || "").slice(0, 1000), stderr: result.stderr || "" };
  }
}

export function computerUseStatus() {
  return runComputerUse("status");
}

export function computerUseAudit(limit = 50) {
  return runComputerUse("audit", { limit });
}

export function computerUsePendingApprovals(limit = 80) {
  const audit = computerUseAudit(limit);
  const rows = Array.isArray((audit as { rows?: unknown[] }).rows) ? (audit as { rows: Array<Record<string, unknown>> }).rows : [];
  const approvals = rows
    .filter((row) => row?.result === "approval_required" || row?.status === "approval_required")
    .map((row) => {
      const details = {
        source: "computer_use_audit",
        auditId: row.id,
        actor: row.actor,
        risk: row.risk,
        action: row.action,
        details: row.details,
      };
      return {
        id: `computer-use:${String(row.id || row.ts || Math.random())}`,
        task_id: null,
        action: row.action || "computer_use",
        status: "pending",
        requested_at: row.ts || "",
        details: JSON.stringify(details),
        source: "computer_use_audit",
      };
    });
  return { ok: audit.ok !== false, approvals, source: "computer_use_audit", auditError: (audit as { error?: string }).error };
}

export function computerUseWechatPrepare(recipientName: string, message: string) {
  return runComputerUse("wechat-send", { recipientName, message, mode: "select_only" }, 35_000);
}

export function computerUseWechatSendApproved(recipientName: string, message: string, approvalToken: string) {
  return runComputerUse("wechat-send", {
    recipientName,
    message,
    mode: "approved_send",
    approved: true,
    approvalToken,
  }, 45_000);
}

export function computerUseWorkbenchSummary() {
  const status = computerUseStatus();
  const audit = computerUseAudit(10);
  return {
    status,
    recentActions: Array.isArray((audit as { rows?: unknown }).rows) ? (audit as { rows: unknown[] }).rows : [],
    source: "openclaw-computer-use",
  };
}

/* ============================================================
 * cu MCP bridge — Task2 通用化层
 * ============================================================ */

const IMAGE_PATH_RE = /^\[image saved:\s*(\S+?)(?:\s+\(([^)]+)\))?\s*\]\s*$/m;
const MCP_ERROR_PREFIX = /^MCP error -?\d+/m;
const DEFAULT_ACTION_TIMEOUT_MS = 15_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
const SCREENSHOT_TOOLS = new Set([
  "desktop_screenshot",
  "desktop_screenshot_region",
  "desktop_zoom",
]);

/** 调一次 cu MCP,返回 { ok, text, filePath?, imageBase64?, json?, error? } */
export function runComputerUseMcp(
  tool: string,
  args: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): {
  ok: boolean;
  text: string;
  filePath?: string;
  imageBase64?: string;
  json?: unknown;
  error?: string;
  durationMs: number;
} {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? (SCREENSHOT_TOOLS.has(tool) ? SCREENSHOT_TIMEOUT_MS : DEFAULT_ACTION_TIMEOUT_MS);
  const result = spawnSync("mavis", ["mcp", "call", "cu", tool, JSON.stringify(args)], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  if (result.error) {
    return { ok: false, text: "", error: result.error.message, durationMs };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      text: result.stdout || "",
      error: result.stderr?.toString() || `mavis mcp call cu ${tool} exited with status ${result.status}`,
      durationMs,
    };
  }
  const stdout = result.stdout || "";
  // mavis mcp CLI 把 MCP 协议层错误(validation / not found / internal)回写到 stdout 但 exit 0
  // 这是 MCP 协议惯例(spawn 看不出错误),必须显式嗅探 "MCP error -NNNN" 前缀。
  const mcpErrMatch = stdout.match(MCP_ERROR_PREFIX);
  if (mcpErrMatch) {
    return { ok: false, text: stdout.trim(), error: stdout.trim(), durationMs };
  }
  // screenshot 类工具的 stdout 是 `[image saved: PATH (MIME)]`
  const imageMatch = stdout.match(IMAGE_PATH_RE);
  if (imageMatch) {
    const filePath = imageMatch[1];
    let imageBase64: string | undefined;
    try {
      imageBase64 = fs.readFileSync(filePath).toString("base64");
    } catch (err) {
      return { ok: false, text: stdout, error: `failed to read image ${filePath}: ${(err as Error).message}`, durationMs };
    }
    return { ok: true, text: stdout.trim(), filePath, imageBase64, durationMs };
  }
  // JSON 工具(stdout 是纯 JSON)
  try {
    const json = JSON.parse(stdout);
    return { ok: true, text: stdout.trim(), json, durationMs };
  } catch {
    // 纯文本
    return { ok: true, text: stdout.trim(), durationMs };
  }
}

/** 从 cu MCP JSON 响应里提取简短状态描述(给 evidence.before/afterState) */
function summarizeState(result: { json?: unknown; text?: string; filePath?: string }): string {
  if (result.json && typeof result.json === "object") {
    const obj = result.json as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.action === "string") parts.push(obj.action);
    if (obj.coordinate_system) parts.push(`coords=${String(obj.coordinate_system)}`);
    if (obj.display && typeof obj.display === "object") {
      const d = obj.display as { width?: number; height?: number };
      if (d.width && d.height) parts.push(`display=${d.width}x${d.height}`);
    }
    if (Array.isArray(obj.windows)) parts.push(`windows=${obj.windows.length}`);
    if (obj.focused && typeof obj.focused === "object") {
      const f = obj.focused as { title?: string };
      if (f.title) parts.push(`focused=${f.title}`);
    }
    return parts.join(" · ");
  }
  if (result.filePath) return `screenshot=${path.basename(result.filePath)}`;
  return result.text?.slice(0, 120) || "(no state)";
}

/** 跑一串 DesktopAction,产出 standardized evidence 数组(每步都带 screenshot 如果 captureScreenshot=true) */
export async function runDesktopActionSequence(
  goalId: string,
  sessionId: string,
  actions: DesktopActionSpec[],
  options: { scenario?: string } = {},
): Promise<DesktopActionEvidence[]> {
  const evidence: DesktopActionEvidence[] = [];
  for (let i = 0; i < actions.length; i++) {
    const spec = actions[i];
    if (spec.delayMs && spec.delayMs > 0) {
      const wait = Math.min(spec.delayMs, 5_000);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const startedAt = Date.now();
    const captureScreenshot = spec.captureScreenshot !== false;
    const args = spec.args || {};
    let beforeState: string | undefined;
    let afterState: string | undefined;
    let screenshot: string | undefined;
    let textResponse: string | undefined;
    let ok = false;
    let error: string | undefined;
    try {
      // 1) 可选:截前屏(给 evidence.beforeState 一个锚点)
      if (captureScreenshot) {
        try {
          const pre = runComputerUseMcp("desktop_screenshot", { task_description: `pre-${spec.tool}-${i}` });
          if (pre.ok && pre.imageBase64) {
            beforeState = summarizeState(pre);
          }
        } catch {
          // 前置截图失败不阻塞主 action
        }
      }
      // 2) 真正调 cu MCP
      const result = runComputerUseMcp(spec.tool, args, { timeoutMs: spec.timeoutMs });
      textResponse = result.text;
      afterState = summarizeState(result);
      if (captureScreenshot && !SCREENSHOT_TOOLS.has(spec.tool)) {
        try {
          const post = runComputerUseMcp("desktop_screenshot", { task_description: `post-${spec.tool}-${i}` });
          if (post.ok && post.imageBase64) screenshot = post.imageBase64;
        } catch {
          // 尾随截图失败不阻塞
        }
      } else if (SCREENSHOT_TOOLS.has(spec.tool) && result.imageBase64) {
        screenshot = result.imageBase64;
      }
      ok = result.ok;
      if (!ok) error = result.error;
    } catch (err) {
      error = (err as Error).stack || (err as Error).message;
      ok = false;
    }
    const durationMs = Date.now() - startedAt;
    evidence.push({
      index: i,
      tool: spec.tool,
      label: spec.label || `${spec.tool}#${i}`,
      args,
      ok,
      durationMs,
      screenshot,
      beforeState,
      afterState,
      textResponse,
      error,
    });
    // 任何一步失败:不再继续后续(goal auto-loop 会基于 evidence.failCount 决策)
    if (!ok) break;
  }
  return evidence;
}
