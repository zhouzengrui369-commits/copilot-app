# Copilot Desktop Phase 1 开发文档 v0.1

状态：**准确性修订完成，待独立静态验收；MVP 未完成**

唯一产品基线：仓库根目录 `goal.md`、`plan.md`、`rules.md`、`delivery.md` v6.2。

## 1. 产品与数据边界

Copilot Desktop 是单用户、本地优先的 Electron 个人知识助理。

| 数据/能力 | 真值与执行位置 | 云边界 |
|---|---|---|
| 笔记原文、Markdown、标签 | 本机 `userData/local-first/` | 默认不上传 |
| KB | 本机 `kb.sqlite` + `notes/` | 可选备份仍未接通 |
| KG 实体、关系、摘要、标签 | 本机 `kg.sqlite`；持久化与编排在本机 | 提取/摘要可调用已配置的本地或无状态远程模型；云不得保存或成为真值 |
| RAG chunk / 向量索引 | 本机 `rag.sqlite` | 只允许无状态模型调用 |
| 待办、提醒、笔记关联 | 本机 KB 的保留命名空间 | 禁止云端成为真值 |
| 模型推理 | 可配置本地或远程 provider | 远程模型只接收完成该次请求所需最小上下文，不获得 KB/KG 权威存储 |
| 腾讯云 | 无状态 LLM proxy、远程管理 relay、可选备份 | 不得提供 KB/KG CRUD 主存储或图谱计算 |

默认 `cloudBackupEnabled=false`。当前 `CLOUD_BACKUP_CAPABILITY.available=false`，即使设置项可保存，也不能把它描述为已完成备份。

## 2. 运行架构

```text
Electron renderer
  Knowledge / Ask / Voice / Schedule / Settings
          |
          | typed, context-isolated preload IPC
          v
Electron main: LocalKnowledgeService
  |              |               |               |
  v              v               v               v
@copilot/kb   @copilot/kg       @copilot/rag   @copilot/llm-client
kb.sqlite     kg.sqlite         rag.sqlite      model provider
+ notes/      local orchestration  local retrieval  local/remote endpoint
```

关键边界：

- Renderer 没有 Node 集成，不直接读文件系统或凭据。
- `domain-ipc.ts` 只向 Renderer 返回整理过的错误；未知异常不得泄露笔记或密钥。
- 保存笔记后由主进程触发 KG 与 RAG 增量索引；笔记和 Todo 删除走主进程可恢复 Trash，UI 提供撤销，永久清除需在 Settings 单独确认。
- RAG 回答必须返回与回答对齐的 `sources` / `sourceDetails`；没有来源时如实显示空状态。
- 媒体权限仅允许受信主 Renderer 的 audio 请求；其他权限 fail closed。
- 非敏感 provider/endpoint/model 设置由主进程管理；凭据必须留在主进程安全边界，Renderer 不得收到 API key，只暴露 `apiKeyConfigured` 等脱敏状态。

## 3. 代码地图

| 范围 | 入口 | 责任 |
|---|---|---|
| 桌面主进程 | `apps/copilot-desktop/src/main/main.ts` | 窗口、生命周期、设置、IPC、遥测 |
| 本地领域服务 | `apps/copilot-desktop/src/main/local-knowledge-service.ts` | KB/KG/RAG/Todo 编排与 local-first 规则 |
| IPC 安全边界 | `apps/copilot-desktop/src/main/domain-ipc.ts` | typed IPC、流式问答、取消、安全错误 |
| 设置持久化 | `apps/copilot-desktop/src/main/settings-store.ts` | 默认值、模型配置、密钥脱敏、窗口状态 |
| UI 入口 | `apps/copilot-desktop/src/renderer/App.tsx` | 5 个工作区与状态栏 |
| Knowledge | `apps/copilot-desktop/src/renderer/workspaces/KnowledgeWorkspace.tsx` | 笔记 CRUD、重建索引、2D KG、详情 |
| Ask | `apps/copilot-desktop/src/renderer/workspaces/AskWorkspace.tsx` | RAG 流式回答、取消、Sources |
| Voice | `apps/copilot-desktop/src/renderer/workspaces/VoiceWorkspace.tsx` | production strict-local 转写、失败闭合、入库 |
| Schedule | `apps/copilot-desktop/src/renderer/workspaces/ScheduleWorkspace.tsx` | CRUD、提醒、列表/日历、笔记回跳、可恢复删除 |
| Settings | `apps/copilot-desktop/src/renderer/components/Settings/` | model、Encrypted Backup、Remote、Trash、主题 |
| KB package | `packages/kb/` | SQLite + Markdown 本地持久化 |
| KG package | `packages/kg/` | 摘要/标签/实体/关系与本地 KG |
| RAG package | `packages/rag/` | chunk、embedding、本地检索、answer + sources |
| Cloud service | `apps/copilot-cloud/` | 无状态代理与 relay；禁止 KB/KG 主存储 |

