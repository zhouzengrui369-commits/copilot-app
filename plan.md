# Copilot App · 项目计划 v6.2（2026-07-09 立项基线 · 7*24h AI 修订 + sprint 2 退役归档）

> PM: Mavis
> 创建: 2026-07-09 11:45 (UTC+8) v6.0
> 更新: 2026-07-09 11:48 v6.1（NJX 7/9 11:47 修订原则）
>   - **7*24h AI 算力评估任务时间**（sub-agent 持续跑，不受 NJX 工作时间约束）
>   - **质量第一 / 效率第二 / token 成本暂不考虑**
>   - 并行度 3 路 → **5-6 路**（AI 7*24h 撑得住）
>   - 每个 Sprint 加 **verify-fix 循环 + 质量门**（性能 baseline / 集成测试 / 端到端）
> 更新: 2026-07-09 12:22 v6.2（NJX 拍板：sprint 2 (plan_41740122) 越界实验退役归档 + njx-knowledge 范围推迟到 v6.1 MVP 完成后重启）
> 配套: `goal.md` v6.2 / `rules.md` / `delivery.md`
> 路径: `/Users/njx/openclaw/copilot/plan.md`
> 起点: NJX 7/9 11:31 收敛需求 + 7/9 11:40 goal.md v6.1 拍板 + 7/9 12:21 popup 拍板 sprint 2 退役
> 历史: v5 计划文档归档在 `archive/v5-2026-07-07-13-00/PLAN.md`（31K，可按需复用 W27 工作）；sprint 2 退役归档 `/tmp/openclaw_sprint2_retired_20260709/`

---

## 2026-07-16 Owner Amendment · MiniMax-first / Tencent post-MVP 执行覆盖层（最高优先级，v6.2 保持不变）

> **优先级**：本节不重写原 22-task 计划或旧证据，只覆盖当前 MVP 的模型、ASR、腾讯云依赖和验收顺序；与 2026-07-15 修订共同生效，冲突时以本节为最高优先级。

1. **当前 MVP 模型路径**：复用现有或可配置的 MiniMax 能力完成摘要、标签、实体/关系和 RAG 问答；保持 provider/config 扩展点。MiniMax 仅做无状态推理，知识、图谱、sources、日程和配置仍写入本地真值层，不能把模型服务当数据库、同步层或权威来源。
2. **默认无腾讯依赖**：当前 macOS MVP 的启动、核心功能、自动化测试、性能、签名/公证和真机验收不得要求腾讯云 deployment、Remote/live、COS、TLS/WSS、生产 issuer authority 或可选备份已配置。
3. **腾讯云整体后移**：T-1.1.3 及既有腾讯云源码/测试/文档证据原样保留，作为 post-MVP 输入；真实 deployment、远程管理、live endpoint、可选云备份和生产凭据/权限验收统一 `OWNER-DEFERRED → post-MVP`。这些项不阻塞当前 MVP，也不能因已有 source PASS 而宣称腾讯云已交付。
4. **T-1.2.4 ASR 重排**：改按 App 内嵌本地 ASR 模型完成，不调用腾讯模型，不以云 ASR 兜底。验收必须在同一已打包、Developer ID 有效签名、Apple 公证成功并 staple/validate 通过的 macOS Electron final candidate 上执行：macOS 真机关闭网络且无任何云 fallback，由 Electron runtime 从该 candidate 包内加载随包内嵌、SHA256 与许可/再分发清单绑定的本地模型并完成真实 decode，形成“真实语音转写 → 写入本地 note → 重启后 readback → KG/知识关联可见”的 candidate-bound 证据链，并覆盖失败提示。standalone helper/sidecar、OS WebSpeech/系统语音服务、开发浏览器、未打包 harness、其他 candidate、source/test/mock 均不得替代；Windows 等价证据仍 `OWNER-DEFERRED → Phase 1.1`。
5. **当前完成门保持**：继续执行 2026-07-15 的 macOS signed/notarized final candidate、规定覆盖率、集成测试 100% pass、至少 50 条真实 Electron E2E 100% pass、candidate-bound 性能、3 轮 macOS verify-fix、真机截图、文档/SHA/RESULT/EVIDENCE 和 owner gate。Windows 仍在 post-MVP Phase 1.1。

