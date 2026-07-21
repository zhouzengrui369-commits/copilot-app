# 右栏顶部 KPI Hero 卡 — 交付报告

## Summary

在 `DeliveryRightRail.tsx` 的 `<aside>` 顶部(`<div class="development-panel-head">` 之后、
`<section class="development-goal-evidence-console">` 之前)新增独立 hero 卡
`<section class="delivery-right-rail-kpi-hero">`,作为右栏首屏的 KPI 总览:左半
显示**目标进度**(标题 + 进度条 + N/M 子任务 + turn/heartbeat),右半显示
**Token 消耗**(大字号数字 + 单位 + 副信息),grid 1.4fr/1fr,高度 ~140px,
8px 进度条 `#0f766e → #2563eb` 渐变,1120px 断点切单列。**未改 server、未重构
goal-evidence-console-hero、未删 styles.css 已有规则、未引新依赖**。

## Changed files

| 文件 | 状态 | 改动 |
|------|------|------|
| `apps/web/src/DeliveryRightRail.tsx` | modified | +61 行:新增 `KpiHero` 私有子组件(无 activeGoal 兜底"暂无目标"),在 panel-head 之后插入 `<KpiHero data={d} />` |
| `apps/web/src/styles.css` | modified | +68 行:末尾追加 `.delivery-right-rail-kpi-hero` 规则 + 1120px 响应式 |
| `apps/web/deliverables/right-rail-kpi-screenshot.png` | new | 全桌面截图 1720×1440,显示右栏顶部新 KPI hero 卡 |
| `apps/web/deliverables/right-rail-kpi-zoom.png` | new | KPI hero 卡 zoom 1000×540,显示目标进度 + 进度条 + 10.0K tokens |

## 截图(已落地)

- `apps/web/deliverables/right-rail-kpi-screenshot.png` — 全屏:Chrome 打开
  http://127.0.0.1:38888/delivery,右栏 aside 顶部第一个 section 是新 KPI hero 卡
  (「目标进度」3/3 子任务通过 + 100% 进度条 +「TOKEN 消耗」10.0K tokens)
- `apps/web/deliverables/right-rail-kpi-zoom.png` — KPI hero 局部 zoom,可见
  目标标题"目标停机,先处置"、进度条 teal→blue 渐变、TOKEN 数字 10.0K + tokens 单位

## 数据流

KpiHero 私有组件接收 `data: d` 单 prop,直接读 `d.*`,不引入新 props 注入,改动
面只有 DeliveryRightRail.tsx + styles.css:

| 字段 | 兜底链 |
|------|--------|
| 目标标题 | `d.activeGoal?.title ?? d.activeGoalMissionControl?.label ?? '当前目标'` |
| 进度 % | `d.baseline?.progress?.percent ?? d.activeGoal?.progressPercent ?? 0` |
| 子任务 N/M | `d.activeGoal?.subtasksPassed` + `d.activeGoal?.subtasksTotal`(或 baseline 等价字段) |
| Turn 数 | `d.activeGoal?.turnCount` 或 `d.activeGoalOperatingSnapshot?.turnCount` |
| Heartbeat 数 | `d.activeGoal?.heartbeatCount` 或 `d.activeGoalOperatingSnapshot?.heartbeatCount` |
| Token 数字 | `d.shortCount(d.estimatedTokenUsage)` 或 `d.estimatedTokenUsage?.toLocaleString()` |
| Token 副信息 | 实时事件数 `d.eventStats?.totalCount` + 每 turn 平均 = `tokens / turnCount` |

## 验证

| 步骤 | 结果 |
|------|------|
| `cd apps/web && npx tsc --noEmit` | exit 0 |
| `cd apps/web && npx vite build` | exit 0(built in 6.74s,新代码落到 `index-q63ZyY6k.js`) |
| Chrome 打开 `http://127.0.0.1:38888/delivery` | 右栏 aside 顶部第一个 section = 新 KPI hero 卡 ✓ |
| `git log --oneline -3` | `12d60ec feat: 右栏顶部 KPI hero 卡 — 独立展示目标进度 + token 消耗` ✓ |
| `git diff --stat HEAD~1` | `DeliveryRightRail.tsx +61 / styles.css +68 / 2 files changed, 129 insertions` ✓ |
| Commit message 末尾 | `Plan-Id: right-rail-kpi-hero` ✓ |

## Notes for verifier

1. **截图包含的环境**:Chrome 在显示器左半屏(0-1720px),右侧是 OpenClaw Workbench 独立
   app chat 窗口(不是 Chrome 内容);KPI hero 卡在 Chrome 窗口的左下角(右栏 aside)。
2. **进度条颜色**:`#0f766e → #2563eb` 线性渐变;这条新增规则用 class scope
   `.delivery-right-rail-kpi-hero`,不污染其他 `.progress-fill`。
3. **spec 偏差说明**:spec 提到 token 估算用 "events × 800 tokens";实际项目代码
   (`App.tsx L6027-6033`) 用 `Math.max(0, Math.ceil(outputCharacterCount/1.8))`。
   KpiHero 按 spec 指示直接读 `d.estimatedTokenUsage`,与项目实际算法一致;无新增
   估算逻辑。
4. **响应式**:1120px 断点切单列(与现有 `.development-board-column` 一致);696px /
   600px 已有更小断点保留,KPI hero 高度自适应内容。
5. **可访问性**:KPI hero `<section aria-label="右栏顶部 KPI 总览">`,进度条
   `role="progressbar" aria-valuenow / aria-valuemin / aria-valuemax`。
6. **Aria labels**(避免和 goal-evidence-console 重复):KpiHero 内部 "目标进度"
   "TOKEN 消耗" 用 `<div class="kpi-label">` 不用 `<h*>`(因为右栏面板-head
   已经有 "GOAL EVIDENCE CONSOLE / 目标证据控制台" 标题)。
