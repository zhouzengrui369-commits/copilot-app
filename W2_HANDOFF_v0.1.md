# W2 (Sprint2 Week 1) 启动 + 6/12 + 6/15 验收 handoff
> PM: Mavis
> 创建: 2026-06-10 23:20
> 路径: `/Users/njx/openclaw_data/openclaw_workbench/W2_HANDOFF_v0.1.md`
> 状态: 草稿 v0.1（W2 实际 6/16 启动，本 doc 提前准备）
> 关联: SPRINT_2_PLAN_v0.2_DRAFT + SESSION_ARCHITECTURE_v0.1

---

## TL;DR — 接下来 5 天 (6/10 - 6/15) 节奏

| 日期 | 时间 | 事件 | 谁负责 | 备好文件 |
|------|------|------|--------|---------|
| 6/10 周三 | 22:30-23:30 | **本 doc 起草** | Mavis | W2_HANDOFF_v0.1.md |
| 6/11 周四 | 全天 | 修整 / 等 6/12 acceptance | Mavis | — |
| 6/12 周五 | 09:00 | **Day3 acceptance cron 自动 fire** | cron | mavis-sprint1-day3-acceptance |
| 6/12 周五 | 09:00-10:00 | 监控 + 报错（如果 FAIL）| Mavis | 失败处理 SOP（见下）|
| 6/12 周五 | 10:00 | 通知 njx（PASS/FAIL + 状态）| Mavis | heartbeat 或 message |
| 6/13-6/14 | 周末 | 等 njx 复盘 / 准备 Sprint2 v1.0 | Mavis | SPRINT_2_PLAN_v1.0 草稿 |
| 6/15 周一 | 21:00 | **Sprint1 整体验收会议** | Mavis + njx | 端到端 demo + 录屏 |
| 6/15 周一 | 21:30 | Sprint2 plan v1.0 定稿 + 启动 W2 | Mavis | SPRINT_2_PLAN_v1.0.md |
| 6/16 周二 | 09:00 | **Sprint2 启动 + 派 Task 2.1 worker** | Mavis | plan_b88df442 (新) |

---

## 6/12 09:00 Day3 Acceptance — 准备 checklist

### 6/11 必须完成的准备

- [ ] **NLU endpoint 实际跑通一次**（curl E2E）：
  ```bash
  curl -X POST http://localhost:38888/api/development/goals/from-natural-language \
    -H 'Cookie: owb_session=...（先登录拿 session）' \
    -H 'Content-Type: application/json' \
    -d '{"naturalLanguage":"在 Chrome 里打开 Workbench 演示笔记生成，截图存证","projectId":"<id>"}'
  ```
  期望：201 + Goal detail 含 3 subtasks

- [ ] **verify harness 端到端 smoke**：调 `/api/computer-use/verify` 看是否真打开 Chrome + 截图存档
- [ ] **workbench server 进程在跑**：`pgrep -f workbench-38888`
- [ ] **04:00-05:00 LaunchAgent 跑成功**（v0.3.2 修完后）—— 看 `/tmp/nas_obsidian_sync.log` 结尾 OK

### 6/12 acceptance cron fire 后 — 监控 SOP

1. **看 cron lastRun 状态**：`mavis cron info mavis mavis-sprint1-day3-acceptance`
2. **看 cron 输出的 report**：在 cron session log 里
3. **PASS 信号**：报告里写"端到端 demo PASS"或类似
4. **FAIL 信号**：
   - LLM 拆解失败（gateway 不可用）→ 立即切 fallback
   - Chrome 没打开（cu MCP 失败）→ 退到 playwright MCP
   - 截图存档失败（路径权限）→ 退到 degraded 模式 + 显式标红
5. **FAIL 时限**：FAIL 后 1h 内 steer 不超过 2 次；2 次仍 FAIL → 升级 njx 拍板

### 6/12 acceptance 失败处理决策树

```
6/12 acceptance FAIL
├─ LLM gateway 不可用?
│  ├─ YES → 走 fallback（minimal goal 入库），UI 提示 "AI 拆解暂不可用"
│  └─ NO → continue
├─ Chrome / cu MCP 不可用?
│  ├─ YES → 退到 playwright MCP 试一次
│  └─ NO → continue
├─ 截图存档失败?
│  ├─ YES → 写 degraded 报告 + 标 "evidence incomplete"
│  └─ NO → continue
└─ 其他?
   ├─ 1h 内 1 次失败 → 自动 retry
   ├─ 1h 内 2 次失败 → 暂停 + 报 njx
   └─ 1h 内 3 次失败 → 取消当日 acceptance，6/13 09:00 retry
```

---

## 6/15 21:00 Sprint1 整体验收 — checklist

### 验收前（6/13-6/14 完成）

- [ ] 端到端 demo 录屏：从用户输入"在 Chrome 里打开..."到 Goal 完成 ACCEPT 全流程
- [ ] 截图存档：至少 5 张关键步骤（输入框 / 拆解中 / Goal 详情 / Verify tab / ACCEPT 后状态）
- [ ] 3 个核心 verify endpoint curl PASS（accept / reject / redo）
- [ ] 浏览器 E2E 跑通（playwright）
- [ ] all 6 development-gates.json PASS（npm run check && npm run build && npm run test:prd && npm run test:e2e && npm run security:scan）
- [ ] Sprint1 commit 全部合到 main / develop

### 验收会议（6/15 21:00，1h）

- [ ] 0-15min: 端到端 demo 播放
- [ ] 15-30min: 录屏 review（用户主导）
- [ ] 30-45min: 4 个 Sprint2 决策点拍板
- [ ] 45-60min: Sprint2 plan v1.0 定稿签字 + W2 启动协议

