# OpenClaw Workbench 产品愿景 v1.0
> Codex-style 基于自然语言目标的自主开发智能体
> 产品经理：Mavis
> 创建日期：2026-06-10
>路径：`/Users/njx/openclaw_data/openclaw_workbench/PRODUCT_VISION_v1.0.md`

---

## 一句话定位

> **OpenClaw Workbench = 用户说一句话，Workbench 把这件事做完整，并在桌面端给出可验收的证据。**

对标产品：**OpenAI Codex CLI**（CLI sandbox验收）→ 我们走更严的路线：**Mac mini桌面端真实操作 +截图证据链 +人类验收**。

---

## Codex 五件套对标 +现状盘点

| # | 五件套 | Codex形态 | Workbench现状 |差距 |
|---|--------|-----------|---------------|------|
|1 | **自然语言目标接口** | 用户说人话，agent拆子任务树 | ✅ 后端 goal API 已完整（POST `/api/development/projects/:id/goals`），但要求结构化 body（title/objective/success_criteria）| **缺 NLU入口**：用户要自己写 JSON |
|2 | **单目标独占 session +上下文累积** | 一个目标一个 session，跨 turn累积 | ✅ Goal实体 + heartbeat + continuation_contract + recovery_packet 已实现 | **缺"用户开 session"流程**：现在 cron scheduler 自动跑，没有用户主导 session入口 |
|3 | **桌面验收证据链** | Codex = sandbox + 命令行输出；我们要 **桌面端 +截图** | ✅ evidence_pack + completion_audit + artifact_refs 已实现；computerUse 模块有微信 + summary 但**没有"通用桌面验收"流程** | **缺桌面验收 harness**：agent真实操作 Chrome/系统 →截图 →写入 evidence_pack → 用户验收 |
|4 | **失败局部恢复** | Codex：局部 patch + retry；Workbench：recovery_packet + dispatch_recovery 已实现 | ✅ recovery_packet / dispatch_recovery / continuation_contract / operating_actions 已实现 | **缺"局部修复 vs整个 retry"策略**：当前 dispatcher 主要 retry entire subtask |
|5 | **自我验证 +长期演进** | Codex：模型自评；Workbench：completion_audit + learning_review | ✅ completion_audit + learning_review 已实现 | **缺"主动 propose改进"回路**：现在是评估结果给人看，没有"agent 自己反思 → propose → 用户决策 → 实现"循环 |

**结论**：Workbench 后端4/5 已具备，**真正的差距是"接入面" + "桌面验收" + "用户主导 session"**。

---

## 产品骨架（Codex 五件套如何映射到 Workbench）

```
┌─────────────────────────────────────────────────────────────┐
│ 用户界面层（web/desktop/mobile 三端统一，localhost:38888） │
│ ┌──────────────────────────────────────────────────────┐ │
│ │1. 自然语言目标入口（"Goal 输入框"） │ │
│ │ 例：用户输入"修复笔记生成慢" │ │
│ │ → NLU拆解 → 自动建 Goal + 子任务树 │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │2. Goal详情页（Owner session视图） │ │
│ │ - Plan / Result / Timeline / Heartbeat │ │
│ │ - 单目标独占 session，跨 turn上下文累积 │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │3.桌面验收面板（Codex 比不了的差异化点） │ │
│ │ - agent 操作桌面截图 →证据链 │ │
│ │ - 用户在 Workbench 内看到截图 →拍板 ACCEPT/REJECT │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │4.失败恢复视图 │ │
│ │ - Recovery Packet → 用户决策 →局部 patch │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │5.自我复盘 → 用户决策 →演进 │ │
│ │ - completion_audit + learning_review 自动产出 │ │
│ │ - agent propose "下个 sprint 应该改什么" │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
 ↕ HTTP API
┌─────────────────────────────────────────────────────────────┐
│ Workbench Server（Fastify @38888） │
│ - /api/development/goals/* (Goal CRUD + Scheduler) │
│ - /api/computer-use/* (桌面控制 +验收) │
│ - /api/agent-workbench/* (Operator Console v3/v4) │
│ - /api/knowledge/* (笔记生成 v3) │
│ - /api/research/* (Deep Research) │
└─────────────────────────────────────────────────────────────┘
 ↕
┌─────────────────────────────────────────────────────────────┐
│ 三代理 + autonomy + cron │
│ - main / boss / worker 三 agent │
│ - autonomy loop（已验证12h持续跑126 metrics +56 screenshots）│
│ - mavis cron调度（knowledge sync, vault curate, dev goals）│
└─────────────────────────────────────────────────────────────┘
```

---

##路线图（5 个 Sprint × ~2 周 =1-2 个月）

### Sprint1（本周末6/10-6/15）—— **立骨架：自然语言入口 +桌面验收 MVP**

**目标**：跑通一条真实链路，证明 Codex 五件套的核心差异化点立得住。

