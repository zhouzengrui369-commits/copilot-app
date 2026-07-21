// GoalVerifyTab — Sprint1 Task4: dev-center 长期目标 Verify 验收 Tab
//
// Sprint1 桌面验收 MVP:在目标详情页 Tab 列表(Overview / Plan / Result / Verify /
// Timeline)里挂一个 Verify Tab,让 owner 在 desktop_evidence_pack / goal 证据
// 链到位后做最后人工决策:ACCEPT / REJECT / REQUEST_REDO。
//
// 端点契约:
//   * POST /api/development/goals/<id>/verify/accept → goal.status → completed
//   * POST /api/development/goals/<id>/verify/reject → goal.status → blocked
//   * POST /api/development/goals/<id>/verify/redo   → goal.status → blocked/
//                                                  running,清空 blockers
//
// 数据来源:由父组件传入 evidencePack(GET /api/development/goals/<id>/evidence-
// pack 的响应)。从中抽出 coverage 命中 + artifacts + events + summary,组装成
// "证据项"(每项含 app / action / 时间戳 / diff score,横向 scroll 缩略图)。
// 真实桌面截图 base64 当前未通过 REST 暴露,所以 Verify Tab 用 evidence 包里
// 的 artifacts / coverage / events 充当证据,后续 Sprint2 / desktop verify
// harness 接入后即可直接显示 screenshots,无需改本组件 contract。
//
// 设计约束 (来自 sprint1计划 / openclaw-workbench.md memory):
//  1. 不引入新依赖,依赖原生 fetch + React。
//  2. 不在 App.tsx主体堆叠,独立文件,export default。
//  3. 仅接收 props,不直接访问全局状态。
//  4. 单文件,父组件最小接入成本(挂载 + props)。

import { useEffect, useMemo, useState } from "react";

// 与 App.tsx 中 DevelopmentGoal / DevelopmentGoalEvidencePack / DevelopmentArtifact /
// DevelopmentEvent / DevelopmentGate 的最小子集(避免跨文件 import type 缠绕)
type VerifyGoal = {
  id: string;
  projectId: string;
  title: string;
  objective?: string;
  status: string;
  statusLabel?: string;
  blockers?: string[];
  nextAction?: string;
  completedAt?: string;
  updatedAt?: string;
  createdAt?: string;
};

type VerifyArtifact = {
  id: string;
  title: string;
  type: string;
  path: string;
  url: string;
  status: string;
  evidenceLevel?: string;
  createdAt: string;
};

type VerifyEvent = {
  id: string;
  type: string;
  actor: string;
  severity: string;
  message: string;
  createdAt: string;
};

type VerifyGate = {
  id: string;
  label: string;
  status: string;
  evidence?: string;
};

type VerifyCoverage = {
  criterion: string;
  covered: boolean;
  matched: number;
  total: number;
  evidence: string;
  artifactId?: string;
  eventId?: string;
};

type VerifyEvidencePack = {
  goalId: string;
  projectId: string;
  generatedAt: string;
  coverageScore: number;
  summary: string;
  counts: { criteria: number; coveredCriteria: number; artifacts: number; gates: number; failedGates: number; evidenceEvents: number };
  coverage: VerifyCoverage[];
  missingEvidence: string[];
  blockers: string[];
  artifacts: VerifyArtifact[];
  gates: VerifyGate[];
  events: VerifyEvent[];
};

export type VerifyEvidenceItem = {
  id: string;
  /** 来源类别,用于在 UI 上贴不同 tag */
  kind: "artifact" | "event" | "coverage" | "gate" | "missing";
  /** 缩略图小标题(显示在缩略图底部) */
  title: string;
  /** 主信息行(显示在大图区) */
  detail: string;
  /** app name(从 artifact.type / event.type 推断) */
  app: string;
  /** action 描述(从 event.message / artifact.path 推断) */
  action: string;
  /** 时间戳(ISO) */
  timestamp: string;
  /** 0-100 差分分,基于覆盖 / 失败门禁 / 状态计算 */
  diffScore: number;
  /** 状态标签:covered / missing / failed / passed / info / warn */
  status: "covered" | "missing" | "failed" | "passed" | "info" | "warn";
  /** 是否被覆盖(只对 coverage 项有意义) */
  covered?: boolean;
  /** 可选跳转 URL(artifact 才有) */
  url?: string;
};

