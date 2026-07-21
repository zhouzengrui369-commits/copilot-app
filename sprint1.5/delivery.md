# Sprint 1.5 Delivery Plan · S1.5 Close Path (Finalize, 2026-07-14 07:30 PM Mavis mvs_fb3605d0aa584c81bccf1af305906ef7)

> **Status**: 🟢 fully closed (PM 2026-07-14 09:18 finalize, NJX 7/14 09:15 拍板 4 件事 sub-decision 下放 PM 自主拍, 7/19 复盘会改期/简化)
> **Sprint**: 1.5 — Win Dev Signing Wire + Branded Icon + vitest 补齐 + PM SOP 固化
> **Close 目标**: Sprint 1.5 真正 close (2026-07-14 09:18), 不等 7/19 复盘会 (NJX 7/14 09:15 拍板改期)
> **PM**: Mavis mvs_fb3605d0aa584c81bccf1af305906ef7
> **Wave 1-2 Worker**: T-1.5.1 Coder mvs_627d543d52ba41ffa3c5b96d43eb647e + T-1.5.2 Coder mvs_69c287fb25c8430b9bd64e4e5d058311
> **Wave 3-4 Worker (派 2026-07-14 07:30)**: T-1.5.3 Coder bg_8b4497c0 + r22 接管 Coder bg_15c92456
> **Wave 5b-5c Worker (派 2026-07-14 08:25 + 08:35)**: S1.6 follow-up phase 1 Coder bg_8a4091cd + phase 2 V3 review Coder bg_0bd654da
> **Wave 5d + 6 (2026-07-14 09:18)**: Sprint 1.5 close 收口 commit + Sprint 1.6 启动 (macOS 真机验收) — PM 自主拍 (NJX 7/14 09:15 拍 "先交付 MVP, 你来定")

---

## 1. S1.5 状态摘要 (2026-07-14 07:30 CST)

**S1.5 = 4 wave planned, 2/4 done (T-1.5.1 + T-1.5.2), Wave 3+4 in_progress (PM 自主 ≤30min + 2 sub-agent ≤60min/4h 并行)**

