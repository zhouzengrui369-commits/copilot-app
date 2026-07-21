// DeliveryLeftRail — 开发台左栏 (Sprint2 三栏布局重构)
//
// 职责 (左栏 5 入口 + 项目列表单层, 对标 Codex 三栏):
//   1. 5 个入口按钮 (新建任务 / 新建技能 / 定时任务 / 手机操控 / 多 agents)
//   2. 项目列表 (单层, 不再有 tab 切换; 直接复用 existing dev-tree 渲染)
//   3. 多 agents 入口按钮 → 弹出行内 agents picker (Codex 风格的紧凑 popover,
//      列在线 agent, 点击即切换 active agent)
//
// 数据契约:
//   * projects, goals, baseline, subtasks — 从 useApi("/api/development/projects") + detail
//   * agents — 从 useApi("/api/agents") 拉取, 每个 agent 含 id/name/avatar/status/model
//   * 切换 agent 触发 onActivateAgent(agentId) 通知父组件
//
// 设计约束:
//   * 不引新依赖 (复用 React + 现有 api)
//   * props 使用 any + comment, 避免与 App.tsx 巨型类型强耦合
//   * 渲染复用 existing .development-project-rail + .dev-tree CSS (不删, 只加 .delivery-left-rail)
//   * 移除 Sprint1 设计的 tab 切换层 (项目 / Agents / Cron), agents 走 popover,
//     cron 走"定时任务"入口按钮直接创建 (列表仍由 server /api/cron 维护, 不再在左栏内嵌)
//
import { useState } from "react";
import { useApi } from "./deliveryShared";

export interface DeliveryLeftRailProps {
  // 项目 / 目标 / 子任务数据
  projects: any[];
  rankedProjects: any[];
  project: any;
  goals: any[];
  baseline: any;
  subtasks: any[];
  activeGoal: any | null;
  activeSubtask: any | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onArchiveProject: () => void;
  onSelectGoal: (projectId: string, goalId: string) => void;
  onSelectSubtask: (projectId: string, subtaskId: string) => void;
  onSelectBaseline: (projectId: string) => void;
  // 5 个入口 (顺序固定: 任务 / 技能 / 定时任务 / 手机操控 / 多 agents)
  onCreateTask: () => void;
  onCreateSkill: () => void;
  onCreateCron: () => void;
  onOpenMobile: () => void;
  // agents (5 入口第 5 项, 走 popover, 不再占 tab)
  activeAgentId: string;
  onActivateAgent: (agentId: string) => void;
  // helpers (optional pass-through)
  helpers: {
    compactDevelopmentGoalTitle: (goal: any, maxLength?: number) => string;
    developmentTone: (status: string) => string;
    developmentStatusLabel: (status: string) => string;
  };
}

