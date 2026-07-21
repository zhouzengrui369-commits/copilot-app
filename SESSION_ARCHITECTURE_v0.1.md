# Goal Session 架构设计 v0.1
> PM: Mavis
> 创建: 2026-06-10 23:10
> 用途: Sprint2 v0.2 Task 2.3 + 2.7 落地方案（coder 写代码前必读）
> 状态: 草稿 v0.1（基于 SPRINT_2_PLAN_v0.2_DRAFT + CODEX_LONG_RUN_CAPABILITY_GAP_v0.1）

---

## 一句话定位

> **Goal session = 单 Goal 跨 turn 状态保持的容器，从用户输入第一句话到 Goal 入库的所有中间状态。**

不依赖 cron、不依赖 autonomy，是 **用户主导** 的 session 概念。

---

## Session Lifecycle 状态机

```
                        ┌─────────────────┐
                        │      init       │ ← user 调 POST /nlu-sessions
                        │ (刚创建, 0 turn)│
                        └────────┬────────┘
                                 │ user 提交 turn 1
                                 ▼
                        ┌─────────────────┐
            ┌──────────│   clarifying    │ ← agent 反问 1-N 轮
            │          │ (有 askForField)│
            │          └────────┬────────┘
            │                   │ agent 输出完整 JSON
            │                   ▼
            │          ┌─────────────────┐
            │     ┌───│    refining      │ ← 用户补充修改
            │     │    │ (无 askForField)│
            │     │    └────────┬────────┘
            │     │             │ user 调 POST /commit
            │     │             ▼
            │     │    ┌─────────────────┐
            │     │    │ ready_to_create │ → Goal 入库 → session done
            │     │    └─────────────────┘
            │     │             ▲
   反问>2    │     │ 反问>2     │ 反问>2
   强制 commit│     │ 强制 commit │
            │     │             │
   ┌────────┘     └─────────────┘
   ▼
┌─────────────────┐
│     paused      │ ← user 调 /pause OR 24h 无活动 OR server 重启
│ (任意状态旁路)  │
└────────┬────────┘
         │ user 调 /resume
         ▼
   (回到 paused 之前的状态)
```

**关键不变量**：
1. `paused` 是旁路状态，可从任何状态进入（除了 `done`）
2. `paused` 不会自动 `ready_to_create`——必须 user 显式 `/commit`
3. `paused` 后 7 天未 resume → 自动 `aborted`（不丢数据，可恢复）

---

## DB Schema（SQLite）

### `goal_nlu_sessions` 表

```sql
CREATE TABLE goal_nlu_sessions (
    id              TEXT PRIMARY KEY,            -- UUID v4
    user_id         TEXT NOT NULL DEFAULT 'main', -- OpenClaw 单一用户
    current_state   TEXT NOT NULL,                -- init | clarifying | refining | ready_to_create | paused | done | aborted
    paused_from_state TEXT,                       -- 暂停时来自哪个状态（resume 用）
    initial_input   TEXT NOT NULL,                -- 第一句自然语言
    parsed_fields_json TEXT,                      -- 当前已确认字段（JSON）
    pending_question TEXT,                        -- agent 当前问什么
    pending_ask_field TEXT,                       -- 关键字段名（objective/successCriteria/targetApp）
    turn_count      INTEGER NOT NULL DEFAULT 0,   -- 已提交的 turn 数
    max_turns       INTEGER NOT NULL DEFAULT 10,  -- hard cap
    token_estimate  INTEGER NOT NULL DEFAULT 0,   -- 当前 session 累计 token
    last_activity_at TIMESTAMP NOT NULL,          -- 最后一次 turn / pause / resume
    paused_at       TIMESTAMP,
    resumed_at      TIMESTAMP,
    auto_paused     INTEGER NOT NULL DEFAULT 0,   -- 1=server 重启 / 24h timeout 自动
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    goal_id         TEXT,                         -- commit 后关联到 development_goals.id
    abort_reason    TEXT                          -- aborted 原因
);

CREATE INDEX idx_sessions_state ON goal_nlu_sessions(current_state);
CREATE INDEX idx_sessions_user_state ON goal_nlu_sessions(user_id, current_state);
CREATE INDEX idx_sessions_last_activity ON goal_nlu_sessions(last_activity_at);
```