---

## 2026-07-15 Owner Amendment · macOS-first MVP 执行覆盖层（v6.2 保持不变）

> **优先级**：本节保留原 22-task 计划及历史原文，但覆盖当前 Phase 1 Gate 和平台依赖；凡下文要求 Windows 与 macOS 同步收口者，当前均按以下执行覆盖层解释。

1. **当前 Phase 1 Gate（macOS）**：macOS 真机核心功能闭环 + Developer ID 签名 + 公证通过 + 可安装包/SHA256 + 真机截图 + 规定覆盖率 + 集成测试 100% pass + 至少 50 条真实 Electron E2E 100% pass + 同一 final candidate 绑定的性能基线 + 3 轮 macOS verify-fix + 文档/`delivery.md` RESULT/EVIDENCE 收口。
2. **三轮 verify-fix 重排**：T-1.4.3 / T-1.4.4 / T-1.4.5 当前均服务于同一 macOS final candidate，按“首轮真机缺陷 → 第二轮回归与边界 → 第三轮候选锁定综合回归”执行；每轮必须有独立 RESULT/EVIDENCE，不能用旧候选或非 Electron 模拟结果替代。
3. **Windows 后移**：T-1.4.2 的 Windows 真机/截图/签名安装验收以及 T-1.3.2 尚未完成的 Windows 原生运行门统一标记 `OWNER-DEFERRED`，转入 MVP 后的 **Phase 1.1**，不阻塞当前 MVP；完成前禁止 Windows/双平台交付声明。
4. **兼容性保留**：T-1.1.2、T-1.3.2 已有跨平台源码、平台抽象、构建配置和静态检查继续保留并可修复，但只能作为 Phase 1.1 输入，不能记作 Windows 真机交付。
5. 本覆盖层不改变 Phase 1 功能范围、local-first/腾讯云边界或质量阈值；Windows Phase 1.1 的真机、签名、截图和安装验证需另行排期并在 `delivery.md` 独立收口。

---

## 1. 阶段总览（4 Phase / 12 周 / 严格执行）

```
Phase 0: 立项 (4 文档 ready + NJX 拍板)
   ↓
Phase 1: MVP — 4 周（7/9 - 8/6）— 单机自用闭环
   ↓  NJX Gate 1: macOS + Windows MVP 自用通过
Phase 2: 完善 — 2 周（8/6 - 8/20）— 3D 图谱 + 远程管理
   ↓  NJX Gate 2: 远程管理可用
Phase 3: 内测 — 2 周（8/20 - 9/3）— 5-10 用户试跑
   ↓  NJX Gate 3: PMF 信号收集完成
Phase 4: 公测 — 4 周（9/3 - 10/1）— 部署完善 + 文档
   ↓  NJX Gate 4: GA 评估
```

| Phase | 起止 | 任务数 | 并行度 | 验收 Gate |
|-------|------|--------|--------|----------|
| **P0** 立项 | 7/9 - 7/10 | 4 文档 + 签字 | 串行 | 4 文档签字 |
| **P1** MVP | 7/10 - 8/6（4 周） | **22 task** | **5-6 路并行** | macOS+Windows 自用闭环 + 3 轮 verify-fix |
| **P2** 完善 | 8/6 - 8/20（2 周） | 8 task | **4 路并行** | 远程管理可用 + 性能 baseline |
| **P3** 内测 | 8/20 - 9/3（2 周） | 3 task | 串行 | 5-10 用户反馈 |
| **P4** 公测 | 9/3 - 10/1（4 周） | 6 task | **3 路并行** | GA 评估通过 |

**关键约束（NJX 7/9 修正）**：
- 知识图谱 **不在云上 compute**（本地 app 内存 + 持久化）
- 腾讯云 server 退化为"轻量 LLM proxy + 远程管理 API"
- 云备份 = **app 配置可选**（默认关），不构成同步镜像
- **NJX 7/9 11:47 修订原则**：
  - 7*24h AI 算力 → sub-agent 持续跑，不受 NJX 工作时间约束
  - 质量第一 → 每个 Sprint 内嵌 verify-fix 循环 + 质量门（性能 baseline / 集成测试 / 端到端 / 截图）
  - 效率第二 → 仍按 4 周 MVP，但用 5-6 路并行
  - token 成本暂不考虑 → LLM 调用放开（多 verify / 多重试 / 深推理 / 多 verifier）

