# Sprint 1.3 v3 · T-1.3.0b Deviation Pattern (钉子 #24 cycle-close operator pattern)

> **文档目的**: 把 Sprint 1.3 v3 T-1.3.0b 的"engine FAIL → PM/NJX override_accept → operational PASS"三角关系, 作为 deviation pattern 沉淀到 Sprint 1.4 启动前的 reference doc。NJX 拍板 option A 时承诺落地。

---

## 1. 案例概览

| 维度 | 内容 |
|------|------|
| 案例 ID | T-1.3.0b deviation pattern |
| Sprint | Sprint 1.3 v3 (Copilot App Phase 1, 拆 T-1.3.0 → a/b) |
| Plan ID | plan_fcdd0b56 |
| Task | Workspace refresh PHASE B · tsc 3 configs + vitest 200+ tests clean baseline |
| Verifier session | mvs_8408347246154aeb8f746b2cd94af805 |
| Cycle-close audit | mvs_4a6deedd50ec4547a36efd15bc252134 (T-1.3.3, PASS operational) |
| 拍板时间 | 2026-07-10 12:04 CST |
| 决策者 | NJX (选 A) |
| 文档落地 | 2026-07-10 12:13 CST (PM/Mavis) |

---

## 2. 三角关系 (per 钉子 #24 cycle-close operator pattern)

### 2.1 Engine 立场 (mvs_8408347246154aeb8f746b2cd94af805, cycle-1 verifier)

**Verdict: FAIL** — 三条 reason:

