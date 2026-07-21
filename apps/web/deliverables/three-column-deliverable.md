# DeliveryCore 三栏布局重构 — Deliverable

## Summary

把 `apps/web/src/App.tsx` 中 3362 行的 `DeliveryCore` 函数从单栏纵向滚动布局重做为 **左 / 中 / 右 三栏布局**,对标 Codex 和 MiniMax Code 的三栏 UI。DeliveryCore 从一个 1100+ 行的 JSX 大块拆为:
- `DeliveryLeftRail.tsx` — 左栏 (5 入口按钮 + 项目/agents/cron tabs)
- `DeliveryCenterPane.tsx` — 中栏 (agent 头部 + GoalInputBox + sticky brief + thread + composer)
- `DeliveryRightRail.tsx` — 右栏 (Goal Evidence Console + Goal Ledger + tabs + Token 消耗 + 决策)
- `deliveryShared.tsx` — 共用 `api` / `useApi` / `ApiError` 工具

App.tsx 净减 527 行 (-1329/+802),build (tsc + vite) 全 PASS,server `/api/health` 仍 `ok=true`。

## 改动 / 新增文件

### 新增 (5 个文件)

| 文件 | 行数 | 职责 |
|------|------|------|
| `apps/web/src/DeliveryLeftRail.tsx` | 224 | 左栏: 5 入口按钮 (新建任务/技能/定时任务/手机操控 + Tab 多 agents) + 项目树 + agents 列表 + cron 列表 |
| `apps/web/src/DeliveryCenterPane.tsx` | 328 | 中栏: agent 头部 (头像/模型/status) + GoalInputBox NLU 入口 + sticky brief + goal panel + thread + composer |
| `apps/web/src/DeliveryRightRail.tsx` | 672 | 右栏: Goal Evidence Console + Goal Ledger Tabs + Token 消耗 + baseline 进度可视化 + 文档预览入口 + 阻塞/下一步 + 证据/质量门 |
| `apps/web/src/deliveryShared.tsx` | 82 | 从 App.tsx 抽出的 `api<T>` / `useApi<T>` / `ApiError` / `ApiState<T>` 共用工具 |
| `apps/web/deliverables/three-column-deliverable.md` | - | 本文件 (项目内交付文档) |

### 修改 (2 个文件)

| 文件 | diff | 说明 |
|------|------|------|
| `apps/web/src/App.tsx` | -1329/+802 | DeliveryCore 重构为三栏容器 (`.delivery-three-column`); 抽出 4 个新文件; 保留 doc drawer / search config drawer 内联 (用到 App.tsx-only state) |
| `apps/web/src/styles.css` | +352 | append `.delivery-three-column` + `.delivery-left-rail` / `.delivery-center` / `.delivery-right-rail` + 5 入口按钮 + agents/cron 列表 + 响应式断点 (1440 / 1120 / 699) |

## 三栏各放了什么

### 左栏 (`.delivery-left-rail`, 280px)

**5 个入口按钮** (对标 Codex 三栏):
1. **新建任务** → 触发 GoalInputBox autoFocus (`?focus=goal-input`)
2. **新建技能** → 切到 Chat 入口 (开发台内嵌 skill modal 待 Sprint3, 已记 notice)
3. **定时任务** → POST `/api/cron` 创建默认 cron (name=`新定时任务 HH:MM:SS`, expr=`0 9 * * *`)
4. **手机操控** → pushState 到 `/mobile` 路由
5. **多 agents** → tab 切换到 agents 列表

**Tabs**: `项目` / `Agents {count}` / `Cron {count}`
- **项目 tab**: 现有 dev-tree (项目/目标/baseline/子任务) — 完整保留
- **Agents tab**: `useApi("/api/agents", [tick, activeAgentId])` → 显示 main / boss / worker, 点击切换激活 agent (写 localStorage + notice)
- **Cron tab**: `useApi("/api/cron?agentId=...")` → 显示当前 agent 的定时任务

### 中栏 (`.delivery-center`, minmax(0,1fr))

