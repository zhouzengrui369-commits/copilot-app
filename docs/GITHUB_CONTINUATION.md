# Copilot App 三方交接与 GitHub 续开发入口

更新日期：2026-08-20
当前结论：`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

本文是 ChatGPT Parent PM、Local Deployment Agent 与 Codex Experience Reviewer 的续跑入口。根目录 `AGENTS.md`、`goal.md`、`plan.md`、`rules.md`、`delivery.md`、`PROJECT_STATE.yaml`、`PROJECT_STATUS.md`、`TODO.md`、`DECISIONS.md` 和 `CHANGELOG.md` 仍是项目真值。

## 1. 当前可接受事实

- Repository：`zhouzengrui369-commits/copilot-app`
- Active Draft PR：`#54`，branch `codex/demo-ui-web-first-r1`
- 本次交接提交之前的 source-gated head：`491da2fce157585367c3a551130a2f03634c900b`
- 对应 tree：`d4a01648bdbc855d9be2d087597317e44fae9d02`
- GitHub source gate：run `31779009577`，job `94700478799`，`17/17 PASS`
- Candidate source contract：`124/124 PASS`
- 唯一 Demo UI authority：`design/authority/copilot-phase1-mvp-demo-v3-calendar-moc.html`
- Demo authority：`52046` bytes，SHA256 `231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205`

本交接提交会使 PR head 前进。因此任何后续部署必须从 GitHub 实时解析 PR #54 head，并要求该**同一精确 head** 的完整 source gate 为 PASS；不得把上述 pre-handoff SHA 当作自动 successor 授权。

## 2. R7 真实终态边界

R7 绑定 `491da2f...` 后完成一次 exact-object authority 和一次 `124/124` source contract，并启动了唯一一次 hydration。随后执行任务因 Codex 用量上限失败，未生成可接受的 terminal hydration PASS、terminal blocker receipt、Candidate manifest 或完整 evidence root。

2026-08-20 只读复核结果：

- 未发现仍在运行的 R7 hydrator/Candidate 进程；
- R7 partial cache 与 hydration worktree 仍存在；
- 没有可接受的 hydration PASS receipt；
- 最后已审计状态仍是 Candidate、package、App、E2E、performance 均未运行；
- partial cache、worktree、日志和任何派生身份均为 `INCOMPLETE_NON_REUSABLE`。

因此：`LOCAL_DEPLOYMENT_COMPLETE=false`，`CODEX_EXPERIENCE_ACCEPTANCE=NOT_STARTED`。不得恢复、续跑、补写或复用 R7；如 Parent PM 决定继续，必须签发新的独立 successor 身份和全新路径。

当前浏览器地址 `http://127.0.0.1:41744/?prototype=ready#today` 只是同源网页原型：`PROTOTYPE / NOT_RUNTIME_PROOF`。它不能证明 Electron Candidate、安装、重启持久化、native 能力、性能、签名、公证或 Release。

## 3. 职责与禁止事项

| 角色 | 负责 | 必须交付 | 禁止 |
| --- | --- | --- | --- |
| ChatGPT Parent PM | 通过 GitHub 分支/PR 完成远程源码开发、测试、CI、评审与 successor 合同 | Draft PR、精确 40 位 SHA/tree、同 SHA source gate、变更与测试摘要、本地部署合同 | 本地运行 Candidate；把网页/CI 当 runtime proof；签发未 source-green 的 SHA |
| Local Deployment Agent | 在全新路径中消费 Parent PM 签发的精确 SHA，执行 hydration、offline lifecycle、Candidate、package、E2E 与 performance | exact identity、全部 execution counts、artifact/runtime/test-data hashes、FINAL_RECEIPT、HANDOFF、进程完整性 | 静默改源码；复用 R1-R7；整体重试；越权签名、公证、merge、release |
| Codex Experience Reviewer | 复核同一 source/artifact/runtime identity，操作真实 packaged App 并做产品体验审核 | P0/P1/P2、关键旅程、Demo UI 对照、重启/离线/native/性能证据、体验结论 | 在审核通道修源码；接受 prototype、worker 口述或不完整收据 |
| Human Owner | 里程碑体验验收与 Release 决策 | `HUMAN_OWNER_MILESTONE_GATE` | 被任何子门禁自动替代 |

Local Deployment Agent 可以是 MiniMax、Codex 本地任务或其他明确指定执行器；执行器身份可以变化，但上述权限边界不能变化。

## 4. 严格阶段门禁

1. **GitHub remote-development gate**
   - Parent PM 从 PR #54 实时 head 开始；
   - Demo HTML 继续作为 UI authority；
   - 完成源码、测试、文档、focused/full checks；
   - 推送 Draft PR；
   - 冻结精确 SHA/tree，并要求该 SHA 的完整 GitHub source gate PASS。
2. **Local-deployment gate**
   - Owner/Parent PM 单独签发新 successor；
   - 所有 worktree/cache/receipt/evidence/Candidate/artifact/runtime/data 路径必须全新且事前不存在；
   - 先 exact-object authority，再一次 source contract、一次 hydration；只有 hydration PASS 才能进入 Candidate；
   - 首个 terminal blocker 立即 fail-closed，后续全部 `NOT_RUN`。
3. **Codex experience gate**
   - 只有完整 packaged `.app`、一致的 manifests/hashes、E2E 与 performance 收据才可启动；
   - Codex 独立操作真实 App，不能把 `41744` 原型页作为替代；
   - 任一 source fix 都返回 Parent PM，并使旧 Candidate 证据失效。
