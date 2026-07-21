import type { Db } from "./db.js";
import { audit } from "./db.js";
import type { DesktopActionEvidence, DesktopEvidencePack } from "./computerUse.js";
import { runDesktopActionSequence } from "./computerUse.js";
import { buildDesktopEvidencePack } from "./evidencePack.js";

/**
 * Task3 (Sprint1 Day3): Goal Auto-Loop 真接通 — evidence pack lifecycle
 *
 * 目标:把 bcb9e977 暴露的 void fire-and-forget hook 升级为 await + 三态 status 流转:
 *   active → evidence_pending → completed
 *   active → evidence_pending → completed (partial_fail, failCount <= totalActions/2)
 *   active → evidence_pending → failed    (failCount > totalActions/2)
 *
 * 失败 case 落 audit_logs (action=development.goal.desktop_evidence_pack_failed) 便于
 * sprint2 audit 工具捞失败 case 不需要 parse details。
 *
 * 设计边界:
 *  - 不动 evidencePack.ts(bcb9e977 文件);lifecycle 逻辑全部在本文件,只 reuse buildDesktopEvidencePack 产 shape
 *  - goal completion hook (index.ts) 调本文件的 runAndPersistWithLifecycle(),await 阻塞
 *  - 返回的 evidencePackOutcome + evidencePackRef 给上层做 status 决策 + response 字段
 *  - retry policy 不实现(Sprint2 范围)
 */

export const EVIDENCE_PACK_FAILED_ACTION = "development.goal.desktop_evidence_pack_failed";

export type EvidencePackOutcome = "completed" | "completed_partial" | "failed";

/** Goal status union we drive via this module. */
export type GoalStatusForEvidence = "active" | "evidence_pending" | "completed" | "failed";

/**
 * Partial-fail policy (Sprint1 Day3 spec 3.1):
 *  - failCount === 0                   → "completed"      (UI: progress=100%, ok)
 *  - failCount > totalActions/2        → "failed"          (UI: 标红,需人工介入)
 *  - otherwise                         → "completed_partial" (UI: 标黄,功能可用,部分子步骤 fail)
 * 边界:totalActions === 0 视为 "failed" (空序列没意义,production 不会发生,只在人工 inject 时出现)
 */
export function deriveEvidencePackOutcome(summary: {
  totalActions: number;
  successCount: number;
  failCount: number;
}): EvidencePackOutcome {
  if (summary.totalActions === 0) return "failed";
  if (summary.failCount === 0) return "completed";
  if (summary.failCount > summary.totalActions / 2) return "failed";
  return "completed_partial";
}

/** Map outcome → goal.status 字符串。 */
export function outcomeToGoalStatus(outcome: EvidencePackOutcome): GoalStatusForEvidence {
  if (outcome === "completed" || outcome === "completed_partial") return "completed";
  return "failed";
}

/** Human-readable status label. */
export function outcomeLabel(outcome: EvidencePackOutcome): string {
  switch (outcome) {
    case "completed": return "全部通过";
    case "completed_partial": return "部分失败(<=50%)";
    case "failed": return "失败(>50%)";
  }
}

export type DesktopActionSpecLite = {
  tool: string;
  args?: Record<string, unknown>;
  label?: string;
  captureScreenshot?: boolean;
  delayMs?: number;
  timeoutMs?: number;
};

/** One-shot helper: 跑 action 序列 + build pack + 落库(包含可选 failed event)。 */
export async function runAndPersistWithLifecycle(input: {
  db: Db;
  goalId: string;
  sessionId: string;
  scenario: string;
  actions: DesktopActionSpecLite[];
  /** Optional pre-built evidence (用于 retry / 自定义 runner 的场景) */
  prebuiltActions?: DesktopActionEvidence[];
  /** Optional override for the persistent action name (default uses evidencePack's constant) */
  persistAction?: string;
}): Promise<DesktopEvidencePack & { outcome: EvidencePackOutcome }> {
  const startedAt = new Date().toISOString();
  let actionsEvidence: DesktopActionEvidence[];
  if (input.prebuiltActions) {
    actionsEvidence = input.prebuiltActions;
  } else {
    actionsEvidence = await runDesktopActionSequence(
      input.goalId,
      input.sessionId,
      input.actions as never, // 复用 bcb9e977 签名
      { scenario: input.scenario },
    );
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
  // 借用 bcb9e977 的 buildDesktopEvidencePack 的 summary,然后 append lifecycle outcome
  const outcome = deriveEvidencePackOutcome(pack.summary);
  const lifecycleAugmented: DesktopEvidencePack & { outcome: EvidencePackOutcome } = {
    ...pack,
    decisionLog: [
      ...pack.decisionLog,
      {
        ts: completedAt,
        phase: outcome === "failed" ? ("fail" as const) : ("complete" as const),
        reason: `lifecycle outcome=${outcome} · ${outcomeLabel(outcome)}`,
      },
    ],
    outcome,
  };
  const riskLevel = outcome === "completed" ? "normal" : outcome === "completed_partial" ? "warn" : "high";
  const persistAction = input.persistAction ?? "development.goal.desktop_evidence_pack";
  audit(input.db, persistAction, "development_goal", input.goalId, riskLevel, {
    pack: lifecycleAugmented,
    outcome,
    partialFail: outcome === "completed_partial",
    signature: `${pack.summary.successCount}/${pack.summary.totalActions} ok · ${pack.summary.totalScreenshots} shots · ${pack.totalDurationMs}ms`,
  });
  if (outcome === "failed" || outcome === "completed_partial") {
    // 失败 + 部分失败:落独立 failed event,便于 sprint2 audit 工具 SELECT
    const failedActions = actionsEvidence
      .filter((a) => !a.ok)
      .map((a) => ({ index: a.index, tool: a.tool, error: a.error || "(no error message)" }));
    audit(input.db, EVIDENCE_PACK_FAILED_ACTION, "development_goal", input.goalId, outcome === "failed" ? "high" : "warn", {
      goalId: input.goalId,
      outcome,
      failCount: pack.summary.failCount,
      totalActions: pack.summary.totalActions,
      failedActions: failedActions.length ? failedActions : undefined,
      reason: failedActions[0]?.error || (outcome === "failed" ? "all actions failed" : "partial failure (some actions failed)"),
    });
  }
  return lifecycleAugmented;
}

/** Read the latest evidence_pack audit_logs row id for a goal (parent sprint2 audit 工具用). */
export function readLatestEvidencePackRef(db: Db, goalId: string): string {
  const row = db
    .prepare(
      "SELECT id FROM audit_logs WHERE action IN (?, ?) AND target_id = ? ORDER BY ts DESC, id DESC LIMIT 1",
    )
    .get("development.goal.desktop_evidence_pack", EVIDENCE_PACK_FAILED_ACTION, goalId) as { id?: number | string } | undefined;
  return row?.id ? String(row.id) : "";
}
