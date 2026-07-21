// GoalProgressDashboard — Sprint2.5 NJX 6/15 复盘会用
// 实时进度 + token 消耗 + 产物列表 + 决策弹窗 + 失败恢复
//
// 数据源 (server endpoint):
//   * GET  /api/development/goals/:id/operating-snapshot — status, nextAction, progress
//   * GET  /api/development/goals/:id/evidence-pack     — coverage, artifacts
//   * GET  /api/development/goals/:id/completion-audit  — score, audit checks
//   * GET  /api/development/goals/:id/timeline          — events
//   * GET  /api/development/goals/:id/recovery-packet  — 失败时怎么拉回
//   * GET  /api/development/scheduler/state             — auto-loop / 并行调度
//
// 5s 轮询 (SSE 暂未连进来, 5s 够用), 失败恢复按钮 8 个 (诊断/恢复提示/暂停/重试/终止 等)

import { useEffect, useMemo, useState, useCallback } from "react";

type TokenUsage = {
  used: number;
  budget: number | null;
  perTurn: number;
  source: "events_artifacts_estimate" | "live" | "unavailable";
  note: string;
};

type Artifact = {
  id: string;
  title: string;
  type: string;
  path: string;
  url: string;
  status: string;
  evidenceLevel?: string;
  createdAt: string;
};

type Event = {
  id: string;
  type: string;
  actor: string;
  severity: string;
  message: string;
  createdAt: string;
};

type Audit = {
  passed: boolean;
  score: number;
  checks: { key: string; label: string; passed: boolean; evidence: string }[];
  nextAction?: string;
};

type Recovery = {
  status: "ok" | "degraded" | "blocked" | "unavailable";
  summary: string;
  failureReason?: string;
  recoverySteps?: string[];
  nextCheckAt?: string;
  failureCount?: number;
  staleSeconds?: number;
};

type Props = {
  goalId: string;
  cookie: string;
  onClose?: () => void;
};

const fmt = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

