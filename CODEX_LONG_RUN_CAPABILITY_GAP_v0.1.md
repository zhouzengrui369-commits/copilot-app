# Codex 等价"目标驱动长时工作"能力差距分析
> PM: Mavis
> 创建: 2026-06-10 22:55
> 状态: v0.1 草稿（基于 Sprint1 已交付件 + Codex 五件套对标 + autonomy loop 验证）
> 用途: 重写 Sprint2 plan v0.2 用，把"自然语言理解深度"重新聚焦为"长时工作能力"

---

## 一句话判断

> **OpenClaw Workbench 当前缺的不是"理解用户说什么"，而是"用户说完之后能跑多久不出事"。**

Sprint1 立的是骨架（NLU 入口 + 桌面验收），证明 Codex 五件套的差异化点立得住。
**但 Sprint2-3 的真正战场是：把"5 分钟 demo"升级成"5 小时不间断工作"。**

Codex CLI 真正强在哪？**不是单次拆解多准，是它能跑很久不出问题。** OpenClaw 要追上这个，不是 LLM 拆解问题，是工程稳健性问题。

---

## Codex 等价的 5 个"长时工作"能力维度

| 维度 | 含义 | Sprint1 现状 | 目标 |
|------|------|-------------|------|
| **1. 长 session 不掉线** | 单 Goal 跑 30min+ 不崩溃 | autonomy 12h 跑过，但用户主导 session 还没 | 用户开 Goal 后 12h 不需要重连 |
| **2. 跨 turn 状态保持** | Goal session 内 LLM 记忆历史决策 | ❌ 无 session 概念 | sessionState 累积最近 10 turn |
| **3. 失败局部恢复** | 子任务失败 → patch → 不全 retry | recovery_packet 有，全 retry 模式 | 行号级 patch + 子任务图重派 |
| **4. 进度可见** | 用户随时看 Goal 在干嘛 | heartbeat + verify tab 有 | 实时 timeline + 子任务状态机 |
| **5. 自我验证** | agent 反思 → propose → 闭环 | completion_audit 有，无 propose 循环 | 完成后自动 propose 下步 |

---

## 维度 1 · 长 session 不掉线（最大 gap）

### Codex 行为
- 用户输入目标 → CLI 跑 30min-2h → 持续输出日志 → 完成后归档
- 中间可以 `Ctrl+C` 暂停，`codex resume` 继续
- model rate limit / network blip 自动 retry，context 满了自动压缩

### OpenClaw 现状
- ✅ `mavis team plan` engine 已支持 cycle + 心跳 + 自动 steer ≤ 2 次
- ✅ autonomy loop 验证过 12h 持续跑（126 metrics + 56 screenshots）
- ❌ **用户主导 session 流程不存在**——现在只有 cron scheduler 自动跑
- ❌ 跨 session resume 没做（autonomy 跑过的 Goal，重启后只能从零开始）
- ❌ context 满了怎么办？没设计

### 差距 → Sprint2/3 任务
**Sprint2 · 任务 2.A** Goal session 长跑机制
- 用户在 UI 触发 Goal（不是 cron）
- session 概念：单 Goal 多 turn，最多 12h
- session lifecycle：`init → planning → executing → verifying → completed | blocked | failed`
- session resume：用户离开后再回来，session 仍可继续

**Sprint2 · 任务 2.B** Context 压缩策略
- 当 session 累计 token > 4K，触发压缩
- 压缩策略：保留最近 5 turn + 决策摘要 + Goal objective
- 老 turn 写入 `09_Wiki/01_Sources/<sessionId>/turn_<n>.md`（Knowledge Sync 路径）

**Sprint3 · 任务 3.A** 长 session rate limit / network retry
- Gateway 限流时：本地排队 + retry with backoff
- Network blip：session 暂停 + 自动 resume
- 用户能感知（不是静默）

---

## 维度 2 · 跨 turn 状态保持（已部分设计）

### Codex 行为
- 单 goal 内多 turn，LLM 记忆：
  - 已做的子任务
  - 用户的偏好决策
  - 之前问过 + 答过的反问
- 不会重复问同一个反问

### OpenClaw 现状
- ❌ **完全没有 session state**
- NLU endpoint 一次输入一次输出，无记忆
- GoalInputBox 是 stateless

### Sprint2 已有覆盖（部分）
Sprint2 v0.1 草稿里 Task 2.3 (Goal session 状态机) + Task 2.4 (上下文累积) 已设计。

**v0.2 改进**：
- Task 2.3 强化：状态机加 `paused` 状态（用户离开）
- Task 2.4 加：每次 turn 同步写入 SQLite `goal_session_turns` 表（已有 schema 雏形）

---

## 维度 3 · 失败局部恢复

### Codex 行为
- 子任务失败 → 不全 retry → 找具体行号 → patch 那段 → 继续
- 用户看到的是"修复了 3 个具体问题"而不是"重跑了 1 小时"

### OpenClaw 现状
- ✅ `recovery_packet` + `dispatch_recovery` + `continuation_contract` 已实现
- ⚠️ **主要是全 retry 模式**，不是局部 patch
- ⚠️ patch 策略是"基于 recovery_packet 重新发起"，不是"行号级修改"

### 差距 → Sprint3 任务
**Sprint3 · 任务 3.B** 行号级 patch
- 子任务失败 → 定位失败行号 → 自动 patch（不重跑整个子任务）
- 适用场景：LLM 写出错的代码 / 配置 / SQL
- 工具：`/api/development/goals/:id/subtasks/:subId/patch` (PATCH)
- 失败后再 patch，最多 3 次，再失败升级 user