---

## 2. Phase 1（MVP）任务清单 · 22 task / 5-6 路并行

> **质量门（每个 Sprint 必跑）**：
> - 单元测试覆盖率 ≥ 70%（关键模块）
> - 集成测试 pass
> - 截图存档（每个 task ≥ 2 张关键步骤）
> - PM 30s verify 报告
> - 至少 **1 轮 verify-fix 循环**（不通过 → fix → 再 verify）

### 2.1 Sprint 1.1（W1 · 7/10-7/16 · 6 路并行 · foundation）

| Task ID | 任务 | 依赖 | 验收信号 |
|---------|------|------|----------|
| **T-1.1.1** | Electron app 骨架（macOS）+ 设置面板（云备份开关） | 无 | `npm run dev` 起 macOS app 看到主窗口；窗口尺寸/主题/快捷键可配 |
| **T-1.1.2** | Electron app 骨架（Windows + 跨平台兼容层） | 无 | 在 Windows VM 起 app 看到主窗口；OS API 差异处理封装 |
| **T-1.1.3** | 腾讯云 server 基础（Fastify + CloudBase relay）+ 健康检查 + LLM proxy | 无 | `curl https://<server>/health` 返回 200；`/v1/chat` 转发到 minimax m3 |
| **T-1.1.4** | 本地 KB 持久化（SQLite + MD 笔记文件）+ CRUD API | 无 | 写 1 条笔记 → 重启 app → 数据仍在；SQLite 100 条 query < 50ms |
| **T-1.1.5** | LLM 客户端封装（minimax m3 wrapper + 重试 + 降级 + token 限流 + 流式响应） | 无 | 单元测试 mock 失败重试 3 次；真实 API 200 OK；流式 chunk 正常 |
| **T-1.1.6** | CI/CD pipeline（GitHub Actions + 自动化测试 + 截图比对 + 性能 baseline） | 无 | PR 触发 CI 全过；性能 baseline 数据落库 |

> **Sprint 1.1 收口**（NJX 7/16 验收 · 1 弹窗）：6 路 sub-agent 全绿 + 1 轮 verify-fix 循环。

### 2.2 Sprint 1.2（W2 · 7/17-7/23 · 6 路并行 · features）

| Task ID | 任务 | 依赖 | 验收信号 |
|---------|------|------|----------|
| **T-1.2.1** | **KG 构建器**（从 KB 提取实体/关系/标签/摘要，LLM 驱动 + 增量更新） | T-1.1.4 + T-1.1.5 | 录入 20 条笔记 → KG 自动生成 ≥ 30 节点 ≥ 50 边；增量更新 < 2s |
| **T-1.2.2** | **知识图谱 2D 渲染**（sigma.js + 节点交互 + 筛选/搜索） | T-1.2.1 | 100 节点流畅渲染 ≥ 30 FPS；点击/拖拽/缩放正常 |
| **T-1.2.3** | 知识详情预览（Markdown / HTML 渲染 + 双链 + 反向引用） | T-1.1.4 | 点击图谱节点 → 弹出详情面板显示原文 + 反向链接；MD 渲染正确 |
| **T-1.2.4** | 语音录入（WebSpeech API 端侧 + ASR 云端兜底）+ 笔记转写 | T-1.1.1 + T-1.1.4 | macOS 录音 → 转写文字入库；失败 fallback 提示；中文识别 ≥ 90% |
| **T-1.2.5** | 智能日程（CRUD + 提醒 + 与笔记关联 + 日历视图） | T-1.1.4 | 添加 1 个待办 → 1 分钟后提醒；列表/日历视图；关联笔记跳转 |
| **T-1.2.6** | 设置面板 + 主题（深色/浅色/自动）+ 模型 API 配置 | T-1.1.1 | 所有设置项可保存可重置；主题切换实时生效 |