export interface GoalVerifyTabProps {
  /** 当前 active goal */
  goal: VerifyGoal;
  /** 目标证据包(可空 —— 由父组件控制何时 fetch 并传入) */
  evidencePack?: VerifyEvidencePack | null;
  /** 是否正在 fetch evidence pack(用于显示 loading 骨架) */
  loadingPack?: boolean;
  /** 父组件繁忙态 —— 置 true 时禁用所有按钮 */
  busy?: boolean;
  /** 决策后通知父组件(让父组件刷 liveDetail / setActiveGoalId 等) */
  onVerify?: (input: { decision: "accept" | "reject" | "redo"; goal: VerifyGoal; reason?: string }) => void;
  /** 父组件希望看到统一 notice */
  onNotice?: (tone: "ok" | "warn" | "error", message: string) => void;
  /** 拉取 evidence pack(可选 —— 父组件可自行 fetch 后传 prop) */
  onRequestEvidencePack?: () => void;
}

type DecisionKind = "accept" | "reject" | "redo";
type LocalBusy = DecisionKind | null;

const REASON_MAX = 240;

function safeNowIso(): string {
  try { return new Date().toISOString(); } catch { return ""; }
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function shortText(text: string, max = 80): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function diffScoreFromCoverage(item: VerifyCoverage): number {
  if (!item.total) return item.covered ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((item.matched / item.total) * 100)));
}

function diffScoreFromGate(gate: VerifyGate): number {
  const status = String(gate.status || "").toUpperCase();
  if (["PASS", "OK", "PASSED"].includes(status)) return 100;
  if (["BLOCKED", "FAIL", "ERROR"].includes(status)) return 0;
  return 50;
}

function deriveEvidenceItems(pack: VerifyEvidencePack | null | undefined): VerifyEvidenceItem[] {
  if (!pack) return [];
  const items: VerifyEvidenceItem[] = [];
  // artifacts: 每个产物 = 1 个证据项
  pack.artifacts.forEach((artifact, idx) => {
    const isImage = /\.(png|jpg|jpeg|gif|webp)$/i.test(artifact.path || artifact.url || "");
    const isReport = /report|delivery|summary/i.test(`${artifact.type} ${artifact.title} ${artifact.path}`);
    const status: VerifyEvidenceItem["status"] = isImage ? "info" : isReport ? "passed" : "covered";
    items.push({
      id: `artifact:${artifact.id || idx}`,
      kind: "artifact",
      title: shortText(artifact.title || artifact.type || `产物 #${idx + 1}`, 36),
      detail: shortText(`${artifact.type || "artifact"} · ${artifact.path}`, 160),
      app: artifact.type || "artifact",
      action: artifact.evidenceLevel ? `${artifact.evidenceLevel} · ${shortText(artifact.path, 60)}` : shortText(artifact.path, 60),
      timestamp: artifact.createdAt || pack.generatedAt,
      diffScore: status === "passed" ? 100 : status === "info" ? 70 : 60,
      status,
      url: artifact.url || undefined,
    });
  });
  // coverage: 每个成功标准 = 1 个证据项
  pack.coverage.forEach((cov, idx) => {
    items.push({
      id: `coverage:${cov.criterion || idx}`,
      kind: "coverage",
      title: shortText(cov.criterion || `成功标准 #${idx + 1}`, 36),
      detail: shortText(cov.evidence, 160),
      app: "success_criterion",
      action: cov.covered ? "覆盖" : "缺证据",
      timestamp: pack.generatedAt,
      diffScore: diffScoreFromCoverage(cov),
      status: cov.covered ? "covered" : "missing",
      covered: cov.covered,
    });
  });
  // events: 每个关键事件 = 1 个证据项
  pack.events.forEach((event, idx) => {
    const severity = String(event.severity || "").toLowerCase();
    const status: VerifyEvidenceItem["status"] =
      severity === "warn" || severity === "high" || severity === "error" ? "warn"
      : severity === "info" ? "info"
      : "covered";
    items.push({
      id: `event:${event.id || idx}`,
      kind: "event",
      title: shortText(event.message || event.type || `事件 #${idx + 1}`, 36),
      detail: shortText(`${event.type} · ${event.actor}`, 160),
      app: event.actor || "system",
      action: event.type,
      timestamp: event.createdAt,
      diffScore: status === "warn" ? 30 : status === "info" ? 80 : 90,
      status,
    });
  });
  // gates: 每个质量门 = 1 个证据项
  pack.gates.forEach((gate, idx) => {
    items.push({
      id: `gate:${gate.id || idx}`,
      kind: "gate",
      title: shortText(gate.label || `门禁 #${idx + 1}`, 36),
      detail: shortText(gate.evidence || gate.status, 160),
      app: "gate",
      action: gate.label || "quality gate",
      timestamp: pack.generatedAt,
      diffScore: diffScoreFromGate(gate),
      status: ["PASS", "OK", "PASSED"].includes(String(gate.status).toUpperCase()) ? "passed" : "failed",
    });
  });
  // missingEvidence: 每个缺失项 = 1 个证据项
  pack.missingEvidence.forEach((missing, idx) => {
    items.push({
      id: `missing:${idx}`,
      kind: "missing",
      title: shortText(missing, 36),
      detail: shortText(missing, 160),
      app: "evidence_gap",
      action: "missing",
      timestamp: pack.generatedAt,
      diffScore: 0,
      status: "missing",
    });
  });
  // 按时间倒序
  items.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  return items;
}

