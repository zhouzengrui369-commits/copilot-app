# Sprint1 Day1 进度报告

> **PM**: Mavis（MiniMax Agent Team Leader）
> **Owner**: njx
> **Plan**: [`SPRINT_1_PLAN.md`](../SPRINT_1_PLAN.md)（6/10 - 6/15，6 天）
> **状态**: 2026-06-10 15:00
> **真实进度**: **2/4 plan tasks 完成 + 1 bonus**（plan 后端段全部提前完工，前端段按 plan 排在 Day4-Day5）

---

## TL;DR

| 维度 | 状态 |
|---|---|
| Plan 4 个 task | 2 完成（Task1+Task2 后端），2 未到时间（Task3+Task4 前端） |
| Plan 外 bonus | 1 完成（evidence pack 三态流转） |
| Acceptance fix 故事线 | 3 commits（fc8fed4d / 66306cfc / 5ead0658）——独立 verify 抓的 latent bug |
| 真实 Chrome 桌面验收截图 | ✅ 落盘（268KB jpg） |
| Sprint1 真 done 报告 | 推到 **6/15 Day6**（不是今天） |
| Day3 acceptance 节点 | **6/12 09:00**（不是 6/11 09:00，plan Day3 才是桌面验收节点） |

---

## 1. Plan 对齐（4 个 task × 6 天节奏）

| Plan Task | Plan 节点 | 实际完工 | 偏差 | Commit |
|---|---|---|---|---|
| Task1: NLU endpoint（后端） | 6/11 Day2 | **6/10 Day1 15:00** | 提前 1 天 | `f4149536` + `c9cd4f89` |
| Task2: computerUse harness（后端） | 6/12 Day3 | **6/10 Day1 15:00** | 提前 2 天 | `bcb9e977` |
| **Task3: 前端 GoalInputBox** | 6/13 Day4 | — | plan 内未到时间 | — |
| **Task4: 前端 Verify tab + ACCEPT/REJECT** | 6/14 Day5 | — | plan 内未到时间 | — |
| **Bonus: evidence pack 三态流转** | (plan 外) | **6/10 Day1 15:00** | 加分 | `fc8fed4d` + `66306cfc` + `5ead0658` |

**关键判断**：今天 Day1 把后端段全部提前完成 + bonus 三态流转，是健康的；plan 把 frontend 排在 Day4-Day5 是合理的（让后端先稳再接 UI），PM 不抢跑。

---

## 2. 6 commits 故事线

### Sprint1 主线（4 commits）

#### `f4149536` — feat(workbench-backend): Sprint1 Task1 — NLU 入口
- 新 endpoint: `POST /api/development/goals/from-natural-language`
- 走 v3 gateway LLM 拆解，prompt 最简形态（角色 + 3 必要约束 + JSON contract + 原文）
- 失败 fallback 到 minimal goal，server 仍能入库
- `?dryRun=1` 模式：只拆不入库（前端预览用）
- 验证：dryRun ok=true, 1.5s（首次 LLM ~58s，后续 cached）

#### `c9cd4f89` — fix(scheduler): persist last_auto_tick_at (补 f4149536)
- 补漏的 schema migration：`development_scheduler_state.last_auto_tick_at` 列
- 12h 监控 tickAgeSec 从 inMemory 兜底改成落库
- Owner override_accept 时已确认 PASS

#### `bcb9e977` — feat(verify): desktop evidence harness
- `computerUse.ts` 82→327 行通用化（DesktopActionSpec / DesktopActionEvidence types）
- 新增 `evidencePack.ts`（buildDesktopEvidencePack + persistDesktopEvidencePack + runDesktopVerifyAndPersist）
- `db.ts` 加 `development_goals.metadata` 列（TEXT NOT NULL DEFAULT '{}'）
- `index.ts` goal completion hook：void async fire runDesktopVerifyAndPersist
- 新增 `scripts/desktop-verify-smoke.mjs`（3 stage: DryRun / Mock / Real Chrome）
- **验证：smoke ALL PASS，audit_logs id=15105 落库**

#### `5ead0658` — feat(verify): Task3 goal auto-loop lifecycle（bonus）
- 新增 `evidencePackLifecycle.ts`（198 行）—— 三态流转 outcome 决策
- `index.ts` goal completion hook: void → await flip + 三态 status 流转
- **验证：3 路径 trace 全部 PASS**
  - happy → completed（audit 15180-15183）
  - full-fail → failed（audit 15170-15174，HTTP 409）
  - partial-fail → completed_partial（audit 15175-15179）

### Acceptance 抓的 latent fixes（2 commits）

#### `fc8fed4d` — fix(verify): project metadata column into developmentGoalView
- **Bug**: `developmentGoalView()` 没把 `metadata` 列投影进 goal object
- 表现：production completion hook (readGoalDesktopActions) 永远拿到 undefined
- 触发：TS `as { metadata?: string }` cast 掩盖；smoke 走 import 路径绕过 view
- **影响**：Task2 上线后 production code path 静默 0 fire
- **修复**：view 加 `metadata: String(row.metadata || "{}")` 投影（1 行 +1）
- **验证**：修复后 production hook fires normally，audit id=15148 production evidence pack

#### `66306cfc` — fix(cu): detect MCP protocol errors on stdout
- **Bug**: `mavis mcp call cu` 在 MCP 协议错误时 stdout 有 "MCP error -NNNN" 前缀但 exit 0
- 表现：error message 丢到 afterState 没人当 failure 处理，ok=true 错误返回
- 触发：bcb9e977 当时 smoke 走 window_list + screenshot 永远 happy path，bug 没暴露
- **修复**：`runComputerUseMcp` 嗅探 stdout 里的 "MCP error -NNNN" 前缀，匹配即返回 ok=false
- **验证**：Task3 full-fail 测试从 outcome=completed（错）变成 outcome=failed（对）