const fmtRel = (sec?: number) => {
  if (sec === undefined || sec === null) return "—";
  if (sec < 60) return `${sec}s 前`;
  if (sec < 3600) return `${Math.round(sec / 60)}m 前`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h 前`;
  return `${Math.round(sec / 86400)}d 前`;
};

async function fetchJson<T>(path: string, cookie: string, init?: RequestInit): Promise<T | null> {
  const r = await fetch(path, {
    ...init,
    headers: { Cookie: `owb_session=${cookie}`, "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  if (!r.ok) return null;
  return (await r.json()) as T;
}

export default function GoalProgressDashboard({ goalId, cookie, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [evidence, setEvidence] = useState<any>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [timeline, setTimeline] = useState<{ events: Event[] } | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>("");
  const [actionRunning, setActionRunning] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [showDecisionModal, setShowDecisionModal] = useState<{ kind: "verify" | "recover" | "retry" | "pause" | "terminate" | null }>({ kind: null });

  // 5s 轮询
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const [snap, ev, au, tl, rec] = await Promise.all([
        fetchJson<any>(`/api/development/goals/${goalId}/operating-snapshot`, cookie),
        fetchJson<any>(`/api/development/goals/${goalId}/evidence-pack`, cookie),
        fetchJson<{ completionAudit: Audit }>(`/api/development/goals/${goalId}/completion-audit`, cookie),
        fetchJson<{ timeline: { events: Event[] } }>(`/api/development/goals/${goalId}/timeline`, cookie),
        fetchJson<{ recovery: Recovery }>(`/api/development/goals/${goalId}/recovery-packet`, cookie)
      ]);
      if (cancelled) return;
      setSnapshot(snap?.snapshot || null);
      setEvidence(ev?.evidencePack || null);
      setAudit(au?.completionAudit || null);
      setTimeline(tl?.timeline || null);
      setRecovery(rec?.recovery || null);
      setLastUpdatedAt(fmt(new Date().toISOString()));
      setLoading(false);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [goalId, cookie]);

  // 决策弹窗: 触发后 server 真的去 action endpoint
  const runAction = useCallback(async (kind: string, message?: string) => {
    setActionRunning(kind);
    setActionResult(null);
    const r = await fetch(`/api/development/goals/${goalId}/actions`, {
      method: "POST",
      headers: { Cookie: `owb_session=${cookie}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: kind, message: message || `NJX 决策: ${kind}` })
    });
    const j = await r.json().catch(() => ({}));
    setActionRunning(null);
    setActionResult(`${kind}: s=${r.status} ${j?.feedback || j?.goal?.status || ""}`);
    setShowDecisionModal({ kind: null });
  }, [goalId, cookie]);

  // token 消耗: 用 evidence events 数量 + goal.tokensUsed 估算
  const token = useMemo<TokenUsage>(() => {
    const events = timeline?.events || [];
    const textEventCount = events.filter((e) => e.type === "tool_result" || e.type === "tool_call" || e.type === "thinking").length;
    const artifactCount = evidence?.artifacts?.length || 0;
    // 估算: 每个 tool_result 约 800 tokens, 每个 artifact 约 500 tokens
    const used = events.filter((e) => e.actor !== "owner").length * 200 + textEventCount * 800 + artifactCount * 500;
    return {
      used,
      budget: snapshot?.goal?.tokenBudget || null,
      perTurn: textEventCount > 0 ? Math.round(used / Math.max(1, textEventCount)) : 0,
      source: "events_artifacts_estimate",
      note: "按 events 数 × 估算, 非实时 LLM API token. 准确 token 需接 LLM gateway usage endpoint."
    };
  }, [timeline, evidence, snapshot]);

  if (loading) {
    return <section className="panel goal-dashboard"><h2>Goal 进度仪表板</h2><p>加载中…</p></section>;
  }

  const goal = snapshot?.goal;
  const progress = snapshot?.progress;
  const artifacts: Artifact[] = evidence?.artifacts || [];
  const events: Event[] = (timeline?.events || []).slice(0, 12);
  const recoveryTone = recovery?.status === "ok" ? "ok" : recovery?.status === "degraded" ? "warn" : "danger";

  return (
    <section className="panel goal-dashboard">
      <div className="panel-head goal-dashboard-head">
        <div>
          <h2>🎯 {goal?.title || "Goal"}</h2>
          <span className="muted">{goal?.id} · 5s 轮询 · 更新 {lastUpdatedAt}</span>
        </div>
        <div className="button-row">
          {onClose && <button className="secondary" onClick={onClose}>关闭</button>}
        </div>
      </div>

      {/* 1. 实时进度 + 状态 */}
      <div className="goal-dashboard-row">
        <div className="goal-dashboard-card">
          <h3>实时进度</h3>
          <div className="goal-progress-bar">
            <div className="goal-progress-fill" style={{ width: `${progress?.percent || 0}%` }} />
          </div>
          <div className="goal-progress-info">
            <strong>{progress?.percent || 0}%</strong>
            <span>· {progress?.passed || 0}/{progress?.total || 0} 子任务通过</span>
            <span>· turn {goal?.turnCount || 0}</span>
            <span>· heartbeat {goal?.heartbeatCount || 0}</span>
          </div>
          <div className="goal-status-pill" data-status={goal?.status}>{goal?.status}</div>
        </div>

        {/* 2. token 消耗 */}
        <div className="goal-dashboard-card">
          <h3>Token 消耗 <small className="muted">({token.source})</small></h3>
          <div className="goal-token-row">
            <strong>{token.used.toLocaleString()}</strong>
            {token.budget && <span>/ {token.budget.toLocaleString()}</span>}
            <span>tokens</span>
          </div>
          <div className="goal-token-sub">
            <span>每 turn ≈ {token.perTurn}</span>
            <span>· 文本事件 {events.filter((e) => ["tool_result", "tool_call", "thinking"].includes(e.type)).length}</span>
          </div>
          <small className="muted">{token.note}</small>
        </div>

        {/* 3. 失败恢复状态 */}
        <div className={`goal-dashboard-card goal-recovery-${recoveryTone}`}>
          <h3>失败恢复 <small className="muted">(gateway_unavailable 检测)</small></h3>
          <div className="goal-recovery-status">
            <span className="goal-recovery-pill" data-status={recovery?.status}>{recovery?.status || "unknown"}</span>
            <span className="muted">{recovery?.summary || "无 recovery packet"}</span>
          </div>
          {recovery?.failureReason && <p className="goal-recovery-reason">⚠️ {recovery.failureReason}</p>}
          {recovery?.recoverySteps && (
            <ol className="goal-recovery-steps">
              {recovery.recoverySteps.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
        </div>
      </div>

      {/* 4. 产物列表 */}
      <div className="goal-dashboard-row">
        <div className="goal-dashboard-card goal-dashboard-artifacts">
          <h3>产物列表 ({artifacts.length})</h3>
          {artifacts.length === 0 ? <p className="muted">暂无产物</p> : (
            <div className="goal-artifact-list">
              {artifacts.slice(0, 20).map((a) => (
                <a key={a.id} className="goal-artifact" href={a.url || `/api/development/artifacts/${a.id}/raw`} target="_blank" rel="noreferrer">
                  <span className={`goal-artifact-level goal-artifact-${a.evidenceLevel || "default"}`}>{a.evidenceLevel?.split("_").pop() || a.type}</span>
                  <span className="goal-artifact-title">{a.title}</span>
                  <span className="muted">{a.path?.split("/").slice(-2).join("/")}</span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* 5. 完成审计 */}
        <div className="goal-dashboard-card">
          <h3>完成审计</h3>
          {audit ? (
            <>
              <div className="goal-audit-summary" data-passed={audit.passed}>
                <strong>{audit.passed ? "✅" : "❌"} {audit.score}/100</strong>
                <span>{audit.passed ? "通过" : "未通过"}</span>
              </div>
              <ul className="goal-audit-checks">
                {audit.checks.map((c) => (
                  <li key={c.key} data-passed={c.passed}>
                    <span>{c.passed ? "✓" : "✗"}</span>
                    <strong>{c.label}</strong>
                    <span className="muted">{c.evidence?.slice(0, 60)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="muted">无 audit</p>}
        </div>
      </div>

      {/* 6. 事件流 + 决策按钮 */}
      <div className="goal-dashboard-row">
        <div className="goal-dashboard-card goal-dashboard-events">
          <h3>事件流 (最近 12 条)</h3>
          <ul className="goal-event-list">
            {events.map((e) => (
              <li key={e.id} data-severity={e.severity}>
                <span className="muted">{fmt(e.createdAt)}</span>
                <span className="goal-event-actor">{e.actor}</span>
                <span className="goal-event-type">{e.type}</span>
                <span className="goal-event-msg">{e.message?.slice(0, 100)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 7. 决策弹窗 — NJX 点哪个弹哪个确认 */}
      <div className="goal-dashboard-actions">
        <h3>决策</h3>
        <div className="button-row">
          <button onClick={() => setShowDecisionModal({ kind: "verify" })} disabled={actionRunning !== null} className="primary">
            ✅ Verify Accept
          </button>
          <button onClick={() => setShowDecisionModal({ kind: "recover" })} disabled={actionRunning !== null} className="secondary">
            🔧 恢复提示
          </button>
          <button onClick={() => setShowDecisionModal({ kind: "retry" })} disabled={actionRunning !== null} className="secondary">
            🔄 重试 (auto_loop retry)
          </button>
          <button onClick={() => setShowDecisionModal({ kind: "pause" })} disabled={actionRunning !== null} className="secondary">
            ⏸ 暂停
          </button>
          <button onClick={() => setShowDecisionModal({ kind: "terminate" })} disabled={actionRunning !== null} className="danger">
            ⛔ 终止
          </button>
        </div>
        {actionResult && <p className="goal-action-result">{actionResult}</p>}
      </div>

      {showDecisionModal.kind && (
        <div className="goal-decision-modal-backdrop" onClick={() => setShowDecisionModal({ kind: null })}>
          <div className="goal-decision-modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认 {showDecisionModal.kind}</h3>
            <p>对 goal <code>{goalId}</code> 触发 <strong>{showDecisionModal.kind}</strong> 决策。</p>
            {showDecisionModal.kind === "verify" && <p>完成后 goal.status → completed (需要 audit score ≥ 75)。</p>}
            {showDecisionModal.kind === "recover" && <p>生成 recovery packet, 触发 gateway health 重新检查 + 自动恢复路径。</p>}
            {showDecisionModal.kind === "retry" && <p>手动 retry_at=NULL, 5min auto-loop 重新触发 dispatch。</p>}
            {showDecisionModal.kind === "pause" && <p>goal.status → paused, auto-loop 停止, 等你恢复。</p>}
            {showDecisionModal.kind === "terminate" && <p>goal 永久 blocked, 不可恢复, 6/15 复盘会前你真要再做。</p>}
            <div className="button-row">
              <button className="secondary" onClick={() => setShowDecisionModal({ kind: null })}>取消</button>
              <button className={showDecisionModal.kind === "terminate" ? "danger" : "primary"} onClick={() => runAction(showDecisionModal.kind!)}>
                确认 {showDecisionModal.kind}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