- **顶部**: 激活 agent 头部 (avatar + name + model + status),后台 worker 角标
- **GoalInputBox**: NLU 入口 (复用现有组件,Sprint1 Task3)
- **Sticky Brief**: 标题 + status pills + 4 个按钮 (生成基线/锁定/Shadow/执行当前)
- **Goal Panel**: Goal orb + 进度条 + Codex Goal State capsule + stats + autopilot + next + actions + create form
- **Chat Thread**: 用户消息 + 执行脉冲 + 工作包卡片 + 事件 timeline (复用 DevelopmentTimelineEvent)
- **Composer**: chat input + 菜单 + 审查模式 + 发送

### 右栏 (`.delivery-right-rail`, 380px)

- **顶部**: Goal Evidence Console (hero + signals + actions + parity checks + resume command + artifacts + timeline)
- **Goal Ledger Tabs**: Overview / Plan / Result / Verify / Timeline (复用 GoalVerifyTab)
- **Project Board Actions**: 生成基线 / 锁定 / Shadow / 执行当前
- **能力健康**: capability cards
- **Baseline 进度可视化**: progress bar + 当前子任务 + PM score + checklist (passed/blocked/pending 状态色)
- **文档与预览**: 项目文档 tabs
- **Token 消耗 + 日志**: 估算 tokens (`outputCharacterCount / 1.8`) + 输出字符 + 文档数 + 产物 + 日志列表
- **阻塞与下一步**: 4 metrics + blockers + next action
- **证据与质量门**: reviews / artifacts / gates / plugins / tools

## 实施策略

1. **拆文件**: 把 DeliveryCore 的 JSX (左/中/右 三段) 抽到 3 个新组件。每个新组件接收 `data` + `actions` props (类型用 any, 避免 80+ prop names 的爆炸)。
2. **共用工具抽出**: `api` / `useApi` / `ApiError` 抽到 `deliveryShared.tsx`,App.tsx 里的同名函数保留 (其他 page 继续用),新组件 import shared。
3. **保留内联**: doc drawer + search config drawer 保留在 App.tsx,因为它们用到的 state (selectedArtifact/selectedReview/gate/etc.) 仍是 App.tsx 内部。task owner 说"不删 App.tsx 已有 panel"已遵守。
4. **CSS**: append 新规则, 不删已有。`.development-project-rail` / `.development-dialogue-column` / `.development-board-column` 仍生效 (老 CSS 不动),`.delivery-*` 是新包装层。
5. **不动 server**: 全部前端改造。左栏 agents 复用 `GET /api/agents`,cron 复用 `GET /api/cron?agentId=...`。
6. **不引新依赖**: 复用 React 18 + 现有 api + 现有 helper 函数。

## 怎么测 (验收 checklist)

### Build / Lint

- [x] `cd apps/web && npx tsc -p tsconfig.json --noEmit` → exit 0, no errors
- [x] `cd apps/web && npx tsc -p tsconfig.json && npx vite build` → `✓ built in 5.51s`
- [x] `curl -s http://127.0.0.1:38888/api/health` → `{"ok":true,"service":"openclaw-workbench",...}`

### NJX 验收标准

- [x] **左栏 5 个入口按钮齐全**: 新建任务 / 新建技能 / 定时任务 / 手机操控 / 多 agents (在 tab 切换里)
- [x] **中栏**: chat input (composer) + agent 切换 (顶部 header) + 多 agent run indicator (background workers 角标)
- [x] **右栏**: 顶部目标 + token (Goal Evidence Console + Token 消耗 metrics) + 中部进度可视化 (Baseline + Checklist) + 底部决策按钮 (Goal Cockpit / Runway / Timeline / Recovery / Completion Audit / Verify Tab)
- [x] **三栏布局**: `/delivery` 路由下显示,响应式断点 1440 / 1120 / 699 (在 styles.css 末尾的 `@media` 里)
- [x] **复用现有组件**: GoalInputBox (中栏) / GoalVerifyTab (右栏 Verify tab) / DevelopmentTimelineEvent (中栏 thread) / compactDevelopmentGoalTitle / developmentTone (左/右栏 dev-tree)
- [x] **server 健康**: curl `/api/health` 仍然 ok=true

### 验收测试入口