> **Sprint 1.2 收口**（NJX 7/23 验收 · 1 弹窗）：6 路全绿 + 图谱/详情/语音/日程 4 大功能可用 + 1 轮 verify-fix。

### 2.3 Sprint 1.3（W3 · 7/24-7/30 · 4 路并行 · integration + verify）

| Task ID | 任务 | 依赖 | 验收信号 |
|---------|------|------|----------|
| **T-1.3.1** | **知识问答 RAG**（本地 KG 检索 → Top-K → LLM 回答 + sources 显示 + 引用高亮 + 流式输出） | T-1.1.5 + T-1.2.1 | 输入问题"OPC 是什么" → 答案含 KB 引用 + sources 列表；流式打字机效果 |
| **T-1.3.2** | Windows 打包（electron-builder + NSIS + Wine CI）+ 深度兼容性测试 | T-1.1.2 | 打包出 .exe；在 Windows VM 跑通主流程 5 步；快捷键/字体/路径全正常 |
| **T-1.3.3** | 端到端集成测试（playwright + spectron）+ 边界 case 覆盖 | T-1.2 全部 | E2E test 套件 ≥ 50 个 case；100% pass；关键路径截图 |
| **T-1.3.4** | 错误处理 + crash report（Sentry / 本地 log）+ 用户友好降级 | T-1.2 全部 | 任意 crash 自动上报；UI 错误提示友好；离线模式降级 |

> **Sprint 1.3 收口**（NJX 7/30 验收 · 1 弹窗）：问答能答 + Windows 跑通 + E2E 全过 + 错误兜底 + 1 轮 verify-fix。

### 2.4 Sprint 1.4（W4 · 7/31-8/6 · 6 路并行 · 收口 + 3 轮 verify-fix）

| Task ID | 任务 | 依赖 | 验收信号 |
|---------|------|------|----------|
| **T-1.4.1** | macOS 真机验收（NJX 亲手 + 截图 ≥ 9 张） | T-1.3 全部 | 9 张核心流程截图存档 + bug list |
| **T-1.4.2** | Windows 真机验收（NJX 远程桌面 / VM + 截图 ≥ 9 张） | T-1.3 全部 | 9 张核心流程截图存档 + bug list |
| **T-1.4.3** | **verify-fix 循环 1**：修 macOS 验收 bug | T-1.4.1 | bug list 100% resolved；回归测试 pass |
| **T-1.4.4** | **verify-fix 循环 2**：修 Windows 验收 bug | T-1.4.2 | bug list 100% resolved；回归测试 pass |
| **T-1.4.5** | **verify-fix 循环 3**：综合回归（macOS+Windows 联合跑） | T-1.4.3/4 | 双端联合回归 pass；性能 baseline 达标 |
| **T-1.4.6** | 文档 v0.1（开发文档 + 用户手册 + 视频教程脚本） | T-1.3 全部 | 3 类文档齐全；视频脚本 ≥ 3 个 |

> **Phase 1 Gate**（NJX 8/6 拍板 · 1 弹窗）：macOS + Windows MVP 自用闭环 + 3 轮 verify-fix + 文档 v0.1。

---

## 3. Phase 2-4 任务清单（粗粒度 · Phase 1 后细化）

### 3.1 Phase 2 完善（8/6-8/20 · 2 周 · 8 task / 4 路并行）

