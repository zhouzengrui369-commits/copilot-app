# Copilot App · 项目目标 v6.2（2026-07-09 重置基线）

> PM: Mavis
> 创建: 2026-07-09 11:34 (UTC+8) v6.0
> 更新: 2026-07-09 11:40 v6.1（NJX 修正决策 2：知识图谱 = 本地，云 = 可选备份）
> 更新: 2026-07-09 12:22 v6.2（NJX 拍板 sprint 2 越界实验退役 + 加决策 4 njx-knowledge 范围）
> 起点: NJX 7/9 11:31 收敛需求（"经过一系列尝试现在收敛需求"）
> 路径: `/Users/njx/openclaw/copilot/goal.md`
> 配套: `plan.md` / `rules.md` / `delivery.md`
> 历史: v5 4 文档（GOAL/PLAN/RULES/ACCEPTANCE）已归档到 `archive/v5-2026-07-07-13-00/`；sprint 2 (plan_41740122) 2026-07-09 12:21 NJX 拍板退役，归档到 `/tmp/openclaw_sprint2_retired_20260709/`

---

## 2026-07-16 Owner Amendment · MiniMax-first / Tencent post-MVP（最高优先级，v6.2 保持不变）

> **生效与优先级**：NJX 于 2026-07-16 拍板，当前 Phase 1 MVP 使用现有或可配置的 MiniMax 模型能力；腾讯云部署、Remote/live、可选云备份及其生产验收整体移至 MVP 后。本修订高于 2026-07-15 macOS-first 修订和下文历史条款；历史原文与既有腾讯云源码证据保留，不倒填、不删除、不改写。

- **当前 MVP 模型边界**：以 MiniMax 作为当前可用模型推理能力，模型配置必须可扩展；默认运行和验收不得依赖腾讯云 deployment、Remote/live、COS、TLS/WSS、生产 issuer authority 或云备份开关已上线。MiniMax 只承担无状态模型推理，不得成为笔记、KB、知识图谱、日程、RAG 索引或用户配置的真值/持久层。
- **严格 local-first 不变**：笔记、KB、LLM WIKI 产出的摘要/标签/实体/关系、本地持久化知识图谱、RAG sources、日程关联及用户设置均以本机数据为唯一真值；任何模型响应必须写回本地受控数据层后才成为可审计应用状态。
- **腾讯云状态**：既有腾讯云 server/source 工作保留为 post-MVP 输入和历史证据；腾讯云部署、远程管理、live endpoint、可选 COS 备份及相关生产权限统一标记 `OWNER-DEFERRED → post-MVP`，不再阻塞当前 MVP。完成真实部署与验收前，不得宣称腾讯云、Remote、live 或云备份已经交付。
- **ASR 边界与成功证据**：语音录入使用 App 内嵌本地 ASR 模型，不使用腾讯模型或云 ASR 兜底。当前 MVP 的 ASR 成功证据必须由同一已打包、Developer ID 有效签名、Apple 公证成功并 staple/validate 通过的 macOS Electron final candidate，在 macOS 真机关闭网络且无任何云 fallback 时，从该 candidate 包内加载随包内嵌、SHA256 与许可/再分发清单绑定的本地模型，由 Electron runtime 执行真实 decode，并形成“真实语音转写 → 写入本地 note → 重启后 readback → KG/知识关联可见”的 candidate-bound 证据链。standalone helper/sidecar、OS WebSpeech/系统语音服务、开发浏览器、未打包 harness、其他 candidate、source/test/mock 均不得替代；Windows 等价证据仍 `OWNER-DEFERRED → Phase 1.1`。
- **其他门禁不降级**：2026-07-15 macOS-first 门继续有效；Windows 仍为 `OWNER-DEFERRED → Phase 1.1`。macOS signed/notarized final candidate、规定覆盖率、集成测试、至少 50 条真实 Electron E2E、candidate-bound 性能、3 轮 verify-fix、真机截图、文档/SHA/RESULT/EVIDENCE 和 owner gate 均不得降低。

---

## 2026-07-15 Owner Amendment · macOS-first MVP（v6.2 保持不变）

> **生效与优先级**：NJX 于 2026-07-15 明确拍板“先在 macOS 验证成功，MVP 后再上 Windows”。本修订是 v6.2 的 owner amendment，保留全部历史记录；与下文任何“macOS + Windows 同步发布 / 双端同步验收 / 不能先 macOS 后 Windows”条款冲突时，以本修订为当前 Phase 1 MVP 的唯一执行口径。