4. **Human Owner gate**
   - Codex 完成体验审核后，由 NJX 进行里程碑验收；
   - signing、notarization、merge、release 仍需独立授权与证据。

## 5. Parent PM 必须解决的当前问题

Parent PM 首先判断 R7 为什么没有 terminal receipt，并在 GitHub 远程开发通道中完成必要的、可测试的 fail-closed 改进。不得在 R7 本地目录中热修。若无需源码变更，也必须给出基于当前 PR head/CI 的明确判断，并签发一个全新 successor 合同；不能恢复 R7。

Successor 合同至少包含：目标、精确 PR/SHA/tree/source gate、允许文件或本地路径、禁止事项、唯一执行次数、网络与 retry 边界、必跑检查、证据根、交付物、验收标准和首个 blocker 行为。

## 6. Copy-ready ChatGPT Parent PM prompt

```text
你现在是 Copilot App 的 ChatGPT Parent PM，负责通过 GitHub 远程开发继续接管，禁止在本地执行或打开 packaged App。

Repository: zhouzengrui369-commits/copilot-app
Active Draft PR: #54
Branch: codex/demo-ui-web-first-r1
Durable handoff: docs/GITHUB_CONTINUATION.md
Sole Demo UI authority: design/authority/copilot-phase1-mvp-demo-v3-calendar-moc.html
Demo SHA256: 231cbef9985cedb697ba52be31d9c04df44ede49bdd9298c3081c8ec19ca4205

请先通过 GitHub 实时读取 PR #54 当前 head、tree、Draft 状态、完整 source gate 和最新 diff；不要只信聊天内旧 SHA。读取并遵守根目录 AGENTS.md、goal.md、plan.md、rules.md、delivery.md、PROJECT_STATE.yaml、PROJECT_STATUS.md、TODO.md、DECISIONS.md、CHANGELOG.md，以及 docs/ARCHITECTURE.md、docs/DEVELOPMENT_WORKFLOW.md、docs/GITHUB_CONTINUATION.md。

已知边界：
- pre-handoff source 491da2fce157585367c3a551130a2f03634c900b / tree d4a01648bdbc855d9be2d087597317e44fae9d02 曾通过 source gate run 31779009577、job 94700478799、17/17。
- R7 只证明 exact authority、124/124 source contract 与 hydration 启动一次；执行任务因用量上限失败，没有 terminal hydration PASS/blocker receipt、Candidate、package、App、E2E 或 performance 终态。
- 2026-08-20 未发现 R7 运行进程；其 partial cache/worktree/log 均不可恢复或复用。
- http://127.0.0.1:41744/?prototype=ready#today 仅为 PROTOTYPE / NOT_RUNTIME_PROOF。

你的任务：
1. 仅在 GitHub 分支/PR 中审查并完成后续源码开发、测试和治理文档；Demo HTML 仍是 UI 权威。
2. 对 R7 缺少 terminal receipt 的失败模式做 fail-closed 设计判断；如需修复，只通过新的 GitHub commit 实现并加回归测试，禁止修改 R7 本地资产。
3. 保持 PR 为 Draft；在最终 head 上运行完整 source gate，输出精确 40 位 SHA、tree、run/job 与测试结果。
4. source gate PASS 后，写出新的、独立身份的 Local Deployment Agent successor 合同。所有 worktree/cache/receipt/evidence/Candidate/artifact/runtime/data 路径必须全新，R1-R7 禁止复用；一旦首个 blocker 出现立即停止。
5. 本地 Agent 只有在 hydration PASS 后才能创建 Candidate；只有完整 packaged Candidate、E2E、performance 与 identity 收据才能交给 Codex。
6. Codex 只负责真实 packaged App 的体验审核；任何源码修复返回本 GitHub 通道。最终 Human Owner 验收、签名、公证、merge、release 均保持独立门禁。

交付：PR URL、最终 SHA/tree、source gate、变更摘要、测试证据、新 successor 合同、未关闭风险。不得宣布本地部署、体验验收、MVP 或 Release 已完成。
```

## 7. 下游提示词模板

### Local Deployment Agent

```text
仅在 Parent PM 给出 PR #54 当前精确 40 位 SHA/tree 和同 SHA 完整 source-gate PASS 后执行。使用新的 successor identity 和所有全新路径；先验证 FETCH_HEAD==SOURCE_SHA、exact-object authority、clean detached worktree，再按 exact-source runner 执行。禁止源码修改、前代资产复用、整体 retry、签名、公证、merge、release。首个 terminal blocker 立即停止并封存；只有 hydration PASS 才能进入 Candidate。返回 FINAL_RECEIPT、HANDOFF、全部 counts、source/artifact/runtime/test-data identity、E2E/performance 和最终进程完整性。
```

### Codex Experience Reviewer

```text
只有在 Local Deployment Agent 返回完整 packaged Candidate 与一致的 source/artifact/runtime/test-data identity 后开始。先独立核验收据和 hashes，再操作真实 packaged App，按 Demo UI authority 检查 Today、Knowledge、Conversations、Settings，以及 Ask/source return、Todo/schedule/restart、Wiki truth、Trash、strict-local ASR、offline、startup/performance、可访问性和产品语言。输出 P0/P1/P2 与 PASS/PARTIAL/FAIL；不得用 41744 prototype、源码测试或 worker 口述替代 runtime proof，不得在审核通道修源码。
```
