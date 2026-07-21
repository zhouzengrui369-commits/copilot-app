# Sprint2 Plan v0.1 DRAFT: 自然语言理解深度
> 周：2026-06-16 ~ 2026-06-29
> PM：Mavis
> 状态：**草稿 v0.1**（基于 PRODUCT_VISION_v1.0 + Sprint1 实际交付状态）
> 定稿时间：2026-06-12 Day3 acceptance PASS 后迭代到 v1.0
> 路径：`/Users/njx/openclaw_data/openclaw_workbench/SPRINT_2_PLAN_v0.1_DRAFT.md`

---

## Sprint2 目标

把 Sprint1 "一次输入 → 一次拆解" 升级为 **"多轮对话 + 上下文累积 + 结构化派生"**：

> **用户说一句话 → agent 主动反问模糊点 → 用户答 → agent 累积上下文 → 派生结构化子任务树 → Goal 入库**

这是 Codex 五件套第 1+2 件的深化：自然语言接口从 "一次性" 变成 "会话式"，从 "LLM 自由发挥" 变成 "可预测的结构化派生"。

---

## 现状 vs 目标差距

### 现状（Sprint1 已交付）
- ✅ `POST /api/development/goals/from-natural-language`（index.ts:1676）
- ✅ `goalNlu.ts` 313 行，prompt version = `goal-nlu-prompt-20260610a`
- ✅ LLM 拆解：title / objective / successCriteria / subtasks / autonomyLevel / riskPolicy / verification
- ✅ 3 条 prompt 约束：1) 不编造 2) 子任务 ≤5 个 3) 不强加验证方式
- ✅ Fallback：LLM 失败 → minimal goal 入库，用户后续手填

### 目标差距

| 能力 | 现状 | Sprint2 目标 |
|------|------|---------------|
| **多轮对话** | 无（一次输入一次输出） | agent 反问模糊点 → 用户答 → 二次拆解 |
| **反问 UI** | 无 | GoalInputBox 加"反问→答→确认"流程 |
| **Goal session** | 无 | 单 Goal 多 turn session 概念，DB schema |
| **上下文累积** | 无 | session 内 LLM 记忆历史决策，避免重复反问 |
| **子任务派生** | LLM 自由生成 | 结构化派生 `[Plan/Implement/Test/Verify]` + 可选 custom |
| **Schema 兼容** | 一次性 JSON | 增量 JSON（每次 turn 补字段） |

---

## Task 拆解

### Task 2.1 · NLU 多轮对话协议（后端）
**范围**：扩展 `goalNlu.ts`，新增多轮拆解模式
- 新增类型 `NluTurn = { role: "user" | "assistant", content: string, parsedFields?: Partial<ParsedGoal>, askForField?: keyof ParsedGoal }`
- 新增 `parseGoalNluMultiTurn(sessionState, userInput): Promise<NluTurnResponse>`
- LLM 决策：哪些字段模糊 → askForField = "objective" | "successCriteria" | "targetApp" 等
- 决策依据：原文 + sessionState 当前字段
- Prompt 升级：v2 加"如果用户原文模糊，挑 1-2 个最关键字段反问，输出 `{askFor: "X", question: "?"}`，否则输出完整 JSON"
- **新 prompt version**：`goal-nlu-prompt-20260616a`（独立 bump，**不污染** `20260610a` 缓存）

**估时**：1.5 天（含 prompt 工程 + 单元测试 3 个反问 case）

### Task 2.2 · NLU 反问 UI（前端）
**范围**：扩展 `GoalInputBox.tsx`（Sprint1 交付的独立组件）
- 输入态：textarea + 拆解中 spinner（已有）
- 反问态：显示"AI 在问：X？" + 单选/多选 chips + 自由输入框
- 确认态：预览 ParsedGoal fields + "确认创建"按钮 + "继续补充"按钮
- Fallback 态：minimal goal 展示 + "手填表单"展开（已有 fallback UI 扩展）
- 单文件 `apps/web/src/NluConversation.tsx`（独立组件，App.tsx 主体 diff ≤ 20 行）

**估时**：1.5 天