- **当前 Phase 1 MVP 完成门**：仅以 macOS 真机闭环验收；必须同时具备 Developer ID 签名、公证通过、可安装的 macOS 安装包及 SHA256、真机关键流程截图、规定覆盖率、集成测试 100% pass、至少 50 条真实 Electron E2E 100% pass、绑定同一 final candidate 的性能基线、3 轮 verify-fix、文档和 `delivery.md` RESULT/EVIDENCE 证据收口。
- **Windows 状态**：`OWNER-DEFERRED`，移入 MVP 后的 **Phase 1.1**；Windows 真机、签名安装包、截图及运行时验证不再阻塞当前 MVP，但在完成前**不得宣称 Windows 已交付、双平台已交付或 Phase 1.1 已完成**。
- **跨平台责任不取消**：当前 MVP 继续保留 Windows 源码路径、平台抽象、静态兼容检查和后续 Phase 1.1 验证计划；这些静态证据不能替代 Windows 真机、签名和安装证据。
- 本修订只改变平台交付顺序与当前完成门，**不改变** local-first 产品边界、Phase 1 功能范围、质量阈值或既有历史证据。

---

## 1. 一句话目标

> **copilot app = 个人 AI 助理（第二大脑）：跨 macOS + Windows 桌面 app + 腾讯云知识服务 + LLM WIKI 动态知识图谱（2D/3D 可切换）+ 知识问答 + 多模态录入 + 智能日程。初期 NJX 自用，未来开放给对 AI 助理感兴趣的用户。**

- **知识 + 知识图谱都在本地**（笔记 / KB / 知识图谱 = app 内存 + 本地持久化），**云 = 可选备份**（app 配置开关，默认关）。
- **LLM WIKI 知识管理**——不是传统 CRUD，是 LLM 驱动的知识组织（自动链接 / 摘要 / 分类 / 标签 / 实体识别）。
- **模型直连**（minimax m3 起步），后期可扩展（OpenAI / Claude / 自托管）。
- **数据存储 = 严格 local-first**（决策 2 已拍：知识图谱存本地，云备份 app 配置可选，见 §9）。

---

## 2. 用户与场景

| 字段 | 内容 |
|---|---|
| **谁是 owner** | NJX（OPC 独立开发者，aircraft MRO 数字化主业 + openclaw 全职产品线） |
| **谁是终端用户** | **初期**: NJX 本人（OPC 工作流 + 跨领域知识沉淀）<br>**未来**: 对 AI 助理感兴趣的用户（不区分中国/海外，先 OPC 自验证再扩） |
| **使用场景** | 个人知识管理 + AI 决策辅助 + 智能日程（覆盖 OPC + 航材主业 + 跨领域研究） |
| **使用频次** | 日均 ≥ 3 次主动操作（录入 / 问答 / 知识管理 / 日程） |

---

## 3. 核心需求（必须做 · 9 项 P0）

按 NJX 7/9 11:31 收敛 + PM 整理为 9 项 P0：

| # | 需求 | 说明 |
|---|------|------|
| **R1** | **跨平台桌面 app** | macOS + Windows 同步发布；Electron 优先（已有 njx-copilot 经验），Tauri 备选 |
| **R2** | **腾讯云 server-client 架构** | 腾讯云 server = 知识图谱 + 知识问答 + 远程 KB 管理 API；client = 桌面 app |
| **R3** | **LLM WIKI 知识管理** | 本地知识源（workspace 文件 / 笔记）→ LLM 自动整理（摘要/链接/标签）→ **本地动态知识图谱**（app 内存 + 持久化） |
| **R4** | **知识图谱 2D/3D 可视化** | 2D 优先（Sprint 2），3D 后置（Sprint 3）；节点 = 笔记/概念，边 = 引用/相似/分类 |
| **R5** | **知识问答 + 知识地图 + 详情** | RAG 召回（基于知识图谱）+ sources 显示 + 详情预览（Markdown / HTML） |
| **R6** | **远程管理本地知识库** | CRUD API（录入 / 修改 / 添加 / 删除）+ 双向同步（**决策 2 见 §9**）+ 冲突解决 |
| **R7** | **多模态录入** | 打字 + 语音（ASR 端侧 + 云端兜底）→ 同步本地 + 入库知识图谱 |
| **R8** | **基于知识的日程管理** | 待办（CRUD） + 提醒 + 知识关联（KB → cal 反向引用） |
| **R9** | **模型 API 直连 + 可扩展** | minimax m3 起步（NJX 7/9 明确），后期可加 OpenAI / Claude / 自托管（config.yaml 切换） |

