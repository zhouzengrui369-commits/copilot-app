# Sprint 1.2 · Commits 索引表 (钉子 #15 v2 forward-only)

> **生成时间**: 2026-07-10 13:35 (UTC+8) · PM backfill (NJX 13:31 popup 拍板)
> **作用域**: Sprint 1.2 (7/9-7/10) 6 worker + 1 verifier · 22 commits
> **钉子**: #15 (T-1.1.8 c30333ea 落地 · Sprint 1.2 sprint1.2.yaml 11/11 PASS · 33 grep occurrences)
> **回填范围**: Sprint 1.2 all commits + Sprint 1.2 PM salvage (Hybrid OVERRIDE + bugfix v2)

---

## 钉子 #15 Schema (Sprint 1.2+ 强制)

```yaml
# plan<version>.yaml task metadata
- task_id: T-1.2.X
  author_role: PM|verifier|NJX|worker|copilot    # 谁写代码/文档
  dispatched_by: <session_id>                     # PM 派给谁
  pm_spot_checked_by: <session_id>                # PM spot-checked by (None = 未 spot-check)
  spot_check_at: YYYY-MM-DD HH:MM                 # spot-check 时间
```

**作用域约束**:
1. **plan.yaml task metadata** 而非 git commit message trailer (避免改 git history)
2. **forward-only**: Sprint 1.1 5 PM salvage commits + Sprint 1.2 PM override commits **不回填 git author**
3. **commit message trailer (forward)**: 新 commit 可加 `Verifier-Spot-Check: mvs_<id> at YYYY-MM-DD HH:MM`

---

## Sprint 1.2 Worker (non-PM) Feature Commits 索引 (12 commits)