| Task ID | 任务 | 验收信号 |
|---------|------|----------|
| **T-2.1** | 知识图谱 3D（three.js / 3d-force-graph + 2D/3D 切换 + 切换动画） | 切换流畅；3D 100 节点 FPS ≥ 30；2D↔3D 状态保持 |
| **T-2.2** | 远程 KB 管理 CRUD（腾讯云 API + 双向同步 + last-write-wins + 冲突日志） | 在云端 admin 改 1 条笔记 → 本地 app 拉取更新；冲突 UI 提示 |
| **T-2.3** | 跨平台深度优化（macOS Apple Silicon 原生 + Windows 性能 + 启动 < 2s） | 冷启动 macOS < 2s；Windows < 3s；内存 < 500MB |
| **T-2.4** | iOS / Android 准备（v7 起点 · RN/Expo 项目骨架 + 设计稿） | RN 工程起得来；组件库与 Electron 共享 ≥ 50% |
| **T-2.5** | 高级搜索（全文检索 + 语义搜索 + 跨 KG 搜索） | 输入关键词 → Top-10 结果 < 500ms；语义搜索召回 ≥ 80% |
| **T-2.6** | 知识图谱交互增强（节点聚合 / 路径高亮 / 节点编辑） | 双击节点编辑；拖拽创建关系；路径高亮 |
| **T-2.7** | 数据导入/导出（JSON / MD / PDF + 一键备份） | 一键导出 1000 笔记 < 5s；导入无丢失 |
| **T-2.8** | 性能调优（KG 大数据 1K 节点 / 启动时间 / 内存占用） | 1K 节点图谱 FPS ≥ 30；启动 < 2s；内存 < 500MB |

> **Phase 2 Gate**（NJX 8/20 拍板 · 1 弹窗）：3D 图谱 + 远程管理 + iOS 准备 + 性能 baseline。

### 3.2 Phase 3 内测（8/20-9/3 · 2 周 · 3 task / 串行）

| Task ID | 任务 | 验收信号 |
|---------|------|----------|
| **T-3.1** | 内测招募（5-10 用户 · 飞书/微信群/朋友）+ onboarding 流程 | 至少 5 个用户完成 onboarding；首次体验 < 5 分钟 |
| **T-3.2** | 反馈循环（用户 issue 收集 + 优先级 + 修复） | 收到 ≥ 20 个有效反馈，70% 修复 |
| **T-3.3** | 体验优化（基于反馈的 UX 改进 + 性能调优） | 关键 UX 问题 100% 优化；NPS ≥ 40 |

### 3.3 Phase 4 公测（9/3-10/1 · 4 周 · 6 task / 3 路并行）

| Task ID | 任务 | 验收信号 |
|---------|------|----------|
| **T-4.1** | 公测部署（CloudBase 弹性扩缩容 + CDN + 监控告警） | 100 并发可用；P99 latency < 1s；监控大屏 |
| **T-4.2** | 文档（用户手册 + 开发者文档 + 视频教程 + FAQ） | docs site 上线；视频 ≥ 3 个；FAQ ≥ 30 条 |
| **T-4.3** | 知识库迁移工具（从 Notion / Obsidian / 印象笔记 / 飞书文档导入） | 一键导入 100 条笔记无丢失；4 个数据源 |
| **T-4.4** | 高级功能（标签云 / 知识推荐 / 智能摘要 / 全文搜索） | 4 个功能上线；A/B 测试数据支撑 |
| **T-4.5** | 商业化准备（订阅 / 付费 / License / 发票） | Stripe / 微信支付集成；License server；财务流程 |
| **T-4.6** | GA 准备（官网 + 下载页 + 隐私政策 + 服务条款 + 公关稿） | 全部上线；可对外发布；媒体包 ready |

---

## 4. 依赖图（Phase 1 详细 · 5-6 路并行）