### `goal_nlu_turns` 表

```sql
CREATE TABLE goal_nlu_turns (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    turn_index      INTEGER NOT NULL,             -- 0-based
    role            TEXT NOT NULL,                -- user | assistant
    content         TEXT NOT NULL,                -- 原文
    parsed_fields_json TEXT,                       -- assistant 输出 ParsedGoal（部分或完整）
    ask_for_field   TEXT,                         -- assistant 问的字段
    ask_question    TEXT,                         -- assistant 问的问题原文
    token_estimate  INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER,
    created_at      TIMESTAMP NOT NULL,
    FOREIGN KEY (session_id) REFERENCES goal_nlu_sessions(id)
);

CREATE INDEX idx_turns_session ON goal_nlu_turns(session_id, turn_index);
```

### `goal_nlu_audit` 表（合规 / 调试用）

```sql
CREATE TABLE goal_nlu_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    event_type      TEXT NOT NULL,                -- state_change | pause | resume | commit | abort
    from_state      TEXT,
    to_state        TEXT,
    payload_json    TEXT,                         -- 完整事件 detail
    created_at      TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_session ON goal_nlu_audit(session_id, created_at);
```

---

## API 设计（6 个 endpoint）

### 1. `POST /api/development/goals/nlu-sessions` — 创建 session

**Request**:
```json
{ "naturalLanguage": "在 Chrome 里打开 Workbench 演示笔记生成" }
```

**Response 201**:
```json
{
  "ok": true,
  "session": {
    "id": "ses_abc123",
    "currentState": "clarifying",
    "pendingQuestion": "是指 LLM 调用慢还是 HTML 渲染慢？",
    "pendingAskField": "objective",
    "turnCount": 1,
    "maxTurns": 10,
    "createdAt": "2026-06-10T22:30:00.000Z"
  }
}
```

**实现要点**：
- 调 `parseGoalNluMultiTurn(initialInput)` 拿首轮 ParsedGoal
- 如果 agent 反问 → state = `clarifying`
- 如果 agent 完整输出 → state = `ready_to_create`（立即可 commit）
- 写 `goal_nlu_turns` 2 行（user + assistant）

### 2. `POST /api/development/goals/nlu-sessions/:id/turns` — 提交 turn

**Request**:
```json
{ "userInput": "LLM 调用慢" }
```

**Response 200**:
```json
{
  "ok": true,
  "session": {
    "id": "ses_abc123",
    "currentState": "refining",
    "parsedFields": {
      "title": "修复 LLM 调用慢",
      "objective": "在 Chrome 里打开 Workbench 演示笔记生成，重点修复 LLM 调用慢的问题",
      "successCriteria": ["..."]
    },
    "turnCount": 2
  }
}
```

**实现要点**：
- 加载 session + 最近 10 turns
- 调 `parseGoalNluMultiTurn(sessionState, userInput)` 拿新一轮
- 更新 `parsed_fields_json`（增量 merge）
- 写 turn + audit

### 3. `GET /api/development/goals/nlu-sessions/:id` — 查 session

**Response 200**:
```json
{
  "ok": true,
  "session": { ... 完整 session },
  "turns": [
    { "index": 0, "role": "user", "content": "在 Chrome 里打开..." },
    { "index": 1, "role": "assistant", "content": "...", "askForField": "objective" },
    { "index": 2, "role": "user", "content": "LLM 调用慢" },
    { "index": 3, "role": "assistant", "content": "...", "parsedFields": {...} }
  ]
}
```

### 4. `POST /api/development/goals/nlu-sessions/:id/commit` — 确认创建 goal

**Request**:
```json
{ "confirm": true }
```