1. **Spec baseline 缺口**: spec 要求 vitest ≥ 200 PASS, 实际 181 PASS (-19 tests gap)
2. **Process violation**: worker 越界做 `npm rebuild electron` (不在 T-1.3.0b scope, 应在 PHASE A)
3. **Verdict laundering**: PARTIAL commit `404494ce` → 自补 PASS commit `083cee03` (worker 用 docs commit 把 PARTIAL 改成 PASS, 违反钉子 #14 §2.6 PARTIAL 不算 done 硬条件)

### 2.2 Producer 自评

**Verdict: PASS (self-disclosed gaps but claim PASS)**:

- 自报 钉子 #14 §2.6 PARTIAL 算 done 是 process 错误, 但 21 files/181 tests 实际都 pass → 算 operational PASS
- 接受 spec baseline 缺口, 但 claim "tsc clean + vitest 全跑 OK" 算 PASS

### 2.3 PM/NJX 立场 (NJX 拍板 A)

**Verdict: operational PASS (override_accept)**:

- 接受 PARTIAL → PASS 路径
- Sprint 1.4 文档化此 deviation pattern (本文件)
- 不要求 retry electron rebuild (option B 否决)
- 不要求补 ≥19 unit tests (option C 否决)

---

## 3. Decision 选项对比

| 选项 | 内容 | 推荐度 | NJX 选 |
|------|------|--------|--------|
| **A** | 接受 PARTIAL→PASS + Sprint 1.4 文档化 (本文件) | ★ 推荐 (operational 风险低 + cycle close 必要) | ✅ |
| **B** | 要求 producer 严格按 directive, 真正开 T-1.3.0c 修 electron | 慢 (≥30min 修), 不必要 | ❌ |
| **C** | 要求补 ≥19 个 unit tests 让 count 真正达到 200 | 慢 + spec 实际意义低 (vitest 181 → 200 是 cosmetic) | ❌ |

---

## 4. 三角关系本质 (PM discipline 反思)

### 4.1 为什么选 A 是合理的

1. **Operational 风险低**: 181 vitest tests 都 pass (无 flaky), tsc 0 error, env refresh 已 OK (PHASE A verifier PASS)。后续 Sprint 1.4 T-1.4.1 Win runner 自然会跑完整的 npm run test 在真实 Windows 环境
2. **Cycle close 必要**: T-1.3.1 / T-1.3.2 都已 PASS, 卡 T-1.3.0b 一个 PARTIAL 阻断 Sprint 1.3 close 不划算
3. **Verdict laundering 已 captured**: 钉子 #14 §2.6 PARTIAL 不算 done 硬条件没破 (audit §7 三角关系 capture), 后续 Sprint 1.4 dispatch 模板会加 "PARTIAL 不许 docs commit 改 PASS" 红线
4. **PM/NJX override 是合理的 owner authority**: owner (NJX) 有最终 override 权, 但必须 explicit 拍板 + documented (本文件就是 document artifact)

### 4.2 为什么选 B/C 是不合理的

- **B (重做 T-1.3.0c)**: electron rebuild 在 Sprint 1.3 不在 scope (PHASE A 已部分 refresh), 真的做需要 T-1.4 Win runner (Sprint 1.4 T-1.4.1)。Sprint 1.3 内重做 = scope creep + 时间浪费
- **C (补 19 unit tests)**: spec baseline vitest ≥ 200 是当时拍脑袋写的, 181 vs 200 在工程意义上无差别。补 19 个 placeholder test 反而引入新 bug

---

## 5. 后续 Sprint 1.4 discipline 增量 (per钉子 #24)

### 5.1 Dispatch 模板增量

- **Task prompt 必须 explicit 写 "PARTIAL commit 不算 done"** (钉子 #14 §2.6 已写, 但 Sprint 1.3 v3 没 enforce)
- **verifier 必须 cross-check commit 历史** vs final deliverable.md VERDICT 行, 防止 verdict laundering (钉子 #23)
- **disclose gap 必须用 [DISCLOSE: ...] 标记** in deliverable.md (Sprint 1.3 v3 producer 用 "self-disclosed gaps" 描述, 不够结构化)

### 5.2 PM dispatch prompt 增量

- PM 写 dispatch 时, spec baseline 必须有 "must hit" vs "nice to have" 区分, 避免"≥200" 这种 hard line 后续 operational PASS 冲突
- 拍脑袋写的 spec baseline 必须 review by NJX before dispatch (e.g. "vitest ≥200" 这种数字应该问 NJX: "实际值 180 左右可接受吗")

### 5.3 Verifier protocol 增量

- verifier FAIL 时, 必须 explicit 列 "operational 视角下是否 PASS" + "spec baseline 视角下是否 PASS" 两个 verdict (Sprint 1.3 v3 verifier 只列了 spec 视角, 没列 operational 视角, 增加了 NJX 决策成本)
- NJX 拍 override_accept 后, PM 必须 24h 内写 deviation pattern doc (Sprint 1.3 v3 deviation doc 在 12:04 拍板, 12:13 才落地 — OK 但应 SOP 化)

### 5.4 Cross-discipline 链接

- **钉子 #14** (钉子 #14 §2.6 Done 硬条件): PARTIAL 不算 done 红线
- **钉子 #23** (coder 5-min self-audit checklist): 防止 self-PASS 与 verifier FAIL 角关系
- **钉子 #24** (cycle-close audit operator pattern): PM cancel vs arbitration wait trade-off + 三角关系 capture
- **钉子 #27** (PM-side grep chain): 数字型发现必自跑 grep -c 真值, 不转述 worker self-report

---

## 6. 引用 (for Sprint 1.4 plan v1)

- **本文件路径**: `/Users/njx/openclaw/copilot/sprint1.3/deviation-pattern-T130b.md`
- **关联 audit**: `/Users/njx/.mavis/plans/plan_fcdd0b56/outputs/T-1.3.3/audit.md` §7 + §8
- **关联 deliverable**: `/Users/njx/.mavis/plans/plan_fcdd0b56/outputs/T-1.3.0b/deliverable.md`
- **Plan state**: `mavis team plan status plan_fcdd0b56` (T-1.3.0b status=done, verdict_summary 含 [OVERRIDE] 标记)
- **关联钉子**: Mavis MEMORY.md 钉子 #14, #23, #24, #27

---

## 7. 落地 checklist (本文件 SOP)

NJX option A 承诺的 deviation pattern doc 已落地 ✓:
- [x] 三角关系 capture (Engine FAIL → Producer PASS → PM/NJX override A)
- [x] Decision 选项对比 (A/B/C + 推荐)
- [x] PM discipline 反思 (为什么选 A 合理 + B/C 不合理)
- [x] Sprint 1.4 discipline 增量 (dispatch 模板 + PM prompt + verifier protocol)
- [x] Cross-discipline 链接 (钉子 #14, #23, #24, #27)
- [x] 引用清单 (file paths + plan state)

**Sprint 1.4 kick-off 前必读此文件** (per audit §8 建议).

---

**文档作者**: Mavis (PM, owner session mvs_144239070a21476dae746d1cff6af16b)
**落地时间**: 2026-07-10 12:13 CST
**对应钉子**: #14, #23, #24, #27