### Task 2.3 · Goal session 状态机（后端 + DB）
**范围**：DB schema 升级 + session CRUD
- 新表 `goal_nlu_sessions`（id, goal_draft_id, current_state, history_json, max_turns=10, created_at, updated_at）
- 新表 `goal_nlu_turns`（id, session_id, turn_index, role, content, parsed_fields_json, ask_for_field, created_at）
- 状态机：`init → clarifying → refining → ready_to_create`（含 transitions）
- 新 endpoint：
  - `POST /api/development/goals/nlu-sessions`（创建 session）
  - `POST /api/development/goals/nlu-sessions/:id/turns`（提交 turn）
  - `GET /api/development/goals/nlu-sessions/:id`（查 session）
  - `POST /api/development/goals/nlu-sessions/:id/commit`（确认创建 goal）

**估时**：2 天（含 migration + 4 个 endpoint + 单元测试）

### Task 2.4 · 上下文累积（LLM prompt 工程）
**范围**：让 LLM 在 session 内记住历史
- Prompt 升级：v2 接收 sessionState + 之前 turns（最多 10 turn）作为 context
- 累积策略：
  - 已经明确的字段 → 保留
  - 用户修改的字段 → 覆盖
  - 新增 turn 信息 → 合并到对应字段
- Token 预算：session history ≤ 4000 tokens，超出截断
- **新 prompt version**：`goal-nlu-prompt-20260616a`（同 Task 2.1，合并升级）

**估时**：1 天（合并在 Task 2.1 里，避免重复 prompt 工作）

### Task 2.5 · 子任务结构化派生（后端 + 单元测试）
**范围**：subtasks 不再 LLM 自由生成，结构化派生
- 派生规则：
  - 必含：plan + verify（保底）
  - 客观 objective → 加 test
  - 涉及 doc/output → 加 docs
  - LLM 仅决定每个子任务的 title（≤30 字）
- 数量控制：3-5 个
- Kind 白名单：`plan | implement | verify | test | docs`
- 单元测试：8 个 case（"修复 bug" / "加 feature" / "写文档" / "性能优化" / "重构" 等）

**估时**：1.5 天

### Task 2.6 · 端到端 demo（多轮 + 上下文验证）
**范围**：Sprint2 验收
- 真实场景：用户说"修复笔记生成慢" → agent 反问"是指 LLM 慢还是 HTML 渲染慢？" → 用户答"LLM" → agent 派生 [Plan/Implement/Verify/Test] → Goal 入库
- 第二次输入同 session：用户说"其实还有截图也慢" → agent 不重复反问，直接合并到 objective
- 浏览器 E2E：GoalInputBox 多轮流程 + Goal 详情页显示 session 历史
- 录屏 + 截图存档

**估时**：1.5 天（含 e2e 自动化）

---

## 时间表

| 日期 | Day | 任务 | 验收 |
|------|-----|------|------|
| 6/16 周一 | Day1 | Sprint1 验收 + Sprint2 plan v1.0 定稿 | 6/15 21:00 Sprint1 done → v1.0 ready |
| 6/17 周二 | Day2 | Task 2.1 NLU 多轮协议（后端） | 单元测试 3 反问 case PASS |
| 6/18 周三 | Day3 | Task 2.3 Goal session 状态机 | 4 endpoint + DB migration PASS |
| 6/19 周四 | Day4 | Task 2.5 子任务结构化派生 | 8 unit case PASS |
| 6/20 周五 | Day5 | Task 2.2 NLU 反问 UI | 浏览器 E2E PASS |
| 6/23 周一 | Day6 | Task 2.4 上下文累积（合并 prompt 升级） | 单元测试 PASS |
| 6/24 周二 | Day7 | Task 2.4 续 + integration 联调 | 4 endpoint 联调 PASS |
| 6/25 周三 | Day8 | Task 2.6 端到端 demo | 录屏 + 截图存档 |
| 6/26 周四 | Day9 | Task 2.6 续 + 浏览器 e2e 自动化 | e2e 全 PASS |
| 6/29 周日 | Day10 | Sprint2 回顾 + Sprint3 启动 | 6/29 21:00 Sprint2 done → Sprint3 plan ready |

---

## 验收 Done 判定

**Sprint2 完成的硬指标**：
1. ✅ Task 2.1-2.6 全部 code + test PASS
2. ✅ 多轮对话：用户原文模糊 → agent 反问 → 用户答 → 拆解（curl E2E PASS）
3. ✅ 上下文累积：同 session 第二次输入，agent 不重复反问（curl E2E PASS）
4. ✅ 子任务结构化派生：3-5 个，必含 plan + verify（单元测试 8 case PASS）
5. ✅ 端到端 demo：浏览器 E2E 走通多轮流程 + 录屏 + 截图存档
6. ✅ Sprint2 commit + Sprint3 启动文档 ready

