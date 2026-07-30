# Copilot App

Copilot App 是严格 local-first 的 Electron 个人知识助理：笔记、知识库、知识图谱和产品数据以本地存储为准，LLM 用于知识整理与问答，腾讯云只承担受限的无状态能力。

> 当前状态：`IN_PROGRESS / PARTIAL_BLOCKED`。Phase 1 MVP 采用 macOS-first 验收；Windows 为 `OWNER-DEFERRED`，转入 MVP 后的 Phase 1.1。本仓库当前没有声明已完成签名、公证、final-candidate coverage、Electron E2E、性能、截图或三轮 verify-fix 门禁。

## 开发与验收工作流

Owner 当前批准的仓库级工作流是：

1. ChatGPT 通过 GitHub 分支和 PR 开发产品代码；GitHub commit 是唯一产品
   源码权威。
2. MiniMax Code 只部署一个已批准的精确 commit，绑定 source snapshot、
   artifact SHA256、runtime ID、test-data manifest、命令与终态证据；部署时
   不静默修改产品代码。
3. Codex 在本机对同一候选执行独立、fail-closed 的真实电脑体验验收和
   Release Gate 复核，不用自写修复替代独立验收。

此工作流取代仓库内旧的 OpenClaw/Mavis-first 产品开发路由，但不改变
v6.2、macOS-first、local-first、测试、证据、签名、公证或独立 Focused
Retest 门。完整合同见
[`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md)。

R28 runner 从未执行，独立复核结果为
`FAIL / STAGE_B_REJECTED / P0=1 / P1=2 / P2=0`，不得晋级。后续 runner
必须绑定 R29 之后的新 GitHub commit，并重新关闭 SHA ledger、离线网络边界
和精确 `113 tests in 9 files` 三项前置门。

## 项目基线

唯一项目基线是根目录 v6.2 文档及 2026-07-15 macOS-first owner amendment：

- [`goal.md`](goal.md)：目标、用户场景、local-first 与范围边界
- [`plan.md`](plan.md)：Phase 1 任务、依赖和当前 macOS Gate
- [`rules.md`](rules.md)：质量、安全、证据与禁止误报规则
- [`delivery.md`](delivery.md)：交付状态与最终 RESULT/EVIDENCE 收口

当前 Phase 1 只有在同一 macOS final candidate 完成规定覆盖率、集成测试、至少 50 条真实 Electron E2E、candidate-bound 性能、三轮 verify-fix、真机截图、Developer ID 签名、Apple 公证、可安装包/SHA256 和文档证据后，才能声明 MVP 完成。

## Ecosystem Baseline

- repository: `zhouzengrui369-commits/knowme-ecosystem`
- version: `0.2.0`
- commit: `965713b81a726279f63527eb17979f5e768423c1`
- review date: `2026-07-29`
- deviations: `None`

治理风险：生态仓缺少其自身 `docs/acceptance` 权威路径；本仓只记录该风险，不修改 Copilot 评审 Core/Profile 或产品定位。

## 核心能力

- 本地笔记与知识库：SQLite + Markdown 持久化、检索、恢复与数据完整性保护。
- LLM WIKI：自动摘要、分类/标签、实体和关系抽取，以及增量知识组织。
- 本地知识图谱：持久化图数据、2D 可视化、筛选/搜索、节点详情和双向引用。
- RAG 问答：基于本地知识的召回、回答与可核对的 `sources`/source details。
- 文字与语音录入：文本输入以及受能力/权限边界保护的 ASR 路径。
- 知识关联日程：Todo、日程与本地知识引用。
- 可扩展模型配置：模型提供方、兼容端点和凭据边界由主进程/安全存储管理。
- 可选 Backup 与 Remote：显式启用、失败闭合，不改变本地数据权威性。

## Local-first 与腾讯云边界

桌面 App 是产品和数据权威面：

- 笔记、KB、KG、Todo、日程及其持久化真值留在本地。
- 本地写入不能依赖云端成功；云不可用时，本地核心能力仍应可用。
- API key、Backup token、issuer 私钥等不得进入笔记、渲染页面、日志或仓库。

腾讯云边界仅包括：

- 无状态 LLM 请求代理；
- 不保存本地知识真值的 Remote 管理中继；
- 显式可选、默认关闭的 Backup 元数据/短期 COS presign 能力。

Backup 数据必须在客户端加密后才可上传；腾讯云不能获得明文或客户端加密密钥。Remote 必须使用生产 issuer 与 TLS/WSS 安全边界。当前腾讯生产配置、issuer mount 和 Remote readiness 仍有未关闭门，不能视为已部署或可用。

更多安全说明见 [`SECURITY.md`](SECURITY.md)。

## Phase 1 不做

- 3D 知识图谱
- mobile 或 web 客户端
- 多用户、多租户、SSO 或实时协作
- 商业化、订阅或付费系统
- 第三方插件或开放 API
- i18n
- 端侧 LLM 推理
- 已退役的 `njx-knowledge` Sprint 2

Windows 源码路径、平台抽象和静态兼容性会保留，但 Windows 真机、签名、安装和截图属于 Phase 1.1，当前不构成已交付证据。

## 本地开发

要求：

- Node.js 24 或更高版本
- npm workspace 依赖已安装
- 当前 Phase 1 的桌面运行与验收目标为 macOS

安装依赖：

```bash
npm install
```

启动 Copilot Electron 桌面开发环境：

```bash
npm run dev:copilot-desktop
```

按需启动本地 Cloud 服务开发进程：

```bash
npm run dev:cloud
```

Cloud 开发进程仍需要合法的本地运行配置；不要把 API key、token、私钥或生产值写入仓库。

## 本地验证入口

以下命令来自当前 `package.json`/workspace scripts。它们是验证入口，不代表本仓库当前已经通过相应门禁。

桌面 TypeScript 与单元测试：

```bash
npm run check:copilot-desktop
npm run test:copilot-desktop
```

桌面集成与真实 Electron E2E：

```bash
npm run test:integration --workspace @copilot/desktop
npm run test:e2e:electron
```

桌面覆盖率：

```bash
npm run test:coverage:global --workspace @copilot/desktop
npm run test:coverage:critical --workspace @copilot/desktop
```

Cloud 检查、测试与覆盖率：

```bash
npm run check:cloud
npm run test:cloud
npm run test:coverage:global --workspace @copilot/cloud
npm run test:coverage:critical --workspace @copilot/cloud
```

项目集成入口：

```bash
npm run ci:integration
```

macOS 打包入口确实存在：

```bash
npm run dist:mac:copilot
```

但运行打包命令或生成 DMG/ZIP 不等于 Developer ID 签名、公证、安装、Gatekeeper 或 final-candidate 验收通过。

## 证据入口

当前接管任务的事实索引位于：

- [`tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/RESULT.md`](tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/RESULT.md)
- [`tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/EVIDENCE.md`](tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/EVIDENCE.md)
- [`tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/DISPATCH_STATUS.md`](tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/DISPATCH_STATUS.md)
- [`tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/reports/`](tasks/codex/2026-07-14T17-11-phase1-mvp-codex-takeover/reports/)

历史 unsigned candidate、source/static PASS、测试路由、计划或 worker 叙述都不能替代同一已签名 final candidate 的真实运行证据。最终状态以根基线和 `delivery.md` 为准。
