# Sprint 1.3 Retrospective · PM 反思循环 (2026-07-10 13:27 CST)

> **Sprint**: 1.3 (T-1.3.0a/b + T-1.3.1 + T-1.3.2)
> **PM**: Mavis (mavis) · **Author**: Mavis · **Status**: post-CLOSE + post-acceptance
> **Archive**: `archive/sprint1.3-2026-07-10-12-41/`

---

## 1. Sprint 1.3 数据快照

| 指标 | 值 | 备注 |
|------|-----|------|
| Plan task count | 5 (T-1.3.0a/b/1/2/3) | T-1.3.3 = cycle-close audit |
| Worker task count | 4 (T-1.3.0a/b/1/2) | 排除 audit |
| Total commit | 16+ | 含 main merge + cycle-close + backfill + archive |
| Critical gap 抓到 | 1 (T-1.3.0a 缺 deliverable.md) | PM hand-audit fix @ 12:30 |
| Backfill commit | 1 (`250094e5`) | 9435B, 224 lines |
| Archive commit | 1 (`10cba95c`) | 12 files, 50465B outputs |
| NJX override A | 1 (T-1.3.0b vitest 181/200 PARTIAL→PASS) | 钉子 #24 |
| Deferred to S1.4 | 3 (vitest 200+/Win runner/branded icon/RAG UI) | 4 follow-up |
| Sprint duration | ~6h (10:53 plan v1 → 12:14 CLOSE → 12:41 acceptance) | 极快节奏 |
| Sprint cost | 4 worker sessions + 1 audit session | 严格 sub-plan 调度 |

---

## 2. PM 反思循环 (钉子 #23/#24/#27 PM-discipline)

### 2.1 钉子 #23 模式重演 + PM hand-audit 抓到的关键 bug

**场景**:
- T-1.3.0a PHASE A worker 在 11:02 commit `47c9fb3a` + 写 SELF-VERIFY (7463B) + append board entry
- **worker 漏写 deliverable.md** — 但 board.md claim "Deliverable: outputs/T-1.3.0a/deliverable.md"
- Sprint 1.3 CLOSE @ 12:14 时, 4 worker task 都 done, plan completed
- PM hand-audit @ 12:29 (15min after CLOSE) 才用 `ls outputs/T-1.3.0a/` 发现 **只有 SELF-VERIFY, 没有 deliverable.md**
- 钉子 #14 3件齐缺 1 件 → literal PASS 失败

**为什么 PM hand-audit 抓到了**:
- 钉子 #23 5-min pre-declare literal verify: `ls outputs/T-1.3.0a/` + `grep VERDICT deliverable.md`
- worker self-declare PASS 时只 check `commit hash` + `SELF-VERIFY 内容`, 不 check `deliverable.md 存在`
- 钉子 #27 数字自验: `wc -l outputs/T-1.3.0a/*` 显示只有 1 个 .md 文件 (7463B)

**修法 (PM 自主, 12:30 CST 闭环)**:
- 写 `outputs/T-1.3.0a/deliverable.md` (9435B, 224 lines) — 基于 SELF-VERIFY 全文派生
- Header 留 Backfill marker (2026-07-10 12:30 CST) — 文档化 PM backfill 而非 worker 漏
- 钉子 #14 self-check table 显式列出 4 件齐 (commit code + backfill deliverable + SELF-VERIFY + board entry)
- Commit `250094e5` docs(sprint1.3): backfill ... — NJX 可见的闭环 trace

