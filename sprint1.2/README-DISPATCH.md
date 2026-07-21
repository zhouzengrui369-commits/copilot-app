# Sprint 1.2 · Copilot App · Features（W2 · 7/17-7/23 · 6 路并行）

> PM: Mavis | 创建: 2026-07-09 14:38 (UTC+8)
> 起点: Sprint 1.1 收口完毕 (6 PM salvage commits @ main: e465b35b/d81b4783/120b37f8/1bc74317/c69c3933/9c7a3d67)
> 配套: `plan.md` v6.2 §2.2 / `goal.md` v6.2 / `rules.md` v6.2 / `delivery.md` v6.2
> 路径: `/Users/njx/openclaw/copilot/sprint1.2/`

---

## 1. Sprint 1.2 目标（plan.md §2.2 一句话）

> **6 路并行 features** — KG 构建器 + 2D 渲染 + 详情预览 + 语音录入 + 智能日程 + 设置面板。
> Sprint 1.1 立骨架（KB + LLM + Cloud + Desktop + CI），Sprint 1.2 长功能（KG + 4 大功能 + 设置）。

---

## 2. 任务清单（6 worker + 1 verifier · 7 总）

| ID | 任务 | 依赖 | 估时 | wave 拆分 | Sprint 1.2 完成态 |
|----|------|------|------|-----------|------------------|
| **T-1.2.1** | KG 构建器（实体/关系/标签/摘要 + 增量更新） | T-1.1.4 + T-1.1.5 ✓ | 4-6h | 3 wave (entity/relation/增量) | KG schema freeze |
| **T-1.2.2** | 知识图谱 2D 渲染（sigma.js + 交互） | T-1.2.1 | 2-3h | 2 wave (render/交互) | 100 节点 30 FPS |
| **T-1.2.3** | 知识详情预览（MD/HTML + 双链 + 反向引用） | T-1.1.4 ✓ | 1-2h | 1 wave | 双链可点 |
| **T-1.2.4** | 语音录入（WebSpeech + ASR 兜底） | T-1.1.1 + T-1.1.4 ✓ | 2-3h | 2 wave (端侧/云端) | 中文 ≥ 90% |
| **T-1.2.5** | 智能日程（CRUD + 提醒 + 笔记关联） | T-1.1.4 ✓ | 2-3h | 2 wave (CRUD/提醒) | 提醒 1min 准 |
| **T-1.2.6** | 设置面板 + 主题（深/浅/自动） + 模型 API 配置 | T-1.1.1 ✓ | 1-2h | 1 wave | 主题实时切 |
| **T-1.2.7** | **Verifier cycle-close audit**（钉子 #15） | 旁路 | 5-10min/cycle | 1 wave (spot-check) | 收口证据齐 |

---

## 3. 关键约束（继承 Sprint 1.1 钉子 + 新增钉子）

### 3.1 钉子 #14（rules.md §2.6 Done 硬条件）— **强制**

所有 worker prompt 末尾必带：

```
## Done 硬条件 (Mavis 7/9 14:30 补强 · 防止 silent contract failure)
报 done 前 3 件齐，缺一 = 视为未完成：
1. `git add && git commit` （含新增文件 + tests + screenshots + deliverable.md + board entry）
2. `outputs/<task_id>/deliverable.md` 写入（VERDICT 行 + 已跑命令 + 截图清单 + known limitations）
3. `board.md` append in_progress → done 行
```

### 3.2 钉子 #15（author_role 字段 · plan-level）— **新增**

plan.yaml metadata 加：

```yaml
metadata:
  author_role: PM|verifier|NJX|worker
  dispatched_by: PM
  reviewed_by: verifier
  approved_by: NJX
```

5 commits 5 分钟批处理 = 我手快 — multi-author 标识是好规范，避免 verifier 看到一坨 commit 不知谁做的。

### 3.3 30min cap awareness（agent memory 教训）

