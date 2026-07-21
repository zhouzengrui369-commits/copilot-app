# Copilot App · 项目交付 v6.2（2026-07-09 立项基线 · 7*24h AI · + sprint2 退役归档）

> PM: Mavis
> 创建: 2026-07-09 11:58 (UTC+8) v6.1
> 更新: 2026-07-09 12:22 v6.2（NJX 12:21 popup 拍板：sprint 2 越界实验退役 + PM 流程强化）
> 配套: `goal.md` v6.2 / `plan.md` v6.2 / `rules.md` v6.2
> 路径: `/Users/njx/openclaw/copilot/delivery.md`
> 性质: 验收 SSoT（Single Source of Truth）+ 截图存档索引 + 状态机

---

## 2026-07-16 Owner Amendment · 当前交付口径（MiniMax-first / Tencent post-MVP，最高优先级）

> NJX owner 决策：当前 MVP 使用现有/可配置 MiniMax 推理能力，腾讯云 deployment、Remote/live、可选云备份与生产验收整体后移；ASR 改为 App 内嵌本地模型。本节高于 2026-07-15 覆盖层；旧任务状态和证据只保留历史含义，不倒填为 runtime 或 deployment PASS。

| 交付门 | 当前状态口径 | 当前 MVP 证据要求 |
|---|---|---|
| 本地数据真值 | **当前 MVP 必须** | 笔记/KB/KG/RAG sources/日程/设置均本地持久化；MiniMax 仅无状态推理，不承载真值或持久层 |
| MiniMax 模型能力 | **当前 MVP 必须** | 现有或可配置 provider 可用；摘要/标签/实体/关系/RAG 真实闭环；失败可兜底；不得硬依赖腾讯 deployment |
| App 内嵌本地 ASR | **当前 MVP 必须** | 同一已打包、Developer ID 有效签名、Apple 公证成功并 staple/validate 通过的 macOS Electron final candidate；macOS 真机关闭网络且无任何云 fallback；Electron runtime 从 candidate 包内加载随包内嵌、SHA256 与许可/再分发清单绑定的本地模型并真实 decode；真实转写 → 本地 note → 重启 readback → KG/知识关联可见；standalone helper/sidecar、OS WebSpeech/系统语音服务、开发浏览器、未打包 harness、其他 candidate、source/test/mock 均不得替代；Windows 等价证据仍 `OWNER-DEFERRED → Phase 1.1` |
| 腾讯云 source 工作 | **保留为 post-MVP 输入** | 既有 source/test/docs 历史证据不删除；不得解释为 deployment、Remote 或 live 已通过 |
| 腾讯 deployment / Remote / live / COS 可选备份 | **OWNER-DEFERRED → post-MVP** | 当前不阻塞 MVP；完成独立生产验收前不得宣称腾讯云、远程管理、live 或云备份已交付 |
| macOS final candidate 与质量门 | **当前 MVP 必须** | 延续 2026-07-15：签名、公证、安装包/SHA、真机截图、coverage、integration、≥50 Electron E2E、candidate-bound 性能、3 轮 verify-fix、docs/RESULT/EVIDENCE、owner gate |
| Windows | **OWNER-DEFERRED → post-MVP Phase 1.1** | 保留兼容源码与计划；不得记为当前 MVP 或双平台交付 |

**当前 Phase 1 仍为 `IN_PROGRESS` / `PARTIAL` / `BLOCKED`；本修订只重排依赖与验收时序，不把任何未完成项标记为 `done`。**

---

## 2026-07-15 Owner Amendment · 当前交付口径（macOS-first MVP，v6.2 保持不变）

> NJX owner 决策：当前 Phase 1 MVP 先在 macOS 完成，Windows 真机/签名/截图转入 MVP 后的 Phase 1.1。本节是当前交付状态的最高优先级覆盖层；旧计划和旧证据原样保留，不得倒填或改写。

| 交付门 | 当前状态口径 | 完成证据 |
|---|---|---|
| macOS final candidate | **当前 MVP 必须** | macOS 真机核心流程；Developer ID 签名；Apple 公证成功；可安装包及 SHA256；真机截图 |
| 自动化质量 | **当前 MVP 必须** | 规定覆盖率；集成测试 100% pass；≥50 条真实 Electron E2E 100% pass |
| 性能与修复 | **当前 MVP 必须** | 同一 final candidate 的 candidate-bound 性能基线；3 轮 macOS verify-fix，各自 RESULT/EVIDENCE |
| 文档证据 | **当前 MVP 必须** | 用户/开发/发布文档及本文件 RESULT/EVIDENCE、命令、截图、产物索引收口 |
| Windows 真机/签名/截图 | **OWNER-DEFERRED → post-MVP Phase 1.1** | 当前不阻塞 MVP；完成前不得宣称 Windows、双平台或 Phase 1.1 已交付 |
| Windows 兼容性 | **保留** | 源码路径、平台抽象、静态兼容检查及 Phase 1.1 验证计划；不等于 Windows 真机交付 |

**当前 Phase 1 验收结论仍只能是 `IN_PROGRESS` / `PARTIAL` / `BLOCKED`，直到上述所有 macOS 必须门关闭；Windows 只可标记 `OWNER-DEFERRED`，不可标记 `done`。**

---

## 1. Changelog（基线变更 + 弹窗交互记录）

### 1.1 基线变更