---

## 3. 三态 evidence pack trace（audit_logs 实证）

| 路径 | audit_logs id 序列 | outcome | HTTP | goal.status |
|---|---|---|---|---|
| happy (2/2 ok) | 15180 → 15181 → 15182 → 15183 | `completed` | 200 | `completed` |
| full-fail (1/1 fail) | 15170 → 15171 → 15172 → 15173 → 15174 | `failed` | 409 | `failed` |
| partial-fail (1/2 fail) | 15175 → 15176 → 15177 → 15178 → 15179 | `completed_partial` | 200 | `completed` |

**事件序列**（每条 goal 的完整生命周期）：
1. `create` → goal 入库 active
2. `evidence_pending` → 进入桌面验收态
3. `desktop_evidence_pack` → evidence 落库（始终落）
4. `desktop_evidence_pack_failed`（仅 failed/partial 落）→ 含 outcome + failCount + failedActions[].error
5. `complete` → 最终 status 落库 + response 含 evidencePackRef + evidencePackOutcome

---

## 4. 截图证据（真实 Chrome 桌面验收）

| 文件 | 大小 | 分辨率 | 时间 |
|---|---|---|---|
| `/Users/njx/.mavis/sessions/mvs_d6c6bfa159c144a581cee35eb51fe843/workspace/desktop-verify-smoke.jpg` | 268 KB | 1356×848 | 2026-06-10 12:21 |
| `/Users/njx/.mavis/sessions/mvs_d6c6bfa159c144a581cee35eb51fe843/workspace/desktop-verify-smoke.png` | 273 KB | (同源) | 2026-06-10 12:18 |

**Stage 3 真实 Chrome 抓图**（bcb9e977 commit message 描述："Chrome 浏览器清晰可读，URL 栏 127.0.0.1:38888/knowledge 可见"）。

---

## 5. Acceptance fix 故事线（PM 视角）

| Bug | 表象 | 根因 | Smoke 为何没发现 | 修复 |
|---|---|---|---|---|
| metadata 列不投影 | production hook 静默 0 fire | `developmentGoalView()` 漏列 | smoke 走 import 路径绕过 view | 加 1 行投影 |
| MCP error exit 0 | failed 路径 outcome 误报 completed | 协议错误回写 stdout 但 exit 0 | smoke 全 happy path 不触发 fail | sniff stdout "MCP error -NNNN" 前缀 |

**PM 教训**：
1. **Smoke 路径 ≠ production 路径**。smoke 走 import 直接拿 schema，绕过了 view 抽象 — 真实 production 必须用完整 stack 走一次（acceptance goal → evidence → audit_logs）。
2. **Exit 0 ≠ ok**。子进程 error 通道不只有 stderr，必须嗅探 stdout 的协议前缀。
3. **Latent bug 在 acceptance 才暴露**。Task1+Task2 实施期没暴露，Task3 实施时+acceptance 一起发现 2 个 latent。说明：production 路径独立 acceptance 是必须的，smoke 走再多也覆盖不了 view/proxy 这一层。

---

## 6. Out of Scope（今天 Day1 不做）

- **frontend Task3 (GoalInputBox)** — plan 排 6/13 Day4，Day1 不抢跑
- **frontend Task4 (Verify tab)** — plan 排 6/14 Day5，Day1 不抢跑
- **v3 笔记质量门槛修复** (commit `a992ddf8`) — 顺手做的，不属 Sprint1 plan
- **Sprint2 plan** — 等 Sprint1 真 done（6/15 Day6）后启动
- **Retry policy / partial event 拆分 / HTTP 409 统一 / status enum CHECK / desktop_actions 配置化** — Task3 暴露的 5 个 follow-up，全部进 Sprint2 候选

---

## 7. 下一步（PM 拍板）

| 节点 | 时间 | 动作 | 触发 |
|---|---|---|---|
| **Day3 acceptance** | **6/12 09:00** | 跑 Task2 harness end-to-end + evidence pack trace 复查 | cron `mavis-sprint1-day3-acceptance` |
| **Day4 frontend kickoff** | **6/13 09:00** | 派 Task3 + Task4 给 coder，要求独立文件避免 App.tsx 超大 hunk | cron `mavis-sprint1-frontend-kickoff` |
| **Sprint1 done 报告** | **6/15 Day6** | 端到端 demo + 全 4 task 完工 + Sprint2 启动 | 6/15 cron |
| **Sprint2 plan** | **6/15 Day6 之后** | 从 5 个 follow-up + Codex 五件套剩 1 件 (Task4?) 拆 | Sprint1 done 后 |

---

## 8. 风险与回退

| 风险 | 缓解 |
|---|---|
| 6/12 acceptance 发现新 latent | coder 立即派 fix，6/13 frontend kickoff 推到 6/14 |
| Frontend App.tsx 14959 行超大文件 | plan 风险 #4 已定：新建 `GoalInputBox.tsx` + `GoalVerifyTab.tsx` 单独文件 |
| Chrome 没安装 / cu 不可用 | 退到 playwright MCP（已配） |
| GoalInputBox LLM 拆解 > 3 分钟 | 同步接口改 async job（参考笔记 v3.4 job 路径） |

---

*本报告由 Mavis（PM）于 2026-06-10 15:10 起草。Sprint1 6 天节奏不变，前端段按 plan Day4-Day5 推进。*