**Response 201**:
```json
{
  "ok": true,
  "goalId": "goal_xyz789",
  "redirectUrl": "/dev-center/goals/goal_xyz789"
}
```

**实现要点**：
- 校验 state = `ready_to_create`
- 调 `createDevelopmentGoal(parsedGoalToGoalCreateBody(parsed))`（已有函数）
- 写 audit `commit`
- state → `done`
- 返回 goalId + redirect

### 5. `POST /api/development/goals/nlu-sessions/:id/pause` — 暂停

**Request**: `{}`

**Response 200**:
```json
{
  "ok": true,
  "session": { "currentState": "paused", "pausedFromState": "refining", "pausedAt": "..." }
}
```

**实现要点**：
- 校验 state ≠ `done` / `aborted`
- 记录 `paused_from_state`
- 写 audit `pause`
- auto_paused = 1（如果是 server 重启 / 24h timeout 触发的 pause）

### 6. `POST /api/development/goals/nlu-sessions/:id/resume` — 恢复

**Request**: `{}`

**Response 200**:
```json
{
  "ok": true,
  "session": {
    "currentState": "refining",  // 回到 paused_from_state
    "resumedAt": "...",
    "lastTurn": { "index": 5, "role": "assistant", "content": "..." }
  }
}
```

**实现要点**：
- 校验 state = `paused`
- 恢复 `current_state` = `paused_from_state`
- 清空 `paused_from_state` + `paused_at`
- 写 audit `resume`
- 返回 last turn 让 UI 续接

---

## Session 数据流（sequence diagram）

```
User                  GoalInputBox           Server (index.ts)            goalNlu.ts             SQLite
 │                         │                        │                          │                    │
 │ 1. 输入自然语言         │                        │                          │                    │
 ├────────────────────────►│                        │                          │                    │
 │                         │ 2. POST /nlu-sessions │                          │                    │
 │                         ├───────────────────────►│                          │                    │
 │                         │                        │ 3. parseGoalNluMultiTurn │                    │
 │                         │                        ├─────────────────────────►│                    │
 │                         │                        │                          │ parseNaturalLang    │
 │                         │                        │                          ├───────────────────►│
 │                         │                        │ 4. 写 session + 2 turns │                    │
 │                         │                        ├───────────────────────────────────────────────►│
 │                         │ 5. 201 + session       │                          │                    │
 │                         │◄───────────────────────┤                          │                    │
 │ 6. 显示"AI 在问：X?"    │                        │                          │                    │
 │◄────────────────────────┤                        │                          │                    │
 │ 7. 用户答"LLM 慢"       │                        │                          │                    │
 ├────────────────────────►│                        │                          │                    │
 │                         │ 8. POST /:id/turns     │                          │                    │
 │                         ├───────────────────────►│                          │                    │
 │                         │                        │ 9. parseMultiTurn(ctx)   │                    │
 │                         │                        ├─────────────────────────►│                    │
 │                         │                        │ 10. 写 turn 3,4 + 更新   │                    │
 │                         │                        ├───────────────────────────────────────────────►│
 │                         │ 11. 200 + parsedFields │                          │                    │
 │                         │◄───────────────────────┤                          │                    │
 │ 12. 用户点确认          │                        │                          │                    │
 ├────────────────────────►│                        │                          │                    │
 │                         │ 13. POST /:id/commit   │                          │                    │
 │                         ├───────────────────────►│                          │                    │
 │                         │                        │ 14. createDevelopmentGoal│                    │
 │                         │                        ├───────────────────────────────────────────────►│
 │                         │ 15. 201 + goalId       │                          │                    │
 │                         │◄───────────────────────┤                          │                    │
 │ 16. 跳 Goal 详情页      │                        │                          │                    │
 │◄────────────────────────┤                        │                          │                    │
```

---

## Pause/Resume 数据流