#### 2026-07-16 · v6.2 Owner Amendment（MiniMax-first / Tencent post-MVP / local embedded ASR）
- Author: NJX 拍板 / Codex sub-agent 落地
- Action: 新增最高优先级执行覆盖层；保留 v6.2、2026-07-15 macOS-first 历史和全部旧证据
- Reason: 当前 MVP 复用现有/可配置 MiniMax 能力；腾讯 deployment、Remote/live、可选云备份整体后移；ASR 使用 App 内嵌本地模型
- Affected: 根目录 `goal.md` / `plan.md` / `rules.md` / `delivery.md` 的当前模型、local-first、ASR、Tencent 和验收时序口径
- Confirmed by: NJX 2026-07-16 Owner Amendment
- Tencent disposition: source 工作保留为 post-MVP 输入；deployment/Remote/live/COS/生产权限验收 `OWNER-DEFERRED → post-MVP`，不阻塞当前 MVP且不得误报已交付
- ASR evidence correction: ASR 成功门绑定同一已打包、Developer ID 有效签名、Apple 公证成功并 staple/validate 通过的 macOS Electron final candidate；必须在 macOS 真机断网且无云 fallback 时由 Electron runtime 加载包内 hash/license 绑定模型并真实 decode，完成转写 → 本地 note → 重启 readback → KG/知识关联证据链；helper/WebSpeech/开发浏览器/未打包 harness/其他 candidate/source/test 均不可替代；Windows 等价证据仍 Phase 1.1
- Quality boundary: macOS signed/notarized candidate、coverage、integration、≥50 Electron E2E、candidate-bound performance、3 轮 verify-fix、screenshots、docs/SHA/RESULT/EVIDENCE、owner gate 不降级；Windows 继续 Phase 1.1
- Delivery status: `MVP_NOT_COMPLETE`；未新增任何 `done`

#### 2026-07-15 · v6.2 Owner Amendment（macOS-first MVP）
- Author: NJX 拍板 / Codex sub-agent 落地
- Action: 增加 macOS-first 当前执行覆盖层；保留 v6.2 标识与历史原文
- Reason: NJX 明确“先在 macOS 验证成功，MVP 后再上 Windows”
- Affected: 根目录 `goal.md` / `plan.md` / `rules.md` / `delivery.md`；当前 Phase 1 Gate、三轮 verify-fix 平台归属、Windows 状态
- Confirmed by: NJX 2026-07-15 明确授权
- Windows disposition: `OWNER-DEFERRED` → post-MVP Phase 1.1；不阻塞当前 MVP，不得误报已交付

#### 2026-07-15 · T-1.4.6 Docs v0.1 static acceptance
- Author: Codex sub-agents / independent static reviewer
- Action: T-1.4.6 → `done (DOCS_STATIC_PASS)`；开发文档、用户手册、视频教程脚本三类齐全，4 个视频脚本，独立静态验收 10/10 PASS
- Evidence: gap audit SHA256 `972f0c420cc218e84cc25f9a19b2849814725aaa55f5eb26e2d7cc300d33fd81`; accuracy repair SHA256 `5a5e80b4a9c80db2e67395037d608d1e588ec718cef650a7c38f2e58252e6977`; independent review SHA256 `bae7a85da08be410ee214120ce710793ad8bf2d5101ef20fb7863d79ddbd985b`
- Document postimages: `README.md` `8394e237b3f22f96bb6697025f89b3b03ae94a55611abd2acea363c09af37736`; `DEVELOPMENT.md` `9860e5ee2a65a76630069eb90ab62b8c15c8ac017d2fe24581d10b0dfc70fd7e`; `USER-MANUAL.md` `6d4c1749d02d25e8c019d4347227f24bb9f481388ab57f79434d59380ed7434e`; `VIDEO-TUTORIAL-SCRIPTS.md` `33ddb01487fd715f53b8b9f6c3b2e86de2b2595d3b62ab4c6f3c780b8206475d`
- Provenance limit: `docs/copilot-desktop-phase1/` 当前为 untracked，Git 无法重建 preimage→postimage patch 或证明历史编辑排他性；hash-bound 报告与当前 postimage 一致，但不得引用为 Git-diff 排他性证明
- Boundary: `TESTS_NOT_RUN / MVP_NOT_COMPLETE / RELEASE_NOT_READY`；本状态只关闭文档静态门，不升级 runtime、coverage、integration、Electron E2E、performance、截图/视频、verify-fix、签名/公证、package 或 owner acceptance

#### 2026-07-09 11:34 · v6.0
- Author: PM
- Action: 新建
- Reason: NJX 7/9 11:31 收敛需求，从零立项 copilot app
- Affected: goal.md v6.0
- Confirmed by: NJX 11:44 弹窗批准 v6.1

#### 2026-07-09 11:40 · v6.1
- Author: NJX 修正 / PM 落地
- Action: 修改
- Reason: 决策 2 修正（知识图谱 = 本地 app 内存 + 持久化；云 = 可选备份）
- Affected: goal.md §1 / §3 R3 / §7.2 / §9 决策 2 / §10
- Confirmed by: NJX 11:44 弹窗批准 v6.1

#### 2026-07-09 11:45 · plan.md v6.0
- Author: PM
- Action: 新建
- Reason: 配套 goal.md v6.1 起草
- Affected: plan.md v6.0（13 task / 3 路并行）
- Confirmed by: --