### 验收后（6/15 22:00 - 6/16 09:00）

- [ ] SPRINT_2_PLAN_v0.2 → v1.0（基于用户决策调整）
- [ ] SESSION_ARCHITECTURE_v0.1 → v1.0（如有用户反馈）
- [ ] 起 plan_b88df442（Sprint2 worker plan）
- [ ] W2 heartbeat cron 设置

---

## W2 (6/16 - 6/22) 启动 checklist

### 6/16 Day1 早上

- [ ] plan_b88df442 启动（coder 跑 Task 2.1 + 2.3）
- [ ] heartbeat cron 12h 设好
- [ ] Task 2.1 prompt version `goal-nlu-prompt-20260616a` 验证独立
- [ ] DB migration 准备（migrations/20260616_001_goal_nlu_sessions.sql）

### W2 任务清单（按 SPRINT_2_PLAN_v0.2）

| Day | 日期 | Task | 交付物 | 估时 |
|-----|------|------|--------|------|
| 1 | 6/16 周一 | Sprint1 验收 + Sprint2 plan v1.0 定稿 | v1.0 plan | 1 天 |
| 2 | 6/17 周二 | Task 2.1 NLU 多轮协议 | parseGoalNluMultiTurn + 3 单测 | 1.5 天 |
| 3 | 6/18 周三 | Task 2.3 Goal session 状态机 | 6 endpoint + DB migration | 2.5 天（v0.2 加 pause/resume）|
| 4 | 6/19 周四 | Task 2.5 子任务结构化派生 | 8 unit case | 1.5 天 |
| 5 | 6/20 周五 | Task 2.2 NLU 反问 UI（核心）| NluConversation.tsx | 1 天（v0.2 砍 chip）|

### W2 退出标准（6/22 21:00）

- [ ] Task 2.1 + 2.3 + 2.5 + 2.2 全部 code + test PASS
- [ ] W2 plan auto-accept
- [ ] W3 Task 2.4 + 2.7 + 2.6 计划 ready

---

## 关键文件位置（njx 复盘会时直接打开）

| 文档 | 路径 | 当前版本 |
|------|------|---------|
| 产品愿景 | `PRODUCT_VISION_v1.0.md` | v1.0 ✓ |
| Sprint1 plan | `SPRINT_1_PLAN.md` | v1.0 ✓ |
| Sprint1 进展报告 | `reports/sprint1-day1-progress.md` | v1.0 |
| Sprint1 Task4 deliverable | `reports/sprint1-task4-verify-tab.deliverable.md` | v1.0 |
| **Sprint2 plan** | `SPRINT_2_PLAN_v0.2_DRAFT.md` | **v0.2**（待 6/15 升 v1.0）|
| **Codex 能力差距** | `CODEX_LONG_RUN_CAPABILITY_GAP_v0.1.md` | **v0.1** |
| **Session 架构** | `SESSION_ARCHITECTURE_v0.1.md` | **v0.1** |
| **W2 handoff** | `W2_HANDOFF_v0.1.md` | **v0.1**（本文件）|

---

## 关键 cron + skill 状态

| 名称 | schedule | 状态 | 关联 |
|------|----------|------|------|
| `mavis-sprint1-day3-acceptance` | 6/12 09:00 | 待 fire | Day3 Task2 真实 Chrome 截图 gate |
| `mavis-njx-heartbeat-12h` | 每 12h | active | 状态汇报 |
| `vault-curate-daily` | 每天 02:00 | active | cluster_topics.py 含新 cleanup 逻辑 |
| `vault-curate-monthly-deep` | 每月 1 号 03:00 | active | — |
| `笔记整理` | 每天 08:00 | active | — |
| `com.openclaw.nas_obsidian_sync` (LaunchAgent) | 每天 03:00 | **已修** (v0.3.2) | vault 路径 hardcode 修 |

---

## 决策点（6/15 21:00 复盘会 njx 拍板）

Sprint2 plan v0.2 列了 8 个决策点，建议默认：

| # | 决策 | 默认建议 |
|---|------|---------|
| 1 | 反问上限 | 2 轮 |
| 2 | 子任务必含项 | plan + verify |
| 3 | Goal session 用户名 | 目标草稿 |
| 4 | 回退策略 | 强 fallback 一次输入 |
| 5 | session auto ready_to_create 时限 | 24h |
| 6 | paused session 过期 | 7 天 |
| 7 | Sprint2 推 1 天到 6/30 | 同意 |
| 8 | Sprint3 起点 7/1 | 同意 |

8/8 默认 = "Sprint2 11.5 天，6/30 收尾，7/1 Sprint3 启动 + W4 Gate 复盘"

---

## 风险预警（6/12 之前要 watch）

| 风险 | 信号 | 缓解 |
|------|------|------|
| NLU endpoint 在 6/12 之前 502 | `curl /from-natural-language` 5xx | 提前 6/11 跑一次 |
| cu MCP 在 6/12 之前不可用 | `mavis mcp call cu desktop_screenshot` 失败 | 退到 playwright |
| workbench server 没跑 | `pgrep -f workbench-38888` 空 | 6/11 早上确认 |
| LaunchAgent v0.3.2 修复没生效 | `/tmp/nas_obsidian_sync.log` 6/11 03:00 仍 ERROR | 看脚本是否 reload |
| v3 笔记生成 pipeline regress | E2E 跑 v3 路径 | Sprint1 已验证不动 |

---

*本文件 6/12 + 6/15 验收前会被多次 review。如有调整在 6/15 上午 v1.0。*