## 4. 本地开发

前置条件：Node.js 24+、npm，以及当前 MVP 的 macOS Electron 开发环境。Windows 仅保留 Phase 1.1 源码/配置输入。不要使用真实用户资料、生产密钥或最终发布候选做开发。

以下是会修改依赖目录的 setup，不是只读检查：

```bash
# 在 repository root 执行
npm install
```

开发启动：

```bash
npm run dev:copilot-desktop
```

静态/类型检查（会生成工具缓存的可能性取决于本地工具链，执行前遵守资源与权限门）：

```bash
npm run check:copilot-desktop
npm run check:cloud
```

测试执行入口（命令存在不代表已经 PASS）：

```bash
npm run test:copilot-desktop
npm run test:cloud
npm run ci:integration
npm run check --workspace @copilot/desktop
npm run test:integration --workspace @copilot/desktop
npm run test:integration --workspace @copilot/cloud
npm run test:integration --workspace @copilot/kb
npm run test:integration --workspace @copilot/kg
npm run test:integration --workspace @copilot/llm-client
npm run test:integration --workspace @copilot/rag
```

仅发现 Electron E2E case、不启动真实 Electron 的入口：

```bash
npm run test:e2e:electron -- --list
```

该命令只证明 discovery，不是 Electron E2E 运行证据。真实 E2E 入口为 `npm run test:e2e:electron`，必须在单独授权和资源安全时执行并绑定同一 final candidate。

不要把根目录的 OpenClaw Workbench `npm start`、`apps/desktop` 或 mobile/web 工作区当成 Copilot Desktop Phase 1 入口。

## 5. 功能数据流

### 5.1 文字笔记与 LLM WIKI

1. Renderer 通过 preload 调用 `notes.create/update`。
2. `LocalKnowledgeService` 写入本机 KB；本地写入是唯一成功真值。
3. Renderer 调用 `kg.reindexNote`。
4. KG builder 编排摘要、标签、实体和关系提取并原子替换该笔记图谱；推理来自当前配置的 provider，可能是本地 endpoint，也可能是无状态远程 endpoint。
5. RAG indexer 更新本地 chunk/vector 数据。
6. UI 重新加载 2D 图谱、详情和反向引用。

模型失败时不得回滚已成功的本地笔记；索引失败必须显示失败状态并允许重试。即使调用远程 provider，笔记、KG、RAG 索引和编排状态仍以本机为权威，云不得持久化为产品真值。

### 5.2 RAG + Sources

问题先从本地 KG/向量索引召回，再向已配置模型发送最小必要上下文。流式事件包括 delta 与来源；取消必须成为终态。UI 的 Sources 按 `notePath` 回跳到 Knowledge，来源为空时禁止伪造引用。

### 5.3 语音

当前 production Voice 路径是 `strictLocal=true`：界面没有注入 cloud endpoint、consent 或 fallback enablement；本地识别不支持/失败时必须 fail closed，并且不发送音频。云 ASR 只允许存在于另行配置的 non-strict 路径，必须同时具备显式 enablement、用户 consent 和明确 HTTP endpoint；当前用户界面不承诺自动 fallback。成功的 strict-local 转写会创建 `inbox/voice-<timestamp>` 本地笔记并重建索引。真实 macOS 麦克风、转写准确率与权限体验仍是 final-candidate runtime 证据。

### 5.4 日程

Todo 通过本地 KB 的保留路径持久化。提醒每 15 秒检查到期项；系统通知只在用户授权后发送。关联笔记按钮在同一 Electron App 内回到 Knowledge。删除 Todo 进入可恢复 Trash 并提供撤销；Settings 中恢复或单独确认永久清除。