#### 2026-07-09 11:48 · plan.md v6.1
- Author: NJX 修订 / PM 落地
- Action: 修改
- Reason: NJX 7/9 11:47 修订原则（7*24h AI + 质量第一 + 效率第二 + token 成本暂不考虑）
- Affected: plan.md 全文（22 task / 5-6 路并行 / 质量门内嵌 / 3 轮 verify-fix）
- Confirmed by: NJX 11:51 弹窗批准 v6.1

#### 2026-07-09 11:52 · rules.md v6.0
- Author: PM
- Action: 新建
- Reason: 配套 goal/plan v6.1
- Confirmed by: --

#### 2026-07-09 11:53 · rules.md v6.1
- Author: PM
- Action: 修改
- Reason: NJX 7/9 11:47 修订（7*24h AI + 质量门 6 维度 + 项目红线 5 条）
- Affected: rules.md 全文
- Confirmed by: NJX 11:57 弹窗批准 v6.1

#### 2026-07-09 11:58 · delivery.md v6.1
- Author: PM
- Action: 新建
- Reason: plan + rules 派生（无需 NJX 单独拍板）
- Confirmed by: --

#### 2026-07-09 12:22 · v6.2（sprint 2 越界实验退役 + PM 流程强化）
- Author: NJX 拍板 / PM 落地
- Action: **sprint 2 (plan_41740122, njx-knowledge 多人+目标-DAG) 全部作废 + 归档**；PM 流程升级为严格 project-pm skill
- Reason: **三重失败**：
  1. Sprint 2 (njx-knowledge 多人协作 + 目标-动作 DAG) 在 4 文档基线外越界运行 — NJX 11:18 启动监控被 PM 误读为已基线化
  2. Sprint 2 cycle 2 T-S2.3 verifier FAIL（2 spec 缺口：workspace_id 隔离只 25% / token binding 安全 bug），PM 之前用 jest 68/68 自选测试集误判 PASS
  3. Sprint 2 cycle 2 T-S2.1 4 attempt 全 0 bytes，worker session `mvs_6e26ed6d89664045b2eb179058b9fafc` 在 engine kill 后**伪造 deliverable.md**（声称 commit 63c31ff + 11 新文件 + 10 截图），PM 30s hard-verify 全部抓到不存在
- Affected: 4 文档全员 v6.2（goal.md §11 决策 7 / plan.md §6 sprint2 退役 / rules.md §6 PM 硬规则）；归档 `/tmp/openclaw_sprint2_retired_20260709/`；黑名单 worker session；cron `knowme-sprint2-monitor` 已删
- Confirmed by: NJX 12:21 popup（3 选全推荐：retire / blacklist-and-policy / strict-pm-skill）

#### 2026-07-09 14:30 · rules.md v6.2 (PM salvage 落地)
- Author: PM
- Action: 修改 §2.5 → §2.6
- Reason: Sprint 1.1 集成收口暴露 T-1.1.2 silent contract failure（worker 写 ~329 行 platform/ 代码 + tests 但 0 commit + 0 deliverable.md + 0 board entry），需补强 sub-agent done 硬条件
- Affected: rules.md §2.6 新增（commit + deliverable.md + board 3 件齐）
- Confirmed by: --（下次 NJX 4 文档迭代时并入）

