# OPC 12 周路线图 · 当前状态 (2026-07-10 13:28 CST)

> **Owner**: NJX (OPC) · **PM**: Mavis (mavis)
> **范围**: W1-W12 整体节奏 + 当前 sprint 状态 + 下一步
> **更新触发**: Sprint 1.3 CLOSE + Sprint 1.4 kick-off

---

## 1. 12 周节奏总览

| Phase | Week | 主题 | Sprint 映射 | 状态 |
|-------|------|------|------------|------|
| **Phase 1** | **W1-W4** | 工作台 MVP | Sprint 1.1 → Sprint 1.4 | 🟡 **W3 done, W4 in progress** |
| **Phase 2** | W5-W8 | 场景产品化 | Sprint 2.0+ | ⏸️ Not started |
| **Phase 3** | W9-W12 | Beta 化 | Sprint 3.0+ | ⏸️ Not started |

**当前**: Phase 1 W3 done (Sprint 1.3 CLOSE 12:14 CST), W4 in progress (Sprint 1.4 kick-off 13:22 CST)

---

## 2. Phase 1 详细状态

### W1 (Sprint 1.1) — 基础 scaffold ✅ DONE
- T-1.1.1 Electron macOS skeleton
- T-1.1.2 Electron Windows compat
- T-1.1.3 Tencent Cloud Server
- T-1.1.4 Local KB SQLite + MD
- T-1.1.5 LLM Client minimax wrapper
- T-1.1.6 CI/CD pipeline
- 6/6 task PASS

### W2 (Sprint 1.2) — KG + voice + settings ✅ DONE
- T-1.2.1 KG builder
- T-1.2.2 KG 2D render
- T-1.2.3 note detail preview
- T-1.2.4 voice input
- T-1.2.5 smart schedule
- T-1.2.6 settings panel theme
- T-1.2.7 verifier cycle-close (audit task)
- 7/7 task PASS + Hybrid OVERRIDE deviation

### W3 (Sprint 1.3) — env + RAG + Win packaging ✅ DONE
- T-1.3.0a PHASE A workspace refresh (npm install 1442 pkgs + kg build)
- T-1.3.0b PHASE B tsc + vitest (钉子 #24 override A)
- T-1.3.1 RAG scaffold (@copilot/rag 16 files, 23 tests, live Ollama)
- T-1.3.2 Win10/11 packaging (NSIS + portable x64+arm64 + multi-res icon)
- 4/4 task PASS + 1 critical gap PM backfill (T-1.3.0a)
- Archive: `archive/sprint1.3-2026-07-10-12-41/`

### W4 (Sprint 1.4) — Win runner + cert + smoke + Gate 复盘 🟡 IN PROGRESS

| Wave | Task | 状态 | ETA |
|------|------|------|-----|
| **W1** | T-1.4.1a Win CI runner setup (GitHub Actions + cache pre-warm) | 🔵 producer running (mvs_b068a920720b4736ab42a2e45d55118f) | ~13:50 CST |
| **W2** | T-1.4.1b NSIS x64 + arm64 实跑 | ⏸ blocked by W1 | ~14:15 CST |
| **W3** | T-1.4.1c portable x64 + arm64 实跑 | ⏸ blocked by W2 | ~14:45 CST |
| **W4** | T-1.4.1d code signing dev cert wire (self-signed) | ⏸ blocked by W3 | ~15:15 CST |
| **W5** | T-1.4.1e NJX 真机 smoke test | ⏸ blocked by W4 | 7/11 NJX 拍 |

**W4 Gate 复盘**: 7/19 W4 close 后, Phase 1 → Phase 2 拍板 (NJX 1h 复盘会)

---

## 3. Phase 2 (W5-W8) — 场景产品化 ⏸️

待 W4 Gate 复盘 + NJX 拍板启动:

- **W5**: Sprint 2.0 第一个航材/数智化场景模板
- **W6**: Sprint 2.1 接入真实数据流
- **W7**: Sprint 2.2 数字孪生雏形
- **W8**: W8 Gate — 真实用户走通 "输入需求→自动跑→交付"

---

## 4. Phase 3 (W9-W12) — Beta 化 ⏸️

待 W8 Gate + NJX 拍板:

- **W9-W10**: Sprint 3.0 权限/部署/文档
- **W11**: Sprint 3.1 3-5 beta 用户自服务
- **W12**: W12 Gate — Beta 跑通 PMF (Product-Market Fit)

---

## 5. Sprint 历史数据

| Sprint | duration | task count | critical gap | backfill commit | override | archive |
|--------|----------|------------|--------------|----------------|----------|---------|
| 1.1 | ~3 days | 6 | 0 | n/a | 0 | n/a |
| 1.2 | ~5 days | 7 | 0 | n/a | 1 (Hybrid OVERRIDE) | n/a |
| 1.3 | 6 hours | 4 (5 with audit) | 1 (T-1.3.0a 缺 deliverable.md) | `250094e5` | 1 (T-1.3.0b vitest 181) | `archive/sprint1.3-2026-07-10-12-41/` |
| 1.4 | TBD | 5 wave | TBD | TBD | TBD | TBD |

---

## 6. 当前主线 (NJX 拍板 Sprint 1.4 = T-1.4.1 Win runner first)

**主线**: 产品化 (NJX Win 10/11 真机能跑通 njx-copilot-v6)
**支线**: Sprint 1.4 + Sprint 1.5 累积 4 follow-up (vitest 200+, branded icon, RAG UI)

---

## 7. 12 周路线图当前风险

| 风险 | 缓解 |
|------|------|
| Phase 1 4 sprint 已用 3 (Sprint 1.1/1.2/1.3), W4 7/19 close 时间紧 | Sprint 1.4 5 wave 拆细 + max_concurrency 2 (verifier 并发) |
| Phase 2 (W5-W8) 4 sprint 需选第一个航材场景 | W4 Gate 复盘拍板 |
| Phase 3 (W9-W12) Beta 用户招募 | 7/19 后启动 |
| Win runner cold cache 95MB Electron download | 钉子 #30 `actions/cache@v4` pre-warm |

---

**12-week roadmap close**: 2026-07-10 13:28 CST (PM Mavis)
**Next update**: Sprint 1.4 W1+2 done (~14:15 CST) 或 W4 Gate 复盘后