# Copilot App

Copilot App 是严格 local-first 的 Electron 个人知识助理：笔记、知识库、知识图谱、Todo、日程和产品数据以本地持久化为准；LLM 用于知识整理和问答；可选云能力不能成为本地核心写入的前置条件。

> 当前状态：`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`。GitHub Phase 1 产品源码已在 Draft PR #14 收口，等待 MiniMax Code 对**精确最终提交**执行本地十二门候选流程。当前没有本地候选、artifact SHA256、runtime ID、候选性能回执、独立 Codex 结论、Developer ID 签名、Apple 公证或 Human Owner Gate。

> 2026-08-20 交接状态：Owner 授权的 Demo HTML 仍是唯一 UI 源码依据。PR #54 的 pre-handoff head `491da2f...` 已通过完整 source gate `17/17`，Candidate source contract `124/124 PASS`。R7 只完成 exact authority、一次 source contract 与一次 hydration 启动；执行任务因用量上限失败，没有 terminal hydration receipt、Candidate、package、App、E2E 或 performance 终态，且 2026-08-20 已无 R7 运行进程。R7 partial assets 不可恢复或复用。当前 `41744` 页面仍是 `PROTOTYPE / NOT_RUNTIME_PROOF`。后续按 [三方 GitHub 交接](docs/GITHUB_CONTINUATION.md) 执行：ChatGPT Parent PM 远程开发 → Local Deployment Agent 全新 successor → Codex packaged-App 体验审核 → Human Owner 里程碑验收。

## 权威与当前工作分工

唯一项目基线是根目录：

- [`AGENTS.md`](AGENTS.md)
- [`goal.md`](goal.md)
- [`plan.md`](plan.md)
- [`rules.md`](rules.md)
- [`delivery.md`](delivery.md)

当前事实由 [`PROJECT_STATE.yaml`](PROJECT_STATE.yaml)、[`PROJECT_STATUS.md`](PROJECT_STATUS.md)、[`TODO.md`](TODO.md)、[`DECISIONS.md`](DECISIONS.md) 和 [`CHANGELOG.md`](CHANGELOG.md) 维护。`docs/*` 是镜像，不能覆盖根目录真值。完整 pre-R30 交接内容保存在 [`docs/history/`](docs/history/)。

Owner 批准的执行边界：

1. **ChatGPT**：只通过 GitHub 分支/PR 开发和审查源码；不在本地执行候选。
2. **本地部署执行官**：先获取并校验 Parent PM 签发的精确 40 位 GitHub 提交，再部署该提交；不静默修源码；返回完整候选绑定证据。任何失败 successor 的目录、缓存、回执、候选、产物和 runtime identity 均不可复用。
3. **Codex**：收到 MiniMax 完整回执后，独立操作真实电脑、执行体验验收和 Release Gate；不在验收通道修源码。

