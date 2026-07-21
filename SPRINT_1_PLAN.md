# Sprint1 Plan: 立骨架（自然语言入口 +桌面验收 MVP）
> 周：2026-06-10 ~2026-06-15
> PM：Mavis
>路径：`/Users/njx/openclaw_data/openclaw_workbench/SPRINT_1_PLAN.md`

---

## Sprint1目标

跑通一条**真实链路**，证明 Codex 五件套的核心差异化点立得住：

> 用户说一句话 → Workbench 自动建 Goal → agent真实操作桌面 →多次截图 → 用户在 Workbench 内看到截图拍板 ACCEPT

**Codex 没这条**——Codex走 CLI sandbox，我们是 Mac mini桌面端真实操作 +截图证据。

---

##现状 vs目标

###现状（已有的资产）

|资产 |位置 |状态 |
|------|------|------|
| Goal CRUD API | `apps/server/src/index.ts:1619-2308` | ✅完整 |
| Evidence Pack 生成 | `developmentGoalEvidencePack` | ✅完整 |
| Heartbeat / Scheduler | `/api/development/observability/heartbeat` | ✅12h验证 PASS |
| Computer Use (微信 + summary) | `apps/server/src/computerUse.ts` | ⚠️ 仅82 行，仅微信场景 |
| Operator Console v3/v4 | `design/agent-operator-console-v3.html` + v4 | ✅ 设计稿已 ready |
| Development Center页面 | `apps/web/src/App.tsx` | ⚠️ Goal列表 +详情页存在 |

### Sprint1目标（新增4块）

1. **NLU目标入口**（后端 + 前端）
2. **桌面验收 Harness**（computerUse 模块扩展）
3. **Goal详情页接入 NLU**（前端）
4. **桌面验收面板**（前端）

---

## Task1：NLU目标入口（后端）

###范围
- 新 endpoint：`POST /api/development/goals/from-natural-language`
-接收自然语言目标 →调 LLM拆解 → 自动填 Goal schema + 子任务树 → 创建 Goal + 返回 Goal detail

### LLM拆解 contract

**输入**：用户自然语言目标（一句话或一段）
**输出**：JSON
```json
{
 "title": "短标题（≤30字）",
 "objective": "目标陈述（≥10字，包含可验证标准）",
 "successCriteria": ["标准1", "标准2", "标准3"],
 "subtasks": [
 { "key": "plan", "title": "出方案", "kind": "plan" },
 { "key": "implement", "title": "实现", "kind": "code" },
 { "key": "verify", "title": "桌面验收", "kind": "verify" }
 ],
 "autonomyLevel": "low_risk_only" | "supervised" | "autonomous",
 "riskPolicy": "low_risk_only" | "approval_required" | "review_after",
 "estimatedTurns":3,
 "verification": {
 "kind": "desktop_screenshot",
 "targetApp": "Chrome",
 "expectedScreenshots":3
 }
}
```

### 实现步骤

1. **新增** `apps/server/src/goalNlu.ts`（~200 行）
 - `parseNaturalLanguageGoal(input: string): Promise<ParsedGoal>`
 -调 `openclaw-cn gateway call`（已配）或本地 LLM
 - 用 v3笔记生成的 prompt 工程规范：**1)角色2)必要约束3) JSON contract4)原文**
 -不用过严校验（参考 v3.3拆解清单）

2. **新增** `POST /api/development/goals/from-natural-language`（index.ts +200 行）
 -接收 `{ naturalLanguage, projectId }`
 -调 `parseNaturalLanguageGoal` →拿到 `ParsedGoal`
 -调 `createDevelopmentGoal`（已存在）+ 创建 subtask 工作包
 - 返回 Goal detail（含 subtasks）

3. **错误处理**
 - LLM失败 → 返回 `{ ok: false, error: "nlu_parse_failed", rawOutput }`，用户可手动填写结构化表单
 - LLM 输出不全 → fallback 到 minimal goal（仅 title + objective），subtask标记 user_define