async function callVerifyEndpoint(goalId: string, decision: DecisionKind, body: Record<string, unknown> = {}): Promise<{ ok: boolean; goal?: VerifyGoal; message?: string }> {
  const res = await fetch(`/api/development/goals/${encodeURIComponent(goalId)}/verify/${decision}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const message = [
      data?.message || data?.error || res.statusText,
      data?.stage && `stage=${data.stage}`,
    ].filter(Boolean).join("；");
    const err = new Error(message || `HTTP ${res.status}`);
    (err as Error & { details?: unknown }).details = data;
    throw err;
  }
  return data as { ok: boolean; goal?: VerifyGoal; message?: string };
}

export default function GoalVerifyTab({
  goal,
  evidencePack,
  loadingPack = false,
  busy = false,
  onVerify,
  onNotice,
  onRequestEvidencePack,
}: GoalVerifyTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState<LocalBusy>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRedoDialog, setShowRedoDialog] = useState(false);
  const [redoReason, setRedoReason] = useState("");

  const items = useMemo(() => deriveEvidenceItems(evidencePack), [evidencePack]);
  const counts = useMemo(() => {
    const total = items.length;
    const covered = items.filter((item) => item.status === "covered" || item.status === "passed" || item.status === "info").length;
    const failed = items.filter((item) => item.status === "failed" || item.status === "missing" || item.status === "warn").length;
    return { total, covered, failed };
  }, [items]);

  // 当 evidence pack 变化时,默认选中第一项
  useEffect(() => {
    if (items.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );

  // goal 切换时,关闭弹窗
  useEffect(() => {
    setShowRejectDialog(false);
    setRejectReason("");
    setShowRedoDialog(false);
    setRedoReason("");
  }, [goal.id]);

  const isBusy = busy || decisionBusy !== null;
  const goalIsClosed = goal.status === "completed";
  const goalIsBlocked = goal.status === "blocked";

  async function handleDecision(decision: DecisionKind, body: Record<string, unknown>) {
    if (isBusy) return;
    setDecisionBusy(decision);
    try {
      const data = await callVerifyEndpoint(goal.id, decision, body);
      const updated = data.goal;
      onVerify?.({ decision, goal: updated || goal, reason: typeof body.reason === "string" ? body.reason : undefined });
      const label = decision === "accept" ? "ACCEPT — 已标记为 completed" : decision === "reject" ? "REJECT — 已标记为 blocked" : "REDO — 已重新进入待验收";
      onNotice?.("ok", `${label} · ${updated?.status || goal.status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onNotice?.("error", `${decision.toUpperCase()} 失败：${message}`);
    } finally {
      setDecisionBusy(null);
    }
  }

  function handleAcceptClick() {
    if (isBusy) return;
    if (goalIsClosed) {
      onNotice?.("warn", "目标已是 completed 状态,ACCEPT 无需重复。");
      return;
    }
    void handleDecision("accept", { note: `Verify Tab ACCEPT @ ${safeNowIso()}` });
  }

  function handleRejectSubmit() {
    const reason = rejectReason.trim();
    if (!reason) {
      onNotice?.("warn", "REJECT 必须填写原因。");
      return;
    }
    if (reason.length > REASON_MAX) {
      onNotice?.("warn", `REJECT 原因请控制在 ${REASON_MAX} 字以内。`);
      return;
    }
    void handleDecision("reject", { reason });
    setShowRejectDialog(false);
  }

  function handleRedoSubmit() {
    const reason = redoReason.trim() || "owner 在 Verify Tab 请求重做";
    void handleDecision("redo", { reason });
    setShowRedoDialog(false);
  }

  return (
    <section className="goal-verify-tab" aria-label={`Verify 验收 · ${goal.title}`}>
      <header className="goal-verify-tab-head">
        <div>
          <span className="goal-verify-tab-tag">Verify</span>
          <strong>桌面验收 · 人工决策</strong>
          <small>
            goal id = <code>{goal.id}</code> · status = <code>{goal.status}</code>
            {goalIsClosed && " · 已 completed,ACCEPT 不再生效"}
            {goalIsBlocked && " · 当前 blocked,REJECT 会保留/追加原因"}
          </small>
        </div>
        <div className="goal-verify-tab-summary">
          <span><strong>{counts.total}</strong> evidence</span>
          <span className="ok"><strong>{counts.covered}</strong> covered</span>
          <span className="warn"><strong>{counts.failed}</strong> failed</span>
          {evidencePack && <span>coverage {evidencePack.coverageScore}/100</span>}
        </div>
      </header>

      {loadingPack && !evidencePack && (
        <div className="goal-verify-tab-loading" role="status" aria-live="polite">
          <span className="goal-verify-tab-spinner" aria-hidden="true" />
          <strong>拉取证据包…</strong>
        </div>
      )}

      {!loadingPack && !evidencePack && (
        <div className="goal-verify-tab-empty">
          <strong>尚未拉取证据包</strong>
          <p>点击右侧「拉取证据」按钮,把 coverage / artifacts / events 载入 Verify Tab。</p>
          {onRequestEvidencePack && (
            <button type="button" onClick={onRequestEvidencePack} disabled={busy}>拉取证据</button>
          )}
        </div>
      )}

      {evidencePack && items.length === 0 && (
        <div className="goal-verify-tab-empty">
          <strong>证据包无内容</strong>
          <p>当前 goal 还没有可被验收的证据(coverage / artifacts / events 都为空)。</p>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="goal-verify-tab-strip" role="listbox" aria-label="证据项缩略图(横向 scroll)">
            {items.map((item) => {
              const active = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`goal-verify-tab-thumb ${item.status} ${active ? "active" : ""}`}
                  onClick={() => setSelectedId(item.id)}
                  title={item.title}
                >
                  <span className="goal-verify-tab-thumb-kind">{item.kind}</span>
                  <span className="goal-verify-tab-thumb-title">{item.title}</span>
                  <span className="goal-verify-tab-thumb-score">{item.diffScore}/100</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="goal-verify-tab-detail" aria-label="当前证据项详情">
              <header>
                <span className={`goal-verify-tab-status ${selected.status}`}>{selected.status}</span>
                <strong title={selected.title}>{selected.title}</strong>
                <small>{selected.kind} · {formatDateTime(selected.timestamp)}</small>
              </header>
              <div className="goal-verify-tab-meta">
                <div><span>app</span><strong>{selected.app}</strong></div>
                <div><span>action</span><strong>{selected.action}</strong></div>
                <div><span>timestamp</span><strong>{formatDateTime(selected.timestamp)}</strong></div>
                <div><span>diff score</span><strong>{selected.diffScore}/100</strong></div>
              </div>
              <p className="goal-verify-tab-detail-body">{selected.detail || "（无额外描述）"}</p>
              {selected.url && (
                <a className="goal-verify-tab-artifact-link" href={selected.url} target="_blank" rel="noreferrer noopener">
                  打开产物原文
                </a>
              )}
            </div>
          )}

          <div className="goal-verify-tab-actions">
            <button
              type="button"
              className="primary"
              onClick={handleAcceptClick}
              disabled={isBusy || goalIsClosed}
              title={goalIsClosed ? "目标已是 completed 状态" : "ACCEPT — goal.status → completed"}
              aria-label="ACCEPT 当前 Verify 验收"
            >
              {decisionBusy === "accept" ? "ACCEPT 处理中…" : "ACCEPT · 标记 completed"}
            </button>
            <button
              type="button"
              className="warn"
              onClick={() => setShowRejectDialog(true)}
              disabled={isBusy}
              title="REJECT — goal.status → blocked,需填写原因"
              aria-label="REJECT 当前 Verify 验收"
            >
              {decisionBusy === "reject" ? "REJECT 处理中…" : "REJECT · 弹框填原因"}
            </button>
            <button
              type="button"
              onClick={() => setShowRedoDialog(true)}
              disabled={isBusy}
              title="REQUEST_REDO — 清空 blockers,让 goal 重新进入待验收"
              aria-label="REQUEST_REDO 当前 Verify 验收"
            >
              {decisionBusy === "redo" ? "REDO 处理中…" : "REQUEST_REDO · 重做"}
            </button>
          </div>
        </>
      )}

      {showRejectDialog && (
        <div className="goal-verify-tab-dialog-backdrop" role="dialog" aria-modal="true" aria-label="REJECT 原因">
          <div className="goal-verify-tab-dialog">
            <header>
              <strong>REJECT 当前 Verify 验收</strong>
              <button type="button" onClick={() => setShowRejectDialog(false)} aria-label="关闭">×</button>
            </header>
            <p>请填写拒绝原因(必填,会写入 blockers + 事件 goal_verify_rejected):</p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={4}
              maxLength={REASON_MAX}
              placeholder="例如:截图与目标描述不符,需要重新跑一次桌面验收。"
              autoFocus
            />
            <div className="goal-verify-tab-dialog-footer">
              <span>{rejectReason.length}/{REASON_MAX}</span>
              <div>
                <button type="button" onClick={() => setShowRejectDialog(false)} disabled={decisionBusy !== null}>取消</button>
                <button type="button" className="warn" onClick={handleRejectSubmit} disabled={decisionBusy !== null || !rejectReason.trim()}>
                  确认 REJECT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRedoDialog && (
        <div className="goal-verify-tab-dialog-backdrop" role="dialog" aria-modal="true" aria-label="REDO 原因">
          <div className="goal-verify-tab-dialog">
            <header>
              <strong>REQUEST_REDO · 重做验收</strong>
              <button type="button" onClick={() => setShowRedoDialog(false)} aria-label="关闭">×</button>
            </header>
            <p>可选填原因;若留空,会用默认文案写入 blockers + 事件 goal_verify_redo:</p>
            <textarea
              value={redoReason}
              onChange={(event) => setRedoReason(event.target.value)}
              rows={3}
              maxLength={REASON_MAX}
              placeholder="例如:截图覆盖率不够,需要再触发一次 desktop evidence pack。"
            />
            <div className="goal-verify-tab-dialog-footer">
              <span>{redoReason.length}/{REASON_MAX}</span>
              <div>
                <button type="button" onClick={() => setShowRedoDialog(false)} disabled={decisionBusy !== null}>取消</button>
                <button type="button" className="primary" onClick={handleRedoSubmit} disabled={decisionBusy !== null}>
                  确认 REDO
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