完整流程见 [`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md)。MiniMax 的可执行手册见 [`docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md`](docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md)。
当前可复制的三方续跑合同见 [`docs/GITHUB_CONTINUATION.md`](docs/GITHUB_CONTINUATION.md)。

## 当前源码链

- 原始接管：`codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`，PR #12
- R30 候选执行器父分支：`agent/r30-github-bound-candidate-runner`，PR #13
- R31 源码收口：`agent/r31-source-completion`，Draft PR #14
- 最终提交：在最后一次 authority-bootstrap CI 成功后，由 PR 对话和 owner-facing 部署指令外部给出；tracked 文档不自引用自身 commit

R28 从未执行，独立复核结果为 `FAIL / STAGE_B_REJECTED / P0=1 / P1=2 / P2=0`，永久拒绝且不得复用。

## 精确提交部署授权

`docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` 必须从**精确 Git commit object**读取，而不是从当前 worktree 推断。此前本地在旧 worktree 中找不到该文件，属于 stale-worktree false blocker；精确批准提交内实际存在文档。

最终交接必须先执行：

```bash
git -C "$REPO" fetch --no-tags --prune origin refs/pull/14/head
test "$(git -C "$REPO" rev-parse FETCH_HEAD)" = "$SOURCE_COMMIT"
git -C "$REPO" cat-file -e "${SOURCE_COMMIT}:docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md"
git -C "$REPO" show "${SOURCE_COMMIT}:scripts/candidate-r30/minimax-authority.mjs" \
  > "$BOOTSTRAP_SCRIPT"
node "$BOOTSTRAP_SCRIPT" \
  --repository "$REPO" \
  --source-commit "$SOURCE_COMMIT" \
  --authority-output "$AUTHORITY_COPY" \
  --receipt-output "$AUTHORITY_RECEIPT"
```

`minimax-authority.mjs` 校验文档关键约束、同一提交内 candidate runner、文档 SHA256 和 exclusive output。它不联网、不建候选 worktree、不建 candidate evidence。任何 cron/file-presence 探查都不是执行授权，不能自动启动候选。

## Phase 1 核心能力

- 本地笔记与知识库：SQLite + Markdown 持久化、检索、回读、恢复和数据完整性保护。
- LLM WIKI：摘要、分类/标签、实体和关系提取，以及按精确笔记 revision 校验的知识构建状态。
- 本地知识图谱：持久化图数据、2D 可视化、搜索/筛选、节点详情和双向引用。
- Grounded RAG：回答必须绑定可核对 sources/source details；缺失、stale、unknown 或不可验证来源不能伪装为成功。
- Todo 与日程：支持未安排 Todo、All/Unscheduled 发现、正文/备注/执行日志、来源路径、canonical readback 和 quit/relaunch 恢复。
- 快速记录：文字始终可用；本地语音只进入可编辑草稿，用户确认后才写入本地笔记。
- 可逆 Trash：删除、恢复、清理和启动恢复均由本地主进程持有，渲染层只接收窄化安全回执。

## R31 本地检索架构

生产默认 embedding provider 是 `embedded-local-hash-v1`：

- 确定性字符/词 n-gram hashing；
- 默认 1024 维；
- 无 HTTP、进程启动、模型下载、native addon、云回退或外部本地服务依赖；
- 显式 provider/model revision/privacy class；
- 仅负责检索 embedding，不代替问答生成模型。

Ollama 仅作为显式选择的 local-service 兼容路径。向量存储执行单模型不变量：模型身份变化时清理不兼容向量，但保留 durable local text，供本地文本 fallback 和重新索引。

详情见 [`packages/rag/README.md`](packages/rag/README.md) 和 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## GitHub Source Gate

PR #14 使用 Node 24 macOS source gate 验证：

1. 精确 PR HEAD 与 exact lockfile；
2. candidate fail-closed 纯 Node 合约，包括 exact-Git-object deployment authority；
3. R31 embedded RAG 专项；
4. LLM → KB → KG → RAG ordered build；
5. 五个 local-first workspace 检查；
6. core unit/integration suites；
7. desktop build 与 Phase 1 release suite；
8. core 与 desktop strict global/critical coverage；
9. production CycloneDX SBOM；
10. Electron list-only exact `113 tests in 9 files`；
11. tracked source unchanged。

最后一次 authority-bootstrap 之前的绿色检查点已通过 desktop `1106/1106`；每个 critical file 均达到至少 90%，其中 `local-knowledge-service.ts` branch coverage 为 90.00%。最终部署 SHA 必须重新通过完整 source gate。这些结果不是 packaged Electron runtime 或 Release 证据。

## 十二门本地候选流程

执行入口：

```bash
node scripts/candidate-r30/run-candidate.mjs \
  --source-commit <EXACT_FINAL_40_HEX_HEAD> \
  --evidence-dir <NEW_ABSOLUTE_DIRECTORY_OUTSIDE_REPO>
```

十二门依次绑定：

1. 精确 commit 与 clean preimage；
2. absolute npm、macOS deny-network sandbox、offline install；
3. 所有 Git-tracked regular files 的 SHA256 ledger 与 aggregate；
4. candidate contracts 与 ordered workspace build；
5. checks/tests/coverage/build/SBOM；
6. canonical unsigned macOS arm64 ZIP/DMG；
7. snapshot、ZIP/DMG/app/executable/`app.asar` identity；
8. focused packaged Electron `2/2`；
9. exact `113 tests in 9 files` 与完整 E2E source manifest；
10. full packaged Electron `113/113`、零 skipped/unexpected/flaky、clean exit；
11. 三次 distinct candidate-bound `r31-v1` 性能测试与 aggregate；
12. final manifest、SBOM、screenshots、commands、test-data/runtime/performance/terminal-state 回执。

本地成功结果仍是 **unsigned diagnostic candidate**，不能替代签名、公证、Codex 独立验收和 Human Owner Gate。

## 本地开发

开发环境要求 Node.js 24 或更高版本。普通开发安装/启动：

```bash
npm install
npm run dev:copilot-desktop
```

网页 UI 验收先运行同源 browser prototype；只有 NJX 明确接受网页结果后，才能进入 Electron/打包 successor：

```bash
npm run preview:browser --workspace @copilot/desktop
```

常用源码验证：

```bash
npm run check --workspace @copilot/desktop
npm run test:phase1-release --workspace @copilot/desktop
npm run test:coverage:global --workspace @copilot/desktop
npm run test:coverage:critical --workspace @copilot/desktop
node --test scripts/candidate-r30/*.test.mjs
```

上述普通开发命令不等于候选执行。候选必须使用精确 final commit、exact-object authority receipt、clean detached worktree、新 evidence directory 和 runner 的 offline/fail-closed 合同。

## Local-first 与云边界

- 笔记、KB、KG、Todo、日程及其持久化真值留在本地。
- 本地写入不能依赖云成功；云不可用时，本地核心仍应工作。
- API key、Backup token、issuer 私钥不得进入笔记、渲染页面、日志或仓库。
- 腾讯云 Remote/live、可选 Backup 与相关生产配置属于 post-MVP，除非 Owner 改变范围。
- Backup 在上传前必须客户端加密；Remote 必须使用生产 issuer 与 TLS/WSS 边界。

安全说明见 [`SECURITY.md`](SECURITY.md)。

## Phase 1 不做与延期

- Windows 真机、签名、安装、截图：Phase 1.1。
- 腾讯部署、Remote/live、可选 Backup：post-MVP。
- 3D 知识图谱、mobile/web、多用户/多租户/SSO/实时协作、商业化、插件开放 API、i18n：post-MVP 或 owner-deferred。

## Release 仍需关闭

- MiniMax exact-commit local candidate 和完整回执；
- Codex 独立真实电脑验收；
- 同一候选三轮 verify-fix；
- packaged real-offline local-ASR；
- Developer ID signing；
- Apple notarization、staple、validate、Gatekeeper 安装/启动；
- Human Owner Gate 与规定使用证据。

任何 historical unsigned candidate、source/static PASS、截图、计划或 worker 自述都不能替代同一 final candidate 的真实证据。最终状态以根基线和 `delivery.md` 为准。