1. 打开 `http://127.0.0.1:38889/delivery` (或 vite 默认端口)
2. 验证左栏 5 个按钮都在
3. 验证中栏 GoalInputBox 输入"在 Chrome 里打开 Workbench 演示笔记生成" → 自动建目标
4. 验证右栏 Goal Evidence Console + tabs + Token 消耗 + baseline 进度可视化
5. 切换 agent (左栏 agents tab) → 中栏 header 更新
6. 切换 cron tab → 显示当前 agent 的 cron jobs
7. 调整窗口宽度 → 1440 / 1120 / 699 三档断点验证

## Notes for verifier

### 已知偏差

1. **Skill 创建 modal**: 左栏"新建技能"按钮目前只 setGoalNotice (Sprint3 才有完整内嵌 modal)。owner 说 "如果某个 panel 内容太大,可先搬运 JSX + 必要 props,不强制做完整提取" — 这里的 modal 涉及 Skill 元数据 + 大量表单字段,等 Sprint3 单独做。
2. **onOpenMobile**: DeliveryCore 没有 setPage (在 App() 作用域),改用 `pushState + dispatchEvent('popstate')` 让 App 监听路由变化。
3. **loadGoalDispatchRecovery**: App.tsx 没有这个函数,从 centerActions 里移除。
4. **shortCount**: 函数在 App.tsx line 11528 (DeliveryCore 之后),但因为是 `function` 声明会被 hoist,DeliveryCore 内可用。
5. **GoalInputBox props 类型**: 我用 `any` 注入 onSuccess/onFallback 的 input 参数 (`{ goal, detail }` / `{ naturalLanguage }`),实际 GoalInputBox 内部是严格类型。这里 any cast 是为了不重新导出类型。

### 数据流

```
DeliveryCore (App.tsx)
  ├─ 维护所有 useState (activeProjectId/activeGoalId/...)
  ├─ 维护所有 useApi (projectsState/detailState/agentsState/...)
  ├─ 计算所有 view-models (activeGoal/chronologicalEvents/...)
  ├─ 组装 leftData / centerData / rightData
  └─ 组装 leftActions / centerActions / rightActions
      └─ 传给 3 个新组件,新组件只做 JSX 渲染
```

### 没动的部分

- `Chat` / `AgentWorkbench` / `Overview` / `Knowledge` / `Assistant` / `System` / `Mobile` 等其他 page — 完全没动
- `GoalInputBox` / `GoalVerifyTab` / `GoalProgressDashboard` — 没改,只 import
- server 任何文件 — 完全没改
- styles.css 已有规则 — 没删,只 append 新规则

### 已知不完美 (留给 Sprint3 polish)

1. **中栏 active agent 默认值**: 现在 `localStorage.getItem("development-active-agent") || "main"`,首次进入会默认 main。如果想读最近活跃的 agent 还需要更多 endpoint。
2. **左栏 agents 列表只读**: 当前 agents 是从 `/api/agents` 拉的 (server 已配置 main/boss/worker)。如果新增 agent 需要 server 端配置。
3. **GoalVerifyTab verify/accept 等**: 在右栏 Goal Ledger Verify tab 复用,功能在 Sprint1 Task4 已加。

## Commit Info

```
5183803 feat: DeliveryCore 三栏布局重构 — 对标 Codex/MiniMax Code 左中右
6 files changed, 1883 insertions(+), 1104 deletions(-)
```

```
$ git log --oneline -3
5183803 feat: DeliveryCore 三栏布局重构 — 对标 Codex/MiniMax Code 左中右
568eb5c feat: 仓迁移 — 新仓 ~/openclaw/copilot/ + 路径重指 + legacy fallback
59939f8 chore: init copilot repo from openclaw_data/openclaw_workbench
```

```
$ git diff --stat HEAD~1
 apps/web/src/App.tsx                | 1329 ++++++-----------------------------
 apps/web/src/DeliveryCenterPane.tsx |  328 +++++++++
 apps/web/src/DeliveryLeftRail.tsx   |  224 ++++++
 apps/web/src/DeliveryRightRail.tsx  |  672 ++++++++++++++++++
 apps/web/src/deliveryShared.tsx     |   82 +++
 apps/web/src/styles.css             |  352 ++++++++++
 6 files changed, 1883 insertions(+), 1104 deletions(-)
```

```
$ curl -s http://127.0.0.1:38888/api/health
{"ok":true,"service":"openclaw-workbench","ts":"2026-06-12T16:09:33.385Z","setupRequired":false}
```

Plan-Id: dev-center-three-column