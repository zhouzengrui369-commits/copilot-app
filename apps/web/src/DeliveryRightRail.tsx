// React import (useState/useEffect for STATUS 时间戳)
import { useEffect, useState } from "react";
import { compactPathLabel } from "./deliveryShared";

// DeliveryRightRail — 开发台右栏 (Sprint2 三栏布局重构)
//
// 职责 (对标 Codex / MiniMax Code 三栏 UI):
//   * 顶部: 当前 goal 标题 + 进度条 + token 消耗 (来自 events×800 估算)
//   * 中部: 进度可视化 (Goal Evidence Console + Goal Ledger + Tabs + Timeline)
//   * 底部: 决策按钮区 (Verify / Recovery / Completion Audit / Learning Review)
//
// 数据契约 (从 props.data 传入, App.tsx 在 DeliveryCore 里计算):
//   data.activeGoal, data.goalTimeline, data.goalRunway, data.goalContinuationContract,
//   data.goalEvidencePack, data.goalCompletionAudit, data.goalLearningReview,
//   data.goalDispatchRecovery, data.goalRecoveryPacket, data.goalCodexParity,
//   data.goalSectionTab, data.activeGoalMissionControl, data.activeGoalOperatingSnapshot,
//   data.goals, data.subtasks, data.documents, data.artifacts, data.reviews,
//   data.gates, data.toolRegistry, data.pluginRegistry, data.capabilityHealth,
//   data.project, data.baseline, data.activeSubtask, data.activeWorkPacket,
//   data.estimatedTokenUsage, data.outputCharacterCount, data.artifactCount,
//   data.developmentDocumentCount, data.developmentLogQuery, data.displayedLogRows,
//   data.shortCount (helper), data.goalEvidenceConsole* (computed view-models)
//
// 动作契约 (从 props.actions 传入):
//   actions.openDocumentPreview, actions.openEvidencePreview, actions.setGoalNotice,
//   actions.setComposerNotice, actions.setActiveSubtaskId, actions.setActiveEvidence,
//   actions.setActiveGoalId, actions.setActiveWorkPacketId, actions.setGoalSectionTab,
//   actions.runGoalSnapshotAction, actions.runGoalRunwayAction, actions.runGoalTimelineAction,
//   actions.runGoalContinuationPrimaryAction, actions.loadGoalRunway, actions.loadGoalTimeline,
//   actions.loadGoalContinuationContract, actions.loadGoalEvidencePack,
//   actions.loadGoalRecoveryPacket, actions.loadGoalCompletionAudit,
//   actions.loadGoalLearningReview, actions.commitGoalContinuationContract,
//   actions.setDevelopmentLogQuery, actions.setGoalCreateOpen,
//   actions.goalContinuationPrimaryLabel (helper), actions.startPreviewResize,
//   actions.generateBaseline, actions.lockBaseline, actions.runShadow, actions.runCurrentSubtask
//
// 设计约束:
//   * props 使用 any, 避免与 App.tsx 巨型类型强耦合
//   * 渲染复用现有 .development-board-column + .development-board-* CSS (不删, 只加 .delivery-right-rail)
//   * 不引新依赖
//
import GoalVerifyTab from "./GoalVerifyTab";

export interface DeliveryRightRailProps {
  data: any;
  actions: any;
}

