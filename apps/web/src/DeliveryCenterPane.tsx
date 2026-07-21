// DeliveryCenterPane — 开发台中栏 (Sprint2 三栏布局重构)
//
// 职责 (对标 Codex / MiniMax Code 三栏 UI 的中栏):
//   * 顶部: 当前激活 agent 头部 (头像 + 模型 + status)
//   * 中部: chat history (开发事件 timeline) + 短期 sticky brief
//   * 底部: chat input (composer) + compact project context
//   * 多 agent run indicator (后台 worker 状态条)
//
// 数据契约 (从 props.data 传入, App.tsx 在 DeliveryCore 里计算):
//   包含原 development-dialogue-column 所需的全部状态 / 计算属性 / 视图模型。
//   类型用 any, 避免与 App.tsx 巨型类型强耦合 (具体形状见 App.tsx DeliveryCore)。
//
// 动作契约 (从 props.actions 传入):
//   包含原 development-dialogue-column 所需的全部回调。
//
// 设计约束:
//   * 不引新依赖, 复用现有 React 组件
//   * props 使用 any + comment, 避免类型爆炸
//   * 渲染复用现有 .development-dialogue-column + .development-thread + .development-composer CSS
//   * 完整搬运 App.tsx 中 8074-8628 行的全部 JSX, 变量引用改为 data.X / actions.X
//
import { type Ref } from "react";

export interface DeliveryCenterPaneProps {
  data: any;
  actions: any;
}

function cleanConversationMessage(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "（空消息）";
  const text = raw
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, " ")
    .replace(/The user is asking me[\s\S]*/gi, " ")
    .replace(/调用工具：[\s\S]*?(?:工具返回：|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 16 && /<think>|The user is asking me|调用工具：/i.test(raw)) {
    return "原始代理思考已折叠。请查看右栏 Outputs、证据或日志摘要。";
  }
  return text.length > 420 ? `${text.slice(0, 417)}...` : text;
}