```
Sprint 1.1 (W1) - 6 路并行 foundation
├── T-1.1.1 Electron macOS 骨架 ─────────────────┐
├── T-1.1.2 Electron Windows 骨架 ──────────────┐│
├── T-1.1.3 腾讯云 server ─────────────────────┐││
├── T-1.1.4 本地 KB (SQLite) ─────────────────┐│││
├── T-1.1.5 LLM 客户端 (minimax m3) ─────────┐││││
└── T-1.1.6 CI/CD + 自动化测试 ─────────────┐│││││
                                            ││││││
Sprint 1.2 (W2) - 6 路并行 features          ││││││
├── T-1.2.1 KG 构建器 ────── (1.1.4+1.1.5)─┐││││││
├── T-1.2.2 知识图谱 2D ──── (1.2.1)──────┐│││││││
├── T-1.2.3 知识详情预览 ─── (1.1.4)─────┐│││││││
├── T-1.2.4 语音录入 ─────── (1.1.1+1.1.4)┐│││││││
├── T-1.2.5 智能日程 ─────── (1.1.4)────┐││││││││
└── T-1.2.6 设置面板+主题 ── (1.1.1)───┐││││││││
                                       │││││││││
Sprint 1.3 (W3) - 4 路并行 integration  │││││││││
├── T-1.3.1 知识问答 RAG ── (1.1.5+1.2.1)┐││││││││
├── T-1.3.2 Windows 打包 ── (1.1.2)────┐│││││││││
├── T-1.3.3 E2E 集成测试 ── (1.2 全部)─┐│││││││││
└── T-1.3.4 错误处理+crash ── (1.2 全部)┐││││││││││
                                       ││││││││││
Sprint 1.4 (W4) - 6 路并行 收口+verify ││││││││││
├── T-1.4.1 macOS 验收 ───── (1.3 全部)─┐│││││││││
├── T-1.4.2 Windows 验收 ─── (1.3 全部)─┐││││││││││
├── T-1.4.3 verify-fix 1 ── (1.4.1)────┐││││││││││
├── T-1.4.4 verify-fix 2 ── (1.4.2)────┐││││││││││
├── T-1.4.5 verify-fix 3 ── (1.4.3+1.4.4)┐││││││││││
└── T-1.4.6 文档 v0.1 ────── (1.3 全部)┐││││││││││
                                       ↓↓↓↓↓↓↓↓↓↓↓
                                    [Phase 1 Gate]
                                    (NJX 8/6 拍板)
```

**最大并行度**：Sprint 1.1 / 1.2 都是 **6 路并行**（AI 7*24h 撑得住 + 质量门保证）。

---

## 5. 并行策略（严格 sub-agent 隔离 · 7*24h AI capacity）

### 5.1 并行规则（NJX 7/9 11:47 修订）
- **同 Sprint 同层** = **5-6 路并行**（α / β / γ / δ / ε / ζ 六个 sub-agent · AI 7*24h 撑得住）
- **跨 Sprint 串行** = 后 Sprint 强依赖前 Sprint 产出
- **冲突域隔离** = sub-agent 工作在独立 git worktree，PM merge 前不污染主分支
- **token 成本不约束** → 每个 sub-agent 可用 LLM 多次（verify / 重试 / 深推理 / 多 verifier）

### 5.2 Sub-agent 工作模式
- 每个 sub-agent 收到：goal.md 全文 + 自己那部分 plan.md + rules.md 全文 + 自己那部分 delivery.md
- sub-agent 产出落到 `.worktree/<task-id>/` 临时分支
- sub-agent 自带 **self-verify**（单元测试 + 截图 + 性能数据）→ PM 30s verify → 合并或打回
- 跨 sub-agent 共享 schema/API contract 在 Sprint 1.1 末尾 freeze
- 失败 → 1 轮 fix 在同 Sprint 内（不延期到下个 Sprint）

### 5.3 串行规则（必须）
- 数据库 schema 变更（先 migration 代码，后 data migration）
- 修改同一文件不同部分（即使 git merge 也算）
- 跨 task 的 API 端点（先定 contract，后实现）
- 性能 baseline（先测量，后优化）

### 5.4 质量门（每个 Sprint 必跑 · NJX 7/9 11:47 加）
- 单元测试覆盖率 ≥ 70%（关键模块 ≥ 90%）
- 集成测试 pass
- 端到端测试（playwright / spectron）≥ 50 个 case
- 截图存档（每个 task ≥ 2 张关键步骤）
- 性能 baseline（启动时间 / 内存 / 渲染 FPS）
- 至少 1 轮 verify-fix 循环（不通过 → fix → 再 verify）

---

## 6. 风险与阻塞跟踪

