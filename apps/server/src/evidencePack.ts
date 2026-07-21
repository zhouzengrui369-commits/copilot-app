import type { Db } from "./db.js";
import { audit } from "./db.js";
import type { DesktopActionEvidence, DesktopEvidencePack } from "./computerUse.js";
import { runDesktopActionSequence } from "./computerUse.js";

/**
 * Task2 (Sprint1 Day2-3): 桌面验收 evidence pack
 *
 * 一份 DesktopEvidencePack 描述一次 goal 完成时的桌面验收全过程(操作序列 +
 * 截图 + 决策日志)。目标:Sprint1 「桌面验收证据链」无需人工跑 cu,goal 完成
 * 自动产出一份可审计、可回放、可对比的 evidence。
 *
 * 落库方式:复用 audit_logs(append-only),action="development.goal.desktop_evidence_pack"。
 * 不存 NAS(避免路径耦合);纯 base64 inline 存进 details JSON 字段。
 */

export const DESKTOP_EVIDENCE_PACK_ACTION = "development.goal.desktop_evidence_pack";

export type DesktopActionSpec = {
  tool: string;
  args?: Record<string, unknown>;
  label?: string;
  captureScreenshot?: boolean;
  delayMs?: number;
  timeoutMs?: number;
};

export type { DesktopActionEvidence, DesktopEvidencePack };

/** Build a fully-populated DesktopEvidencePack from raw action evidence. */
export function buildDesktopEvidencePack(input: {
  goalId: string;
  sessionId: string;
  scenario: string;
  startedAt: string;
  completedAt: string;
  actions: DesktopActionEvidence[];
}): DesktopEvidencePack {
  const successCount = input.actions.filter((a) => a.ok).length;
  const failCount = input.actions.length - successCount;
  const totalScreenshots = input.actions.filter((a) => Boolean(a.screenshot)).length;
  const totalDurationMs = input.actions.reduce((sum, a) => sum + a.durationMs, 0);
  const decisionLog: DesktopEvidencePack["decisionLog"] = [
    { ts: input.startedAt, phase: "start", reason: `开始桌面验收 scenario=${input.scenario} actions=${input.actions.length}` },
    ...input.actions.map((a) => ({
      ts: new Date(new Date(input.startedAt).getTime() + input.actions.slice(0, a.index).reduce((s, x) => s + x.durationMs, 0)).toISOString(),
      phase: a.ok ? "action" as const : "fail" as const,
      reason: a.ok ? `${a.tool} ok · ${a.afterState || ""}`.trim() : `${a.tool} FAILED · ${a.error || ""}`.trim(),
      actionIndex: a.index,
    })),
  ];
  // 完成时
  if (failCount === 0) {
    decisionLog.push({
      ts: input.completedAt,
      phase: "complete",
      reason: `全部 ${input.actions.length} 步通过,screenshots=${totalScreenshots}`,
    });
  } else {
    decisionLog.push({
      ts: input.completedAt,
      phase: "complete",
      reason: `${failCount}/${input.actions.length} 步失败,提前终止(避免污染后续状态)`,
    });
  }
  return {
    goalId: input.goalId,
    sessionId: input.sessionId,
    scenario: input.scenario,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    totalDurationMs,
    actions: input.actions,
    summary: {
      totalActions: input.actions.length,
      successCount,
      failCount,
      totalScreenshots,
    },
    decisionLog,
  };
}

/** Persist the pack to audit_logs. Returns the audit row id (best-effort, may be null on db error). */
export function persistDesktopEvidencePack(
  db: Db,
  pack: DesktopEvidencePack,
  options: { riskLevel?: string } = {},
): string {
  const risk = options.riskLevel ?? (pack.summary.failCount === 0 ? "normal" : "high");
  const details = {
    pack,
    // 留一个简短 signature 便于 SELECT 后直接肉眼读
    signature: `${pack.summary.successCount}/${pack.summary.totalActions} ok · ${pack.summary.totalScreenshots} shots · ${pack.totalDurationMs}ms`,
  };
  audit(db, DESKTOP_EVIDENCE_PACK_ACTION, "development_goal", pack.goalId, risk, details);
  // 取刚插入的 row id(actor='owner' filter 缩短范围)
  const row = db
    .prepare(
      "SELECT id FROM audit_logs WHERE action = ? AND target_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
    )
    .get(DESKTOP_EVIDENCE_PACK_ACTION, pack.goalId) as { id?: number | string } | undefined;
  return row?.id ? String(row.id) : "";
}

/** One-shot helper: run a desktop action sequence + build + persist the evidence pack. */
export async function runDesktopVerifyAndPersist(input: {
  db: Db;
  goalId: string;
  sessionId: string;
  scenario: string;
  actions: DesktopActionSpec[];
  onError?: (err: Error) => void;
}): Promise<DesktopEvidencePack> {
  const startedAt = new Date().toISOString();
  let actionsEvidence: DesktopActionEvidence[] = [];
  let buildError: string | undefined;
  try {
    actionsEvidence = await runDesktopActionSequence(input.goalId, input.sessionId, input.actions, {
      scenario: input.scenario,
    });
  } catch (err) {
    buildError = (err as Error).stack || (err as Error).message;
    if (input.onError) input.onError(err as Error);
  }
  const completedAt = new Date().toISOString();
  const pack = buildDesktopEvidencePack({
    goalId: input.goalId,
    sessionId: input.sessionId,
    scenario: input.scenario,
    startedAt,
    completedAt,
    actions: actionsEvidence,
  });
  if (buildError) {
    pack.decisionLog.push({ ts: completedAt, phase: "fail", reason: `runner exception: ${buildError}` });
  }
  // 落库 — 即便 fail 也要留痕
  try {
    persistDesktopEvidencePack(input.db, pack);
  } catch (err) {
    if (input.onError) input.onError(err as Error);
  }
  return pack;
}

/** Read the goal.metadata JSON and extract desktopActions. Returns [] when absent or malformed. */
export function readGoalDesktopActions(goalMetadataJson: string | null | undefined): DesktopActionSpec[] {
  if (!goalMetadataJson) return [];
  try {
    const meta = JSON.parse(goalMetadataJson) as { desktopActions?: unknown };
    if (!Array.isArray(meta.desktopActions)) return [];
    return meta.desktopActions
      .filter((x): x is DesktopActionSpec => Boolean(x && typeof x === "object" && typeof (x as { tool?: unknown }).tool === "string"))
      .map((x) => ({
        tool: x.tool,
        args: x.args && typeof x.args === "object" ? (x.args as Record<string, unknown>) : undefined,
        label: typeof x.label === "string" ? x.label : undefined,
        captureScreenshot: typeof x.captureScreenshot === "boolean" ? x.captureScreenshot : true,
        delayMs: typeof x.delayMs === "number" ? x.delayMs : undefined,
        timeoutMs: typeof x.timeoutMs === "number" ? x.timeoutMs : undefined,
      }));
  } catch {
    return [];
  }
}