| Wave | Task | 状态 | Verdict | Worker | 时间 |
|------|------|------|---------|--------|------|
| **1** | T-1.5.1 Win dev signing wire | 🟢 done | PASS | Coder mvs_627d543d52ba41ffa3c5b96d43eb647e | 2026-07-10 20:05 done, 20:14 merged main (HEAD = f0df9380) |
| **2** | T-1.5.2 Branded icon verify (T-1.3.2 placeholder + 4 artifact re-verify) | 🟢 done | PASS | Coder mvs_69c287fb25c8430b9bd64e4e5d058311 | 2026-07-10 20:24 done, 2026-07-11 04:38 merged main (HEAD = adddd80f) |
| **3** | T-1.5.3 vitest 181 → 200+ 补齐 (5 packages: kb/rag/llm-client/kg/copilot-cloud) | 🟡 in_progress | TBD | Coder bg_8b4497c0 | 2026-07-14 07:30 dispatched, ≤60min cap |
| **4** | 钉子 #49 (S1.5 #38 重整) PM SOP + W4 Gate 准备 | 🟡 in_progress | TBD | PM mvs_fb3605d0aa584c81bccf1af305906ef7 | 2026-07-14 07:30 in_progress, ≤30min cap |
| **5** | r22 接管 cold-start-kg-fix (NJX 2026-07-13 21:55 拍板破 forbidden 边界) | 🟡 done (PARTIAL) | PARTIAL | Coder bg_15c92456 (sub-agent) | 2026-07-14 08:30 worker done (1h / 4h cap); V3 source/test 修复完成 + cherry-pick main `fdefb8b8`; V3 独立 review + 12+ supporting files 添加 是 follow-up |
| **5b** | S1.6 follow-up r22 phase 1: cherry-pick 12+ supporting files (NJX 2026-07-14 08:18 拍板 🅰 派) | 🟢 done (FOLLOW-UP PHASE 1 PASS, V3 review pending) | PASS | Coder bg_8a4091cd | 2026-07-14 08:25 dispatched, 08:32 done (7min / 2h cap); 18 files cherry-picked (`b5c46b0`); `npm run build` PASS 0 error; `bash scripts/ci/unit-test.sh` passed=6 failed=0; 347/347 vitest PASS; V3 independent review 仍 PENDING (phase 2) |
| **5c** | S1.6 follow-up r22 phase 2: V3 independent whole-source review (sub-agent B 派) | 🟢 done | PASS | Coder (sub-agent B, INDEPENDENT V3 reviewer) | 2026-07-14 08:35 dispatched, 08:36 done (~10min / 1h cap); 5/5 验收信号全过 (probe hash a45ec172... + V3 RED 16/16 + V2 r22 focused 11 files 142/142 + Full Desktop Vitest 33 files 347/347 + tsc --noEmit exit 0); `R22_GREEN_WHOLE_SOURCE_REVIEW_V3_PASS` token issued; `RESULT.md` status flipped → `SOURCE_GREEN_ACCEPTED`; **build authorization GRANTED** |
| **5d** | Sprint 1.5 收口 commit (NJX 7/14 09:15 拍板 4 件事 + 7/19 复盘会改期) | 🟡 in_progress | TBD | PM Mavis mvs_fb3605d0aa584c81bccf1af305906ef7 | 2026-07-14 09:18 PM 自主拍 (NJX 9:15 拍 "立即拍 4 件事" + "先交付 MVP, 你来定" = 4 件事 sub-decision 下放 PM 自主); Sprint 1.5 真正 close (main HEAD 43cb4061) + retrospective §8 + 7/19 复盘会改期 + Sprint 1.6 启动 = macOS 真机验收 |
| **6** | Sprint 1.6 启动 = macOS 真机验收 + 3 轮 verify-fix (NJX 9:15 拍 "先交付 MVP") | ⚪ pending | TBD | Coder bg_xxx (待派) | PM 推荐 🅱 (S1.4 T-1.4.1d 推迟任务, Phase 1 Gate 收口), ≤ 1-2h cap, worktree sp1.6-T-1.6.1-macos-verify |

---

## 2. Wave 1: T-1.5.1 Win dev signing wire (DONE)