export default function DeliveryLeftRail(props: DeliveryLeftRailProps) {
  const {
    projects: _projects, rankedProjects, project, goals, baseline, subtasks,
    activeGoal, activeSubtask, query,
    onQueryChange, onSelectProject, onCreateProject, onArchiveProject,
    onSelectGoal, onSelectSubtask, onSelectBaseline,
    onCreateTask, onCreateSkill, onCreateCron, onOpenMobile,
    activeAgentId, onActivateAgent,
    helpers,
  } = props;

  // 多 agents popover 开关 (单层左栏唯一 state)
  const [agentsOpen, setAgentsOpen] = useState(false);

  // agents 列表 — server 返回 { ok, agents: [{ id, name, avatar, status, model, role }] }
  const agentsState = useApi<any>("/api/agents", [agentsOpen]);
  const agents = (agentsState.data?.agents || []) as any[];
  const taskStackGoals = goals.slice(0, 5);
  const currentProjectId = project?.id || rankedProjects[0]?.id || "";
  const currentProgress = baseline?.progress ? `${baseline.progress.passed}/${baseline.progress.total}` : subtasks.length ? `0/${subtasks.length}` : "0/0";
  const currentTaskTitle = activeSubtask
    ? `${String(activeSubtask.sequence).padStart(3, "0")} ${activeSubtask.title}`
    : activeGoal
      ? helpers.compactDevelopmentGoalTitle(activeGoal, 42)
      : project?.name || "未选择任务";
  const currentTaskStatus = activeSubtask?.status || activeGoal?.status || baseline?.status || project?.status || "waiting";

  return (
    <aside className="development-project-rail delivery-left-rail" aria-label="开发台左栏">
      {/* 5 个入口按钮 (对标 Codex 三栏, 单层布局, 不再有 tab) */}
      <div className="delivery-left-rail-actions">
        <button type="button" className="delivery-left-rail-action primary" onClick={onCreateTask} title="新任务：选择项目并开启任务">
          <span>＋</span><strong>新任务</strong><small>Start</small>
        </button>
        <button type="button" className="delivery-left-rail-action" onClick={onCreateSkill} title="新建技能">
          <span>◇</span><strong>新建技能</strong><small>Skill</small>
        </button>
        <button type="button" className="delivery-left-rail-action" onClick={onCreateCron} title="新建定时任务">
          <span>C</span><strong>定时任务</strong><small>Cron</small>
        </button>
        <button type="button" className="delivery-left-rail-action" onClick={onOpenMobile} title="手机操控">
          <span>M</span><strong>手机操控</strong><small>Mobile</small>
        </button>
        <button
          type="button"
          className={["delivery-left-rail-action", "delivery-left-rail-agents-toggle", agentsOpen ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => setAgentsOpen((prev) => !prev)}
          title={`多 agents (当前: ${activeAgentId || "main"})`}
          aria-expanded={agentsOpen}
          aria-controls="delivery-left-rail-agents-popover"
        >
          <span>AI</span><strong>多 agents</strong><small>{agents.length ? `·${agents.length}` : "切换"}</small>
        </button>
      </div>

      {/* 多 agents popover (Codex 风格, 行内展开, 不挤占项目列表) */}
      {agentsOpen && (
        <div id="delivery-left-rail-agents-popover" className="delivery-left-rail-agents" aria-label="多 agents 切换">
          {agents.length === 0 && <p className="muted dev-plain">{agentsState.loading ? "载入中..." : "暂无 agent"}</p>}
          {agents.map((agent: any) => (
            <button
              key={agent.id}
              type="button"
              className={["delivery-left-rail-agent", agent.id === activeAgentId ? "active" : "", agent.status === "offline" ? "offline" : ""].filter(Boolean).join(" ")}
              onClick={() => {
                onActivateAgent(agent.id);
                setAgentsOpen(false);
              }}
              title={`${agent.role || agent.name} · ${agent.status}`}
            >
              <span className="agent-avatar">{agent.avatar || agent.id.slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{agent.name || agent.id}</strong>
                <small>{agent.role || "OpenClaw Agent"}</small>
                <small>模型: {typeof agent.model === "object" ? agent.model?.value || "未配置" : agent.model || "未配置"}</small>
              </div>
              <span className={["delivery-left-rail-agent-status", agent.status === "online" ? "ok" : agent.status === "busy" ? "warn" : "error"].filter(Boolean).join(" ")}>
                {agent.status || "unknown"}
              </span>
            </button>
          ))}
        </div>
      )}

      <section className="delivery-task-stack" aria-label="当前任务导航">
        <header>
          <span>Task Stack</span>
          <strong title={currentTaskTitle}>{currentTaskTitle}</strong>
          <small>{helpers.developmentStatusLabel(currentTaskStatus)} · {currentProgress} baseline</small>
        </header>
        <div className="delivery-task-stack-current">
          <button
            type="button"
            className={["delivery-task-stack-row", "current", helpers.developmentTone(currentTaskStatus)].filter(Boolean).join(" ")}
            onClick={() => activeSubtask ? onSelectSubtask(currentProjectId, activeSubtask.id) : activeGoal ? onSelectGoal(currentProjectId, activeGoal.id) : currentProjectId && onSelectProject(currentProjectId)}
            disabled={!currentProjectId}
          >
            <span>{activeSubtask ? String(activeSubtask.sequence).padStart(3, "0") : "GO"}</span>
            <strong>{currentTaskTitle}</strong>
            <small>{helpers.developmentStatusLabel(currentTaskStatus)}</small>
          </button>
        </div>
        <div className="delivery-task-stack-list">
          {taskStackGoals.map((goal: any) => (
            <button
              key={goal.id}
              type="button"
              className={["delivery-task-stack-row", goal.id === activeGoal?.id ? "active" : "", helpers.developmentTone(goal.status)].filter(Boolean).join(" ")}
              onClick={() => onSelectGoal(goal.projectId || currentProjectId, goal.id)}
              title={goal.title || goal.objective}
            >
              <span>◎</span>
              <strong>{helpers.compactDevelopmentGoalTitle(goal, 40)}</strong>
              <small>{goal.statusLabel || helpers.developmentStatusLabel(goal.status)}</small>
            </button>
          ))}
          {subtasks.slice(0, 5).map((subtask: any) => (
            <button
              key={subtask.id}
              type="button"
              className={["delivery-task-stack-row", subtask.id === activeSubtask?.id ? "active" : "", helpers.developmentTone(subtask.status)].filter(Boolean).join(" ")}
              onClick={() => onSelectSubtask(currentProjectId, subtask.id)}
              disabled={!currentProjectId}
            >
              <span>{String(subtask.sequence).padStart(3, "0")}</span>
              <strong>{subtask.title}</strong>
              <small>{helpers.developmentStatusLabel(subtask.status)}</small>
            </button>
          ))}
        </div>
      </section>

      {/* 项目树降级为二级浏览区；首屏优先展示 Task Stack。 */}
      <details className="delivery-project-tree-fold">
        <summary>
          <span>Project Browser</span>
          <strong>{rankedProjects.length} 项目</strong>
          <small>{project?.name || "未选择项目"}</small>
        </summary>
        <div className="dev-tree">
        <div className="dev-tree-actions">
          <button className="dev-tree-action primary" type="button" onClick={onCreateProject}>
            <span>＋</span><strong>新项目</strong><small>New</small>
          </button>
          <label className="dev-tree-search">
            <span>⌕</span>
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索项目" />
          </label>
        </div>
        <div className="dev-tree-section">
          <div className="dev-tree-heading">
            <span>项目</span>
            <button type="button" onClick={onArchiveProject} disabled={!project}>归档</button>
          </div>
          {rankedProjects.map((item: any) => {
            const itemBaseline = item.id === project?.id ? baseline : item.baseline;
            const itemSubtasks = item.id === project?.id ? subtasks : itemBaseline?.subtasks || [];
            const itemGoals = item.id === project?.id ? goals : item.goals || [];
            return (
              <div key={item.id} className="dev-tree-project">
                <button
                  className={item.id === project?.id ? "dev-tree-folder active" : "dev-tree-folder"}
                  type="button"
                  aria-current={item.id === project?.id ? "page" : undefined}
                  onClick={() => onSelectProject(item.id)}
                >
                  <span>{item.id === project?.id ? "▾" : "▸"}</span>
                  <strong>{item.name}</strong>
                  <small>{itemGoals.length ? `${itemGoals.length} 目标` : itemBaseline?.progress ? `${itemBaseline.progress.passed}/${itemBaseline.progress.total}` : `${item.packetCount || 0} 包`}</small>
                </button>
                {itemGoals.slice(0, item.id === project?.id ? 6 : 1).map((goal: any) => (
                  <button
                    className={["dev-tree-row goal", goal.id === activeGoal?.id ? "active" : "", helpers.developmentTone(goal.status) === "warn" ? "warn" : ""].filter(Boolean).join(" ")}
                    type="button"
                    key={goal.id}
                    title={goal.title || goal.objective}
                    onClick={() => onSelectGoal(item.id, goal.id)}
                  >
                    <span>◎</span>
                    <strong>{helpers.compactDevelopmentGoalTitle(goal, 44)}</strong>
                    <small>{goal.statusLabel || helpers.developmentStatusLabel(goal.status)}</small>
                  </button>
                ))}
                {itemBaseline && (
                  <button
                    className={["dev-tree-row packet", itemBaseline.id === baseline?.id ? "active" : "", helpers.developmentTone(itemBaseline.status) === "warn" ? "warn" : ""].filter(Boolean).join(" ")}
                    type="button"
                    onClick={() => onSelectBaseline(item.id)}
                  >
                    <span>◇</span>
                    <strong>项目任务基线 v{itemBaseline.version}</strong>
                    <small>{helpers.developmentStatusLabel(itemBaseline.status)}</small>
                  </button>
                )}
                {itemSubtasks.slice(0, item.id === project?.id ? 24 : 3).map((subtask: any) => (
                  <button
                    className={["dev-tree-row sub", subtask.id === activeSubtask?.id ? "active" : "", helpers.developmentTone(subtask.status) === "warn" ? "warn" : ""].filter(Boolean).join(" ")}
                    type="button"
                    key={subtask.id}
                    onClick={() => onSelectSubtask(item.id, subtask.id)}
                  >
                    <span>{subtask.status === "passed" ? "✓" : "•"}</span>
                    <strong>{String(subtask.sequence).padStart(3, "0")} {subtask.title}</strong>
                    <small>{helpers.developmentStatusLabel(subtask.status)}</small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="dev-tree-footer">
          <button type="button" onClick={onCreateProject}>新项目</button>
          <button type="button" onClick={onArchiveProject} disabled={!project}>归档所选</button>
        </div>
        </div>
      </details>
    </aside>
  );
}