---

## 4. 范围边界（v6 明确不做 · 9 项）

防止 v6 范围蔓延，第一版砍掉所有非 P0：

- ❌ **不做 mobile 端（iOS / Android）** — 决策 1：纯 desktop-first（**见 §9**）
- ❌ **不做 web 端客户端** — 客户端只走 Electron 桌面；Web 仅 server admin console
- ❌ **不做多用户 / 多租户 / SSO** — Phase 1 单用户（NJX 自用）
- ❌ **不做商业化 / 订阅 / 付费** — 未来开放时再考虑
- ❌ **不做实时协作** — 个人助理，非 Notion / 飞书
- ❌ **不做开放 API / 第三方插件** — 封闭产品，先验证 PMF
- ❌ **不做 i18n（多语言）** — v6 中文为主
- ❌ **不做端侧 LLM 推理** — 全部走云端 API（minimax m3 起步）
- ❌ **不做 v5 4 文档相关延续** — v5 已归档，clean slate（NJX 7/9 11:31 明确）

---

## 5. 成功标准（北极星指标 · 3 项）

| # | 指标 | 目标值 | 测量方式 |
|---|------|--------|----------|
| **NS1** | **日活使用** | NJX 一周主动打开 app **≥ 10 次** | app 启动埋点 + 操作日志 |
| **NS2** | **知识沉淀** | 一周入库笔记 **≥ 30 条**，知识图谱节点数 **≥ 50** | 本地 KB 统计 + 图谱 schema count |
| **NS3** | **问答准确率** | 知识问答 **Top-3 召回率 ≥ 80%** | 人工判定 20 个 sample question |

**Phase 1 Gate** = NS1 + NS2 + NS3 全部达标才能算 MVP 完成。

---

## 6. 时间线（4 phase · 12 周）

| Phase | 内容 | 截止 | 状态 |
|-------|------|------|------|
| **P0** | 立项（v6 4 文档 ready + NJX 拍板） | +1 天（7/10） | 🟡 当前 |
| **P1** | **MVP** — Electron 桌面 app + 腾讯云 server 基础 + LLM WIKI 知识图谱（2D）+ 知识问答 + 多模态录入 + 智能日程 | +4 周（8/6） | ⏳ |
| **P2** | 完善 — 知识图谱 3D + 远程 KB 管理（CRUD） + 跨平台深度优化 | +6 周（8/20） | ⏳ |
| **P3** | 内测 — 开放给 5-10 个用户 + 反馈循环 + 体验优化 | +8 周（9/3） | ⏳ |
| **P4** | 公测 + 部署完善 + 文档 + 知识库迁移工具 | +12 周（10/1） | ⏳ |

**GA 不在 3 个月内**——先把 Phase 3 内测证明 PMF，再决定 GA 时间。

---

## 7. 假设与约束

### 7.1 假设（默认成立）
- NJX 每天会检查 `delivery.md` 进度
- 运行环境：macOS 13+ / Windows 10+ 双端同步发布
- 腾讯云账号 NJX 已开通（CloudBase / 轻量应用服务器 / COS）
- minimax m3 API NJX 已开通（按 NJX 7/9 描述）
- 现有 `/Users/njx/openclaw_data/openclaw_workbench` 代码资产可作为 v6 起点（PM 评估后按需复用）

### 7.2 约束（硬性）
- **OPC 模式**：NJX 决策 + PM 自主执行（与现有 sprint 模式一致）
- **NJX 物理边界**：OAuth consent / 2FA / 系统弹窗 / 跨设备 NFC = **NJX 域**（PM 不接管）
- **数据主权（严格）**：**笔记 / KB / 知识图谱都是本地真值**；腾讯云 = **可选备份**（app 配置开关，默认关），不承担主服务（除 LLM 推理 + 远程管理 API）
- **桌面平台对等**：macOS + Windows **同步发布**，不能"先 macOS 后 Windows"