### 5.5 Settings：Backup、Remote 与 Trash

- **Encrypted Backup**：默认 OFF；需要配置与显式 consent，只允许选择 scope 后手动 snapshot/upload/download-verify/restore-preview/delete。没有 schedule/background upload；restore apply 当前不可用。现有 UI/source 不是 live COS 成功证据，footer 仍为 `UNAVAILABLE (metadata-only)`。
- **Remote management**：默认 OFF；需要已验证 pairing，online-only、无离线队列，每条命令由桌面确认，可 revoke/disable；authority/readiness fail closed。腾讯 production issuer、mount、TLS/WSS 和 live relay 尚未部署验收。
- **Trash**：列出本地可恢复的 note/Todo，支持 restore；冲突或 recovery-required 状态必须保留并提示，永久 purge 需要独立明确确认。

## 6. AI 与隐私失败兜底

| 失败 | 对用户的结果 | 禁止 |
|---|---|---|
| 未配置远程 API key | `[CONFIG_REQUIRED]` 对应“请先在设置中完成模型服务配置” | 静默使用内置密钥 |
| 本地模型/网络不可用 | 显示本地 AI 服务不可用并允许重试 | 伪造摘要/回答 |
| RAG 无来源 | 空 Sources + 明确空状态 | 生成不存在的引用 |
| 流式问答取消 | 停止流并产生取消终态 | 取消后继续写回答 |
| KG/RAG 索引失败 | 笔记保留为本地真值，可重试索引 | 删除已保存笔记 |
| 云备份不可用 | 状态栏显示 `UNAVAILABLE (metadata-only)` | 宣称已经同步/备份 |
| strict-local Voice 不可用 | 不发送音频，显示可操作错误并改用文字录入 | 自动上传到云 ASR |
| 麦克风拒绝 | 引导系统设置，仍可文字录入 | 请求非音频权限 |
| Remote authority/readiness 不可用 | 保持 OFF/拒绝连接与命令 | listen + ready 假绿或降级到非 TLS |
| 未知内部错误 | 仅返回安全通用错误 | 把笔记、token、堆栈发到 Renderer/日志 |

## 7. 质量与发布门禁

历史/源码诊断可能包含 integration、覆盖率或 macOS packaged Electron E2E 结果，但它们不能替代当前 final candidate。当前 Phase 1 的最终 AND 门全部绑定同一 macOS final candidate：

- 总覆盖率至少 70%，声明的关键文件逐文件至少 90%；
- 6 个明确 workspace 的 integration 全部有非零测试且通过；
- 同一 macOS 最终签名候选至少 50 条真实 Electron E2E，100% pass；
- 同一 macOS final candidate 的 candidate-bound 性能合同与基线；
- 同一 macOS final candidate 的真机关键流程截图；
- Round 1、2、3 均在同一 macOS final candidate 上完成正式 verify-fix；
- 真实 final manifest 驱动的 macOS 可安装包、Developer ID、公证、Gatekeeper、SHA256 和 release identity；
- live 模型/云边界数据、NS1-NS3 与 NJX owner 签字。

直接运行 `electron-builder` 的 `dist:*` 脚本只能产生开发/诊断包，不能绕过 canonical release、签名和证据门禁。最终发布操作还需要 owner 对 clean commit、凭据、签名、公证和网络提交逐项授权。Windows runner/签名属于另行授权的 Phase 1.1。

## 8. 当前已知阻塞

- 无 Developer ID Application 与可用 notary profile；
- 无最终 signed clean candidate；
- 无同一 macOS final candidate 的正式 3 轮 verify-fix；
- 无 live model/cloud 与一周 NS1-NS3 数据；
- 性能 aggregate 的候选绑定仍受受保护配置约束。

Windows 原生功能、签名、安装、E2E、性能和截图仍未完成，但状态是 `OWNER-DEFERRED → Phase 1.1`，不作为当前 MVP 阻塞或已交付项。

当前截图、视频、candidate ID、包名、SHA256、签名与公证结果：`PENDING_REAL_FINAL_CANDIDATE_EVIDENCE`。它不是文件路径或 PASS。

因此本文档完成只代表 `T-1.4.6` 的内部文档内容就绪，不改变根 `delivery.md` 或 Phase 1 状态。