**Sprint1范围**：
1. **NLU目标入口**（后端）
 - 新 endpoint：`POST /api/development/goals/from-natural-language`
 -接收自然语言 → LLM拆解 → 自动填 goal + 子任务树 → 创建 Goal
 -保持原有结构化 POST入口不变（向后兼容）

2. **桌面验收 Harness**（computerUse 模块扩展）
 - 新函数：`computerUseVerify(target: { app, action, screenshotCount })`
 - agent真实打开 app（Chrome/系统/Workbench自身）→多次操作 →多次截图 →整理成 evidence pack
 -失败 →触发 recovery_packet

3. **Goal详情页接入 NLU**（前端）
 - 在 Development Center 加"目标输入框"（占1 行 textarea + 创建按钮）
 - 用户输入 →调 NLU endpoint →跳转 Goal详情

4. **桌面验收面板**（前端）
 - Goal详情页加 "Verify" tab
 -嵌入截图序列（多张缩略图 + 单张大图）
 - 用户 ACCEPT/REJECT →写入 completion_audit

**验收**（用户说一条自然语言目标）：
- "在 Chrome 里打开 Workbench演示笔记生成，截图存证"
- agent真实操作 →3-5 张截图 →写入 evidence → 用户在 Workbench 看截图拍板

**为什么先这条**：这是 Codex形态缺我们有的"硬证据"。先把这条立住 = 产品差异化立住了。

---

### Sprint2（6/16-6/29）—— **自然语言理解深度**

- NLU 多轮对话：用户说"修复笔记生成慢" → agent 反问 "是指 LLM慢还是 HTML渲染慢？" → 用户答 →拆解
- 子任务自动生成：从 Goal objective派生 [Plan / Implement / Test / Verify] 子任务结构
-上下文累积：单 Goal session 内，agent记忆历史决策（避免重复反问）

### Sprint3（6/30-7/13）—— **用户主导 session +局部恢复**

- Owner session模式：从 cron scheduler调度 → 用户在 UI 开 session
-局部 patch策略：subtask失败 →定位行号 → patch → 不重跑整个 task
- recovery_packet 用户审批 UI：在 Workbench 内看到 recovery options → 用户选 → 执行

### Sprint4（7/14-7/27）—— **自我验证 +长期演进**

- completion_audit 自动评估：每个 Goal完成后 agent 自己跑 audit →标红短板
- learning_review → propose：agent 提出"下个 sprint 应该改 X"
- 用户决策 → 创建新 Goal →闭环

### Sprint5（7/28-8/10）—— **产品打磨**

- Codex 五件套全面对齐
-端到端 demo：从用户输入一句话 → 自动跑完 →桌面验收通过 → 自动归档
- 产品文档 + 用户视频

---

##核心非目标（不会做的事）

1. **不做 Marvis抄 UI**——Workbench 是 Owner Operator 控制台，不是协作聊天界面
2. **不做"假装 OK"**——Degraded状态永远显示，不包装成 Working
3. **不做"假证据"**——验收截图必须真实桌面，不允许 mock
4. **不做"无审计自动决策"**——所有 high-risk动作走 approvals 表
5. **不做"长 session 无压缩"**——超过 token budget 必须显式交接

---

## 与现有 v3/v3.3/v3.4 的关系

- v3笔记生成 / v3.3 quality gate / v3.4锁修复 =已有资产，**保留**
- v4 Operator Console = UI骨架，**保留**
- Codex 五件套 = 在 v4 Operator Console之上加 **Goal入口 +验收面板**
-1-2 个月迭代期**不动**核心 v3 pipeline（避免回归）

---

##风险与开放问题

|风险 |缓解 |
|------|------|
| NLU拆解 LLM不可靠 |保留结构化 POST入口；NLU 输出给用户预览再确认 |
|桌面验收截图隐私 | 用户工作目录白名单；截图前 confirm |
| Codex 五件套全面铺开周期太长 | Sprint1 MVP 立骨架后，每个 Sprint 一个核心件，**用户验收驱动节奏** |
| autonomy loop持续写 working tree噪音 | .gitignore 已配；commit拆文件级 +诚实 message（已验证） |

---

## 给用户的下一步（决策点）

**用户已在2026-06-1009:42拍板**：
- MVP范围：**C方案（完整 Codex 五件套，1-2 个月长周期）**
-角色授权：**除安全 +明确决策项外，由 PM 直接决**
- 开发不中断：**不需要等用户，PM 直接推进**

**PM接下来的动作（已自动启动）**：
1. ✅写本 vision文档
2. ✅写 SPRINT_1_PLAN.md
3.11:30验收 hook：整理12h metrics + screenshots +路线图摘要给用户拍板
4. 用户验收后启动 Sprint1实际开发（NLU endpoint +桌面验收 harness）

---

*本文件由 Mavis（顶 PM）于2026-06-1009:42起草，作为1-2 个月 Codex 五件套迭代的纲领。*