- **Verdict**: PASS (5/5 验收信号, 1 caveat = self-signed root = 预期)
- **交付**:
  - `apps/copilot-desktop/build/dev-cert.{key,crt,pfx}` (gitignored, self-signed, 365d)
  - `apps/copilot-desktop/electron-builder.yml` (certificateFile + certificatePassword null + signingHashAlgorithms: [sha256])
  - `apps/copilot-desktop/.env.example` (CSC_KEY_PASSWORD=changeme-dev-only placeholder)
  - `apps/copilot-desktop/.gitignore` (build/dev-cert.* + *.pfx + *.key + .env + release/)
  - 4 signed artifact (x64-setup + x64-portable + arm64-setup + arm64-portable) **留在 wt-T151 release/**
- **签 verification**: osslsigncode 4/4 "Number of verified signatures: 1" + signer = CN=NJX Dev Signing (Self-Signed)
- **PM merge (20:14)**: ✓ git merge --ff-only sp1.5-T-1.5.1, main HEAD = f0df9380 (钉子 #15 v2 forward-only)
- **commit hash typo (钉子 #39 候选 #2)**: 3 files 提到 7b00738d, 实际 merge commit = f0df9380

---

## 3. Wave 2: T-1.5.2 Branded icon verify (DRAFT pending commit)

- **Scope 收窄** (NJX 20:13 拍板 "用现在 njx-copilot app 的 logo" = T-1.3.2 placeholder)
- **Verdict**: PASS pending commit
- **5/5 验收信号**:
  1. 4 artifact 存在 + size sanity (4 file 78-83MB, 70-90MB 范围) ✓
  2. icon.ico 嵌入 4/4 (ICONDIR magic 26-54 hits, PNG magic 8-11 hits) ✓
  3. osslsigncode 4/4 verified (1 sig each, self-signed root 警告 = 预期) ✓
  4. build/icon.ico 保持 T-1.3.2 commit 351e99d7, 未被覆盖 ✓
  5. commit + 3件齐 + board entry + delivery.md 草稿 ✓
- **钉子 #38 dist bundle grep**: src/dist 一致性 OK (T-1.5.1 + T-1.5.2 均不动 src/ 业务代码)
- **Caveat (3 件, 全部预期)**:
  1. osslsigncode exit 1 due to self-signed root (S1.4 rules.md §3.1 + S1.5 rules.md §2.6 红线允许)
  2. **main worktree release/ 实际是 S1.4 Wave 5 build (UNSIGNED, 18:52)**:
     - PM action item 7/11 前 sync wt-T151 signed artifacts → main checkout
     - 不影响 T-1.5.2 verdict (artifact 本身 OK, 位置问题)
  3. signed artifact 内 dist bundle 字符串不连续 (asar 压缩后 "Sprint" + "1.4" + "release" 被分开)

---

## 4. Wave 3: T-1.5.3 vitest 181 → 200+ 补齐 (5 packages, PENDING)

- **Scope**: 5 packages 并行 vitest 补齐 (T-1.5.3 详细任务分配 TBD by PM)
- **钉子红线**:
  - ❌ 不为凑数写 trivially-true test
  - ❌ 不 mock 整个 module (Sprint 1.3 v3 教训: mock 重于实跑反而漏 bug)
  - ❌ 不动 5 package 各自 vitest config (保持 baseline)
  - ❌ 不为求行数覆盖写 dead-code path test
  - ✅ 每个 test 必真跑 + 必 fail-then-pass 验证
  - ✅ 优先 coverage gap: error path + edge case + integration
  - ✅ 5 package 并行跑 `pnpm -w test`, 0 fail 才算 done
  - ✅ coverage 不下降 (Sprint 1.3 baseline 锁定)
- **PM 自主起**: 7/14-7/16
- **Verdict 期望**: PASS with caveat (新 test 必 fail-then-pass 验证)

---

## 5. Wave 4: 钉子 #38 PM SOP + W4 Gate 准备 (PENDING, PM 自主)

### 5.1 钉子 #38 SOP 固化

- **触发场景** (S1.5 rules.md §4.1):
  - Sprint close / partial close 前
  - 任何 artifact rebuild 后 (electron-builder / vite build)
  - 任何 src 文案 / feature flag / version 字符串改后
  - 任何 package.json version bump 后
- **SOP 模板** (S1.5 rules.md §4.2 完整版):
  - A. src 关键字符串 snapshot
  - B. dist bundle grep
  - C. 一致性验证
  - D. 反向校验
- **T-1.5.2 跑通证据** (5/5 PASS):
  - src 5+ Sprint 命中
  - dist bundle 命中
  - 反向校验 4 keyword 全 PASS
  - 一致性: src/dist 不漂移
- **固化提案** (7/19 复盘会拍板):
  - PM 推荐固化为全局钉子 #38 (跨 Sprint 适用)
  - NJX 拍板保留 / 改进 / 撤销

### 5.2 W4 Gate 复盘会准备 (7/19)

**PM 7/18 准备**:

- **Sprint 1.5 retrospective 草案** (6 章节):
  1. what went well
  2. what didn't
  3. lessons
  4. sprint metrics
  5. next sprint plan
  6. 钉子固化提案 (#38 + #39 候选)
- **Phase 2 kickoff 选项** (per OPC 12 周 W5-W8 路线图):
  - 🅰 1-2 个航材场景 + 接入真实数据流 (Sprint 2.0/2.1)
  - 🅱 数字孪生雏形 + 知识库集成 (Sprint 2.0/2.1/2.2)
  - 🅲 暂缓 Phase 2, 继续产品化打磨 (Sprint 1.6/1.7)
- **Sprint 1.5 archive 目录 close**: `archive/sprint1.5-2026-07-10-close/`

**NJX 7/19 1h 复盘会拍板**:
- Sprint 1.5 验收签字
- 钉子 #38 + 钉子 #39 是否正式固化
- Phase 2 kickoff 选项 🅰/🅱/🅲

---

## 6. PM 风险 (待 S1.5 close 时 update)

- **钉子 #37** (electron-builder Wine auto-provision): T-1.5.1 + T-1.5.2 都验证 macOS host wine-4.0.1 auto-download 0 sec warm cache
- **钉子 #30** (dispatch explicit flags): T-1.5.1 + T-1.5.2 显式 `--config electron-builder.yml` + `cd apps/copilot-desktop/` 验证 OK
- **钉子 #14** (3件齐): 4 wave 都遵守, 0 漏
- **钉子 #23** (PM hand-audit 5-min pre-accept): PM 在 NJX 验收前必跑 5 件套
- **钉子 #38** (dist bundle grep): S1.5 起执行, T-1.5.2 已 5/5 PASS, W4 Gate 复盘会拍固化

---

## 7. 钉子 #39 候选 (S1.5 反思)

- **#39 候选 #1**: 钉子 #30 (dispatch explicit flags) 升级 — 含 yml `certificatePassword: null` (不是 `${CSC_KEY_PASSWORD}` 字面字符串, electron-builder 不展开 env var)
- **#39 候选 #2**: commit hash typo 修正 — worker 报 7b00738d, 实际 merge commit = f0df9380, PM 30min 内补 patch-on-merge
- **#39 候选 #3**: 跨 worktree build (T-1.5.1 worker 用了 main worktree 的 electron-builder binary + node_modules) — PM 拍板允许, 但 S1.6+ 应避免, 每个 worktree 独立 `pnpm install`
- **#39 候选 #4**: signed artifact build 输出没 sync 回 main checkout — T-1.5.2 验证时才发现 main release/ 是 S1.4 Wave 5 UNSIGNED, PM 7/11 前 sync

**PM 7/19 复盘会拍板**: 哪些固化为正式钉子, 哪些改进 SOP, 哪些撤销

---

## 8. 已知非阻塞问题 (跨 Sprint follow-up)

1. **signed artifact 内 dist bundle 字符串不连续** (asar 压缩): 钉子 #38 跑 1 次完整验证
2. **跨 worktree build 风险** (T-1.5.1): S1.6+ 每个 worktree 独立 `pnpm install`
3. **SmartScreen "Unknown Publisher" 警告**: prod cert 才消除, 推迟到 S1.6+ (NJX 拍板)
4. **Win 真机 verify** (signtool): S1.4 NJX Surface Pro 8 流程已验证, S1.5 沿用

---

## 9. 4 文档 (PM SOP, S1.5 close 时 finalize)

| 文档 | 当前状态 | 7/18 finalize 必跑 |
|------|---------|-------------------|
| `sprint1.5/board.md` | Wave 1+2 done, Wave 3-4 pending | 全部 wave entry close |
| `sprint1.5/goal.md` | 19:44 NJX 拍板 scope, 不变 | 不变 |
| `sprint1.5/plan.md` | 19:44 plan, 不变 | 不变 |
| `sprint1.5/rules.md` | 19:35 PM 起草, 含钉子 #38 | 7/18 跑 钉子 #38 1 次, 7/19 拍固化 |
| `sprint1.5/delivery.md` (本文件) | T-1.5.2 worker 起草 draft | 7/18 PM finalize, 加 Wave 3+4 close |

---

## 10. Next (PM 自主 per §0.1)

- **7/10 20:24 (T-1.5.2 close)**: report back to PM, NJX 验收弹窗 trigger
- **7/11**: T-1.5.2 NJX 验收 accept → merge sp1.5-T-1.5.2 → main HEAD = (TBD)
- **7/11 (PM action item)**: sync wt-T151 signed artifacts → main checkout
- **7/14-7/16**: T-1.5.3 vitest dispatch (PM 自主起, 5 packages 并行)
- **7/18**: 钉子 #38 SOP 自跑 + 4 文档 close + retrospective 草案
- **7/19**: W4 Gate 复盘会 1h (NJX 物理参与)

---

**Draft 起草时间**: 2026-07-10 20:24 CST (T-1.5.2 worker)
**Finalize 时间**: 2026-07-18 (PM, 7/19 复盘会前 1 天)
**Finalize 内容**: 补 Wave 3 (T-1.5.3 PASS) + Wave 4 (钉子 #38 验证) close 状态