#### 2026-07-09 14:30 · root package.json workspaces (PM salvage 落地)
- Author: PM
- Action: 修改
- Reason: Sprint 1.2 sub-task 需用 `--workspaces` 跑 packages/*（@copilot/kb + @copilot/llm-client），root 之前只列 apps/*
- Affected: package.json workspaces 加 `"packages/*"`
- Confirmed by: --

#### 2026-07-09 14:30 · Sprint 1.1 lockfiles (PM salvage 落地)
- Author: PM
- Action: commit
- Reason: 5 分支 merge 后根 package-lock.json 需重生成（workspace union），packages/kb 新增 package-lock.json 锁 better-sqlite3 11.10.0 exact pin（防止 Sprint 1.2 consumer 收 relaxed pin）
- Affected: package-lock.json (15338 行 / 400KB) + packages/kb/package-lock.json (2851 行 / 98KB)
- Confirmed by: --

#### 2026-07-09 14:35 · T-1.1.2 salvage commit (PM 决策 B)
- Author: PM
- Action: WIP commit on `sp1.1-T-1.1.2` branch (NOT merged to main)
- Reason: T-1.1.2 worker β 写 ~329 行 platform/ + tests + 配置到 working tree 但 0 commit + 0 deliverable + 0 board（silent contract failure · verifier 钉子 #14）。PM 决策 B 推 Sprint 1.3，不在 Sprint 1.1 集成收口 merge 阻塞
- Affected: sp1.1-T-1.1.2 @ 0a63ac27（752 行 WIP code 保留，branch HEAD 不动 main）
- 激活计划: Sprint 1.3 T-1.3.2 Windows compat — cherry-pick + 补 deliverable.md + 补 SELF-VERIFY + 补 board entry + 补 cu MCP Windows 真机验证
- Confirmed by: --

#### 2026-07-09 14:35 · Sprint 1.1 集成收口 owner-wrap-up (PM 决策)
- Author: PM
- Action: T-1.1.7 worker 两次 15min cap 物理装不下（5 次 30min cap 经验证）→ plan_a9d38ddd cycle 4 owner-override_accept 关闭 + PM 接管 wrap-up
- Reason: T-1.1.7 结构超 30min hard cap（3-way merge 5 branch + project smoke + contract freeze + cu MCP 截图 + RESULT.md = 45-60min）。attempt 1 producer aborted；attempt 2 verifier timeout。attempt 1 实际进度：5/6 branch merge 进 main（553fc688 / fd2f7c3d / c42cfba8 / 84d3d190 / f62172a6）。剩余 wrap-up（project smoke + cloud live /health / v1/chat auth + desktop alive + contract freeze verify + RESULT-Sprint-1.1.md + delivery.md 状态更新）由 PM owner 接手
- Affected: plan_a9d38ddd status=completed · main @ f62172a6 · 288/288 tests pass across 4 merged workspaces · 5 worker branch 全部 PASS verifier
- Confirmed by: sprint1.1/RESULT-Sprint-1.1.md (PM owner wrap-up evidence)

#### 2026-07-09 14:42 · Sprint 1.2 plan design 落地 (T-1.2.0)
- Author: PM (Mavis session mvs_144239070a21476dae746d1cff6af16b)
- Action: Sprint 1.2 plan design 6 worker + 1 verifier task contracts,基于 plan.md v6.2 §2.2 NJX 7/9 11:51 批准 scope
- Reason: Sprint 1.1 收口 (288/288 tests pass + 4 contract frozen) 后启动 W2 features (KG builder / 2D 渲染 / note detail / voice input / schedule / settings)。钉子 #14 (rules.md §2.6 Done 硬条件) + 钉子 #15 (author_role forward-only schema) 强制落地
- Affected: sprint1.2/ (9 文件 / 1493 行 · sprint1.2.yaml 250 行 + README-DISPATCH.md 131 行 + 7 task contracts + board.md + outputs/T-1.2.0-plan-design/deliverable.md) · commit b1195efa
- Confirmed by: -- (PM 自主, NJX 12:21 已批 Sprint 1.2 scope)

#### 2026-07-09 14:45 · 钉子 #15 v2 schema 同步 + v6.2 references + board cleanup
- Author: PM
- Action: 3 follow-up commit (合并为 1 commit · 865309fb) 落地钉子 #15 v2 完整 schema
- Reason: Sprint 1.2 dispatcher 必带 (a) metadata 5 字段 author_role/dispatched_by/verified_by/spot_check_at/approved_by, (b) pm_cycle_close_cron 6h interval 兜底 (钉子 #15 v2), (c) retired_sprint_reference 黑名单 worker 标记 (防 sprint 2 worker session `mvs_6e26ed6d89664045b2eb179058b9fafc` 复活)
- Affected: sprint1.2/sprint1.2.yaml (+52 行 metadata · 5 字段 + cron + retired ref) · sprint1.2/README-DISPATCH.md (+55 行 v6.2 ref + 钉子 #15 v2 §9) · 6 task contracts (v6.1→v6.2 refs) · board.md (+21/-8 清理 hook 重复段 + done entry 加 author_role 标识 + T-1.2.0 commit ref) · outputs/T-1.2.0-plan-design/deliverable.md (caveats 更新 T-1.1.8 done + NJX 12:21 done)
- Confirmed by: -- (PM 自主, 30s spot-verify 见 Sprint 1.2 dispatch verifier 必跑段)

#### 2026-07-09 14:50 · Sprint 1.2 dispatch readiness 落地 + 钉子 #14/#15 双向交叉
- Author: PM (Mavis session mvs_144239070a21476dae746d1cff6af16b) + verifier standby (mvs_0b85d4f3fc0a495bbb7257b3415e74dd)
- Action: Sprint 1.1 收口 + 钉子 #14/#15 升级 + Sprint 1.2 dispatch prep 三段交叉验证 + verifier 30s spot-check PASS 落地
- Reason: 14:30 rules.md §2.6 (钉子 #14 Done 硬条件) + 14:35 Sprint 1.1 owner-wrap-up + 14:42 Sprint 1.2 plan design + 14:45 钉子 #15 v2 schema — 4 节点齐 + 30s spot-verify PASS (commit 865309fb · 10 文件 / +128-36) → 视为 Sprint 1.2 dispatch readiness 已具备 (rules.md v6.2 §2.6 + sprint1.2.yaml metadata 5 字段 + pm_cycle_close_cron + retired_sprint_reference 双向 cross-doc 一致)
- Affected: delivery.md (本 entry) · verifier session standby (mvs_0b85d4f3fc0a495bbb7257b3415e74dd 复用 + 每个 T-1.2.7 cycle 新开 session · 混合方案 B) · cron 设计 (主 `sprint1.2-cycle-close` 6h 触发 T-1.2.7 + 旁路 `sprint1.2-pm-watchdog` 30min 异常才报)
- Confirmed by: verifier 30s spot-verify PASS (14:45) · 待 15:10-15:30 verifier 复 spot-check delivery.md Changelog + sprint1.2.yaml final sanity · 待 15:30+ Sprint 1.2 `mavis team plan run sprint1.2.yaml` 启动信号 (max_concurrency=6 · 7 task 跨 3-7 天)

#### 2026-07-10 12:14 · Sprint 1.3 v3 CLOSE (Copilot App Phase 1 · 4 路 integration 完成)
- Author: Mavis (PM)
- Action: Sprint 1.3 v3 plan_fcdd0b56 cycle 4 CLOSE · 4 worker branch merge to main + T-1.3.3 cycle-close verifier PASS + cron disable
- Reason: Sprint 1.3 v3 5/5 task operational PASS (T-1.3.0a/b + T-1.3.1 + T-1.3.2 + T-1.3.3 cycle-close audit). Sprint 1.2 retry v2 钉子 #14+#15+#20+#22+#23+#24+#27 全部 solidify · NJX 12:04 popup 拍 A (operational PASS · PARTIAL→PASS · 文档化 deviation pattern)。deviation-pattern-T130b.md 落地 (130 lines · commit 5388702f · 5/5 cross-discipline 钉子)。
- Affected: main HEAD `ee65f48b` (4 merge commits + 1 CLOSE entry) · sprint1.3/board.md (4 done entries + CLOSE entry) · sprint1.3/deviation-pattern-T130b.md (new) · `sprint1.3-pm-watchdog` cron DISABLED (钉子 #29) · `sprint1.2-cycle-close` cron DISABLED retroactive (stale prompt cleanup) · Sprint 1.3 表 (上) 5 row 全部 done · Operational gaps 3 项 deferred to Sprint 1.4 (vitest -19 / NSIS+portable+code signing / deliverable size drift)
- Confirmed by: PM hand-audit 12:14 CST · sprint1.3/board.md CLOSE entry (commit ee65f48b) · deviation-pattern-T130b.md (commit 5388702f) · cycle-close audit `/Users/njx/.mavis/plans/plan_fcdd0b56/outputs/T-1.3.3/audit.md` (8-section 钉子 #15 v2 PASS)


### 1.2 PM ↔ Owner 弹窗记录

| 时间 | 弹窗 # | 场景 | 选项 | 结果 |
|------|--------|------|------|------|
| 11:31 | #1 | baseline-strategy | 🅲 greenfield-copilot-app | 选 🅲（从零立项）|
| 11:36 | #2 | goal-approval | Others: 修正知识图谱在云的描述 | 修正 v6.1 |
| 11:43 | #3 | goal-final-approval | 🅰 approve-v61 | 批准 v6.1 |
| 11:46 | #4 | plan-final-approval | Others: 任务时间按 7*24h AI 算力评估 | 升级 v6.1 |
| 11:51 | #5 | plan-v61-approval | 🅰 approve-v61-plan | 批准 v6.1 |
| 11:56 | #6 | rules-v61-approval | 🅰 approve-v61-rules | 批准 v6.1 |
| 12:0X | #7 | **最终签字**（4 文档 ready）| TBD | TBD（pending） |
| **12:21** | **#8** | **sprint 2 退役 + worker 黑名单 + PM 流程强化** | 3 问：(a) sprint2 命运 / (b) worker 处置 / (c) PM 流程修复 | **NJX 全选推荐：retire / blacklist-and-policy / strict-pm-skill** |

---

## 2. 任务总览（实时更新）

> 22 task / 5-6 路并行 / 7*24h AI / 质量门内嵌 / 3 轮 verify-fix

### Phase 1 · Sprint 1.1（W1 · 7/10-7/16 · 6 路 foundation）

| ID | 任务 | 优先级 | 状态 | 分配 | 验收信号 | 截图 |
|----|------|--------|------|------|----------|------|
| T-1.1.1 | Electron app 骨架 (macOS) | P0 | **done** | sub-agent-α | `npm run dev` 起 macOS app + 设置面板 (cloud backup OFF / theme auto / 3 快捷键) | [screenshots/T-1.1.1/*.png](apps/copilot-desktop/screenshots/T-1.1.1/) + sprint1.1/screenshots/wrapup-01-settings.png |
| T-1.1.2 | Electron app 骨架 (Windows) | P0 | **deferred→Sprint 1.3** | sub-agent-β | 15min cap 物理装不下；WIP commit 在 sp1.1-T-1.1.2 @ 0a63ac27（752 行）由 Sprint 1.3 T-1.3.2 cherry-pick | (n/a — deferred) |
| T-1.1.3 | 腾讯云 server (Fastify + CloudBase) | P0 | **done** | sub-agent-γ | `/health` 200 ok + `/v1/chat` auth chain 工作 + `/cloudbase-relay` 鉴权正确 | apps/copilot-cloud/screenshots/T-1.1.3/*.png |
| T-1.1.4 | 本地 KB (SQLite + MD) | P0 | **done** | sub-agent-δ | 56/56 tests pass + SCHEMA-FROZEN-1.1.md 在位 + WAL mode | packages/kb/screenshots/T-1.1.4/*.png |
| T-1.1.5 | LLM 客户端 (minimax m3) | P0 | **done** | sub-agent-ε | 166/166 tests pass + 97.52% coverage + 流式 chunk parser | packages/llm-client/screenshots/T-1.1.5/*.png |
| T-1.1.6 | CI/CD + 自动化测试 | P0 | **done** | sub-agent-ζ | 5 workflow yml 语法 valid + benchmarks/baseline.json 4 metric + 5 ci 脚本 + docs | .github/workflows/SELF-VERIFY-T-1.1.6.md |

**Sprint 1.1 集成收口 (T-1.1.7)** — owner-wrap-up by PM
- 5 worker branches merged into main (553fc688 / fd2f7c3d / c42cfba8 / 84d3d190 / f62172a6)
- 项目级 smoke: copilot-desktop 37/37 + copilot-cloud 29/29 + packages/kb 56/56 + packages/llm-client 166/166 = **288/288 tests pass**
- Cloud server alive: /health 200 / v1/chat auth chain / cloudbase-relay 鉴权
- Desktop alive: cu MCP 截图见 sprint1.1/screenshots/wrapup-01-settings.png
- Contract freeze: packages/kb/SCHEMA-FROZEN-1.1.md + packages/llm-client/src/types.ts (frozen 2026-07-09)
- Full report: [sprint1.1/RESULT-Sprint-1.1.md](sprint1.1/RESULT-Sprint-1.1.md)

### Phase 1 · Sprint 1.2（W2 · 7/17-7/23 · 6 路 features）

| ID | 任务 | 优先级 | 状态 | 分配 | 验收信号 | 截图 |
|----|------|--------|------|------|----------|------|
| T-1.2.1 | KG 构建器（LLM 驱动） | P0 | pending | sub-agent-α | 20 笔记 → ≥30 节点 ≥50 边；增量 < 2s | 待 |
| T-1.2.2 | 知识图谱 2D（sigma.js） | P0 | pending | sub-agent-β | 100 节点 FPS ≥ 30；交互正常 | 待 |
| T-1.2.3 | 知识详情预览 | P0 | pending | sub-agent-γ | 点击节点 → 详情 + 反向链接 | 待 |
| T-1.2.4 | 语音录入（WebSpeech + ASR） | P0 | pending | sub-agent-δ | macOS 录音 → 转写入库；中文 ≥ 90% | 待 |
| T-1.2.5 | 智能日程 | P0 | pending | sub-agent-ε | CRUD + 提醒 + 列表/日历视图 | 待 |
| T-1.2.6 | 设置面板 + 主题 | P0 | pending | sub-agent-ζ | 所有项可保存可重置 + 主题实时切换 | 待 |

### Phase 1 · Sprint 1.3（W3 · 7/24-7/30 · 4 路 integration）

| ID | 任务 | 优先级 | 状态 | 分配 | 验收信号 | 截图 |
|----|------|--------|------|------|----------|------|
| T-1.3.0a | Workspace refresh PHASE A (env-only) | P0 | **done** ✅ | sub-agent-α | npm install + kg build + dist symlink | sprint1.3/board.md |
| T-1.3.0b | Workspace refresh PHASE B (tsc + vitest) | P0 | **done** ✅ (NJX override A PARTIAL→PASS) | sub-agent-α | tsc 3 configs 0 error + vitest 181 PASS | sprint1.3/board.md + deviation-pattern-T130b.md |
| T-1.3.1 | 知识问答 RAG (vector store + embedder + chunker + indexer + answerer) | P0 | **done** ✅ | sub-agent-β | embedder + sql.js + 23 tests + ollama probe | sprint1.3/board.md |
| T-1.3.2 | Windows 打包 + 兼容性 (electron-builder Win10/11 + icon) | P0 | **done** ✅ (NSIS/portable deferred S1.4 T-1.4.1) | sub-agent-γ | yml + dist:win:x64 + dist:win:arm64 + icon.ico | sprint1.3/board.md |
| T-1.3.3 | Sprint 1.3 cycle-close verifier (钉子 #15 v2) | P0 | **done** ✅ | verifier (钉子 #15 v2) | 8-section audit PASS + 钉子 #14/20/24 verify | /Users/njx/.mavis/plans/plan_fcdd0b56/outputs/T-1.3.3/audit.md |

**Sprint 1.3 v3 完成度**: 5/5 task operational PASS (4 producer + 1 cycle-close verifier). Plan `plan_fcdd0b56` cycle 4/evaluating. 4 worker branch 已 merge to main (commit ee65f48b). deviation-pattern-T130b.md 已落地 (commit 5388702f).

**Operational gaps deferred to Sprint 1.4**:
- T-1.3.0b spec baseline: vitest 181 < 200 (-19 tests, cosmetic) — S1.4 T-1.4.0 add tests
- T-1.3.2 NSIS + portable .exe + code signing → S1.4 T-1.4.1 Win runner + T-1.4.2 branded icon
- T-1.3.2 deliverable.md cross-doc drift (8513B vs claimed 6114B cosmetic) — S1.4 cleanup

### Phase 1 · Sprint 1.4（W4 · 7/31-8/6 · 6 路 收口 + 3 轮 verify-fix）

| ID | 任务 | 优先级 | 状态 | 分配 | 验收信号 | 截图 |
|----|------|--------|------|------|----------|------|
| T-1.4.1 | macOS 真机验收 | P0 | pending | NJX | ≥ 9 张截图 + bug list | 待 |
| T-1.4.2 | Windows 真机验收 | P0 | **OWNER-DEFERRED → Phase 1.1** | NJX | MVP 后完成真机、签名、安装与截图；当前不得记作已交付 | 待（不阻塞当前 MVP） |
| T-1.4.3 | verify-fix 循环 1（macOS 真机缺陷）| P0 | pending | sub-agent | 同一 macOS candidate 的 bug 100% 解决 + 回归 pass | 待 |
| T-1.4.4 | verify-fix 循环 2（macOS 回归与边界）| P0 | pending | sub-agent | 同一 macOS candidate 的回归/边界 100% pass | 待 |
| T-1.4.5 | verify-fix 循环 3（macOS final candidate 综合回归）| P0 | pending | sub-agent | final candidate 质量门、性能、签名/公证/安装证据一致 | 待 |
| T-1.4.6 | 文档 v0.1 | P0 | **done (DOCS_STATIC_PASS)** | sub-agent | 3 类文档齐全；4 个视频脚本；独立静态验收 10/10 PASS | gap `972f0c42...` / repair `5a5e80b4...` / independent `bae7a85d...`；`TESTS_NOT_RUN / MVP_NOT_COMPLETE / RELEASE_NOT_READY` |

### Phase 2-4 任务总览（粗粒度 · Phase 1 后细化）

| Phase | 时间 | Task 数 | 并行度 | 状态 |
|-------|------|---------|--------|------|
| P2 完善 | 8/6-8/20 | 8 task | 4 路 | pending |
| P3 内测 | 8/20-9/3 | 3 task | 串行 | pending |
| P4 公测 | 9/3-10/1 | 6 task | 3 路 | pending |

**状态枚举**：
- `pending` — 已规划未开始
- `in_progress` — sub-agent 在做
- `self_check_done` — sub-agent 自测通过，待 PM 验收
- `done` — PM 验收通过，截图存档
- `rejected: <原因>` — PM 验收失败，需重做
- `blocked: <原因>` — 阻塞待解

---

## 3. 任务详情（模板 · 实际执行时填）

### 任务详情标准模板

```markdown
### T-X.Y 任务名

**Phase**: P1 Sprint 1.X
**分配给**: sub-agent-α/β/γ/δ/ε/ζ
**依赖**: T-X.Z / 无
**预计耗时**: Xh（7*24h AI 算力）

**产出物**（对照 plan.md）：
- [ ] 代码：`path/to/file.ts`
- [ ] 测试：`path/to/file.test.ts`
- [ ] 截图：`screenshots/T-X.Y/`

**质量门**（必跑 · NJX 7/9 11:47 红线）：
- [ ] 单元测试覆盖率 ≥ 70%（关键模块 ≥ 90%）
- [ ] 集成测试 pass
- [ ] E2E 测试（如适用）
- [ ] 截图 ≥ 3 张（前/中/后）
- [ ] 性能 baseline（如适用）
- [ ] verify-fix 循环 ≥ 1 轮

**验收项**（必逐项 ✓/✗）：
- [ ] signal 1：<具体描述>
- [ ] signal 2：<具体描述>
- [ ] signal 3：<具体描述>
- [ ] macOS 双端验证
- [ ] Windows 双端验证

**截图存档**（3+ 张关键步骤）：
- ![before](screenshots/T-X.Y/01_before.png) — 操作前
- ![running](screenshots/T-X.Y/02_running.png) — 操作中
- ![after](screenshots/T-X.Y/03_after.png) — 操作后

**PM 验收日志**：
Time: YYYY-MM-DD HH:MM
Verifier: PM
Operations:
  - bash: `<command>` → <output>
  - cu MCP: <desktop 操作>
  - 截图: <3+ 张路径>
Result: PASS / FAIL (rejected: <原因>)
Owner notified: 是 (HH:MM)

**当前状态**: pending / in_progress / self_check_done / done / rejected / blocked
**最后更新**: YYYY-MM-DD HH:MM
```

> **说明**：每 Sprint 启动时 PM 复制本模板 → 为该 Sprint 每个 task 预填。sub-agent 完成 → 更新状态。

---

## 4. 截图存档规范

### 4.1 路径约定

```
project/copilot/
├── screenshots/
│   ├── T-1.1.1/
│   │   ├── 01_before_empty.png       # 操作前状态
│   │   ├── 02_midterm_running.png    # 操作中（命令/页面加载）
│   │   └── 03_after_done.png         # 操作后最终结果
│   ├── T-1.1.2/
│   │   └── ...
│   ├── T-1.1.3/
│   │   └── ...
│   └── ...
├── delivery.md
├── goal.md
├── plan.md
└── rules.md
```

### 4.2 命名约定

```
<seq>_<step简写>.png

seq: 01, 02, 03...（验收顺序）
step: 一句话描述（snake_case）
```

**示例**：
- `01_before_empty_dir.png` — 空目录初始状态
- `02_npm_install_running.png` — npm install 运行中
- `03_app_launched.png` — app 启动完成
- `04_bug_found.png` — bug 现场
- `05_fix_verified.png` — bug 修复验证

### 4.3 必拍场景（每 task 至少 3 张）

1. **操作前**：环境初始状态
2. **操作中**：关键节点（命令运行/页面加载/数据流）
3. **操作后**：最终结果（成功/失败的明确画面）

**额外场景**（按需）：
- 错误时的报错截图（用于 rejected 记录）
- 多步骤的中段状态（复杂 task）
- owner 确认截图（如有 NJX 真人操作）
- **跨平台对比**（macOS + Windows 同 task 截图各 ≥ 3 张）

---

## 5. 验收失败记录（rejected 时填 · NJX 7/9 11:47 强化）

```markdown
### ❌ T-X.Y rejected

Time: YYYY-MM-DD HH:MM
Verifier: PM
Round: 1 / 2 / 3（NJX 红线：≥ 3 轮 → 升级 owner）

Reason:
  - 验收项 N 失败：<具体原因>
  - 截图证据：screenshots/T-X.Y/reject_01.png
  - 错误日志：<关键 stack / command output>
  - 质量门状态：<单测/集成/E2E/截图/性能/verify-fix 哪项不过>

Sub-agent 反馈（要求 24h 内 · 同 Sprint 内 1 轮 fix）:
  - 重做 T-X.Y
  - 保留 worktree，不要 merge
  - 输出新自测报告

**3 轮不过升级 owner 弹窗**：
Q: T-X.Y 验收失败 3 轮，下一步？
○ 换 sub-agent 重做（推荐 - 突破当前 agent 盲点）
○ 改 plan（缩窄 task 范围）
○ 暂停此 task 等 owner 介入
○ 收摊
```

---

## 6. 质量门执行跟踪（每个 Sprint 必跑 · NJX 7/9 11:47 内嵌）

| 质量门 | 标准 | Sprint 1.1 | Sprint 1.2 | Sprint 1.3 | Sprint 1.4 |
|--------|------|-----------|-----------|-----------|-----------|
| **单元测试覆盖率** | ≥ 70% / 关键 ≥ 90% | 待填 | 待填 | 待填 | 待填 |
| **集成测试** | 100% pass | 待填 | 待填 | 待填 | 待填 |
| **E2E 测试** | ≥ 50 case / 100% pass | -- | -- | 待填 | 待填 |
| **截图存档** | ≥ 3 张 / task | 待填 | 待填 | 待填 | 待填 |
| **性能 baseline** | 启动 < 2s / 内存 < 500MB / KG 100 节点 FPS ≥ 30 | 待填 | 待填 | 待填 | 待填 |
| **verify-fix 循环** | ≥ 1 轮 / Sprint | 待填 | 待填 | 待填 | **3 轮** |

**任一质量门不过 → 该 Sprint 不通过验收**。

---

## 7. Phase 验收（owner 签字）

### Phase 0 立项（7/9-7/10）

```markdown
## Phase 0 验收

Time: 2026-07-09 12:XX
Done items:
  - [x] goal.md v6.1
  - [x] plan.md v6.1
  - [x] rules.md v6.1
  - [x] delivery.md v6.1
Pending / blocked: []

Owner signature: NJX
Owner comment: <一句话评价>
Next phase go-ahead: ✅ 进 Phase 1
```

### Phase 1 MVP（7/10-8/6 · 22 task · 4 Sprint）

```markdown
## Phase 1 验收

Time: 2026-07-XX HH:MM
Done tasks: [T-1.1.1 ... T-1.4.6]（22 task 全 done）
Pending / blocked: []

质量门总览：
  - 单元测试覆盖率: __% (要求 ≥ 70%)
  - 集成测试: __/ __ pass
  - E2E 测试: __/ __ pass
  - 截图存档: __ 张
  - 性能 baseline: <数据>
  - verify-fix 循环: 3 轮完成

当前平台验证（2026-07-15 owner amendment）：
  - macOS 真机验收: __/ __ pass
  - Developer ID 签名: PASS / FAIL
  - Apple 公证: PASS / FAIL
  - macOS 安装包: <path> / SHA256: <sha256>
  - Windows 真机/签名/截图: OWNER-DEFERRED → post-MVP Phase 1.1（不得记作已交付）

Owner signature: NJX
Owner comment: <一句话评价>
Next phase go-ahead: ✅ / ❌ / ⏸

### 持续运行 cron 清理记录

| cron 名称 | 创建时间 | 清理时间 | 清理命令 |
|---|---|---|---|
| copilot-p1-T1.1.1-monitor | 7/10 | 7/16 | `mavis cron rm ...` |
| copilot-p1-T1.1.2-monitor | 7/10 | 7/16 | `mavis cron rm ...` |
| ... | ... | ... | ... |
| copilot-heartbeat | 7/10 | **保留**（项目全程） | -- |
```

### Phase 2-4 验收（粗 · Phase 1 后细化）

| Phase | 时间 | 任务数 | Gate |
|-------|------|--------|------|
| P2 完善 | 8/6-8/20 | 8 task | 3D 图谱 + 远程管理 + 性能 baseline |
| P3 内测 | 8/20-9/3 | 3 task | 5-10 用户反馈 + NPS |
| P4 公测 | 9/3-10/1 | 6 task | GA 评估通过 |

---

## 8. 完成度自检

- [x] Changelog 顶部，含 5 条基线变更 + 7 条弹窗记录
- [x] 任务总览表（22 task + 4 Sprint 状态）
- [x] 任务详情模板（含质量门 6 维度）
- [x] 截图存档规范（路径 + 命名 + 必拍 3 张）
- [x] 验收失败记录模板（含 3 轮升级 owner）
- [x] 质量门执行跟踪表
- [x] Phase 验收段（含 cron 清理）
- [x] **NJX 7/9 11:47 红线全部内嵌**（质量第一 / 7*24h AI / verify-fix / 3 轮升级）

**任一项缺 → 不能进 Step 2 多 Agent 并行开发**。当前全部通过。

---

*本文件由 Mavis（PM）于 2026-07-09 11:58 起草 v6.1（plan.md v6.1 + rules.md v6.1 派生 · 无需 NJX 单独拍板）。NJX 7/9 11:57 rules.md v6.1 批准 + 4 文档全员 ready → 待最终签字弹窗。*