**Sprint2 失败判定**：
- LLM 反问 3 次以上不收敛 → Sprint2 部分完成，回退到 v1 单轮拆解
- 子任务派生太死板（用户自定义需求被强结构）→ 允许 custom kind 兜底（已写进 Task 2.5）

---

## 风险与回退

| 风险 | 缓解 | 回退 |
|------|------|------|
| LLM 反问收敛性差 | prompt 限制 ≤2 轮反问 | 强制 2 轮后用 fallback |
| Session 状态爆炸（>10 turn） | max_turns=10 hard cap | 超 cap 强制 ready_to_create |
| 子任务派生漏掉关键任务 | kind 白名单 + 必含 plan/verify | custom kind 兜底 |
| 上下文累积 token 超 | session history ≤4000 tokens 截断 | 截断后保留最近 5 turn |
| App.tsx 14959 行超大文件 | 新组件独立文件（Task 2.2 已设计） | 拆 App.tsx（推到 Sprint3） |
| Sprint1 6/12 6/15 gate 失败 | Sprint2 Day1 是 Sprint1 验收日 | Sprint2 推迟到 Sprint1 完整 done |

---

## 与 Sprint1 / Codex 五件套的衔接

### 复用 Sprint1
- `goalNlu.ts` 313 行：扩展为多轮 + 结构化派生（v2 升级）
- `GoalInputBox.tsx` 381 行：扩展为反问 UI（独立组件增量）
- `index.ts:1676` 原始 endpoint：保留向后兼容，新增 nlu-sessions 4 endpoint
- 桌面验收 computerUse 335 行：Sprint2 不动（保持 sprint 边界）

### Codex 五件套映射
| Codex 五件套 | Sprint1 | **Sprint2** | Sprint3+ |
|--------------|---------|-------------|----------|
| 1. NLU 目标接口 | 一次输入 | **多轮对话 + 反问** | 用户主导 session |
| 2. 单目标 session | ❌ | **Goal session 状态机** | 完整 session UI |
| 3. 桌面验收 | harness | （不动） | （不动） |
| 4. 失败恢复 | ❌ | （不动） | 局部 patch |
| 5. 自我验证 | ❌ | （不动） | completion_audit + propose |

---

## 给用户的决策点（v0.1 → v1.0）

需要 njx 在 **6/15 21:00 Sprint1 验收后**拍板：

1. **反问上限**：每 session agent 最多反问 2 轮（建议 2）vs 不限（自然收敛）
2. **子任务必含项**：`plan + verify` 保底（建议）vs 只 verify
3. **Goal session 用户名**：`目标草稿`（draft 感）vs `开发会话`（session 感）vs `AI 协作中`（协作感）
4. **回退策略优先级**：多轮失败 → 强 fallback 一次输入（建议）vs 提示用户手动填写

**默认建议**：1=2, 2=plan+verify, 3=目标草稿, 4=强 fallback
有反对意见 6/15 21:00 复盘会改。

---

## 跟既有约束兼容

1. server 编译需重启（每次改 server 端后 `cd apps/server && npm run build && kill old PID && nohup node --experimental-sqlite dist/index.js > /tmp/workbench-38888.log2>&1 &`）
2. v3 笔记生成 pipeline 不动
3. autonomy loop 持续写 working tree：.gitignore 已配
4. development-gates.json 6 个 gate：prd_required / prototype_required / test_evidence_required / security_scan / release_approval / no_fake_ok 全 PASS 才能进 release
5. App.tsx 主体 diff ≤ 20 行/任务（Sprint1 已验证，可执行）

---

## v0.1 → v1.0 待办

- [ ] 6/12 09:00 Day3 acceptance cron：Sprint1 Task2 真实 Chrome 截图 PASS
- [ ] 6/15 21:00 Sprint1 整体验收：端到端 demo + 录屏
- [ ] 6/15 21:30 Sprint2 plan v1.0 定稿
- [ ] 4 个决策点（反问上限/必含项/会话名/回退策略）用户拍板

---

*本文件由 Mavis（顶 PM）于 2026-06-10 22:32 起草，作为 Sprint2 的预准备。Sprint1 6/12 + 6/15 gate 通过后定稿为 v1.0 启动。*