---

## 8. 风险登记

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| **腾讯云 server 部署成本超预算** | 中 | 高 | P1 用轻量应用服务器（24-48 元/月），不上 K8s；P3 后按用量扩 |
| **知识图谱节点数爆炸（>10K 节点性能）** | 中 | 中 | v6 P1 用 1K 节点本地测试；超限用 sigma.js 优化 + 节点懒加载 |
| **LLM API 调用成本失控** | 中 | 高 | embedding 缓存 + 问答 session 缓存；优先 minimax m3（成本低） |
| **跨平台兼容性（macOS vs Windows）** | 中 | 中 | P1 阶段每 task 同步在两个平台验收；Windows build 用 Wine/CI |
| **语音录入跨 OS 兼容性** | 中 | 中 | 用浏览器 WebSpeech API（Electron 内嵌 Chromium），OS 抽象层 + 端侧 ASR 兜底 |
| **LLM 知识整理质量不稳定** | 高 | 高 | 人机回环：LLM 整理后 NJX 抽查 + 反馈，迭代 prompt；加 quality gate |
| **本地 KB → 云端知识图谱同步冲突** | 中 | 中 | 用 last-write-wins + 冲突日志，NJX 手动 resolve（v6 不做 CRDT） |
| **腾讯云带宽 / 公网延迟** | 低 | 中 | CloudBase relay 中转（已验证）+ CDN 加速静态资源 |
| **W27 v5 工作（48 commit）失去 PM 上下文** | 低 | 低 | v5 4 文档归档保留 trace；W27 期间代码资产可按需复用（NJX 拍） |

---

## 9. 待定决策（NJX 拍板后填 · 3 项）

> 这 3 个决策影响 Phase 1 任务设计，NJX 在 goal.md 拍板弹窗里**一次性拍完**。

### 决策 1：平台范围

| 选项 | 含义 | 工期影响 |
|---|---|---|
| **A 纯 desktop**（PM 推荐） | v6 只做 macOS + Windows，mobile 推到 v7 | 8 周完成 MVP，聚焦质量 |
| **B desktop-first + mobile 后续** | v6 desktop，v7（+8 周）加 iOS + Android | v6 工期 +2 周 |
| **C 全平台** | v6 一次性 desktop + iOS + Android | v6 工期 +6-8 周，工期翻倍 |

**PM 推荐理由**：
- v6 已经"从零立项 clean slate"，再加 mobile = scope creep
- Electron 桌面端 = 复用现有 njx-copilot 经验，降低风险
- mobile 推到 v7 单独 phase，可以用 React Native / Expo 复用 web 组件

### 决策 2：数据存储模型（**NJX 7/9 11:40 拍板**）

**最终方案：本地 = 真值（笔记 / KB / 知识图谱全在本地 app 内存 + 持久化）；腾讯云 = 可选备份（app 配置开关，默认关）+ LLM 推理 + 远程管理 API**

| 数据类型 | 存储位置 | 是否同步云 | 备注 |
|---|---|---|---|
| **笔记原文** | 本地（app 持久化） | 可选备份（app 配置） | 真值在本地 |
| **知识库（KB）** | 本地（app 持久化） | 可选备份（app 配置） | 真值在本地 |
| **知识图谱（KG）** | **本地（app 内存 + 持久化）** | **可选备份（app 配置）** | **NJX 7/9 修正：图谱不在云上跑，云只是备份** |
| **LLM 推理上下文** | 腾讯云（无状态） | 不备份 | 临时计算 |
| **远程管理 API 状态** | 腾讯云 | 不备份 | 仅做指令转发 |

**PM 推荐理由 vs NJX 修正差异**：
- 原 PM 推荐 A = "local-first + cloud mirror" → **被 NJX 修正为更激进的 local-only + 可选备份**
- 关键差异：**知识图谱不在云上 compute**，只在本地（app 内存）构建 + 渲染；云端只承担备份（如果用户开启）
- 实现影响：腾讯云 server = **轻量 LLM proxy + 远程管理 API**，不承载图谱计算（节省 server 算力 / 成本 / 隐私风险）
- 取消选项 B（cloud-first）：NJX 7/9 明确"个人数据本地存储"
- 取消选项 C（双向 CRDT）：开发量 +200%，v6 不做

