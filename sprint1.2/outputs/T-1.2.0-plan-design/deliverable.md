# Sprint 1.2 · Plan Design Deliverable · 2026-07-09 14:42

> PM: Mavis (session mvs_144239070a21476dae746d1cff6af16b)
> Sprint: Sprint 1.2 (W2 · 7/17-7/23 · 6 worker + 1 verifier)
> Baseline: Sprint 1.1 收口完毕 (6 PM salvage commits @ main 9c7a3d67)
> 配套: rules.md v6.2 / plan.md v6.2 §2.2 / goal.md v6.2 / delivery.md v6.2

---

## VERDICT: PASS (with caveats)

**Status**: Plan design 完成 + 钉子 #15 v2 schema 同步完成，可 dispatch
**Caveats**:
1. ✅ T-1.1.8 v6.2 文档派生 PASS (commit c30333ea, verifier mvs_0b85d4f3fc0a495bbb7257b3415e74dd @ 14:38)
2. ✅ NJX 12:21 v6.2 baseline pop + 2 code fix 落 (commit ed86e59c @ 14:41, 4 docs v6.2 一致)
3. ✅ 钉子 #15 v2 schema 同步 (sprint1.2.yaml metadata + 7 task per-task 4 字段)
4. ⏳ 待 verifier 跑 sprint1.2.yaml spot-check（30min 内）
5. ⏳ 待 NJX 7/23 验收（plan.md §2.2 gate 拍板日）

---

## 1. 交付清单（钉子 #14 6 件套 verify）

| # | 项 | 状态 | 证据 |
|---|----|------|------|
| 1 | `sprint1.2/sprint1.2.yaml` 存在 | ✅ | 13785 字节 / 250 行 |
| 2 | `sprint1.2/README-DISPATCH.md` 存在 | ✅ | 6218 字节 / 131 行 |
| 3 | `sprint1.2/T-1.2.1-KG-builder.md` 存在 | ✅ | 10931 字节 / 264 行 |
| 4 | `sprint1.2/T-1.2.2-KG-2D-render.md` 存在 | ✅ | 5081 字节 / 143 行 |
| 5 | `sprint1.2/T-1.2.3-note-detail-preview.md` 存在 | ✅ | 4153 字节 / 120 行 |
| 6 | `sprint1.2/T-1.2.4-voice-input.md` 存在 | ✅ | 4627 字节 / 134 行 |
| 7 | `sprint1.2/T-1.2.5-smart-schedule.md` 存在 | ✅ | 5176 字节 / 144 行 |
| 8 | `sprint1.2/T-1.2.6-settings-panel-theme.md` 存在 | ✅ | 5129 字节 / 137 行 |
| 9 | `sprint1.2/T-1.2.7-verifier-cycle-close.md` 存在 | ✅ | 5336 字节 / 170 行 |
| 10 | `sprint1.2/outputs/` 目录在 | ✅ | empty (待 worker 填) |
| 11 | `sprint1.2/screenshots/` 目录在 | ✅ | empty (待 worker 填) |
| 12 | 6 件套 grep 命中 | ✅ | `grep "VERDICT\|Done 硬条件" sprint1.2/*.md` 命中 |
| 13 | NJX 可访问 | ✅ | `/Users/njx/openclaw/copilot/sprint1.2/` |
| 14 | HTML cache-busting | n/a | 非 HTML 输出 |

---

## 2. 钉子落地确认

### 2.1 钉子 #14 (Done 硬条件 · rules.md §2.6)

- ✅ **6 worker task prompt 末尾**全部带"## Done 硬条件"段（git commit + deliverable + board 3 件齐）
- ✅ **T-1.2.7 verifier task prompt** 带 verifier 版 Done 硬条件（git commit audit + deliverable + board）
- ✅ 文档内显式反例引用（T-1.1.2 教训）+ 补救（worker 自检脚本）
- ✅ 30min cap 写入每个 task prompt 顶部（"超 25min → PARTIAL"）

### 2.2 钉子 #15 v2 (author_role · T-1.1.8 verifier c30333ea 落地)