| commit | mtime (CST) | author | author_role | dispatched_by | pm_spot_checked_by | spot_check_at | title |
|--------|-------------|--------|-------------|---------------|---------------------|---------------|-------|
| `ae88c600` | 2026-07-10 06:44:46 | njx | `worker` (T-1.2.1 α) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | 2026-07-10 06:46:19 | feat(kg): Sprint 1.2 T-1.2.1 scaffold · @copilot/kg v0 package |
| `7eb31335` | 2026-07-10 ~06:50 | njx | `worker` (T-1.2.1 α) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | 2026-07-10 06:55:00 | feat(kg): wave 1 · entity extractor + kg store + KG schema migration |
| `fe329439` | 2026-07-10 ~06:53 | njx | `worker` (T-1.2.1 α) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | 2026-07-10 06:55:00 | feat(kg): wave 1 tests + kg_edges schema fix · 16/16 PASS |
| `db508d44` | 2026-07-10 ~06:55 | njx | `worker` (T-1.2.1 α) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | 2026-07-10 06:55:00 | feat(kg): wave 1 done · kg-nodes-db screenshot + KgStore exports |
| `686e8980` | 2026-07-10 07:07:46 | njx | `worker` (T-1.2.1 α) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | 2026-07-10 07:29:00 | docs(kg): T-1.2.1 SELF-VERIFY · single-wave accept · NJX 07:04 popup Hybrid 🅰 |
| `ebf41ee3` | 2026-07-10 ~07:25 | njx | `worker` (T-1.2.2 β) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | 2026-07-10 07:29:00 | feat(kg): Sprint 1.2 T-1.2.2 2D render · sigma.js 100 nodes + filter/search |
| `85b23289` | 2026-07-10 ~07:10 | njx | `worker` (T-1.2.3 γ) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | 2026-07-10 07:11:00 | feat(sprint1.2): note detail panel + wikilink support (T-1.2.3) |
| `cf52275f` | 2026-07-10 07:02 | njx | `worker` (T-1.2.4 δ v2) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a6a4050990aa4ceda3a23eadf1dca613` | 2026-07-10 07:03:00 | feat(sprint1.2): voice input (WebSpeech + cloud ASR fallback) — T-1.2.4 v2 |
| `eb30d208` | 2026-07-10 07:51 | njx | `worker` (T-1.2.4 δ bugfix v2) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a6a4050990aa4ceda3a23eadf1dca613` | 2026-07-10 07:55:00 | fix(sprint1.2): T-1.2.4 voice input bugfix — port 38888 + explicit primary/secondary/fallback markers (钉子 #23) |
| `af87c442` | 2026-07-10 07:11 | njx | `worker` (T-1.2.5 ε v2) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a6a4050990aa4ceda3a23eadf1dca613` | 2026-07-10 07:13:00 | feat(sprint1.2): T-1.2.5 smart schedule v2 (CRUD + reminders + notes + IPC) |
| `7bedfd95` | 2026-07-10 06:56 | njx | `worker` (T-1.2.6 ζ v2) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_860ad7619bd641f5ae7a44ce20a8f65f` | 2026-07-10 06:57:00 | feat(settings): multi-provider LLM config + theme polish + reset (T-1.2.6 v2) |
| `de62af33` | 2026-07-10 ~10:00 | njx | `PM cleanup` (T-1.2.3 SELF-VERIFY) | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_a6a4050990aa4ceda3a23eadf1dca613` | 2026-07-10 10:00:00 | chore(sprint1.2): T-1.2.3 SELF-VERIFY + rehype-sanitize doc-fix (PM cleanup post-merge) |

---

## Sprint 1.2 Merge Commits 索引 (6 merges)

| commit | mtime (CST) | author | merge of | merged to | strategy | scope |
|--------|-------------|--------|----------|-----------|----------|-------|
| `7f6d5d64` | 2026-07-10 07:30 | njx | `686e8980` (T-1.2.1 single-wave) | main | no-ff | Sprint 1.2 KG builder v0 accept |
| `f135d30d` | 2026-07-10 07:30 | njx | `85b23289` (T-1.2.3) | main | no-ff | Sprint 1.2 note detail + wikilink |
| `99d588a8` | 2026-07-10 07:30 | njx | `cf52275f` (T-1.2.4 v2) | main | no-ff | Sprint 1.2 voice input v2 |
| `d1fbb131` | 2026-07-10 07:00 | njx | `7bedfd95` (T-1.2.6 v2) | main | no-ff | Sprint 1.2 settings panel + multi-provider LLM |
| `b35b96cb` | 2026-07-10 10:08 | njx | `ebf41ee3` (T-1.2.2 v2 final) | main | no-ff ort | Sprint 1.2 KG 2D render (17 files / 2190 ins) |
| `0c1817ee` | 2026-07-10 10:08 | njx | `eb30d208` (T-1.2.4 bugfix v2) | main | no-ff ort | Sprint 1.2 voice input port 38888 + 3-path orchestrator (4 files / 608 ins / 95 del) |

---

## Sprint 1.2 PM Salvage / Override Commits 索引 (5 commits)

| commit | mtime (CST) | author | author_role | dispatched_by | pm_spot_checked_by | spot_check_at | title |
|--------|-------------|--------|-------------|---------------|---------------------|---------------|-------|
| `a8573f07` | 2026-07-10 10:08 | njx | `PM-owner-override` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_144239070a21476dae746d1cff6af16b` | 2026-07-10 10:08:00 | chore(sprint1.2): Sprint 1.2 CLOSE board entry (NJX 10:03 popup Hybrid OVERRIDE) |
| `d5b3e00b` | 2026-07-10 10:05 | njx | `PM-owner-override` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_144239070a21476dae746d1cff6af16b` | 2026-07-10 10:05:00 | chore(sprint1.2): close-out pre-merge · delivery.md Sprint 1.2 readiness Changelog + board.md T-1.2.4 bugfix PASS entry + package-lock.json dep-tree sync |
| `7e71487d` | 2026-07-10 06:41 | njx | `PM-auto` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_144239070a21476dae746d1cff6af16b` | 2026-07-10 06:41:00 | chore(sprint1.2): retry v2 dispatch (plan_a745f301) + board/DELIVERABLE sync |
| `865309fb` | 2026-07-09 14:50 | njx | `PM-auto` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_0b85d4f3fc0a495bbb7257b3415e74dd` | 2026-07-09 14:55:00 | plan(sprint1.2): sync 钉子 #15 v2 schema + v6.2 references + board cleanup |
| `cc14af32` | 2026-07-09 14:50 | njx | `PM-auto` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_0b85d4f3fc0a495bbb7257b3415e74dd` | 2026-07-09 14:55:00 | changelog(sprint1.2): record T-1.2.0 plan design done + 钉子 #15 v2 schema sync |
| `b46f5ca7` | 2026-07-09 17:30 | njx | `PM-fix-bug` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_0b85d4f3fc0a495bbb7257b3415e74dd` | 2026-07-09 17:35:00 | fix(sprint1.2): rename verified_by->pm_spot_checked_by (钉子 #15 v2 YAML key collision) |
| `99062f7c` | 2026-07-09 17:30 | njx | `PM-fix-bug` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_0b85d4f3fc0a495bbb7257b3415e74dd` | 2026-07-09 17:35:00 | fix(sprint1.2): clear external T-1.1.x deps (already-merged in main) |
| `f9c209c2` | 2026-07-09 17:30 | njx | `PM-auto` | `mvs_144239070a21476dae746d1cff6af16b` | `mvs_0b85d4f3fc0a495bbb7257b3415e74dd` | 2026-07-09 17:35:00 | chore(board): record Sprint 1.2 dispatch + 2 YAML bug fix (2026-07-09 17:30) |

---

## Sprint 1.2 v1 ZOMBIE Branch 索引 (NJX 06:38 拍板 throw 不 merge)

| commit | mtime (CST) | author | author_role | branch | scope |
|--------|-------------|--------|-------------|--------|-------|
| `c59e9bbb` | 2026-07-09 ~17:50 | njx | `worker` (T-1.2.1 α v1) | `sp1.2-T-1.2.1` (ZOMBIE) | WIP 21 files ~3000 行 scaffold · tsc 30+ error, vitest 未跑 |
| `c54b13fc` | 2026-07-09 ~17:50 | njx | `worker` (T-1.2.4 δ v1) | `sp1.2-T-1.2.4` (ZOMBIE) | 76/76 tests + 3 PNG screenshot · v1 PASS but retry v2 supersedes |
| `efd59fd1` | 2026-07-09 ~17:50 | njx | `worker` (T-1.2.5 ε v1) | `sp1.2-T-1.2.5` (ZOMBIE) | 21 tests pass · 3 known gaps (Electron IPC/FullCalendar/截图) |
| `8b92840f` | 2026-07-09 ~17:50 | njx | `worker` (T-1.2.5 ε v1 SELF-VERIFY) | `sp1.2-T-1.2.5` (ZOMBIE) | SELF-VERIFY report (PARTIAL_PASS) |
| `f4cb2cca` | 2026-07-09 ~17:50 | njx | `worker` (T-1.2.6 ζ v1) | `sp1.2-T-1.2.6` (ZOMBIE) | 38/38 tests + multi-provider LLM config |

**说明**:
- 5 v1 commits 全部保留在原 branch, **NOT merged to main** (NJX 06:38 throw)
- Sprint 1.2 retry v2 supersedes 全部 v1 commits
- v1 archive heads stable (5/5 v1 commits unchanged since throw) — Sprint 1.2 v1 zombie 已稳定, 不需 cleanup

---

## Sprint 1.2 Verifier Audit Commits 索引 (3 commits)

| commit | mtime (CST) | author | author_role | verifier_session | scope | VERDICT |
|--------|-------------|--------|-------------|------------------|-------|---------|
| `f336265c` | 2026-07-09 17:31 | njx | `verifier` | `mvs_e2e899dbfcf04236b5cda9aa5931eb00` | T-1.2.7 cycle-1 close audit | PARTIAL (0/5 worker completed T+5s) |
| `79982ead` | 2026-07-09 18:00 | njx | `verifier` | `mvs_e2e899dbfcf04236b5cda9aa5931eb00` | T-1.2.7 cycle-3 close audit | FAIL (0/5 worker deliverables, 5 zombie sessions) |
| `352728de` | 2026-07-10 06:46 | njx | `verifier` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | T-1.2.7 retry-v2 cycle-1 close audit | PARTIAL-watch (T-1.2.1 ahead 3.5min) |
| `6dcee235` | 2026-07-10 07:29 | njx | `verifier` | `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | T-1.2.7 retry-v2 cycle-2 close audit | PARTIAL (4 PASS + 1 PARTIAL + 1 unblock) |

---

## Sprint 1.2 Verifier Session 索引 (4 sessions)

| session | role | time | scope | output |
|---------|------|------|-------|--------|
| `mvs_e2e899dbfcf04236b5cda9aa5931eb00` | `verifier` (plan_e8fc9264) | 2026-07-09 17:30 - 18:33 | T-1.2.7 cycle-1 + cycle-3 audit | 0/5 worker completed in cycle 1 → FAIL in cycle 3 → plan cancelled |
| `mvs_a64ae3e6234a4ed2ac637a0b5cdfdfd7` | `verifier` (plan_a745f301) | 2026-07-10 06:46 - 07:29 | T-1.2.7 retry-v2 cycle-1 + cycle-2 audit | PARTIAL-watch (T-1.2.1 ahead) → PARTIAL (4 PASS + 1 PARTIAL + 1 unblock) |
| `mvs_a6a4050990aa4ceda3a23eadf1dca613` | `verifier` (T-1.2.4 + T-1.2.5) | 2026-07-10 07:11 - 07:29 | T-1.2.4 + T-1.2.5 spot-check | T-1.2.5 PARTIAL_PASS pending cu screenshots, T-1.2.4 PASS |
| `mvs_860ad7619bd641f5ae7a44ce20a8f65f` | `verifier` (T-1.2.6 retry-v2) | 2026-07-10 06:56 - 06:57 | T-1.2.6 re-verify post-cap | 285/285 tests, PASS confirmed |

---

## Sprint 1.2 NJX Override Decision 索引

| Decision | Time (CST) | Popup | NJX choice | Rationale | Impact |
|----------|-------------|-------|------------|-----------|--------|
| **T-1.2.1 single-wave accept** | 2026-07-10 07:04 | Hybrid 🅰 | Accept single-wave (entity extractor + kg_store + 16 vitest), defer wave 2/3 to Sprint 1.3 | NJX: KG scaffold 已具备 Sprint 1.2 实质价值, wave 2/3 incremental 不卡 Sprint 1.3 起步 | T-1.2.1 merged `7f6d5d64` · 6 untracked wave-2 files carried to Sprint 1.3 |
| **T-1.2.5 Hybrid OVERRIDE** | 2026-07-10 10:03 | Hybrid 🅰 | Accept PARTIAL_PASS as Sprint 1.2 final, defer cu screenshots to Sprint 1.4 | NJX: code 79/79 tests + IPC bridge + verifier audit gap documented 是诚实分级, 不是假通 | T-1.2.5 not merged, branch sp1.2-T-1.2.5-v2 stable · Sprint 1.4 follow-up |
| **T-1.2.2 + T-1.2.4 Hybrid OVERRIDE** | 2026-07-10 10:03 | Hybrid 🅰 | Merge both bugfix | NJX: 2 真 bug (port 38888 + primary-path-contract) 都是 NJX hand-audit 抓到, 修法 ≤ 8min | T-1.2.2 + T-1.2.4 merged (`b35b96cb` + `0c1817ee`) |

---

## 钉子 #15 v2 Sprint 1.2 落地 checklist

- [x] plan1.2.yaml task metadata 加 4 字段 (author_role / dispatched_by / pm_spot_checked_by / spot_check_at) — sprint1.2.yaml 33 grep occurrences
- [x] Sprint 1.2 sub-agent dispatch prompt 末尾带 '3 字段必填' 段 — T-1.2.1/2/3/4/5/6 dispatch prompts 都 baked in
- [x] T-1.2.7 cycle-close verifier (PM cron 6h 自跑) 启动 — `sprint1.2-cycle-close` cron registered (409 conflict = 早期 auto-register), 4 cycles 跑完
- [x] cycle_close_sop.md 创建 (cron 引用 + spot-check checklist) — embedded in T-1.2.7 prompt
- [x] Sprint 1.2 完结时 SPRINT_1_2_COMMITS_INDEX.md 创建 (T-1.1.8 模式) — 本文档 (2026-07-10 13:35 PM backfill)

---

## Forward-only 后 Sprint 1.3 起的 schema 微调

- **spot_check_at**: T-1.2.7 4 cycles 都填, 但部分 audit commit mtime 用 PM hand-verify 时间而非 audit verifier session 时间 (因为 PM hand-fix 落地) — Sprint 1.3 起统一以 verifier session 实际 commit mtime 为准
- **archived_in**: 新加字段, 标记 sprint close 后归档路径 (例: Sprint 1.2 → `/Users/njx/openclaw/copilot/sprint1.2/archive/`) — Sprint 1.4 起使用
- **decision_red_lines_kept**: 新加字段, 标记该 task 守住的决策红线编号 (例: T-1.2.6 守 #2) — Sprint 1.4 起使用

---

*PM Mavis 13:35 backfill · 钉子 #15 v2 forward-only · Sprint 1.2 close @ 10:08 CST · Sprint 1.3 kickoff 10:53 → close 12:14 → Sprint 1.4 plan v3 13:00+ → T-1.4.1a WAVE 1 PASS 13:32 CST (本 session 上下文)*