**教训固化**:
- **PM hand-audit 必跑 literal verify before CLOSE**: `ls outputs/<task>/` + `grep VERDICT deliverable.md` + `wc -l outputs/<task>/*.md`
- **worker self-declare PASS 不可信** (钉子 #23): PM 必须自跑 verify, 不转述 worker claim
- **deliverable.md 是必交文件, 不是 SELF-VERIFY 替代品** — 写进 Sprint 1.4 dispatch template 红线

### 2.2 钉子 #24 deviation pattern — T-1.3.0b vitest 181/200 PARTIAL→PASS

**场景**:
- T-1.3.0b PHASE B worker 修 better-sqlite3 native binding → tsc 0 errors → vitest 21 files / 181 tests
- spec baseline 是 ≥200 vitest, 实际 181 (-19)
- Engine verifier 报 FAIL (PARTIAL)
- Worker self-declare operational PASS (181 ≠ 200 但 all discovered pass)
- NJX 拍 override A: "operational PASS, defer to Sprint 1.4 cosmetic fix"
- PM 文档化到 `sprint1.3/deviation-pattern-T130b.md` (commit `5388702f`)

**为什么走 override 而不是重做**:
- vitest 181 vs 200 是 cosmetic (-19 tests 没写, 不是 19 fail)
- 修完 native binding + 跑全 21 file 181 test 已是显著进步 (从 PHASE A 部分坏到全绿)
- 重写 19 test 是新 scope, 不在 T-1.3.0b 范围
- Sprint 1.4 T-1.4.4 候选 task 自然承接补齐

**教训固化**:
- 钉子 #24 deviation pattern 必须文档化: `sprint<n>/deviation-pattern-T<X>.md` 模板 (commit / worker session / engine verdict / NJX override rationale / Sprint X+1 follow-up)
- Operator pattern: Producer self-PASS + Engine FAIL + NJX override A → operational PASS (不是 cycle retry)
- Sprint 1.4 §X.X 引用 deviation pattern as case study reference

### 2.3 钉子 #27 数字自验 — packages/rag/ 16 files 真值

**场景**:
- T-1.3.1 board.md claim "16 files, packages/rag/*"
- PM hand-audit `find packages/rag -type f | wc -l` = 16 ✓
- `find packages/rag -type f -name "*.ts" | wc -l` = 12 (12 ts + 4 cfg/docs = 16 total)
- 数字 16 严格说 = total file count, board.md 表述 OK

**教训固化**:
- 数字必自跑 `wc -l` / `find -type f | wc -l` / `grep -c` 真值, 不轻信 worker 自报 (钉子 #27)
- "16 files" = total file count 不是 ts file count, 但如果歧义要写 "16 files (12 ts + 4 cfg)"

### 2.4 钉子 #30 dispatch explicit flags (本任务相关教训)

**场景**:
- 7/10 13:01 PM memory 自动注入钉子 #30 — Sprint 3 T-S3.4c-probe-re-verify dispatch 漏 `--config jest.config.metrics.cjs` flag
- Sprint 1.4 T-1.4.1 dispatch prompt 已 baked in `--config electron-builder.yml` explicit (防重演)

**教训固化**:
- 所有 electron-builder / jest / build 命令必带 explicit config flag
- Sprint 1.4 dispatch template §3 "Commands to run" 显式列出, 不省略

---

## 3. Sprint 1.3 NJX Acceptance 复盘

| Task | 验收 | 时间 | 关键证据 |
|------|------|------|---------|
| T-1.3.0a | NJX pass | 12:31 CST | backfill 后钉子 #14 闭环 (commit `250094e5`) |
| T-1.3.0b | NJX pass | 12:32 CST | 钉子 #24 override A operational PASS |
| T-1.3.1 | NJX pass | 12:40 CST | additive + 23/23 + live Ollama 1024-dim |
| T-1.3.2 | NJX pass | 12:41 CST | config + icon + Mac 保持 + Win exec deferred |

**NJX acceptance 全 4/4 PASS** · 严守 project-pm "每 task 单独弹窗" SOP

---

## 4. Sprint 1.3 → Sprint 1.4 衔接

| Sprint 1.3 产出 | Sprint 1.4 走向 |
|----------------|----------------|
| `electron-builder.yml` win/nsis/portable section | T-1.4.1a runner config 复用 + T-1.4.1d cert wire |
| `build/icon.ico` (multi-res placeholder) | T-1.4.2 branded icon (Sprint 1.5+) |
| `@copilot/rag` package (16 files) | T-1.4.3 Electron renderer UI (Sprint 1.5+) |
| better-sqlite3 native binding 修复经验 | T-1.4.4 vitest 200+ 补齐 (基础已稳定) |

**主线**: NJX 拍 Sprint 1.4 = T-1.4.1 Win runner first (产品化主线)

---

## 5. PM process 改进建议 (写给未来 sprint)

### 5.1 dispatch template 加红线
- ❌ 漏 deliverable.md → Sprint 1.4 §3 必列 "deliverable.md 是必交, 不是 SELF-VERIFY 替代"
- ❌ 漏 explicit flags → Sprint 1.4 §3 必列完整命令 (cd + flags + config)
- ❌ 漏 lint check → Sprint 1.4 §5 acceptance 必跑 YAML/JSON lint 验证

### 5.2 PM hand-audit 必跑 literal verify (5-min pre-declare)
- `ls -la outputs/<task>/` 4 件齐
- `grep -c VERDICT outputs/<task>/deliverable.md` ≥ 1
- `wc -l outputs/<task>/*.md` size 自验
- `git status --short outputs/<task>/` tracked
- `git log --oneline -1 -- outputs/<task>/` commit 存在
- `git diff main...HEAD --stat` 不含 forbidden files

### 5.3 Sprint close commit 必带 cron hygiene (钉子 #29)
- ✅ Disable sprint-specific cycle-close cron
- ✅ Silent tick log 写到 scratchpad
- ✅ Cross-sprint cron migration SOP: close sprint → grep cronName → disable all → register new sprint cron

### 5.4 deviation pattern 必文档化 (钉子 #24)
- `sprint<n>/deviation-pattern-T<X>.md` 模板: commit / worker / engine verdict / NJX override / Sprint X+1 follow-up
- 5/5 cross-discipline 钉子 (#14/#23/#24/#27/#29) reference list

---

## 6. Sprint 1.3 整体评价

| 维度 | 评分 | 备注 |
|------|------|------|
| 速度 | ⭐⭐⭐⭐⭐ | 6h sprint start → CLOSE → acceptance, 极快 |
| 质量 | ⭐⭐⭐ | 1 critical gap (T-1.3.0a), 但 PM hand-audit 抓到 + backfill 闭环 |
| 范围 | ⭐⭐⭐⭐ | 4 task 全部 PASS, 3 deferred 自然接 S1.4 |
| PM discipline | ⭐⭐⭐⭐ | 钉子 #14/#23/#24/#27/#29 全部触发, 教训固化 |
| NJX 体验 | ⭐⭐⭐⭐⭐ | NJX 拍 5 个决策点 (acceptance × 4 + kick-off × 1), 没有 ambiguity |

**整体**: Sprint 1.3 是 OPC 12 周路线图 Phase 1 W1-W4 的稳定 milestone, 主线产品化 (Win packaging) 已 config layer ready, 实跑留 Sprint 1.4 接力。

---

## 7. Sprint 1.4 启动建议 (已 NJX 拍板)

- ✅ Wave 1: T-1.4.1a Win CI runner setup (GitHub Actions windows-latest)
- ⏳ Wave 2: T-1.4.1b NSIS x64 + arm64 实跑 (depends Wave 1)
- ⏳ Wave 3: T-1.4.1c portable x64 + arm64 实跑
- ⏳ Wave 4: T-1.4.1d code signing dev cert wire (self-signed)
- ⏳ Wave 5: T-1.4.1e NJX Win 10/11 真机 smoke test

**ETA**: Wave 1+2 ~14:15 CST, Wave 1+2+3 ~15:00 CST, Wave 5 7/11 NJX 拍

---

**RETROSPECTIVE close**: 2026-07-10 13:27 CST (PM Mavis)
**Next**: 写 OPC 12 周路线图当前状态更新 + 弹窗 NJX 汇报