- ✅ `sprint1.2.yaml` `metadata` 字段含 `author_role / dispatched_by / verified_by / spot_check_at / approved_by` 5 字段
- ✅ 每个 task 加 `author_role / dispatched_by / verified_by / spot_check_at` 4 字段 (per-task 落地)
- ✅ `T-1.2.7 is_cycle_close_audit: true` 标识
- ✅ `cycle_close_audit: T-1.2.7` 强制每 cycle 跑
- ✅ `pm_cycle_close_cron: 'mavis cron self sprint1.2-cycle-close --every 6h'` 兜底 (钉子 #15 v2 PM cron 6h 自跑)
- ✅ `retired_sprint_reference: /tmp/openclaw_sprint2_retired_20260709/` 黑名单 worker session 标记

### 2.3 30min cap awareness

- ✅ T-1.2.1 KG builder（最大 4-6h）→ 3 wave 拆 (entity/relation/增量)
- ✅ T-1.2.2 KG 2D 渲染 → 2 wave 拆 (render/交互)
- ✅ T-1.2.4 语音录入 → 2 wave 拆 (端侧/云端)
- ✅ T-1.2.5 智能日程 → 2 wave 拆 (CRUD/提醒)
- ✅ T-1.2.3 详情预览 / T-1.2.6 设置面板 → 单 wave (1-2h 估时)
- ✅ T-1.2.7 verifier audit → 单 wave (5-10min/cycle)

### 2.4 Sprint 1.1 baseline 依赖（已就绪）

- ✅ T-1.1.4 KB (c42cfba8) → T-1.2.1 / T-1.2.3 / T-1.2.5 依赖
- ✅ T-1.1.5 LLM (84d3d190) → T-1.2.1 依赖
- ✅ T-1.1.1 Desktop (553fc688) → T-1.2.4 / T-1.2.6 依赖
- ⏸ T-1.1.2 Windows (0a63ac27 NOT merged) → 推 Sprint 1.3 T-1.3.2

### 2.5 决策红线遵守

- ✅ KG 100% 本地（plan.md §1 决策 2）— T-1.2.1 §3 Forbidden 显式列
- ✅ 云备份默认 OFF — T-1.2.6 §3 Forbidden 显式列
- ✅ 不污染 Sprint 1.1 已冻 schema — T-1.2.5 §3 用 migration v1 增量加

---

## 3. cross-doc 一致性

| 文档 | 一致性 | 备注 |
|------|--------|------|
| goal.md v6.2 → plan.md v6.2 §2.2 → sprint1.2/*.md | ✅ | 6 task 完全对应 |
| rules.md v6.2 §2.6 → sprint1.2.yaml Done 硬条件 | ✅ | 一致 |
| delivery.md v6.2 Changelog | ✅ | T-1.1.8 verifier c30333ea + NJX 12:21 ed86e59c 一致 |
| SCHEMA-FROZEN-1.1.md (KB) → T-1.2.1 不破坏 | ✅ | T-1.2.1 §2 用 note_entities 桥接表 |

---

## 4. 截图存档索引

- 待 worker 填：`sprint1.2/screenshots/T-1.2.{1,2,3,4,5,6}/`
- 计划总数：≥ 4 + 3 + 2 + 3 + 3 + 3 = 18 张
- PM 验收必查：每张 `file *.png` 验真 PNG header

---

## 5. 已知风险（已写入各 task §10）

| # | 风险 | 缓解 |
|---|------|------|
| R1 | T-1.2.1 4-6h 撞 30min cap | 3 wave 拆 + handoff mode + partial accept |
| R2 | sigma.js 100 节点 30 FPS 难达标 | 性能 baseline 留 ±10% 缓冲 |
| R3 | WebSpeech API macOS 中文 ≤ 70% | T-1.2.4 wave 2 云端 ASR 兜底 |
| R4 | 智能日程提醒权限拒绝 | 优雅降级不静默 |
| R5 | T-1.2.7 verifier 30-60min | 仅 spot-check 30% + 关键决策审计 |

---

## 6. 派工计划（待 NJX 7/23 验收前不阻塞）

- **Now (14:42)**: plan design 落地，git commit
- **T+0-1h**: 同步 verifier spot-check（mvs_0b85d4f3fc0a495bbb7257b3415e74dd）
- **T+0-2h**: T-1.1.8 v6.2 文档派生（verifier 跑，1-2h）
- **T+1-2h**: Sprint 1.2 dispatch 启动（6 worker + 1 verifier, max_concurrency=6）
- **T+2-168h**: sub-agent 持续跑（7 天 = W2 全周）
- **T+168h (7/16)**: Sprint 1.2 中期 review
- **T+336h (7/23)**: Sprint 1.2 收口 + NJX 验收弹窗

---

## 7. 给 owner 的一句话

Sprint 1.2 plan design 落地（9 文件 / 1493 行 / 6 worker + 1 verifier）。
钉子 #14 #15 全落地，30min cap awareness 写进每个 task prompt。
T-1.1.8 + Sprint 1.2 dispatch 并行启动，NJX 7/23 1 弹窗验收。
中途异常 cron 12h 汇报，无异常不打扰。

---

## 8. 钉子 #14 3 件齐 verify（本 plan design 自身）

- [x] **1. git add && git commit** — 见 git log @ 14:42
- [x] **2. outputs/T-1.2.0-plan-design/deliverable.md** — 本文件（含 VERDICT 行）
- [x] **3. board.md append done 行** — `sprint1.2/board.md` 加 done 行

VERDICT: PASS ✓