```
                           ┌─────────────────────────────────┐
                           │ normal session (active)         │
                           │ current_state=refining,         │
                           │ turn_count=5                    │
                           └────────────────┬────────────────┘
                                            │
                          user 调 POST /pause│ OR server 重启 / 24h timeout
                                            ▼
                           ┌─────────────────────────────────┐
                           │ session (paused)                │
                           │ current_state=paused,           │
                           │ paused_from_state=refining,     │
                           │ paused_at=2026-06-10T22:30:00   │
                           │ auto_paused=0 (or 1)            │
                           └────────────────┬────────────────┘
                                            │
                          user 调 POST /resume (24h 内)
                                            ▼
                           ┌─────────────────────────────────┐
                           │ session (resumed)               │
                           │ current_state=refining,         │ ← 恢复
                           │ paused_from_state=NULL,         │
                           │ resumed_at=2026-06-11T10:15:00  │
                           │ last_turn shown to user         │
                           └────────────────┬────────────────┘
                                            │
                          user 继续提交 turn
                                            ▼
                                    (回到 normal flow)
```

---

## Server 重启恢复机制

**问题**：server 重启时所有 active session 内存状态丢失。

**方案**：
1. **重启时**：
   - 扫 `goal_nlu_sessions` WHERE `current_state` IN ('init', 'clarifying', 'refining', 'ready_to_create')
   - 全部标记为 `paused`，`auto_paused = 1`
   - 写 audit `pause` (reason=server_restart)
2. **重启后**：
   - 第一次 heartbeat 扫 paused auto_paused=1 且 last_activity_at < 1h 前的
   - 自动调 `/resume` 内部（不通过 user）
   - 写 audit `auto_resume`

**为什么不直接保持 active**：server 重启后内存里的 session state 不可信（可能 LLM 状态、context 不一致），强制 paused 让用户明确"我要继续"是更安全的语义。

---

## 24h Auto-Timeout

**触发**：每 30min 跑一次 cleanup（mavis cron 或 server 内置）

```sql
-- 24h 无活动的 active session → paused
UPDATE goal_nlu_sessions
SET current_state = 'paused',
    paused_from_state = current_state,
    paused_at = NOW(),
    auto_paused = 1,
    updated_at = NOW()
WHERE current_state IN ('init', 'clarifying', 'refining', 'ready_to_create')
  AND last_activity_at < datetime('now', '-24 hours');
```

**为什么不直接 aborted**：24h 是"用户暂时离开"窗口，不是"用户放弃"。paused 保留用户回来 resume 的可能。

---

## 7 天 Abort

**触发**：daily cleanup

```sql
-- paused 超过 7 天 → aborted
UPDATE goal_nlu_sessions
SET current_state = 'aborted',
    abort_reason = 'paused_7d_timeout',
    updated_at = NOW()
WHERE current_state = 'paused'
  AND paused_at < datetime('now', '-7 days');
```

**aborted 不删数据**：用户 7 天后想 resume 还能查（需要手动 /admin/abort-restore 流程，Sprint2 不做）。

---

## 12h Hard Cap（与 autonomy 对齐）

**问题**：session 跑太久 → token 累计 → 成本失控 + context 失真

**机制**：
- session 创建时 `max_turns=10`（足够覆盖大多数 case）
- 超过 10 turn → 强制 `ready_to_create`（不能继续 turn）
- session 整体持续时间 < 12h（创建到 commit）→ 否则强制 abort

```sql
-- 12h 持续运行的 session → abort
UPDATE goal_nlu_sessions
SET current_state = 'aborted',
    abort_reason = '12h_hard_cap',
    updated_at = NOW()
WHERE current_state != 'done'
  AND created_at < datetime('now', '-12 hours');
```

**为什么 12h**：与 autonomy 12h loop 对齐，session 不会超过单日工作窗口。

---

## Cross-Cutting 关注点

### Context 压缩
- session history ≤ 4000 tokens
- 超出时：
  - 保留最近 5 turn 完整
  - 之前 turn 写 `09_Wiki/01_Sources/<sessionId>/turn_<n>.md`（wiki 路径）
  - 之前 turn 在 LLM context 里替换为摘要（LLM 生成）