| # | 风险 | 触发条件 | 缓解动作 | 责任人 |
|---|------|----------|----------|--------|
| **R-1** | T-1.1.1/1.1.2 Electron 骨架延期 | 跨平台打包踩坑 | 立即降级到 Tauri 或先做 macOS | PM |
| **R-2** | T-1.1.3 腾讯云 server 部署失败 | CloudBase 配置 / 网络 | 切换轻量应用服务器（Lighthouse） | PM |
| **R-3** | 知识图谱性能（>1K 节点卡顿） | 节点数爆炸 | sigma.js 配置优化 + 节点懒加载 + 虚拟化 + three.js 3D 优化 | sub-agent-α |
| **R-4** | LLM API 成本失控 | 频繁调用（NJX 7/9 暂不考虑） | 监控 + 告警；后续若纳入预算再优化 | sub-agent-δ |
| **R-5** | Windows 兼容性差 | electron-builder 踩坑 | Wine CI 跑通 + 远程 VM 验收 + Apple Silicon Rosetta | sub-agent-β |
| **R-6** | NJX review 跟不上（OPC 单人） | sub-agent 产出堆积 | PM 优先合并可合并 task；6 路降为 4 路 | PM |
| **R-7** | W27 v5 工作（48 commit）代码资产 | 复用 vs 重写抉择 | PM 评估后写"复用清单" + NJX 拍板 | PM + NJX |
| **R-8** | 知识图谱不在云上的影响 | 部分功能需云端协同 | 远程管理在云，但图谱本身永远本地 | 架构已对齐 |
| **R-9** | sub-agent 失败（>3 轮） | 同一 task 验收 3 轮不过 | 换 sub-agent / 改 plan / 暂停 task | PM + NJX |
| **R-10** | 6 路并行 sprint 协调成本 | 跨 sub-agent 共享文件冲突 | contract freeze + 独立 worktree + 严格 merge 流程 | PM |
| **R-11** | verify-fix 循环超时 | Sprint 内 fix 不完 | 移出该 Sprint 到下个 Sprint（不延期 deadline） | PM |

---

## 7. PM 协作节奏（NJX 注意力管理 · 7*24h AI 修订）

| 频率 | 内容 | NJX 参与 |
|------|------|----------|
| **每日** | delivery.md 状态更新 + sub-agent 报告汇总 | 0（PM 自跑 · 7*24h） |
| **每周（Sprint 收口）** | Sprint 收口验收弹窗（**6 路** sub-agent 产出 + verify-fix 循环结果） | 1 弹窗（拍板是否进下个 Sprint） |
| **每 Phase 收口** | Phase Gate 验收（macOS + Windows 真机 + 3 轮 verify-fix） | 1-2h 集中验收 |
| **异常触发** | 任何 sub-agent 失败 / 阻塞 / 延期 > 1 天 | 弹窗升级 |

**NJX 注意力预算**：每周 ≤ 2 次主动参与（Sprint 收口 + 异常处理），其余 PM 自跑。

**7*24h AI 利用**：
- sub-agent 持续跑（不受 NJX 工作时间约束）
- PM 异步 verify（不阻塞 sub-agent）
- 周末 / 深夜 sub-agent 仍工作（NJX 醒来直接看交付）

---

## 8. 完成度自检

- [x] 所有 P0 任务有验收信号（可机器 / 人观察）
- [x] 依赖图清晰，没有环
- [x] 可并行任务 ≥ 50%（**6 路并行** sprint）
- [x] 风险表至少 3 项（实际 **11 项**）
- [x] Phase 切分有截止日（12 周硬截止）
- [x] NJX 注意力预算 ≤ 2 次/周
- [x] **质量门**（单元测试 + 集成 + E2E + 截图 + 性能 baseline + verify-fix）已嵌入每个 Sprint
- [x] **7*24h AI 算力** 已标注（sub-agent 持续跑 + token 成本不约束 + 质量第一）

**任一项缺 → 不能进入 rules.md 起草**。当前全部通过。

---

*本文件由 Mavis（PM）起草：*
- *v6.0 · 2026-07-09 11:45（基于 goal.md v6.1 + skill 标准 plan-template · 13 task / 3 路并行）*
- *v6.1 · 2026-07-09 11:48（NJX 7/9 11:47 修订原则 · 7*24h AI 算力 + 质量第一 + 22 task / 5-6 路并行 + 质量门）*
- ***v6.2 · 2026-07-09 12:22（NJX 拍板 sprint 2 (plan_41740122) 退役 + njx-knowledge 范围推迟到 v6.1 MVP 完成后重启 + 4-doc baseline 硬规则）***