function cleanEvidenceSummary(value: unknown, fallback: string) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const containsRawThinking = /<think>|<\/think>|The user is asking me|调用工具：|工具返回：/i.test(raw);
  const withoutThink = raw
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, " ")
    .replace(/The user is asking me[\s\S]*/gi, " ")
    .replace(/调用工具：[\s\S]*?(?:工具返回：|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const onlyRawPrefix = /(?:OpenClaw\s+\S+\s+代理(?:最终)?回写|代理(?:最终)?回写)\s*[:：]?\s*$/i.test(withoutThink);
  if (onlyRawPrefix || (containsRawThinking && withoutThink.length < 40)) {
    return "原始代理思考已折叠。请查看 GOAL / PRD / RESULT 或证据包中的结构化结论。";
  }
  const text = withoutThink || raw.replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

// KpiHero — 右栏顶部独立 KPI 卡片
// 左半: 当前 goal 标题 + 进度条 + N/M 子任务 · turn · heartbeat
// 右半: token 消耗估算 + 每 turn 平均 + 事件数
// 兜底: 没有 activeGoal 时显示 "暂无目标" + token 数字照常
function KpiHero({ data: d }: { data: any }) {
  const progressPercent = Math.max(
    0,
    Math.min(100, Number(d?.baseline?.progress?.percent ?? d?.activeGoal?.progressPercent ?? 0) || 0),
  );
  const passedSubtasks = Number(d?.baseline?.progress?.passed ?? 0);
  const totalSubtasks = Number(d?.baseline?.progress?.total ?? 0);
  const turnCount = Number(d?.activeGoal?.turnCount ?? 0);
  const heartbeatCount = Number(d?.activeGoal?.heartbeatCount ?? 0);

  const goalTitle =
    d?.activeGoalMissionControl?.label ||
    d?.activeGoalFullTitle ||
    d?.activeGoalDisplayTitle ||
    d?.activeGoal?.title ||
    "暂无目标";

  const estimatedTokenUsage = Math.max(0, Number(d?.estimatedTokenUsage ?? 0) || 0);
  const actualTokensUsed = Number(d?.activeGoal?.tokensUsed ?? NaN);
  const tokenBudget = d?.activeGoal?.tokenBudget === null || d?.activeGoal?.tokenBudget === undefined ? null : Number(d.activeGoal.tokenBudget);
  const hasActualTokenUsage = Number.isFinite(actualTokensUsed) && actualTokensUsed > 0;
  const tokenUsage = hasActualTokenUsage ? Math.max(0, actualTokensUsed) : estimatedTokenUsage;
  const eventCount = Math.max(0, Number(d?.eventStats?.totalCount ?? 0) || 0);
  const avgPerTurn = turnCount > 0 ? Math.round(tokenUsage / turnCount) : 0;
  const formatTokens = (value: number) => d?.shortCount ? d.shortCount(value) : value.toLocaleString();
  const tokenBudgetLabel = Number.isFinite(tokenBudget || NaN) && Number(tokenBudget) > 0 ? ` / ${formatTokens(Number(tokenBudget))}` : "";

  return (
    <section className="delivery-right-rail-kpi-hero" aria-label="右栏顶部 KPI 总览">
      {/* 左: 目标进度 */}
      <div className="kpi-block">
        <span className="kpi-label">目标进度</span>
        <strong className="kpi-title" title={d?.activeGoalFullTitle || goalTitle}>
          {goalTitle}
        </strong>
        <div className="progress-track" aria-label="目标进度条" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
          <i className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <small className="kpi-sub">
          {passedSubtasks}/{totalSubtasks} 子任务通过 · {progressPercent}% · {turnCount} turns · {heartbeatCount} heartbeats
        </small>
      </div>
      {/* 右: Token 消耗 */}
      <div className="kpi-block">
	        <span className="kpi-label">{hasActualTokenUsage ? "Token 消耗" : "Token 消耗估算"}</span>
        <div>
          <strong className="kpi-value">{formatTokens(tokenUsage)}{tokenBudgetLabel}</strong>
          <span className="kpi-sub" style={{ marginLeft: 6 }}>{hasActualTokenUsage ? "tokens" : "est. tokens"}</span>
        </div>
        <small className="kpi-sub">
          {hasActualTokenUsage ? `预算字段来自 Goal Run · 估算 ${formatTokens(estimatedTokenUsage)}` : "由运行日志字符数估算"} · ~{formatTokens(avgPerTurn)}/turn · {eventCount > 0 ? `${eventCount} events` : "等待事件统计"}
        </small>
      </div>
    </section>
  );
}

export default function DeliveryRightRail({ data, actions }: DeliveryRightRailProps) {
  const d = data;
  const a = actions;

  // === STATUS strip ===
  // Codex aesthetic: small caps STATUS label + 实时在线 chip + 实时时间戳。
  // 不依赖 SSE 链路 (开发台走 polling, 没有 stream.connected); 用本地时间戳表示"心跳时刻"。
  // Gateway 连接态从 capabilityHealth 派生: 任一 capability 不是 error 即视为 connected (开发台直连 fastify)。
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 实时在线信号必须来自明确运行态证据，而不是“项目数据加载过”。
  // Codex 级 inspector 不能把 stale payload 伪装成 Gateway connected。
  const liveSnapshot = d?.live?.snapshot || null;
  const liveSnapshotTs = liveSnapshot?.ts ? Date.parse(String(liveSnapshot.ts)) : 0;
  const liveSnapshotFresh = liveSnapshotTs > 0 && Date.now() - liveSnapshotTs < 45_000;
  const liveOnline = d?.live?.connected === true && liveSnapshotFresh;
  const capabilityList = Array.isArray(d?.capabilityHealth) ? d.capabilityHealth : [];
  const gatewayCapabilitySignals = capabilityList.filter((cap: any) => /gateway|workbench|backend|sse|event_stream/i.test(`${cap?.key || ""} ${cap?.label || ""}`));
  // 只有真实连接错误、SSE snapshot 明确 gateway.reachable=false、或 gateway/backend capability 错误才显示 down。
  const explicitGatewayDown = liveSnapshot?.gateway?.reachable === false;
  const agentRuntime = d?.agentRuntimeHealth || {};
  const agentGatewayDown = agentRuntime?.gatewayOk === false || agentRuntime?.blocked === true;
  const gatewayDown = Boolean(d?.detailStateError) || explicitGatewayDown || agentGatewayDown || gatewayCapabilitySignals.some((cap: any) => String(cap?.tone || "").toLowerCase() === "error");
  const gatewayVerified = liveOnline && !gatewayDown;
  const gatewayLabel = gatewayDown ? "Gateway down" : gatewayVerified ? "Gateway connected" : "Gateway checking";
  const gatewayTitle = gatewayDown
    ? agentRuntime?.healthError || agentRuntime?.abnormal || "Gateway/backend/event stream reported an error"
    : gatewayVerified
      ? `SSE snapshot fresh: ${liveSnapshot?.ts || "unknown"}`
      : d?.live?.connected
        ? "SSE connected but no fresh runtime snapshot yet"
        : "SSE is not connected; Gateway status is still checking";

  const stamp = now.toLocaleString("zh-CN", { hour12: false });
  const changeItems = Array.isArray(d.codexChangeItems) ? d.codexChangeItems.slice(0, 5) : [];
  const taskStatus = d.activeSubtask?.status || d.activeGoal?.status || d.baseline?.status || d.project?.status || "waiting";
  const taskTone = d.developmentTone ? d.developmentTone(taskStatus) : d.selectedStatusTone;
  const taskTitle = d.activeSubtask
    ? `${String(d.activeSubtask.sequence).padStart(3, "0")} ${d.activeSubtask.title}`
    : d.activeGoalDisplayTitle || d.activeWorkPacket?.title || d.project?.name || "未选择任务";
  const nextAction = cleanEvidenceSummary(d.activeSubtask?.blockers?.[0]
    || d.activeGoal?.nextAction
    || d.activeWorkPacket?.nextAction
    || "", "运行当前子任务或补齐目标证据。");
  const goalEvidenceSummary = cleanEvidenceSummary(
    d.activeGoalMissionControl?.why || d.goalRuntimeCapsuleWhy,
    "等待目标证据生成。",
  );
  const outputItems = (() => {
    const seen = new Set<string>();
    const rows: any[] = [];
    const push = (item: any) => {
      const key = String(item?.key || item?.id || item?.path || item?.title || "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      rows.push(item);
    };
    changeItems.forEach((item: any) => push({
      key: item.key,
      label: item.label,
      title: item.title || item.path,
      path: item.path,
      added: item.added,
      removed: item.removed,
      tone: item.status === "missing" ? "warn" : "ok",
      evidenceId: item.evidenceId,
      documentKey: item.documentKey,
    }));
    (Array.isArray(d.artifacts) ? d.artifacts : []).slice(0, 6).forEach((artifact: any) => push({
      key: `artifact-${artifact.id}`,
      label: artifact.type || "artifact",
      title: artifact.title || artifact.path,
      path: artifact.path || artifact.url,
      tone: d.developmentTone ? d.developmentTone(artifact.status || "ready") : "ok",
      evidenceId: artifact.id,
    }));
    (Array.isArray(d.goalEvidenceConsoleArtifacts) ? d.goalEvidenceConsoleArtifacts : []).slice(0, 4).forEach((artifact: any) => push({
      key: `goal-${artifact.id}`,
      label: artifact.label || "goal",
      title: artifact.title,
      path: artifact.detail,
      tone: "ok",
      evidenceId: artifact.id,
    }));
    return rows.slice(0, 8);
  })();
  const goalOs = d?.goalOs || {};
  const goalOsPreflight = goalOs?.preflight || goalOs?.latestRun?.preflight || null;
  const goalOsChecks = Array.isArray(goalOsPreflight?.checks) ? goalOsPreflight.checks : [];
  const goalOsBlocked = goalOs?.status === "blocked_preflight" || goalOsPreflight?.ok === false;
  const goalOsReady = goalOsPreflight?.ok === true || goalOs?.canDispatch === true;
  const goalOsTone = goalOsBlocked ? "blocked" : goalOsReady ? "ok" : "warn";
  const goalOsLabel = goalOsBlocked ? "blocked_preflight" : goalOsReady ? "preflight_ready" : goalOs?.status || "not_initialized";
  const goalOsReason = goalOsBlocked
    ? (goalOs?.blockingReason || goalOsPreflight?.blockers?.[0] || "Goal OS preflight 未通过。")
    : goalOsReady
      ? "执行通道已通过最新 preflight。"
      : "尚未运行 Goal OS preflight。";
  const goalOsRepairActions = Array.isArray(goalOsPreflight?.repairActions) ? goalOsPreflight.repairActions : [];

  if (d.rightRailCollapsed) {
    return (
      <aside className="development-board-column delivery-right-rail delivery-right-rail-collapsed" aria-label="开发台右栏已折叠">
        <button type="button" className="delivery-right-rail-expand" onClick={a.toggleRightRail} aria-label="展开右栏" title="展开右栏">›</button>
        <span>STATUS</span>
        <strong>{d.shortCount ? d.shortCount(d.estimatedTokenUsage || 0) : d.estimatedTokenUsage || 0}</strong>
        <em>{goalOsBlocked ? "preflight blocked" : agentRuntime?.gatewayOk === false ? "gateway down" : `${outputItems.length} outputs`}</em>
      </aside>
    );
  }

  return (
    <aside className="development-board-column delivery-right-rail" aria-label="开发台右栏">
      {/* Resizer handle — positioned absolute, not a grid sibling.
          修复: 之前 <button> 是 <> fragment 的顶层 sibling, 与 <aside> 一起作为 .delivery-three-column 的
          第 3/4 个 grid child, 导致 aside 被挤到 row2 col1 (260px). 现在 button 移到 aside 内部,
          用 position:absolute 浮在右栏左缘 (-4px), 不再占 grid cell. */}
      <button
        className="development-preview-resizer"
        type="button"
        aria-label="调整项目看板宽度"
        onPointerDown={a.startPreviewResize}
      />
      {/* === STATUS strip (顶置, 小字 small caps; 对标 Codex 顶部 "环境信息 / 变更 / 本地 / main" 极简风) === */}
      <div className="development-panel-head development-panel-head--status" aria-label="右栏状态栏">
        <div className="development-panel-head-status-main">
          <span className="development-panel-head-status-label">STATUS · 状态</span>
          <span className="development-panel-head-status-time" title={now.toISOString()}>{stamp}</span>
        </div>
        <div className="development-panel-head-status-chips">
          <span className={`development-panel-head-chip ${liveOnline ? "ok" : "warn"}`} title={liveOnline ? "SSE/poll 在线" : "等待数据"}>
            <i className="development-panel-head-chip-dot" />
            {liveOnline ? "实时在线" : "实时检查中"}
          </span>
          <span className={`development-panel-head-chip ${gatewayDown ? "error" : gatewayVerified ? "ok" : "warn"}`} title={gatewayTitle}>
            <i className="development-panel-head-chip-dot" />
            {gatewayLabel}
          </span>
          <button
            type="button"
            className="dev-drawer-open development-panel-head-preview-icon"
            onClick={() => a.openDocumentPreview(d.selectedDocument?.key || "prd")}
            aria-label="预览文档"
            title="预览文档"
          >
            {/* 简易 doc icon (内联 SVG, 不引新依赖) */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M3.5 2h6L12.5 5v9a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5Z" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5 6.5h6M5 9h6M5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="development-panel-head-preview-icon delivery-right-rail-collapse"
            onClick={a.toggleRightRail}
            aria-label="收起右栏"
            title="收起右栏"
          >
            ›
          </button>
        </div>
      </div>

      {/* === 右栏顶部 KPI Hero === 独立展示目标进度 + token 消耗 === */}
      <KpiHero data={d} />

      <div className="development-board-scroll">
        <section className={`development-board-section delivery-goal-os-preflight goal-os-preflight ${goalOsTone}`} aria-label="Goal OS preflight">
          <div className="delivery-goal-os-preflight-head">
            <div>
              <span>Goal OS</span>
              <strong>{goalOsLabel}</strong>
            </div>
            <em>{goalOsPreflight?.generatedAt ? d.formatDateTime(goalOsPreflight.generatedAt) : "no run"}</em>
          </div>
          <p title={goalOsReason}>{goalOsReason}</p>
          <div className="delivery-goal-os-preflight-checks">
            {goalOsChecks.length ? goalOsChecks.slice(0, 6).map((check: any) => (
              <span key={check.key || check.label} className={`delivery-goal-os-preflight-check ${check.status === "failed" ? "failed" : check.status === "warn" ? "warn" : "passed"}`} title={check.summary || check.detail || check.label}>
                {check.label || check.key}
              </span>
            )) : (
              <span className="delivery-goal-os-preflight-check warn">waiting</span>
            )}
          </div>
          {goalOsBlocked ? (
            <div className="delivery-goal-os-preflight-forbidden">
              <span>禁止派发</span>
              <strong>{Array.isArray(goalOsPreflight?.forbiddenActions) ? goalOsPreflight.forbiddenActions.join(" · ") : "dispatch_agent · run_subtask"}</strong>
            </div>
          ) : null}
          {goalOsRepairActions.length ? (
            <div className="delivery-goal-os-preflight-actions">
              {goalOsRepairActions.slice(0, 2).map((item: string) => (
                <button key={item} type="button" onClick={() => a.setComposerNotice({ tone: "warn", message: item })}>{item}</button>
              ))}
            </div>
          ) : null}
          <div className="delivery-goal-os-preflight-actions">
            <button type="button" onClick={() => void a.runGoalPreflight?.("dispatch")} disabled={!d.activeGoal || d.goalBusy}>重跑 preflight</button>
            <button type="button" onClick={() => void a.loadGoalEvidencePack?.()} disabled={!d.activeGoal || d.goalBusy}>刷新证据包</button>
          </div>
        </section>
        <section className={`development-board-section delivery-agent-runtime-card ${agentRuntime?.tone || (agentRuntime?.gatewayOk === false ? "error" : "ok")}`} aria-label="当前 agent 运行态">
          <div className="delivery-inspector-head">
            <div>
              <span>Agent Runtime</span>
              <strong>{agentRuntime?.name || "OpenClaw Agent"}</strong>
            </div>
            <span className={`dev-pill ${agentRuntime?.gatewayOk === false ? "error" : agentRuntime?.tone || "ok"}`}>
              {agentRuntime?.gatewayLabel || "Gateway checking"}
            </span>
          </div>
          <p>{agentRuntime?.nextAction || "选择任务或点击 Run 派发给当前 agent。"}</p>
          <div className="delivery-agent-runtime-grid">
            <div><span>当前代理</span><strong>{agentRuntime?.agentId || "main"}</strong><small>{agentRuntime?.role || "OpenClaw Agent"}</small></div>
            <div><span>任务状态</span><strong>{agentRuntime?.taskStatus || "idle"}</strong><small>{agentRuntime?.taskLabel || "当前无运行任务"}</small></div>
            <div><span>Gateway</span><strong>{agentRuntime?.healthStatus || "checking"}</strong><small>{agentRuntime?.healthError || agentRuntime?.abnormal || "no error"}</small></div>
          </div>
        </section>
        <section className="development-board-section delivery-output-panel" aria-label="产出和文件变更">
          <div className="delivery-inspector-head">
            <div>
              <span>Outputs</span>
              <strong>产出 / 文件变更</strong>
            </div>
            <span className="dev-pill muted">{outputItems.length} items</span>
          </div>
          <div className="delivery-output-list">
            {outputItems.length ? outputItems.map((item: any) => (
              <button
                key={item.key}
                type="button"
                className={item.tone}
                onClick={() => item.evidenceId
                  ? a.openEvidencePreview({ type: "artifact", id: item.evidenceId })
                  : item.documentKey
                    ? a.openDocumentPreview(item.documentKey)
                    : a.setComposerNotice({ tone: item.tone === "warn" ? "warn" : "ok", message: `${item.label}: ${item.path || item.title}` })}
              >
                <span>{item.label}</span>
                <strong title={item.title || item.path}>{compactPathLabel(item.title || item.path || "output", 62)}</strong>
                <small title={item.path}>{item.path ? compactPathLabel(item.path, 72) : `+${item.added || 0} -${item.removed || 0}`}</small>
                {typeof item.added === "number" || typeof item.removed === "number" ? <em>+{item.added || 0} -{item.removed || 0}</em> : null}
              </button>
            )) : (
              <p>暂无产出；开启任务、运行当前子任务或生成证据包后会显示文件、报告、截图和审计产物。</p>
            )}
          </div>
        </section>
        <section className={`development-board-section delivery-inspector-section delivery-current-evidence ${taskTone}`} aria-label="当前任务证据">
          <div className="delivery-inspector-head">
            <div>
              <span>Current Task Evidence</span>
              <strong title={taskTitle}>{taskTitle}</strong>
            </div>
            <span className={`dev-pill ${taskTone}`}>{d.developmentStatusLabel(taskStatus)}</span>
          </div>
          <p>{nextAction}</p>
          <div className="delivery-inspector-metrics">
            <div><span>进度</span><strong>{d.baseline?.progress ? `${d.baseline.progress.passed}/${d.baseline.progress.total}` : `${d.activeGoal?.progressPercent || 0}%`}</strong></div>
            <div><span>变更</span><strong>{changeItems.length}</strong></div>
            <div><span>日志</span><strong>{d.displayedLogRows?.length || 0}</strong></div>
          </div>
          <div className="delivery-inspector-changes" aria-label="当前任务变更">
            {changeItems.length ? changeItems.map((item: any) => (
              <button
                key={item.key}
                type="button"
                onClick={() => item.evidenceId
                  ? a.openEvidencePreview({ type: "artifact", id: item.evidenceId })
                  : item.documentKey
                    ? a.openDocumentPreview(item.documentKey)
                    : a.setComposerNotice({ tone: "ok", message: `${item.label}: ${item.path}` })}
              >
                <span title={item.label}>{item.label}</span>
                <strong className="codex-change-path" title={item.path}>{compactPathLabel(item.path, 54)}</strong>
                <em>+{item.added} -{item.removed}</em>
              </button>
            )) : <p>暂无文件或产出摘要；运行当前任务后会在这里出现。</p>}
          </div>
          {d.activeSubtask?.acceptanceCriteria?.length ? (
            <div className="delivery-inspector-criteria">
              {d.activeSubtask.acceptanceCriteria.slice(0, 3).map((item: string) => <span key={item}>{item}</span>)}
            </div>
          ) : null}
        </section>
        {/* === 目标证据: 深层材料折叠，首屏只保留 Codex inspector 摘要行 === */}
        {d.activeGoal && (
          <details className={`development-board-section delivery-inspector-accordion delivery-goal-evidence-summary ${d.goalEvidenceConsoleTone}`} aria-label="目标证据">
            <summary>
              <span>Goal Evidence</span>
              <strong title={d.activeGoalFullTitle}>{d.activeGoalMissionControl?.label || d.goalRuntimeCapsuleTitle}</strong>
              <small>{d.goalEvidenceConsoleSignals.length} signals</small>
            </summary>
            <div className="goal-evidence-console-hero">
              <div>
                <span>当前目标</span>
                <strong title={d.activeGoalFullTitle}>{d.activeGoalMissionControl?.label || d.goalRuntimeCapsuleTitle}</strong>
                <small>{d.activeGoalMissionControl?.focus || d.goalCockpitPointer} · {d.activeGoalMissionControl?.generatedAt ? d.formatDateTime(d.activeGoalMissionControl.generatedAt) : d.formatDateTime(d.activeGoal.updatedAt)}</small>
              </div>
              <button type="button" className={d.activeGoalMissionControl?.primaryAction.tone || "info"} onClick={() => d.activeGoalMissionControl ? a.runGoalSnapshotAction(d.activeGoalMissionControl.primaryAction.key) : void a.loadGoalContinuationContract()} disabled={d.goalBusy}>
                {d.activeGoalMissionControl?.primaryAction.label || d.goalCockpitPrimaryLabel}
              </button>
            </div>
            <p>{goalEvidenceSummary}</p>
            <div className="goal-evidence-console-signals">
              {d.goalEvidenceConsoleSignals.map((signal: any) => (
                <button key={signal.key} type="button" onClick={() => a.setGoalNotice({ tone: signal.key === "state" && d.goalEvidenceConsoleTone === "blocked" ? "warn" : "ok", message: `${signal.label}: ${signal.value} · ${cleanEvidenceSummary(signal.detail, "等待目标运行证据")}` })}>
                  <span>{signal.label}</span>
                  <strong>{signal.value}</strong>
                  <small>{cleanEvidenceSummary(signal.detail, "等待目标运行证据")}</small>
                </button>
              ))}
            </div>
            <div className="goal-evidence-console-actions" aria-label="目标证据操作">
              <button type="button" onClick={() => void a.loadGoalRunway()} disabled={d.goalBusy}>跑道</button>
              <button type="button" onClick={() => void a.loadGoalTimeline()} disabled={d.goalBusy}>时间线</button>
              <button type="button" onClick={() => void a.loadGoalContinuationContract()} disabled={d.goalBusy}>续跑</button>
              <button type="button" onClick={() => void a.loadGoalEvidencePack()} disabled={d.goalBusy}>证据包</button>
              <button type="button" onClick={() => void a.loadGoalRecoveryPacket()} disabled={d.goalBusy}>恢复包</button>
              <button type="button" onClick={() => void a.loadGoalCompletionAudit()} disabled={d.goalBusy}>审计</button>
            </div>
            {d.goalCodexParity && (
              <div className={`goal-evidence-console-parity ${d.goalCodexParity.tone}`} aria-label="Codex 目标能力验收">
                <header>
                  <div>
                    <span>Codex Goal Parity</span>
                    <strong>{d.goalCodexParity.score}/100 · {d.goalCodexParity.label}</strong>
                    <small>source: {d.goalCodexParity.source}</small>
                  </div>
                  <button type="button" onClick={() => a.setGoalNotice({ tone: d.goalCodexParity.tone === "ok" ? "ok" : "warn", message: cleanEvidenceSummary(d.goalCodexParity.missing[0], "Codex Goal parity checks passed.") })}>
                    {d.goalCodexParity.criticalMissing ? "查看缺口" : "查看证据"}
                  </button>
                </header>
                <div className="goal-evidence-console-parity-checks">
                  {d.goalCodexParity.checks.slice(0, 9).map((check: any) => (
                    <button key={check.key} type="button" className={check.passed ? "passed" : "missing"} onClick={() => a.setGoalNotice({ tone: check.passed ? "ok" : "warn", message: `${check.label}: ${cleanEvidenceSummary(check.evidence, "等待目标证据")}` })}>
                      <span>{check.passed ? "✓" : "!"}</span>
                      <strong>{check.label}</strong>
                      <small>{cleanEvidenceSummary(check.evidence, "等待目标证据")}</small>
                    </button>
                  ))}
                </div>
                {d.goalCodexParity.missing.length ? (
                  <div className="goal-evidence-console-parity-missing">
                    {d.goalCodexParity.missing.slice(0, 3).map((item: string) => (
                      <span key={item}>{cleanEvidenceSummary(item, "等待目标证据")}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            <div className="goal-evidence-console-resume" aria-label="目标接力命令">
              <header>
                <div>
                  <span>Resume Command</span>
                  <strong>{d.goalEvidenceConsoleResumeLabel}</strong>
                </div>
                <div>
                  <button type="button" onClick={() => void a.commitGoalContinuationContract("copy")} disabled={d.goalBusy}>复制</button>
                  <button type="button" onClick={() => void a.commitGoalContinuationContract("stage")} disabled={d.goalBusy}>接入</button>
                  <button type="button" className="primary" onClick={() => d.goalCockpitContract ? a.runGoalContinuationPrimaryAction(d.goalCockpitContract) : void a.loadGoalContinuationContract()} disabled={d.goalBusy}>
                    {d.goalCockpitContract ? a.goalContinuationPrimaryLabel(d.goalCockpitContract) : "生成"}
                  </button>
                </div>
              </header>
              <pre>{d.goalEvidenceConsoleResumeCommand}</pre>
            </div>
            <div className="goal-evidence-console-artifacts" aria-label="目标关键产物">
              <header>
                <strong>关键产物</strong>
                <span>{d.goalEvidenceConsoleArtifacts.length} files</span>
              </header>
              {d.goalEvidenceConsoleArtifacts.length ? d.goalEvidenceConsoleArtifacts.slice(0, 5).map((artifact: any) => (
                <button key={artifact.key} type="button" onClick={() => a.openEvidencePreview({ type: "artifact", id: artifact.id })}>
                  <span>{artifact.label}</span>
                  <strong>{artifact.title}</strong>
                  <small>{d.formatDateTime(artifact.detail)}</small>
                </button>
              )) : <p>还没有可恢复产物；先生成续跑契约、证据包或恢复包。</p>}
            </div>
            <div className="goal-evidence-console-timeline" aria-label="目标最近事件">
              <header>
                <strong>最近事件</strong>
                <span>{d.goalEvidenceConsoleTimeline.length} events</span>
              </header>
              {d.goalEvidenceConsoleTimeline.length ? d.goalEvidenceConsoleTimeline.map((item: any) => (
                <button key={item.id} type="button" className={item.tone} onClick={() => a.setGoalNotice({ tone: item.tone === "warn" ? "warn" : "ok", message: `${item.label}: ${cleanEvidenceSummary(item.message, "等待目标事件")}` })}>
                  <span>{item.label}</span>
                  <strong>{cleanEvidenceSummary(item.message, "等待目标事件")}</strong>
                  <small>{item.actor} · {item.type} · {d.formatDateTime(item.createdAt)}</small>
                </button>
              )) : <p>暂无目标事件；刷新时间线或运行一次心跳检查。</p>}
            </div>
          </details>
        )}

        {/* === 执行脉冲 === */}
        {d.visibleExecutionPulse && (
          <section className={`development-board-section board-execution-section ${d.visibleExecutionPulse.status}`} aria-live="polite">
            <h3>{d.executionPulseActive ? "执行进行中" : "执行收敛"}</h3>
            <div className="board-execution-head">
              <strong>{d.visibleExecutionPulse.subtaskTitle}</strong>
              <span>{d.formatElapsed(d.visibleExecutionPulse.startedAt, d.visibleExecutionPulse.completedAt)}</span>
            </div>
            <div className="board-execution-progress">
              {d.executionPulseSteps.map((step: any) => (
                <span key={step.key} className={step.done ? "done" : ""}>{step.label}</span>
              ))}
            </div>
            <p>{d.visibleExecutionPulse.message}</p>
          </section>
        )}

        {/* === Goal Ledger + Tabs === */}
        <details className="development-board-section delivery-inspector-accordion delivery-goal-ledger" open={Boolean(d.goalEvidencePack && d.goalEvidencePack.goalId === d.activeGoal?.id)}>
          <summary>
            <span>Goal Ledger</span>
            <strong>{d.activeGoalDisplayTitle || "长期目标"}</strong>
            <small>{d.goalSectionTab}</small>
          </summary>
          <div className="development-board-head">
            <div>
              <span>Goal Ledger</span>
              <strong>长期目标</strong>
            </div>
            <div className="development-board-head-actions">
              <button type="button" onClick={() => void a.loadGoalRunway()} disabled={!d.activeGoal || d.goalBusy}>跑道</button>
              <button type="button" onClick={() => void a.loadGoalTimeline()} disabled={!d.activeGoal || d.goalBusy}>时间线</button>
              <button type="button" onClick={() => void a.loadGoalContinuationContract()} disabled={!d.activeGoal || d.goalBusy}>续跑</button>
              <button type="button" onClick={() => void a.loadGoalEvidencePack()} disabled={!d.activeGoal || d.goalBusy}>证据包</button>
              <button type="button" onClick={() => void a.loadGoalRecoveryPacket()} disabled={!d.activeGoal || d.goalBusy}>恢复包</button>
              <button type="button" onClick={() => a.setGoalCreateOpen(true)}>新增</button>
            </div>
          </div>
          <div className="development-goal-section-tabs" role="tablist" aria-label="Goal 详情页 Tab 列表">
            {([
              ["overview", "Overview"],
              ["plan", "Plan"],
              ["result", "Result"],
              ["verify", "Verify"],
              ["timeline", "Timeline"],
            ] as Array<[any, string]>).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={d.goalSectionTab === key} className={d.goalSectionTab === key ? "active" : ""} onClick={() => a.setGoalSectionTab(key)} disabled={!d.activeGoal && key !== "overview"}>
                {label}
              </button>
            ))}
          </div>
          {d.activeGoal && d.goalSectionTab === "verify" ? (
            <GoalVerifyTab
              goal={d.activeGoal as unknown as Parameters<typeof GoalVerifyTab>[0]["goal"]}
              evidencePack={(d.goalEvidencePack as unknown as Parameters<typeof GoalVerifyTab>[0]["evidencePack"]) ?? null}
              loadingPack={d.goalBusy && !d.goalEvidencePack}
              busy={d.goalBusy}
              onVerify={({ goal: updatedGoal, decision }: any) => {
                if (updatedGoal) a.setLiveDetail((prev: any) => prev ? { ...prev, activeGoal: updatedGoal } : prev);
                a.setGoalNotice({ tone: "ok", message: `Verify ${decision.toUpperCase()} 已应用 · status=${updatedGoal?.status || d.activeGoal.status}` });
                a.setGoalSectionTab("overview");
              }}
              onNotice={(tone: any, message: any) => a.setGoalNotice({ tone, message })}
              onRequestEvidencePack={() => void a.loadGoalEvidencePack()}
            />
          ) : null}
          {d.activeGoal ? (
            <div className="development-goal-ledger-card">
              <header>
                <strong title={d.activeGoalFullTitle}>{d.activeGoalDisplayTitle || d.activeGoal.title}</strong>
                <span>{d.activeGoal.runtimeLabel || d.activeGoal.statusLabel}</span>
              </header>
              <p>{d.activeGoal.nextAction || d.activeGoal.objective}</p>
              <div className="development-goal-mini-progress"><i style={{ width: `${d.activeGoal.progressPercent || 0}%` }} /></div>
              <div className="development-goal-ledger-meta">
                <span>{d.activeGoal.heartbeatCount} heartbeats</span>
                <span>{d.activeGoal.turnCount} turns</span>
                <span>{d.activeGoal.heartbeatDue ? "heartbeat due" : d.activeGoal.tokenBudget ? `${d.activeGoal.tokensUsed}/${d.activeGoal.tokenBudget} tokens` : "budget unset"}</span>
              </div>
              <div className={`development-goal-auto-summary ${d.activeGoal.autoRunEnabled ? "on" : ""}`}>
                <span>{d.activeGoal.autoRunEnabled ? "Autopilot on" : "Autopilot off"}</span>
                <strong>{d.activeGoal.autoRunEnabled ? `${d.activeGoal.autoTurnsUsed || 0}/${d.activeGoal.maxAutoTurns || 3} turns · ${d.activeGoal.heartbeatIntervalMinutes || 30}m cadence` : "手动继续，避免无审计自动执行"}</strong>
              </div>
              {d.activeGoal.runtimeEvidence?.length ? (
                <div className="development-goal-runtime-evidence">
                  {d.activeGoal.runtimeEvidence.slice(0, 3).map((item: string) => <span key={item}>{item}</span>)}
                </div>
              ) : null}
            </div>
          ) : <p>当前项目尚未创建长期目标。</p>}
          {d.goalRunway && d.goalRunway.goalId === d.activeGoal?.id ? (
            <div className={`development-goal-runway-compact ${d.goalRunway.riskLevel}`}>
              <div>
                <strong>{d.goalRunway.phaseLabel}</strong>
                <span>{d.goalRunway.readinessScore}/100 · {d.goalRunway.primaryAction.detail}</span>
              </div>
              <div className="development-goal-runway-compact-actions">
                <button type="button" onClick={() => void a.loadGoalRunway()} disabled={d.goalBusy}>刷新</button>
                <button type="button" className={d.goalRunway.primaryAction.tone} onClick={() => a.runGoalRunwayAction(d.goalRunway.primaryAction.key)} disabled={d.goalBusy}>{d.goalRunway.primaryAction.label}</button>
              </div>
            </div>
          ) : null}
          {d.goalTimeline && d.goalTimeline.goalId === d.activeGoal?.id ? (
            <div className="development-goal-timeline">
              <div className="development-goal-timeline-head">
                <div>
                  <strong>运行时间线</strong>
                  <span>{d.goalTimeline.continuityScore}/100 · {d.goalTimeline.resumeBrief}</span>
                </div>
                <button type="button" className={d.goalTimeline.nextCheckpoint.tone} onClick={() => a.setGoalNotice({ tone: d.goalTimeline.nextCheckpoint.tone === "warn" ? "warn" : "ok", message: `${d.goalTimeline.nextCheckpoint.label}: ${d.goalTimeline.nextCheckpoint.detail}` })}>
                  {d.goalTimeline.nextCheckpoint.label}
                </button>
              </div>
              {d.goalTimeline.pointer.subtaskTitle || d.goalTimeline.pointer.workPacketTitle ? (
                <div className="development-goal-timeline-pointer">
                  <span>{d.goalTimeline.pointer.baselineStatus || "baseline"}</span>
                  <strong>{d.goalTimeline.pointer.subtaskTitle || d.goalTimeline.pointer.workPacketTitle}</strong>
                </div>
              ) : null}
              {d.goalTimeline.actions.length ? (
                <div className="development-goal-timeline-actions" aria-label="目标下一步操作">
                  {d.goalTimeline.actions.slice(0, 4).map((action: any) => (
                    <button key={action.key} type="button" className={action.tone} onClick={() => a.runGoalTimelineAction(action.key)} disabled={d.goalBusy || (action.key === "lock_baseline" && !d.project)}>
                      <strong>{action.label}</strong>
                      <span>{action.detail}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="development-goal-timeline-items">
                {d.goalTimeline.items.slice(0, 8).map((item: any) => (
                  <button key={item.id} type="button" className={item.tone} onClick={() => {
                    if (item.subtaskId) {
                      a.setActiveSubtaskId(item.subtaskId);
                      a.setActiveEvidence({ type: "subtask", id: item.subtaskId });
                    }
                    a.setGoalNotice({ tone: item.tone === "warn" ? "warn" : "ok", message: `${item.label}: ${item.message}` });
                  }}>
                    <i>{item.label}</i>
                    <strong>{item.message}</strong>
                    <span>{item.actor} · {item.type} · {d.formatDateTime(item.createdAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {d.goalContinuationContract && d.goalContinuationContract.goalId === d.activeGoal?.id ? (
            <div className={`development-goal-continuation-contract ${d.goalContinuationContract.blockers.length || d.goalContinuationContract.requiredEvidence.length ? "warn" : "ok"}`}>
              <div className="development-goal-continuation-head">
                <div>
                  <strong>Continuation Contract</strong>
                  <span>{d.goalContinuationContract.readinessLabel} · {d.goalContinuationContract.readinessScore}/100 · {d.goalContinuationContract.continuity.heartbeatCount} heartbeats</span>
                </div>
                <button type="button" onClick={() => void a.commitGoalContinuationContract("copy")} disabled={d.goalBusy}>复制接力提示</button>
              </div>
              <p>{d.goalContinuationContract.nextCommand}</p>
              <div className="development-goal-continuation-pointer">
                <span>{d.goalContinuationContract.pointer.baselineStatus || "baseline"}</span>
                <strong>{d.goalContinuationContract.pointer.subtaskTitle || d.goalContinuationContract.pointer.workPacketTitle || d.goalContinuationContract.currentFocus}</strong>
              </div>
              <div className="development-goal-continuation-actions">
                <button type="button" className="primary" onClick={() => a.runGoalContinuationPrimaryAction(d.goalContinuationContract)} disabled={d.goalBusy}>{a.goalContinuationPrimaryLabel(d.goalContinuationContract)}</button>
                <button type="button" onClick={() => void a.commitGoalContinuationContract("stage")} disabled={d.goalBusy}>接入输入框</button>
              </div>
              <div className="development-goal-continuation-checks">
                {d.goalContinuationContract.checkpoints.slice(0, 5).map((checkpoint: any) => (
                  <button key={checkpoint.key} type="button" className={checkpoint.tone} onClick={() => a.setGoalNotice({ tone: checkpoint.tone === "warn" ? "warn" : "ok", message: `${checkpoint.label}: ${checkpoint.evidence}` })}>
                    <strong>{checkpoint.label} · {checkpoint.status}</strong>
                    <span>{checkpoint.evidence}</span>
                  </button>
                ))}
              </div>
              {d.goalContinuationContract.blockers.length || d.goalContinuationContract.requiredEvidence.length ? (
                <div className="development-goal-continuation-risks">
                  {[...d.goalContinuationContract.blockers, ...d.goalContinuationContract.requiredEvidence].slice(0, 4).map((item: string) => <span key={item}>{item}</span>)}
                </div>
              ) : null}
            </div>
          ) : null}
          {d.goalEvidencePack && d.goalEvidencePack.goalId === d.activeGoal?.id ? (
            <div className={`development-goal-evidence-pack ${d.goalEvidencePack.missingEvidence.length || d.goalEvidencePack.blockers.length ? "warn" : "ok"}`}>
              <div className="development-goal-evidence-pack-head">
                <div>
                  <strong>Evidence Pack</strong>
                  <span>{d.goalEvidencePack.coverageScore}/100 · {d.goalEvidencePack.counts.coveredCriteria}/{d.goalEvidencePack.counts.criteria} criteria · {d.goalEvidencePack.counts.artifacts} artifacts</span>
                </div>
                <i style={{ width: `${d.goalEvidencePack.coverageScore}%` }} />
              </div>
              {d.goalEvidencePack.missingEvidence.length ? (
                <div className="development-goal-evidence-missing">
                  {d.goalEvidencePack.missingEvidence.slice(0, 3).map((item: string) => <span key={item}>{item}</span>)}
                </div>
              ) : null}
              <div className="development-goal-coverage-list">
                {d.goalEvidencePack.coverage.slice(0, 5).map((item: any) => (
                  <button key={item.criterion} type="button" className={item.covered ? "ok" : "warn"} onClick={() => {
                    if (item.artifactId) a.openEvidencePreview({ type: "artifact", id: item.artifactId });
                    else a.setGoalNotice({ tone: item.covered ? "ok" : "warn", message: `${item.criterion}: ${item.evidence}` });
                  }}>
                    <strong>{item.covered ? "covered" : "missing"} · {item.criterion}</strong>
                    <span>{item.evidence}</span>
                  </button>
                ))}
              </div>
              <div className="development-goal-evidence-assets">
                {d.goalEvidencePack.artifacts.slice(0, 4).map((artifact: any) => (
                  <button key={artifact.id} type="button" onClick={() => a.openEvidencePreview({ type: "artifact", id: artifact.id })}>
                    <strong>{artifact.type || "artifact"}</strong>
                    <span>{artifact.title}</span>
                  </button>
                ))}
                {d.goalEvidencePack.gates.slice(0, 4).map((gate: any) => (
                  <button key={gate.id} type="button" className={d.developmentTone(gate.status)} onClick={() => a.openEvidencePreview({ type: "gate", id: gate.id })}>
                    <strong>{gate.status}</strong>
                    <span>{gate.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {d.goals.length > 1 && (
            <div className="development-goal-list">
              {d.goals.slice(0, 8).map((goal: any) => (
                <button key={goal.id} type="button" className={goal.id === d.activeGoal?.id ? "active" : ""} onClick={() => { a.setActiveGoalId(goal.id); a.setActiveWorkPacketId(goal.activeWorkPacketId || ""); a.setActiveSubtaskId(goal.activeSubtaskId || ""); }}>
                  <span>{goal.statusLabel || d.developmentStatusLabel(goal.status)}</span>
                  <strong title={goal.title || goal.objective}>{d.compactDevelopmentGoalTitle(goal, 56)}</strong>
                </button>
              ))}
            </div>
          )}
          {d.activeGoal?.successCriteria?.length ? (
            <div className="development-goal-evidence-list">
              <strong>成功标准</strong>
              {d.activeGoal.successCriteria.slice(0, 4).map((item: string) => <span key={item}>{item}</span>)}
            </div>
          ) : null}
          {d.activeGoal?.evidence?.length ? (
            <div className="development-goal-evidence-list muted">
              <strong>目标证据</strong>
              {d.activeGoal.evidence.slice(0, 4).map((item: string) => <span key={item}>{item}</span>)}
            </div>
          ) : null}
          {d.goalCompletionAudit && d.goalCompletionAudit.goalId === d.activeGoal?.id ? (
            <div className={`development-goal-completion-audit ${d.goalCompletionAudit.passed ? "passed" : "failed"}`}>
              <div>
                <strong>Completion Audit</strong>
                <span>{d.goalCompletionAudit.score}/100 · {d.goalCompletionAudit.passed ? "可完成" : d.goalCompletionAudit.nextAction}</span>
              </div>
              <div className="development-goal-audit-checks">
                {d.goalCompletionAudit.checks.map((check: any) => <span key={check.key} className={check.passed ? "passed" : "failed"}>{check.passed ? "✓" : "!"} {check.label} · {check.evidence}</span>)}
              </div>
            </div>
          ) : null}
          {d.goalLearningReview && d.goalLearningReview.goalId === d.activeGoal?.id ? (
            <div className={`development-goal-learning-review ${d.goalLearningReview.blockers.length ? "warn" : "ok"}`}>
              <div>
                <strong>Learning Review</strong>
                <span>{d.goalLearningReview.learningScore}/100 · {d.formatDateTime(d.goalLearningReview.generatedAt)}</span>
              </div>
              <div className="development-goal-learning-insights">
                {d.goalLearningReview.insights.slice(0, 4).map((item: string) => <span key={item}>{item}</span>)}
              </div>
              <div className="development-goal-learning-actions">
                {d.goalLearningReview.recommendedActions.slice(0, 4).map((action: any) => (
                  <button key={action.key} type="button" onClick={() => a.setGoalNotice({ tone: action.priority === "P0" ? "warn" : "ok", message: `${action.priority} · ${action.label}: ${action.detail}` })}>
                    <strong>{action.priority} · {action.label}</strong>
                    <small>{action.detail}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {d.goalDispatchRecovery && d.goalDispatchRecovery.goalId === d.activeGoal?.id ? (
            <div className="development-goal-dispatch-packet">
              <div>
                <strong>Dispatch Recovery</strong>
                <span>{d.formatDateTime(d.goalDispatchRecovery.generatedAt)} · {d.goalDispatchRecovery.pointer.subtaskTitle || "未绑定子任务"} · {d.goalDispatchRecovery.pointer.baselineStatus || "baseline unknown"}</span>
              </div>
              <p>{d.goalDispatchRecovery.summary}</p>
              <div className="development-goal-dispatch-actions">
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(d.goalDispatchRecovery.prompt); a.setGoalNotice({ tone: "ok", message: "派发恢复提示已复制。" }); }}>复制恢复提示</button>
                {d.goalDispatchRecovery.artifact && <button type="button" onClick={() => a.openEvidencePreview({ type: "artifact", id: d.goalDispatchRecovery.artifact.id })}>打开恢复产物</button>}
                <button type="button" onClick={() => void a.loadGoalTimeline()}>刷新事件</button>
              </div>
              <div className="development-goal-dispatch-facts">
                <span>PLAN: {d.goalDispatchRecovery.pointer.planPath || "未绑定"}</span>
                <span>RESULT: {d.goalDispatchRecovery.pointer.resultPath || "未绑定"}</span>
                <span>{d.goalDispatchRecovery.events.length} events</span>
              </div>
              <textarea readOnly value={d.goalDispatchRecovery.prompt} rows={8} onFocus={(event) => event.currentTarget.select()} />
            </div>
          ) : null}
          {d.goalRecoveryPacket && d.goalRecoveryPacket.goalId === d.activeGoal?.id ? (
            <div className="development-goal-recovery-packet">
              <div>
                <strong>Recovery Packet</strong>
                <span>{d.formatDateTime(d.goalRecoveryPacket.generatedAt)} · {d.goalRecoveryPacket.events.length} events · {d.goalRecoveryPacket.artifacts.length} artifacts</span>
              </div>
              <textarea readOnly value={d.goalRecoveryPacket.markdown} rows={10} onFocus={(event) => event.currentTarget.select()} />
            </div>
          ) : null}
        </details>

        {/* === Project Board Actions === */}
        <details className="development-board-section delivery-inspector-accordion">
          <summary>
            <span>Project Actions</span>
            <strong>{d.project?.name || "项目开发总览"}</strong>
            <small>{d.baseline ? `baseline v${d.baseline.version}` : "collapsed"}</small>
          </summary>
          <div className="development-board-head">
            <div>
              <span>{d.project?.id || "development"} · {d.baseline ? `baseline v${d.baseline.version}` : "no baseline"}</span>
              <strong>{d.project?.name || "项目开发总览"}</strong>
            </div>
            <span className={`dev-pill ${d.selectedStatusTone}`}>{d.developmentStatusLabel(d.activeSubtask?.status || d.baseline?.status || d.activeWorkPacket?.status || d.project?.status || "waiting")}</span>
          </div>
          <p>{d.activeSubtask ? d.activeSubtask.description : d.baselineCompleted ? d.baselineCompletionMessage : d.activeWorkPacket?.objective || d.project?.objective || "选择左侧项目开始开发闭环。"}</p>
          <div className="development-board-actions">
            <button type="button" onClick={a.generateBaseline} disabled={!d.project}>生成基线</button>
            <button type="button" onClick={a.lockBaseline} disabled={!d.project || d.baseline?.status === "locked"}>锁定</button>
            <button type="button" onClick={a.runShadow} disabled={d.running || !d.project}>{d.running ? "检查中" : "Shadow"}</button>
            <button type="button" onClick={a.runCurrentSubtask} disabled={d.running || !d.activeSubtask}>{d.baselineCompleted && !d.activeSubtask ? "已完成" : d.running ? "执行中" : "执行当前"}</button>
          </div>
        </details>

        {/* === 能力健康 === */}
        {d.capabilityHealth.length > 0 && (
          <details className="development-board-section delivery-inspector-accordion">
            <summary>
              <span>Capability Health</span>
              <strong>能力健康</strong>
              <small>{d.capabilityHealth.length} signals</small>
            </summary>
            <h3>能力健康</h3>
            <div className="dev-capability-list">
              {d.capabilityHealth.map((item: any) => (
                <button key={item.key} type="button" className={item.tone} onClick={() => a.setComposerNotice({ tone: item.tone === "error" ? "warn" : item.tone, message: `${item.label}: ${item.summary} ${item.evidence ? `证据：${item.evidence}` : ""}` })}>
                  <span>{item.label}</span>
                  <strong>{d.developmentStatusLabel(item.status)}</strong>
                  <small>{item.summary}</small>
                </button>
              ))}
            </div>
          </details>
        )}

        {/* === Baseline 进度可视化 === */}
        <details className="development-board-section delivery-inspector-accordion">
          <summary>
            <span>Baseline</span>
            <strong>项目任务基线</strong>
            <small>{d.baseline ? `${d.baseline.progress.passed}/${d.baseline.progress.total}` : "collapsed"}</small>
          </summary>
          <h3>项目任务基线</h3>
          <div className="development-baseline-board" aria-label="项目任务基线">
            <div className="baseline-head">
              <div>
                <span>进度</span>
                <strong>{d.baseline ? `${d.baseline.progress.passed}/${d.baseline.progress.total} 已验收` : "未生成"}</strong>
              </div>
              <div className="baseline-progress"><i style={{ width: `${d.baseline?.progress?.percent || 0}%` }} /></div>
              <div>
                <span>当前子任务</span>
                <strong>{d.activeSubtask ? `${String(d.activeSubtask.sequence).padStart(3, "0")} ${d.activeSubtask.title}` : d.baselineCompleted ? "全部完成" : "待生成"}</strong>
              </div>
              <div>
                <span>PM</span>
                <strong>{d.productRole ? `${d.productRole.tasteThreshold}/${d.productRole.criticalThreshold}` : "85/75"}</strong>
              </div>
            </div>
            <div className="baseline-checklist vertical">
              {d.subtasks.slice(0, 12).map((subtask: any) => (
                <button type="button" key={subtask.id} className={subtask.id === d.activeSubtask?.id ? "active" : ""} onClick={() => { a.setActiveSubtaskId(subtask.id); a.setActiveEvidence({ type: "subtask", id: subtask.id }); }}>
                  <span>{subtask.status === "passed" ? "✓" : subtask.status === "blocked" ? "!" : "○"}</span>
                  <strong>{String(subtask.sequence).padStart(3, "0")}</strong>
                  <em>{subtask.title}</em>
                  <small>{d.developmentStatusLabel(subtask.status)}</small>
                </button>
              ))}
            </div>
          </div>
        </details>

        {/* === 文档与预览 === */}
        <details className="development-board-section delivery-inspector-accordion">
          <summary>
            <span>Docs</span>
            <strong>文档与预览</strong>
            <small>{d.documents.length} docs</small>
          </summary>
          <h3>文档与预览</h3>
          <div className="development-brief-tabs board-doc-tabs" aria-label="项目文档入口">
            {d.documents.map((doc: any) => (
              <button key={doc.key} type="button" className={!d.activeEvidence && d.selectedDocument?.key === doc.key ? "active" : ""} onClick={() => a.openDocumentPreview(doc.key)}>
                <span>{doc.label}</span>
                <strong>{doc.title}</strong>
              </button>
            ))}
          </div>
        </details>

        {/* === Token 消耗 + 日志 === */}
        <details className="development-board-section delivery-inspector-accordion">
          <summary>
            <span>Logs</span>
            <strong>日志与产出</strong>
            <small>{d.displayedLogRows.length} rows</small>
          </summary>
          <div className="development-board-head">
            <div>
              <span>日志与产出</span>
              <strong>运行日志 · 产出统计</strong>
            </div>
            <span className="dev-pill muted">项目看板</span>
          </div>
          <div className="development-board-log-toolbar">
            <input
              type="text"
              value={d.developmentLogQuery}
              onChange={(event) => a.setDevelopmentLogQuery(event.target.value)}
              placeholder="输入关键词筛选日志（事件类型/内容）"
            />
          </div>
          <div className="development-board-metrics board-metrics">
            <div><span>Token 估算</span><strong>{d.shortCount(d.estimatedTokenUsage)}</strong></div>
            <div><span>输出字符数</span><strong>{d.shortCount(d.outputCharacterCount)}</strong></div>
            <div><span>文档数</span><strong>{d.developmentDocumentCount}</strong></div>
            <div><span>产出物</span><strong>{d.artifactCount}</strong></div>
          </div>
          <div className="development-board-log-results">
            {d.displayedLogRows.length ? d.displayedLogRows.map((row: any) => (
              <div key={row.id} className={["development-log-row", row.severity === "error" ? "error" : row.severity === "warn" ? "warn" : "neutral"].filter(Boolean).join(" ")}>
                <strong>{row.title}</strong>
                <small>{row.createdLabel}</small>
                <p>{row.message || "（空日志）"}</p>
              </div>
            )) : <p className="muted">暂无日志。</p>}
          </div>
          <div className="development-board-subsection">
            <strong>产出物预览</strong>
            {d.artifacts.length ? (
              <div className="dev-record-list board-record-list">
                {d.artifacts.slice(0, 6).map((artifact: any) => (
                  <button key={artifact.id} type="button" onClick={() => a.openEvidencePreview({ type: "artifact", id: artifact.id })}>
                    <span>{artifact.type}</span>
                    <strong>{artifact.title}</strong>
                  </button>
                ))}
              </div>
            ) : <p className="muted">暂无产出物。</p>}
          </div>
        </details>

        {/* === 阻塞与下一步 === */}
        <details className="development-board-section delivery-inspector-accordion">
          <summary>
            <span>Blockers</span>
            <strong>当前阻塞与下一步</strong>
            <small>{d.blockerCount} blockers</small>
          </summary>
          <h3>当前阻塞与下一步</h3>
          <div className="development-summary-grid board-metrics">
            <div><span>基线</span><strong>{d.baseline?.status ? d.developmentStatusLabel(d.baseline.status) : "未生成"}</strong></div>
            <div><span>子任务</span><strong>{d.baseline?.progress ? `${d.baseline.progress.passed}/${d.baseline.progress.total}` : "0/0"}</strong></div>
            <div><span>文档</span><strong>{d.project?.documentCount || 0}/{d.documents.length || 0}</strong></div>
            <div><span>阻塞</span><strong>{d.blockerCount}</strong></div>
          </div>
          <div className="dev-next-actions board-next-actions">
            <strong>下一步</strong>
            <span>{d.activeSubtask?.blockers[0] || (d.baselineCompleted ? "全部子任务已验收，等待发布审批；正式交付仍需 release approval 通过。" : d.activeWorkPacket?.nextAction || "继续执行当前子任务，完成后进入人工验收。")}</span>
            {d.activeSubtask?.blockers.slice(0, 3).map((blocker: string) => <span key={blocker}>{blocker}</span>)}
          </div>
        </details>

        {/* === 证据与质量门 === */}
        <details className="development-board-section delivery-inspector-accordion">
          <summary>
            <span>Quality Gates</span>
            <strong>证据与质量门</strong>
            <small>{d.gates.length + d.reviews.length} checks</small>
          </summary>
          <h3>证据与质量门</h3>
          {d.reviews.length > 0 && (
            <div className="dev-review-strip board-review-strip" aria-label="多 reviewer 记录">
              {d.reviews.slice(0, 6).map((review: any) => (
                <button type="button" key={review.id} className={d.developmentTone(review.status)} onClick={() => a.openEvidencePreview({ type: "review", id: review.id })}>
                  <span>{review.label}</span>
                  <strong>{review.score}</strong>
                  <small>{d.developmentStatusLabel(review.status)}</small>
                </button>
              ))}
            </div>
          )}
          {d.detail?.artifacts?.length ? (
            <div className="dev-record-list board-record-list">
              {d.detail.artifacts.slice(0, 8).map((artifact: any) => (
                <button type="button" key={artifact.id} onClick={() => a.openEvidencePreview({ type: "artifact", id: artifact.id })}>
                  <span>{artifact.type}</span>
                  <strong>{artifact.title}</strong>
                </button>
              ))}
            </div>
          ) : null}
          {d.gates.length > 0 && (
            <div className="dev-role-list board-gate-list">
              {d.gates.slice(0, 6).map((gate: any) => (
                <button type="button" key={gate.id} onClick={() => a.openEvidencePreview({ type: "gate", id: gate.id })}>
                  <strong>{gate.label}</strong>
                  <span>{gate.status}</span>
                  <p>{gate.evidence || "等待证据。"}</p>
                </button>
              ))}
            </div>
          )}
          {d.pluginRegistry.length > 0 && (
            <div className="dev-plugin-list board-plugin-list" aria-label="插件和 Skill 状态">
              {d.pluginRegistry.slice(0, 6).map((plugin: any) => (
                <button type="button" key={plugin.id} className={d.developmentTone(plugin.lastStatus)} onClick={() => a.openEvidencePreview({ type: "plugin", id: plugin.id })}>
                  <span>{plugin.kind}</span>
                  <strong>{plugin.label}</strong>
                  <small>{plugin.enabled ? d.developmentStatusLabel(plugin.lastStatus) : "disabled"}</small>
                </button>
              ))}
            </div>
          )}
          {d.toolRegistry.length > 0 && (
            <div className="dev-plugin-list board-plugin-list" aria-label="工具注册状态">
              {d.toolRegistry.slice(0, 6).map((tool: any) => (
                <button type="button" key={tool.id} className={d.developmentTone(tool.lastStatus)} onClick={() => a.setComposerNotice({ tone: d.developmentTone(tool.lastStatus) === "warn" ? "warn" : "ok", message: `${tool.label}: ${tool.lastStatus} · ${tool.approvalPolicy}` })}>
                  <span>{tool.category}</span>
                  <strong>{tool.label}</strong>
                  <small>{d.developmentStatusLabel(tool.lastStatus)}</small>
                </button>
              ))}
            </div>
          )}
        </details>
      </div>
      </aside>
  );
}