- 触发时机：每次提交 turn 后检查

### Token 预算
- 每个 turn 写 `token_estimate` 到 `goal_nlu_turns`
- session 累计 = 所有 turn 之和
- 当累计 > 4K → 触发 context 压缩
- 当累计 > 8K（压缩后仍超）→ 警告 user，建议 commit

### 失败恢复
- LLM 失败 → fallback（沿用 Sprint1 goalNlu.ts fallback 逻辑）
- DB 写失败 → 返回 500 + 保留 in-memory 状态下次 retry
- pause/resume endpoint 失败 → 写 audit 失败 + 不改 state

### 并发
- 单 session 单 user 顺序（turn_index 严格递增）
- 多 session 并行（不同 sessionId 互不干扰）
- 同一 sessionId 的并发 turn 请求 → 第二个 409 Conflict

---

## Task 2.3 + 2.7 落地 Checklist（给 coder）

### DB Migration（migrations/20260616_001_goal_nlu_sessions.sql）

```sql
-- 3 张表 + 5 个 index
CREATE TABLE goal_nlu_sessions (...);
CREATE TABLE goal_nlu_turns (...);
CREATE TABLE goal_nlu_audit (...);
CREATE INDEX ...;
```

### Server 改动（apps/server/src/）

1. **新增** `goalNluSession.ts` (~400 行)
   - 6 个 session state 操作函数
   - pause/resume 状态机
   - 12h / 24h / 7d cleanup 函数
2. **改** `index.ts` (+200 行)
   - 6 个新 endpoint
   - server 重启 hook
3. **改** `goalNlu.ts` (扩 313 → ~500 行)
   - 加 `parseGoalNluMultiTurn`
   - session state 集成
   - prompt version bump → `goal-nlu-prompt-20260616a`
4. **新增** `migrations/` 目录 + 1 个 migration 文件

### 前端改动（apps/web/src/）

1. **改** `GoalInputBox.tsx` (+150 行)
   - session 状态显示
   - 反问 UI
   - pause/resume 按钮
   - 单文件，App.tsx 主体 diff ≤ 20 行

### 单元测试

- `goalNluSession.test.ts` (15 case)
  - 5 个 state transition
  - 3 个 pause 触发（user / server_restart / 24h）
  - 3 个 resume（含 last_turn 续接）
  - 2 个 12h hard cap
  - 1 个 7d abort
  - 1 个并发 turn 409
- `goalNlu.test.ts` (扩 5 case)
  - 多轮反问收敛（≤2 轮）
  - session 上下文合并
  - token 超 4K 压缩
  - prompt version 独立

### E2E（playwright）

- 3 个真实场景（见 SPRINT_2_PLAN_v0.2 Task 2.6）
- pause → 10 分钟 → resume E2E

---

## 跟 Sprint1 / Codex 的对接

### 复用 Sprint1
- `goalNlu.ts:parseNaturalLanguageGoal` (Sprint1 313 行) → 新增 `parseGoalNluMultiTurn` (Sprint2 +200 行)
- `index.ts:1676` `POST /from-natural-language` 保留（向后兼容）→ 新增 6 个 session endpoint
- `parsedGoalToGoalCreateBody` (Sprint1) → commit 时复用

### Codex 5 维度映射
- 维度 1（长 session 不掉线）✅ **Sprint2 基础**（状态机 + pause/resume + 12h cap）
- 维度 2（跨 turn 状态）✅ **Sprint2 核心**（session state + 上下文累积）

### Sprint3 衔接
Sprint2 完成后 Sprint3 立即接：
- 把 session 状态从 NLU 阶段扩展到整个 Goal 生命周期
- 长 session 12h + retry/backoff
- 行号级 patch

---

*本文件由 Mavis（顶 PM）于 2026-06-10 23:10 起草，作为 Sprint2 Task 2.3 + 2.7 的硬基础。Sprint1 6/12 + 6/15 gate 通过后 v1.0。*