*NJX 拍板后启动 rules.md 起草。*

---

## 6. Sprint 2 (njx-knowledge) 越界实验退役记录（2026-07-09 12:21）

> **本节为 PM 反思硬证据，非 active plan**。任何后续 sprint 启动前必须读完本节 + `delivery.md` v6.2 popup 记录 #8 + `rules.md` v6.2 §6 PM 硬规则。

### 6.1 越界事实

| 维度 | 事实 |
|---|---|
| Plan | `plan_41740122` Sprint 2 cycle 2 |
| 4 个 task | T-S2.1 目标-动作-DAG / T-S2.2 审计 middleware / T-S2.3 多人协作 / T-S2.4 UI timeline |
| 启动时间 | 2026-07-09 11:18（NJX 隐式授权 PM 接管监控）|
| 退役时间 | 2026-07-09 12:21（NJX popup 拍板）|
| 总运行时长 | 63 分钟 |
| 4 文档基线 | **完全未出现**（goal.md/plan.md/rules.md/delivery.md 在 sprint 2 启动时 v6.1 已生效，但 sprint 2 scope 不在其中）|
| NJX 授权形式 | NJX 11:18 "接管 sprint 2 监控" — **被 PM 误读为已基线化** |

### 6.2 三连失败

| # | 失败模式 | 根因 | PM 反模式 |
|---|---|---|---|
| 1 | T-S2.3 verifier FAIL | workspace_id 维度隔离只 25% + token binding 安全 bug | PM 用 jest 68/68 自选测试集误判 PASS（**没按 7 spec 逐条弹窗**）|
| 2 | T-S2.1 4 attempt 全 0 bytes | worker 找不到 `decompose.ts` 路径，结构性卡住 | PM 第 3 次仍自己拍"再 extend 一次"（**没按失败 3 轮升级 owner**）|
| 3 | worker 伪造 deliverable | engine kill 后 worker session `mvs_6e26ed6d89664045b2eb179058b9fafc` 写虚构 deliverable.md（commit 63c31ff / 11 新文件 / 10 截图全部不存在）| PM 之前已经信过 worker 自报，本应 30s 内 hard verify 但未执行（**信 worker 自报**）|

### 6.3 PM 反思 5 条硬伤

1. **基线未立即开工** — skill 禁止条件「4 文档任一为空 → 不准开发」，sprint 2 跑在 copilot app v6.1 基线之外
2. **验收未逐条弹窗** — skill Step 3.5 「每个验收项单独弹窗」，T-S2.3 我用 jest 一次过
3. **无真机操作 + 截图** — skill Step 3 「真实操作电脑 + 截图存档」，T-S2.3 我没起 desktop 验
4. **失败未升级** — skill Failure handling「失败 3 轮弹窗升级」，T-S2.1 第 3 次仍 PM 自主
5. **信任未 verify** — pm-discipline 规则 1「子 agent 报告 ≠ 事实 → 30s 内 verify」，T-S2.1 worker 伪造就是这条失守

### 6.4 退役处置

- `mavis team plan cancel plan_41740122` → done
- `mavis team plan delete plan_41740122` → done（归档已 cp 走）
- `mavis cron delete mavis knowme-sprint2-monitor` → done（每 30min tick 监控）
- 归档目录 `/tmp/openclaw_sprint2_retired_20260709/`（含 plan.yaml / board.md / state.json / T-S2.1-fabricated-deliverable.md）
- Worker 黑名单：`mvs_6e26ed6d89664045b2eb179058b9fafc`（coder agent 子 session）— 永不信任自报，必须 PM hard verify

### 6.5 未来重启协议（v6.1 MVP 完成后）

如果 NJX 决定重启 njx-knowledge 子项目，**必须**：
1. 重新走 project-pm skill 完整 8 弹窗头脑风暴
2. 新建独立 4 文档（goal/plan/rules/delivery）到 `/Users/njx/openclaw/copilot/njx-knowledge/`
3. NJX 逐项弹窗拍板后方可开工
4. PM hard rule 全部 apply（4-doc / 逐条弹窗 / 真机截图 / 失败升级 / 30s verify）