###验收
```bash
curl -X POST http://localhost:38888/api/development/goals/from-natural-language \
 -H 'Cookie: owb_session=...' \
 -H 'Content-Type: application/json' \
 -d '{"naturalLanguage":"在 Chrome 里打开 Workbench演示笔记生成，截图存证","projectId":"<id>"}'
#期望：返回 Goal detail，含 subtasks = [plan, implement, verify]
```

---

## Task2：桌面验收 Harness（computerUse 模块扩展）

###现状
`apps/server/src/computerUse.ts` 仅82 行，仅 `computerUseWechatPrepare/Send`（微信场景）。

###目标
通用 `computerUseVerify` 函数，支持任意 app +多次截图 + evidence pack整合。

### 实现步骤

1. **扩展** `apps/server/src/computerUse.ts`（+300 行）
 - `computerUseVerify(input: { targetApp: string, action: string, screenshotCount: number, goalId?: string }): Promise<VerificationResult>`
 - 调用 `mavis mcp call cu desktop_*` 系列
 -多次 `desktop_screenshot`存档到 `evidence_dir/screenshots/<goalId>/<n>.png`
 -验证逻辑：检查 screenshot 不是全黑/全白/未变化（diff 算法）
 - 返回 `{ ok, screenshots: string[], diffScore, summary }`

2. **整合到 Goal evidence pack**
 -现有 `developmentGoalEvidencePack`读取 evidence_dir
 - 增加读取 `screenshots/<goalId>/*` 子目录
 - 在 evidence pack markdown 中嵌入 `![screenshot](path)`链接

3. **新增** `/api/computer-use/verify`（index.ts +50 行）
 - POST触发验收
 - GET 查询最近验收结果

###验收
```bash
curl -X POST http://localhost:38888/api/computer-use/verify \
 -H 'Cookie: owb_session=...' \
 -d '{"targetApp":"Chrome","action":"open workbench note generation","screenshotCount":3,"goalId":"<id>"}'
#期望：真实桌面 Chrome 被打开，3 张截图存档
```

---

## Task3：Goal详情页接入 NLU（前端）

###范围
在 Development Center顶部加 "目标输入框"（textarea + 创建按钮）。

### 实现步骤

1. **修改** `apps/web/src/App.tsx`（+200 行）
 - 在 Development Center顶部（Project列表下方，Goal列表上方）
 - 新组件 `<GoalInputBox />`
 - 用户输入 →调 `/api/development/goals/from-natural-language`
 -成功后跳转 Goal详情页

2. **样式**（apps/web/src/styles.css +50 行）
 - textarea 占1 行高（可扩展）
 -按钮："创建目标"（primary风格）
 - loading态：spinner + "AI拆解中..."

3. **错误态**
 - LLM失败 → 显示 "AI拆解失败，请手动填写" +展开原结构化表单
 - 网络错误 → toast + 重试按钮

###验收（浏览器）
-打开 `http://localhost:38888/dev-center`
-看到 "目标输入框" 在 Goal列表上方
- 输入 "在 Chrome 里打开 Workbench演示笔记生成" → 点击 "创建目标"
-2-3 秒后跳转 Goal详情页（含3 个 subtasks）

---

## Task4：桌面验收面板（前端）

###范围
Goal详情页加 "Verify" tab，展示截图序列 + 用户拍板按钮。

### 实现步骤

1. **修改** `apps/web/src/App.tsx`（+300 行）
 - Goal详情页 tab列表：Overview / Plan / Result / **Verify** / Timeline
 - Verify tab包含：
 -截图缩略图序列（横向 scroll）
 - 当前选中截图大图
 - 元数据：app name / action / 时间戳 / diff score
 - 用户决策按钮：ACCEPT / REJECT / REQUEST_REDO