export default function DeliveryCenterPane({ data, actions }: DeliveryCenterPaneProps) {
  const d = data;
  const a = actions;
  const changeItems = Array.isArray(d.codexChangeItems) ? d.codexChangeItems.slice(0, 5) : [];
  const taskStatus = d.activeSubtask?.status || d.activeGoal?.status || d.baseline?.status || d.project?.status || "waiting";
  const taskTone = d.developmentTone ? d.developmentTone(taskStatus) : d.selectedStatusTone;
  const taskTitle = d.activeSubtask
    ? `${String(d.activeSubtask.sequence).padStart(3, "0")} ${d.activeSubtask.title}`
    : d.activeGoalDisplayTitle || d.activeWorkPacket?.title || d.project?.name || "未选择开发任务";
  const taskDescription = d.activeSubtask?.description
    || d.activeGoal?.nextAction
    || d.activeWorkPacket?.nextAction
    || d.project?.objective
    || "选择左侧任务或用 command bar 创建开发目标。";
  const progressPercent = Math.max(0, Math.min(100, Number(d.baseline?.progress?.percent ?? d.activeGoal?.progressPercent ?? 0) || 0));
  const conversationEvents = Array.isArray(d.chronologicalEvents) ? d.chronologicalEvents.slice(-7) : [];
  const agentRuntime = d.agentRuntimeHealth || {};
  const agentRuntimeTone = agentRuntime.tone || (String(agentRuntime.status || "").toLowerCase() === "offline" ? "error" : "ok");
  const taskPrompt = d.recentLauncherPrompt
    || (d.activeSubtask ? `${String(d.activeSubtask.sequence).padStart(3, "0")} ${d.activeSubtask.title}：${d.activeSubtask.description}` : "")
    || d.activeGoal?.objective
    || d.activeWorkPacket?.objective
    || d.project?.objective
    || "我们应该在当前项目中构建什么？";
  const actorLabel = (event: any) => {
    const actor = String(event?.actor || "").toLowerCase();
    if (/owner|user|human/.test(actor)) return "用户";
    if (/tool/.test(event?.type || "")) return "工具";
    if (/top_ai_pm|pm/.test(actor)) return "PM";
    return "OpenClaw";
  };
  const eventTone = (event: any) => event?.severity === "error" ? "error" : event?.severity === "warn" || event?.type === "blocker" ? "warn" : actorLabel(event) === "用户" ? "user" : "assistant";

  return (
    <section className="development-dialogue-column delivery-center" aria-label="开发台中栏">
      {/* === 顶部: 激活 agent 头部 (对标 Codex 三栏中栏顶) === */}
      <div className="delivery-center-agent-header" aria-label="激活 agent 头部">
        <span className="delivery-center-agent-avatar" aria-hidden="true">{d.activeAgentAvatar || "OC"}</span>
        <div>
          <strong>{d.activeAgentName || "OpenClaw"}</strong>
          <small>{d.activeAgentModel || "minimax-m3"} · {d.activeAgentStatus || "checking"}</small>
        </div>
        <span className={`delivery-agent-runtime-chip-source ${agentRuntimeTone}`} title={agentRuntime.abnormal || agentRuntime.gatewayLabel || "Gateway checking"}>
          {agentRuntime.gatewayLabel || "Gateway checking"}
        </span>
        {d.backgroundWorkers?.length ? (
          <span className="delivery-center-agent-bg" title={`后台 workers: ${d.backgroundWorkers.join(", ")}`}>
            {d.backgroundWorkers.length} background workers
          </span>
        ) : null}
      </div>

      <div className="codex-session-strip" aria-label="开发台会话状态">
        <div className="codex-session-main">
          <span>{d.activeGoal ? "GOAL SESSION" : "DEV SESSION"}</span>
          <strong title={d.activeGoalFullTitle || d.project?.name || ""}>{d.activeGoalDisplayTitle || d.project?.name || "未选择开发项目"}</strong>
        </div>
        <div className="codex-session-meta">
          <span>{d.activeSubtask ? `TASK ${String(d.activeSubtask.sequence).padStart(3, "0")}` : d.baseline ? `BASELINE V${d.baseline.version}` : "NO TASK"}</span>
          <span>{d.activeGoal ? `${d.activeGoal.turnCount || 0} turns` : `${d.subtasks?.length || 0} subtasks`}</span>
          <span className={d.running || d.goalBusy ? "hot" : ""}>{d.running || d.goalBusy ? "running" : "idle"}</span>
        </div>
      </div>

      <section className="codex-task-workflow-head" aria-label="当前任务工作流">
        <div className="codex-task-workflow-main">
          <span className={`codex-task-status ${taskTone}`}>{d.developmentStatusLabel ? d.developmentStatusLabel(taskStatus) : taskStatus}</span>
          <div>
            <strong title={taskTitle}>{taskTitle}</strong>
            <p title={taskDescription}>{taskDescription}</p>
          </div>
        </div>
        <div className="codex-task-workflow-metrics" aria-label="任务指标">
          <div><span>progress</span><strong>{progressPercent}%</strong></div>
          <div><span>changes</span><strong>{changeItems.length}</strong></div>
          <div><span>tokens</span><strong>{d.shortCount ? d.shortCount(d.estimatedTokenUsage || 0) : (d.estimatedTokenUsage || 0)}</strong></div>
        </div>
        <div className="codex-task-workflow-actions">
          <span className={`delivery-agent-runtime-chip ${agentRuntimeTone}`} title={agentRuntime.abnormal || agentRuntime.gatewayLabel || "Gateway checking"}>
            {agentRuntime.gatewayLabel || "Gateway checking"}
          </span>
          <button type="button" onClick={a.runShadow} disabled={d.running || !d.project}>Shadow</button>
          <button type="button" onClick={a.runCurrentSubtask} disabled={d.running || !d.activeSubtask}>{d.running ? "Running" : "Run"}</button>
          <button type="button" onClick={() => void a.loadGoalCompletionAudit()} disabled={d.goalBusy || !d.activeGoal}>Audit</button>
        </div>
        <div className={`delivery-agent-runtime-inline ${agentRuntimeTone}`} aria-label="当前 agent 运行态">
          <span>Agent Runtime</span>
          <strong>{agentRuntime.name || d.activeAgentName || "OpenClaw"} · {agentRuntime.taskStatus || "idle"}</strong>
          <small>{agentRuntime.nextAction || "等待任务派发。"}</small>
        </div>
      </section>

      {d.quickPanel && (
        <section className={`delivery-quick-panel ${d.quickPanel}`} aria-label="开发台快速入口面板">
          <header>
            <div>
              <span>Dev Console Action · {d.activeAgentId || "main"}</span>
              <strong>{d.quickPanel === "skill" ? "新建技能闭环" : d.quickPanel === "cron" ? "新建定时任务闭环" : "手机操控台"}</strong>
            </div>
            <button type="button" onClick={() => a.setQuickPanel(null)}>关闭</button>
          </header>
          {d.quickPanel === "skill" && (
            <div className="delivery-quick-form">
              <input value={d.skillDraft.name} onChange={(event) => a.setSkillDraft((value: any) => ({ ...value, name: event.target.value }))} placeholder="技能名称，例如：prd-review-gate" />
              <input value={d.skillDraft.description} onChange={(event) => a.setSkillDraft((value: any) => ({ ...value, description: event.target.value }))} placeholder="技能说明：触发条件和用户价值" />
              <textarea value={d.skillDraft.prompt} onChange={(event) => a.setSkillDraft((value: any) => ({ ...value, prompt: event.target.value }))} rows={3} placeholder="执行说明：输入、步骤、失败兜底、验收标准" />
              <div className="delivery-quick-actions">
                <button type="button" className="primary" onClick={() => void a.createSkillFromPanel()} disabled={d.quickPanelBusy}>{d.quickPanelBusy ? "创建中..." : "保存技能"}</button>
                <small>会写入 skill_catalog 并生成 SKILL.md，下一次 /api/skills 可发现。</small>
              </div>
            </div>
          )}
          {d.quickPanel === "cron" && (
            <div className="delivery-quick-form">
              <input value={d.cronDraft.name} onChange={(event) => a.setCronDraft((value: any) => ({ ...value, name: event.target.value }))} placeholder="任务名称，例如：每日开发台状态审计" />
              <input value={d.cronDraft.expression} onChange={(event) => a.setCronDraft((value: any) => ({ ...value, expression: event.target.value }))} placeholder="Cron 表达式，例如：0 9 * * *" />
              <textarea value={d.cronDraft.prompt} onChange={(event) => a.setCronDraft((value: any) => ({ ...value, prompt: event.target.value }))} rows={3} placeholder="定时执行提示词：目标、输入、产出和验收标准" />
              <div className="delivery-quick-actions">
                <button type="button" className="primary" onClick={() => void a.createCronFromPanel()} disabled={d.quickPanelBusy}>{d.quickPanelBusy ? "保存中..." : "创建暂停任务"}</button>
                <small>默认 paused，避免未经确认自动执行。</small>
              </div>
            </div>
          )}
          {d.quickPanel === "mobile" && (
            <div className="delivery-mobile-control">
              <div className="delivery-mobile-grid">
                <div><span>设备数</span><strong>{d.mobileControlState?.devices?.devices?.length ?? "..."}</strong><small>来自 /api/mobile/devices</small></div>
                <div><span>移动 API</span><strong>{d.mobileControlState?.bootstrap?.apiVersion || "mobile-v1"}</strong><small>{d.mobileControlState?.bootstrap?.features?.voiceNotes ? "voice notes ready" : "等待能力"}</small></div>
                <div><span>操控模式</span><strong>配对 / 采集 / 撤销</strong><small>高风险动作保持人工确认</small></div>
              </div>
              {d.mobileControlState?.pairing?.code && (
                <div className="delivery-mobile-pairing">
                  <span>配对码</span>
                  <strong>{d.mobileControlState.pairing.code}</strong>
                  <small>有效至 {d.formatDateTime(d.mobileControlState.pairing.expiresAt)}</small>
                </div>
              )}
              <div className="delivery-quick-actions">
                <button type="button" onClick={() => void a.loadMobileControlPanel()} disabled={d.quickPanelBusy}>刷新设备</button>
                <button type="button" className="primary" onClick={() => void a.createMobilePairingFromPanel()} disabled={d.quickPanelBusy}>生成配对码</button>
                <small>当前版本聚焦安全操控入口：配对、状态、采集任务；不伪装成远程接管手机。</small>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Project context is available on demand; the first viewport belongs to
          task thread, changes, evidence and the bottom composer. */}
      <details className="codex-support-details codex-support-details--compact">
        <summary>
          <span>Project Context</span>
          <strong>{d.project?.name || "项目开发总览"}</strong>
          <small>{d.activeGoal ? "目标 / 基线 / 操作" : "基线 / 项目操作"}</small>
        </summary>
        <div className="codex-support-grid">
          <button type="button" onClick={a.generateBaseline} disabled={!d.project}>
            <span>Baseline</span>
            <strong>{d.baseline ? `v${d.baseline.version}` : "生成基线"}</strong>
            <small>{d.baseline?.status || "required"}</small>
          </button>
          <button type="button" onClick={a.lockBaseline} disabled={!d.project || d.baseline?.status === "locked"}>
            <span>Lock</span>
            <strong>{d.baseline?.status === "locked" ? "已锁定" : "锁定基线"}</strong>
            <small>{d.baseline?.progress ? `${d.baseline.progress.passed}/${d.baseline.progress.total}` : "no baseline"}</small>
          </button>
          <button type="button" onClick={a.runShadow} disabled={d.running || !d.project}>
            <span>Shadow</span>
            <strong>{d.running ? "检查中" : "Shadow 检查"}</strong>
            <small>PRD / PLAN / 证据</small>
          </button>
          <button type="button" onClick={a.runCurrentSubtask} disabled={d.running || !d.activeSubtask}>
            <span>Run</span>
            <strong>{d.baselineCompleted && !d.activeSubtask ? "已完成" : d.running ? "执行中" : "执行当前"}</strong>
            <small>{d.activeSubtask ? String(d.activeSubtask.sequence).padStart(3, "0") : "no task"}</small>
          </button>
          <button type="button" onClick={() => void a.runGoalPreflight?.("dispatch")} disabled={d.goalBusy || !d.activeGoal}>
            <span>Preflight</span>
            <strong>执行门控</strong>
            <small>{d.goalOs?.status || "not run"}</small>
          </button>
          <button type="button" onClick={() => a.setGoalCreateOpen((value: boolean) => !value)} disabled={!d.project}>
            <span>Goal</span>
            <strong>{d.activeGoal ? "新目标" : "创建目标"}</strong>
            <small>{d.activeGoal?.statusLabel || "optional"}</small>
          </button>
        </div>
        {d.goalNotice && <div className={`development-goal-notice ${d.goalNotice.tone}`}>{d.goalNotice.message}</div>}
        {d.goalCreateOpen && (
          <div className="development-goal-create codex-goal-create-compact">
            <input value={d.goalDraft.title} onChange={(event) => a.setGoalDraft((value: any) => ({ ...value, title: event.target.value }))} placeholder="目标名称" />
            <textarea value={d.goalDraft.objective} onChange={(event) => a.setGoalDraft((value: any) => ({ ...value, objective: event.target.value }))} placeholder="目标说明、成功样子和边界" rows={2} />
            <button type="button" onClick={() => void a.createGoal()} disabled={d.goalBusy || !d.project}>{d.goalBusy ? "创建中..." : "保存目标"}</button>
          </div>
        )}
      </details>

      {/* === Chat Thread === */}
      <div className="development-thread" ref={d.threadRef as Ref<HTMLDivElement>}>
        <div className="codex-conversation-thread" aria-label="任务对话过程">
          <article className="codex-conversation-message user">
            <header>
              <strong>用户</strong>
              <span>{d.project?.name || "copilot"}</span>
            </header>
            <p>{taskPrompt}</p>
          </article>
          {conversationEvents.length ? conversationEvents.map((event: any) => (
            <article key={event.id} className={["codex-conversation-message", eventTone(event)].filter(Boolean).join(" ")}>
              <header>
                <strong>{actorLabel(event)}</strong>
                <span>{event.type} · {d.formatDateTime(event.createdAt)}</span>
              </header>
              <p>{cleanConversationMessage(event.message)}</p>
            </article>
          )) : (
            <article className="codex-conversation-message assistant">
              <header>
                <strong>OpenClaw</strong>
                <span>ready</span>
              </header>
              <p>选择项目并开启任务后，对话过程、执行反馈和人工确认会在这里连续呈现。</p>
            </article>
          )}
          {d.visibleExecutionPulse && (
            <article className={["codex-conversation-message", "assistant", d.visibleExecutionPulse.status].filter(Boolean).join(" ")} role="status" aria-live="polite">
              <header>
                <strong>{d.executionPulseActive ? "OpenClaw 正在执行" : "执行反馈"}</strong>
                <span>{d.formatElapsed(d.visibleExecutionPulse.startedAt, d.visibleExecutionPulse.completedAt)}</span>
              </header>
              <p>{d.visibleExecutionPulse.message}</p>
            </article>
          )}
        </div>
        <details className="codex-event-log-drawer">
          <summary>
            <span>运行日志</span>
            <strong>{d.chronologicalEvents.length || 0} events</strong>
            <small>SQLite development_run_events</small>
          </summary>
          <div className="codex-event-log-list" aria-label="折叠运行日志">
            {d.visibleExecutionPulse && (
              <div className={`dev-execution-pulse ${d.visibleExecutionPulse.status}`} role="status" aria-live="polite">
                <header>
                  <div>
                    <span>{d.executionPulseActive ? "正在执行" : "执行结果"}</span>
                    <strong>{d.visibleExecutionPulse.subtaskTitle}</strong>
                  </div>
                  <small>已处理 {d.formatElapsed(d.visibleExecutionPulse.startedAt, d.visibleExecutionPulse.completedAt)}</small>
                </header>
                <p>{d.visibleExecutionPulse.message}</p>
              </div>
            )}
            {d.chronologicalEvents.length === 0 ? (
              <div className="dev-plain"><p>该项目尚无运行事件。先补齐 PRD / PLAN，或点击 Shadow 检查生成第一条开发证据。</p></div>
            ) : d.chronologicalEvents.slice(-8).map((event: any) => {
              const TimelineEventComponent = d.TimelineEventComponent;
              return (
                <TimelineEventComponent
                  innerRef={event.id === d.latestThreadEventId ? d.latestEventRef : undefined}
                  key={event.id}
                  event={event}
                />
              );
            })}
            {d.runningEvidence && (
              <div className="dev-thinking" aria-label="思考中">
                <span>正在思考</span><i></i><i></i><i></i>
              </div>
            )}
          </div>
        </details>
        {d.activeBlockerCount > 0 && (
          <div className="dev-next-actions">
            <strong>下一步 / 人工确认</strong>
            <div className={["dev-blocker-decision", d.hasWebSearchBlocker ? "search" : ""].filter(Boolean).join(" ")}>
              <span>{d.hasWebSearchBlocker ? "搜索配置门控" : "阻塞门控"}</span>
              <p>{d.blockerDecisionSummary}</p>
            </div>
            {d.visibleBlockers.map((blocker: string) => <span key={blocker}>{blocker}</span>)}
            {d.recommendedActions.length > 0 && (
              <div className="dev-choice-list" aria-label="推荐下一步">
                {d.recommendedActions.map((option: any, index: number) => (
                  <button key={option.key} type="button" onClick={() => a.chooseRecommendedAction(option.key)}>
                    <strong>{index + 1}. {option.label}</strong>
                    <small>{option.hint}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* === Composer (chat input) === */}
      <div className="development-composer">
        <div className={["dev-composer-box", d.composerManualMode ? "manual" : "", d.visibleExecutionPulse ? `pulse-${d.visibleExecutionPulse.status}` : ""].filter(Boolean).join(" ")}>
          {d.composerMenuOpen && (
            <div className="dev-quick-menu" aria-label="附加能力菜单">
              <button type="button" onClick={() => { a.setReviewMode("自动审查"); a.setComposerManualMode(false); a.setComposerText((value: string) => value || "同意执行当前子任务"); a.setComposerMenuOpen(false); }}><span>◇</span><strong>执行当前</strong><em>›</em></button>
              <button type="button" onClick={() => { a.setReviewMode("人工审批"); a.setComposerManualMode(true); a.setComposerText(""); a.setComposerNotice({ tone: "warn", message: "请粘贴真实验收证据：测试命令、截图路径、产物路径、审核结论或用户确认。" }); a.setComposerMenuOpen(false); a.focusComposer(); }}><span>✓</span><strong>申请验收</strong><em>{d.reviewMode === "人工审批" ? "开" : "关"}</em></button>
              <button type="button" onClick={() => { a.setReviewMode("自动审查"); a.setComposerManualMode(true); a.setComposerText((value: string) => value || "申请基线修订："); a.setComposerMenuOpen(false); a.focusComposer(); }}><span>!</span><strong>申请基线修订</strong><em>审批</em></button>
            </div>
          )}
          {d.visibleExecutionPulse && (
            <div className={`dev-composer-progress ${d.visibleExecutionPulse.status}`} role="status" aria-live="polite">
              <div>
                <strong>{d.executionPulseActive ? "正在执行当前子任务" : "执行反馈"}</strong>
                <span>{d.visibleExecutionPulse.message}</span>
              </div>
              {d.executionPulseActive && <i aria-hidden="true" />}
            </div>
          )}
          {d.composerNotice && <div className={`dev-composer-notice ${d.composerNotice.tone}`} role="status">{d.composerNotice.message}</div>}
          {d.recommendedActions.length > 0 && (
            <div className="dev-composer-suggestions" aria-label="Codex 式建议选项">
              {d.recommendedActions.map((option: any) => (
                <button key={option.key} type="button" onClick={() => a.chooseRecommendedAction(option.key)}>{option.label}</button>
              ))}
            </div>
          )}
          <div className="dev-composer-main">
            <button type="button" className={d.composerMenuOpen ? "dev-round active" : "dev-round"} onClick={() => a.setComposerMenuOpen((value: boolean) => !value)} aria-label="打开附加菜单">＋</button>
            <textarea
              ref={d.composerInputRef as Ref<HTMLTextAreaElement>}
              className="dev-composer-input"
              rows={d.composerManualMode || (d.composerText?.length || 0) > 42 ? 2 : 1}
              value={d.composerText}
              onChange={(event) => { a.setComposerText(event.target.value); if (d.composerNotice) a.setComposerNotice(null); }}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void a.submitComposer(); } }}
              placeholder="输入“同意执行”运行当前子任务，或切到人工审批后提交验收。"
            />
            <select className="dev-tool-select" value={d.reviewMode} onChange={(event) => a.setReviewMode(event.target.value)} aria-label="审查模式">
              <option>自动审查</option>
              <option>人工审批</option>
            </select>
            <button type="button" className="dev-send" aria-label="发送" onClick={() => void a.submitComposer()} disabled={d.running || !d.canSubmitComposer}>{d.running ? "…" : "↑"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