**Sprint3 · 任务 3.C** 失败 → user 决策 UI
- 子任务失败不静默重试
- UI 弹 recovery options：
  - 自动 patch（默认）
  - 跳过这步继续
  - 用户手动改后重试
  - 终止整个 Goal

---

## 维度 4 · 进度可见

### Codex 行为
- 实时 timeline：当前在哪一步、还剩多少步、最近 5 步结果
- 子任务状态：pending → running → succeeded | failed | skipped

### OpenClaw 现状
- ✅ `/api/development/observability/heartbeat` 有
- ✅ Sprint1 Task4 GoalVerifyTab 有截图证据
- ❌ **没有实时 timeline**——heartbeat 是 30min 间隔的快照
- ❌ 子任务状态机没暴露给 UI

### 差距 → Sprint2/3 任务
**Sprint2 · 任务 2.D** Goal session timeline UI
- 实时事件流（WebSocket 推送）
- 子任务状态卡片（pending/running/succeeded/failed）
- 进度条（X/Y 子任务完成）
- 最近 5 步日志（可点开看完整）

**Sprint3 · 任务 3.D** 实时 evidence pack
- agent 每步完成自动 push 截图
- 用户不需要等 verify tab 出现才能看

---

## 维度 5 · 自我验证 + 长期演进

### Codex 行为
- 子任务完成 → 模型自评（好不好、风险点、改进建议）
- 整个 Goal 完成后 → propose 下个 Goal

### OpenClaw 现状
- ✅ `completion_audit` + `learning_review` 已实现
- ⚠️ **没形成 propose → 决策 → 闭环**
- 评估是结果给人看，不是给 agent 自己反思

### 差距 → Sprint4 任务
**Sprint4 · 任务 4.A** agent propose 循环
- completion_audit 后自动 generate "propose" 文档
- 文档结构：当前 sprint 短板 + 下 sprint 该改的 + 改的预期影响
- 用户在 UI 看到 propose → 决策 accept/reject/modify
- accept → 自动创建下个 Goal
- 闭环：agent 反思 → propose → user 决策 → 实施

---

## 重新排 Sprint 优先级

之前 product vision 里 sprint 排序：
- Sprint1: 立骨架 ✓
- Sprint2: 自然语言理解深度（多轮对话）
- Sprint3: 用户主导 session + 局部恢复
- Sprint4: 自我验证 + 长期演进
- Sprint5: 产品打磨

**v0.2 重排**（聚焦长时工作）：
- Sprint1: 立骨架 ✓（已交付）
- **Sprint2: 跨 turn 状态 + 子任务结构化派生**（2.1-2.6，10 天）
- **Sprint3: 长 session 不掉线 + 失败恢复 + 进度可见**（3.A-3.D，14 天）
- Sprint4: 自我验证 + propose 闭环（4.A，10 天）
- Sprint5: 产品打磨（10 天）

**Sprint2 v0.1 → v0.2 调整**：
- Task 2.1-2.6 不变（核心是 session + 上下文）
- **加 Sprint3 任务到 plan v0.2** 作为后续 14 天
- **砍掉**：原 Sprint2 里"反问 UI 美观度"等非核心 polish

---

## 关键约束（cross-cutting）

不管哪个 sprint，**这 5 个不变量**：
1. **现有 autonomy 12h 跑不能 regress**——任何 session 改动要保底 autonomy 仍能跑
2. **v3 笔记生成 pipeline 不动**——Sprint1 已约束
3. **App.tsx 主体 diff ≤ 20 行/任务**——Sprint1 已验证
4. **6 个 development-gates.json 全 PASS**——prd/prototype/test/security/release/no_fake_ok
5. **sessionState token 预算 ≤ 4K**——超出就压缩

---

## v0.2 Sprint2 plan 调整建议（基于上面）

**Sprint2 任务不动**（2.1-2.6）——它们就是 session + 上下文 + 派生核心

**Sprint2 加 1 个新 task**：
- **Task 2.7 · session 暂停/恢复机制**
  - 用户离开 → session `paused`
  - 用户回来 → session `resumed`，从最后 turn 继续
  - session 不丢 / 不重头
  - 估时: 1.5 天

**Sprint2 改 1 个 task**：
- **Task 2.2 (反问 UI) 砍掉"反问 chip 视觉 polish"**——保留核心功能，砍掉非核心
  - 估时: 1.5 → 1 天

Sprint2 总 6+1 task = 11.5 天 (vs 之前 10 天) → 调整不影响 6/29 截止日

---

## 给 njx 的拍板点（v0.2 → v1.0）

需要你 6/15 21:00 拍板：

1. **Sprint2 加不加 Task 2.7**（session 暂停/恢复）？
   - 加：Sprint2 11.5 天，超 6/29 截止日 1.5 天（推到 6/30）
   - 不加：Sprint2 10 天，6/29 收尾，加的东西推到 Sprint3 起点

2. **Sprint2 砍不砍反问 chip 视觉**？
   - 砍：核心功能保留，进度快
   - 不砍：完整反问体验，估时+0.5 天

3. **Sprint3 起点 = 6/30 还是 7/1**？
   - 6/30：Sprint2 推到 6/30，Sprint3 也推 1 天
   - 7/1：Sprint2 6/29 收尾，Sprint3 7/1 启动（中间空 1 天）

4. **session 12h hard cap vs unlimited**？
   - 12h：与 autonomy 对齐，避免失控
   - unlimited：用户决定，但风险高

**默认建议**：
- 1=加（11.5 天）
- 2=砍（核心功能）
- 3=7/1（中间 1 天做 W4 Gate 复盘）
- 4=12h（与 autonomy 对齐）

---

*本文件是 Sprint2 plan v0.2 的核心驱动。Sprint1 6/12 + 6/15 gate 通过后，基于此定稿 v1.0。*