### 决策 3：腾讯云 server 与现有 Mac mini 关系

| 选项 | 含义 | NJX 维护负担 |
|---|---|---|
| **A 替代 Mac mini**（PM 推荐） | 腾讯云 = 唯一 server；Mac mini 不再跑 server | 最低（无本地 server 维护） |
| **B 并存** | 腾讯云 = prod；Mac mini = dev/staging | 中（双 server 维护） |
| **C 混合** | 腾讯云承载知识服务；Mac mini 承载 KB 整理 + cron | 高（双 server 协调） |

**PM 推荐理由**：
- NJX 7/9 11:31 明确"**通过部署腾讯云**"——直接对应 A 方案
- Mac mini 角色弱化（不再跑 server）= 降低 NJX 本地维护负担
- 现有 v5 期间 W27 的 Mac mini 38888 server 可以**逐步下线**（NJX 拍节奏）

---

## 9.5. 决策 4（2026-07-09 12:22 NJX 拍板）：njx-knowledge 多用户/目标-DAG 范围处置

> **背景**：sprint 2 (plan_41740122) 7/9 11:18 启动后 50 分钟内三连失败（越界 4 文档基线 + T-S2.3 verifier FAIL + worker 伪造交付），NJX 12:21 popup 拍板**全部作废**。本决策解决**该范围未来如何重启**。

| 选项 | 含义 | 工期 | PM 推荐 |
|---|---|---|---|
| **A 立即重启（njx-knowledge 重做 4 文档基线）** | 重新走 project-pm skill 流程：8 弹窗重写 goal → plan → rules → delivery，NJX 逐项拍板后再开 | 2-3h 头脑风暴 + 重启开发 | △ — scope 本身没问题，但 PM 反思未消化前重做会重蹈覆辙 |
| **B 推迟到 v6.1 完整上线后** | copilot app MVP（Phase 1 W1-W4）跑完、稳定性 + 用户验收都过之后再启 njx-knowledge 子项目，单独 4 文档立项 | 不影响当前 sprint 节奏 | ✓ — 治本，先把 PM 反思写进 memory 再做新项目 |
| **C 砍掉不做了** | njx-knowledge 范围（多用户 workspace + 目标-DAG 拆解）不再立项，copilot app 用单人单空间简化版 | 0 工期 | △ — NJX 7/9 11:31 收敛时还提了这个范围，未来可能还要 |

**NJX 12:21 popup 选 🅱（推迟到 v6.1 MVP 完成后）**。理由：
- 当前 sprint 2 失败模式暴露了 PM 在「范围基线 + worker 信任 + 失败 3 轮升级」三处硬伤
- 不消化 PM 反思立即重启 = 高概率复现
- v6.1 MVP（W1-W4 / 7/10-8/6）完成后再立项 njx-knowledge 子项目，**走完整 4 文档流程 + PM 反思硬规则**

**未来 sprint 启动协议**：每次新 sprint 从完整 4 文档开始，不允许用"NJX 11:18 启动监控"作为基线授权——那只是 PM 接管监控的信号，不是项目立项。

---

## 10. 完成度自检

- [x] owner 看完 30 秒能复述出"我们做什么"
- [x] 范围边界已写清（9 条不做）
- [x] 有 3 个可量化的北极星指标
- [x] 时间线有截止日（12 周 / 4 phase）
- [x] 至少识别 9 个风险
- [x] 3 个待定决策已全部 NJX 拍板（A 纯 desktop / 严格 local-first + 云可选备份 / 替代 Mac mini）

**3 个待定决策已收口 → 进入 plan.md 起草**。

---

*本文件由 Mavis（PM）于 2026-07-09 11:34 起草 v6.0（基于 NJX 7/9 11:31 收敛需求 + skill 标准 goal-template）。2026-07-09 11:40 v6.1 修订（NJX 修正决策 2：知识图谱存本地，云备份 app 配置可选）。**2026-07-09 12:22 v6.2 修订（NJX 拍板 sprint 2 越界实验退役 + 加决策 4：njx-knowledge 范围推迟到 v6.1 MVP 完成后重启）**。v5 4 文档（GOAL/PLAN/RULES/ACCEPTANCE v5.0 2026-07-07）已归档到 `archive/v5-2026-07-07-13-00/`。NJX 拍板 4 个待定决策后启动 plan.md 起草。*