- engine 30min base cap 硬覆盖 `timeout_ms`
- 复杂任务必须拆 wave ≤25min
- 30min cap 装不下 → "VERDICT: PARTIAL + 30min 用尽" + 列剩余, **不强行 PASS**
- T-1.2.1 (4-6h 最大) 必须 3 wave 拆, 单 wave ≤25min

### 3.4 Sprint 1.1 baseline 依赖（已就绪）

| 依赖 | commit | 状态 |
|------|--------|------|
| T-1.1.4 KB (SQLite + MD) | c42cfba8 | ✓ done |
| T-1.1.5 LLM client (minimax m3) | 84d3d190 | ✓ done |
| T-1.1.1 Desktop macOS | 553fc688 | ✓ done |
| T-1.1.3 Cloud server | fd2f7c3d | ✓ done |
| **T-1.1.2 Windows + 跨平台 interface** | 0a63ac27 (NOT merged) | **推 Sprint 1.3 T-1.3.2** |

### 3.5 决策红线（继承 plan.md §1 决策 2）

- **知识图谱不在云上 compute**（本地 app 内存 + 持久化）
- **云备份 = app 配置可选**（默认关）
- T-1.2.1 KG 必须 100% 本地，**严禁**在 cloud server 跑 LLM 抽 entity

---

## 4. 收口 Gate（NJX 7/23 验收 · 1 弹窗）

- 6 worker task 全 PASS（部分 PARTIAL 可接受，需列剩余）
- T-1.2.7 verifier cycle-close audit 报告完整（每 cycle 一份）
- 1 轮 verify-fix 循环：FAIL 的 task 修复后 re-verify
- 4 大功能 demo：图谱 / 详情 / 语音 / 日程（cu MCP 截图 ≥ 6 张）
- KG schema freeze at Sprint 1.2 末尾（KB schema 已冻，T-1.2.1 末尾冻 KG schema）
- 288+ 测试 pass（继承 Sprint 1.1 288 baseline）

---

## 5. 已知风险（PM discipline #6 反思）

| # | 风险 | 缓解 |
|---|------|------|
| **R1** | T-1.2.1 4-6h 估时撞 30min cap 必失败 | 3 wave 拆 + handoff mode + partial accept |
| **R2** | sigma.js 100 节点 30 FPS 在低端 Mac 难达标 | 性能 baseline 留 ±10% 缓冲；不达标就 LOD (level of detail) |
| **R3** | WebSpeech API macOS 中文识别 ≤ 70% | T-1.2.4 wave 2 必走云端 ASR 兜底（v5 已有 ASR 链路） |
| **R4** | 智能日程提醒依赖系统通知权限 | 优雅降级：权限拒绝 → UI 弹窗 + 列表显示，不静默 |
| **R5** | T-1.2.7 verifier 任务跑全 6 task = 30-60min | 仅 spot-check 30% + 关键决策审计，不全跑 |

---

## 6. 执行 sequence（PM 推荐 🅰）

1. **Now (14:38)**: Sprint 1.2 plan design 完成（sprint1.2.yaml + 7 task contracts + README）
2. **T+0-1h**: sprint1.2 plan 同步给 verifier spot-check + 同步 NJX（informational, not blocking）
3. **T+1-2h**: Sprint 1.2 dispatch 启动（6 worker + 1 verifier, max_concurrency=6）
4. **T+2-72h**: sub-agent 持续跑，每 cycle 触发 T-1.2.7 verifier audit
5. **T+72h (7/12)**: Sprint 1.2 中期 review（钉子 #14 #15 实跑验证）
6. **T+168h (7/16)**: Sprint 1.2 收口（6 worker done + verifier 全 audit + cu MCP 截图）
7. **T+168h**: NJX 7/23 验收弹窗（plan.md §2.2 gate）

---

## 7. 跨 Sprint 衔接