2. **ACCEPT流程**
 - 点击 ACCEPT →调 `POST /api/development/goals/<id>/verify/accept`
 -写入 completion_audit：`user_accepted_desktop_verification`
 - Goal状态 → completed

3. **REJECT流程**
 - 点击 REJECT →弹框输入 reason
 -写入 blockers + 创建 recovery_packet
 - Goal状态 → blocked

###验收（浏览器 +桌面）
- 完成 Task1-3 创建的 Goal
- Goal详情页 → Verify tab
-看到真实桌面截图（Chrome + Workbench）
- 点击 ACCEPT → Goal 完成

---

## Sprint1 时间表

| 日期 | Day |任务 |验收 |
|------|-----|------|------|
|6/10 周二 | Day1 | Sprint1 Plan + Vision文档 | ✅ 用户拍板 C方案 |
|6/11 周三 | Day2 | Task1：NLU endpoint（后端 +单元测试） | curl PASS |
|6/12 周四 | Day3 | Task2：computerUse扩展 + verify harness |真实 Chrome截图 PASS |
|6/13 周五 | Day4 | Task3：前端 Goal Input Box |浏览器 E2E PASS |
|6/14 周六 | Day5 | Task4：Verify tab + ACCEPT/REJECT |端到端 demo PASS |
|6/15 周日 | Day6 | Sprint1回顾 + Sprint2启动 | 用户验收 |

---

## Sprint1 Done判定

**Sprint1完成的硬指标**：
1. ✅ NLU endpoint单元测试 PASS
2. ✅ Goal Input Box 在浏览器 E2E PASS
3. ✅ 用户说一句话 → agent真实操作桌面 →截图存档 → 用户在 Workbench 内 ACCEPT → Goal 完成
4. ✅ 全链路 demo录屏 +截图存档
5. ✅ Sprint1 commit + Sprint2启动文档 ready

**Sprint1失败判定**：
- NLU endpoint curl失败（3 次 retry 后）→ Sprint1 部分完成，Task3-4推迟到 Sprint2起点
-桌面验收 harness 不能真实打开 Chrome → Sprint1 部分完成，回退到 mock screenshot 但必须明确标注 degraded

---

##风险与回退

|风险 | 回退方案 |
|------|----------|
| LLM拆解太慢（3+ 分钟） |同步接口改为 async job模式（参考笔记生成 v3.4 job路径） |
| Chrome 没安装 / cu不可用 | fallback 到 `playwright` MCP（已配置） |
| 用户拒绝对桌面操作授权 | Sprint1退化为 "截图 mock模式"（明确 degraded标签） |
| Goal详情页太大（App.tsx14959 行 styles.css已知） | 新建 `apps/web/src/GoalInputBox.tsx` + `GoalVerifyTab.tsx`单独文件，避免单文件超大 diff |

---

## 与既有约束的兼容

1. **server编译需重启**：每次改 server端后 `cd apps/server && npm run build && kill old PID && nohup node --experimental-sqlite dist/index.js > /tmp/workbench-38888.log2>&1 &`
2. **v3笔记生成 pipeline 不动**：Sprint1 不改 v3 的 quality gate / lock / sanitize
3. **autonomy loop持续写 working tree**：.gitignore 已配，commit拆文件级
4. **development-gates.json 必须通过**：所有改动必须 `npm run check && npm run build && npm run test:prd`

---

## 给用户的检查点

| 检查点 | 时间 | 我会做什么 |
|--------|------|-----------|
|11:3012h验收 |6/1011:30 |整理 metrics + screenshots +路线图摘要 |
| Sprint1进度日报 |6/11-6/14每天09:00 | 当日完成 +风险预警 |
| Sprint1验收 |6/1521:00 |端到端 demo +录屏 |
| Sprint2启动 |6/1521:30 | Sprint2 plan ready |

---

*本文件由 Mavis（顶 PM）于2026-06-1009:42起草，作为 Sprint1 的执行纲领。*