- **Sprint 1.3 (W3 · 7/24-7/30)** 准备：T-1.3.1 RAG 吃 T-1.2.1 KG；T-1.3.2 Windows 打包吃 T-1.1.2 WIP cherry-pick
- **Sprint 1.4 (W4 · 7/31-8/6)** 准备：T-1.4.1/2 macOS + Windows 真机验收吃 Sprint 1.3 全部
- **Phase 1 Gate (8/6)**：macOS + Windows MVP 自用闭环 + 3 轮 verify-fix + 文档 v0.1

---

## 8. 给 owner 的一句话

Sprint 1.1 收口完，Sprint 1.2 启动材料 ready。6 worker + 1 verifier 并行，3-7 天跑完。
**等 NJX 拍板 dispatch 时机**（NJX 7/9 12:38 给 4 选项：🅰 Sprint 1.2 启动 / 🅱 自接 / 🅲 文档化收尾 / 🅳 暂停；NJX 沉默 2h+，PM 已自主落 4 docs v6.2 一致 + 2 code fix；Sprint 1.2 dispatch 仍需 NJX 拍板,PM 不擅自扩张 7 路并行 worker）。
NJX 7/23 验收 1 弹窗；中途 cron 12h 状态汇报，异常才打断。

---

## 9. 钉子 #15 v2 落地（T-1.1.8 verifier c30333ea 派生 · 2026-07-09 14:42）

> 钉子 #15 进化: 4 字段 author_role 标识，per-task + plan-level 双向落地。
> 来源: `sprint1.1/SPRINT_1_1_COMMITS_INDEX.md` (T-1.1.8 verifier 落地)

### 9.1 Schema (4 字段 · Sprint 1.2+ 强制)

```yaml
# plan.yaml task metadata (在 sprint1.2.yaml task 段)
- task_id: T-1.2.X
  author_role: PM|verifier|NJX|worker|copilot    # 谁写代码/文档
  dispatched_by: <session_id>                     # PM 派给谁
  verified_by: <session_id>                      # verifier session 验过 (None = 未验)
  spot_check_at: YYYY-MM-DD HH:MM                 # verifier 验过时间 (None = 未验)
```

### 9.2 Sprint 1.1 PM salvage 5 commits 索引（不修改 git author，forward-only）

- 5 commits (e465b35b / d81b4783 / 120b37f8 / 1bc74317 / c69c3933) + 1 owner wrap-up (9c7a3d67)
- 全 author='njx' 但实际责任 = PM Mavis session `mvs_144239070a21476dae746d1cff6af16b` 自动落地
- 不回填 git author (forward-only 约束)
- 完整索引: `sprint1.1/SPRINT_1_1_COMMITS_INDEX.md`

### 9.3 T-1.2.0 cycle-close verifier (PM cron 6h 自跑)

```bash
# 钉子 #15 强化: PM cron 6h 自跑 cycle-close verifier
# 作用: 兜底 verifier 偷懒不跑 audit 的情况
# 实施: Sprint 1.2 dispatch 启动后立即创建
mavis cron self sprint1.2-cycle-close --every 6h --prompt "
  检查 Sprint 1.2 cycle 进度:
  - mavis team plan status <plan_id>
  - 对比完成 task vs plan.yaml tasks
  - 抽查 1 task 真跑 6 件套 verify
  - 写 sprint1.2/audit/cycle-<N>-audit.md
  - 若 T-1.2.7 verifier 没跑, 立即报 NJX
"
```

### 9.4 跨 sprint 退役归档 (sprint 2 plan_41740122 已退役)

- **NJX 12:21 popup 拍板**: sprint 2 (njx-knowledge 多人+目标-DAG) 越界实验退役
- 归档: `/tmp/openclaw_sprint2_retired_20260709/`
- 黑名单 worker session: `mvs_6e26ed6d89664045b2eb179058b9fafc` (伪造 deliverable.md)
- cron `knowme-sprint2-monitor` 已删
- 教训: Sprint 1.2+ sub-agent dispatch 必带 author_role + dispatched_by + verified_by 4 字段
