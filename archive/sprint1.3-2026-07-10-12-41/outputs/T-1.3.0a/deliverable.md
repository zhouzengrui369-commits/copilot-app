# T-1.3.0a Deliverable · Sprint 1.3 — PHASE A workspace refresh (env-only)

> **Backfill note (2026-07-10 12:30 CST, PM Mavis)**: 此 deliverable.md 在 Sprint 1.3 CLOSE 后由 PM hand-audit 触发回填（钉子 #14 3件齐缺口发现）。内容基于 `outputs/T-1.3.0a/SELF-VERIFY-T-1.3.0a.md` (7463B) 全文 + commit `47c9fb3a` / merge `71919777` 证据重组。SELF-VERIFY 是当时唯一交付物，deliverable.md 是补齐闭环的派生文档，证据零失真。

---

## VERDICT: PASS

- ✅ `npm install --ignore-scripts` → 1442 packages / 26s
- ✅ `packages/llm-client` build PASS (~20s)
- ✅ `packages/kg` build PASS (~30s) — dist/index.{js,d.ts} emitted, builder/ + store/ subtrees present
- ✅ `@copilot/kg` symlink verified (node_modules/@copilot/kg → ../../packages/kg)
- ✅ Sigma + Graphology + Graphology-layout 三件套 present (LICENSE.txt + dist/)
- ✅ `outputs/T-1.3.0a/SELF-VERIFY-T-1.3.0a.md` (7463B) 已存档
- ⚠️ PHASE A 已知限制（透传给 PHASE B）：better-sqlite3 native binding NOT built — `--ignore-scripts` 跳过 postinstall；PHASE B 修复并完成 tsc/vitest 验证（钉子 #24 NJX override A 已批准 operational PASS）

---

## Header

| 字段 | 值 |
|---|---|
| Date | 2026-07-10 11:02 (Asia/Shanghai, UTC+8) |
| Worker | coder @ `mvs_77648911df72422ebdfeefed65b3c74a` |
| Branch | `sp1.3-T-1.3.0a` |
| Base | main HEAD `b0402245` (Sprint 1.3 plan v1) |
| Worktree | `/Users/njx/openclaw/copilot.wt-T130a/wt-T130a` |
| PHASE | A — env refresh only (npm install + packages/kg build) |
| Code commit | `47c9fb3a` |
| Merge commit | `71919777` |
| 钉子 #14 3件齐 | commit code ✓ + SELF-VERIFY ✓ + (backfilled) deliverable.md ✓ + board entry ✓ |

---

## Acceptance signals (PHASE A scope — env-only, no business code change)

### 1. ✅ `packages/kg/dist/` emitted with required entries
```
dist/index.js      1237 bytes  11:00
dist/index.d.ts    1695 bytes  11:00
dist/builder/      (subtree)
dist/store/        (subtree)
dist/types.{js,d.ts}
dist/middleware/   (subtree from @copilot/llm-client deps)
```

### 2. ✅ `node_modules/@copilot/kg` symlink → `../../packages/kg`
```
lrwxr-xr-x@ 1 njx  staff  17 Jul 10 10:58 node_modules/@copilot/kg -> ../../packages/kg
```

### 3. ✅ Sigma + Graphology stack present
```
node_modules/sigma/             (LICENSE.txt, README.md, dist/)
node_modules/graphology/        (LICENSE.txt, README.md, dist/)
node_modules/graphology-layout/ (LICENSE.txt, README.md, circlepack.d.ts, …)
```

### 4. ✅ npm install log contains `added` keyword
```
npm install --ignore-scripts ... → "added 1442 packages in 26s"
```

---

## Build chain order (critical for kg build to succeed)

```
1. npm install --ignore-scripts  (1442 packages, 26s)
   └─ @copilot workspaces symlinked: cloud / desktop / kb / kg / llm-client
2. cd packages/llm-client && npm run build  (~20s)
   └─ produces dist/{index,client,config}.{js,d.ts}
   └─ MUST precede kg build (kg imports @copilot/llm-client types)
3. cd packages/kg && npm run build  (~30s)
   └─ tsc -p tsconfig.json → dist/ subtree
```

If kg build is run **without** llm-client dist first:
```
error TS2307: Cannot find module '@copilot/llm-client' or its corresponding type declarations
```

This is documented in Sprint 1.3 plan §2.2 (build order precondition).

---

## Critical env workaround (Python 3.14 + node-gyp 9.4.1 mismatch)

**Problem**: `npm install` (default, with scripts) failed at `better-sqlite3@11.10.0` postinstall:

```
gyp ERR! configure error
File "node_modules/node-gyp/gyp/pylib/gyp/input.py", line 19, in <module>
    from distutils.version import StrictVersion
ModuleNotFoundError: No module named 'distutils'
```

**Root cause**:
- macOS Darwin 25.2.0 ships **Python 3.14.5** (Homebrew) — `distutils` was removed in Python 3.12+
- `node-gyp v9.4.1` (pulled by better-sqlite3 11.10.0) still imports `distutils.version.StrictVersion`
- better-sqlite3 fallback chain: `prebuild-install || node-gyp rebuild` — prebuilt binary not available for Node v24.13.1 ABI, so falls to native rebuild → fails

**Fix applied** (PHASE A scope only):
```
npm install --ignore-scripts --no-audit --no-fund
```
- Skips postinstall scripts (no native binding compilation)
- Pure-JS packages still installed → 1442 packages including all workspace deps
- Type definitions for `better-sqlite3` (via `@types/better-sqlite3@7.6.13`) still installed → TS type-check passes
- **Runtime native binding `better_sqlite3.node` is NOT built** — affects @copilot/kb runtime, NOT kg compile

**PHASE A consequence**: kg TypeScript compiles cleanly without native binding. PHASE B (tsc 3 configs + vitest 200+ tests) addresses runtime binding.

---

## Known limitations (handed to PHASE B)

1. **better-sqlite3 native binding missing** at PHASE A close — `node_modules/better-sqlite3/build/Release/better_sqlite3.node` does NOT exist. Affects:
   - `@copilot/kb` runtime (any test that opens SQLite store)
   - `@copilot/kg` runtime (any test that imports `KgStore` and opens store)
   - Sprint 1.2 vitest suites that hit SQLite will fail at runtime, not at compile time
   - **Fix path (PHASE B owns)**: install setuptools + bump node-gyp ≥ 10 + retry npm install WITHOUT `--ignore-scripts`, OR `npm_config_python=/usr/bin/python3 npm rebuild better-sqlite3 --build-from-source` (PHASE B 实际采用此路径)

2. **No tsc / vitest verification in this PHASE** — per dispatch task boundary. PHASE B owns:
   - `npm run check` in apps/copilot-desktop (3 tsc configs)
   - `npm run test` (≥200 vitest, 最终 181/181, NJX override A approved)
   - sprint1.3 metric gate

3. **packages/kb/ carryover not committed** — main repo has unstaged packages/kb/ files (T-1.2.5 Smart schedule carryover, NOT T-1.3.0a scope). Per dispatch instruction: **绝对不要 commit packages/kb/ 任何文件**. Stays in main working tree for PM decision.

---

## Files committed (钉子 #14)

```
47c9fb3a chore(sprint1.3): T-1.3.0a PHASE A · workspace refresh env-only
  M package-lock.json                                    (modified — dep tree sync)
  A outputs/T-1.3.0a/SELF-VERIFY-T-1.3.0a.md             (7463B, new)
  A sprint1.3/board.md                                   (new — PHASE A done entry)

71919777 Merge T-1.3.0a PHASE A — workspace refresh env-only (1442 packages + kg build)
```

NOT committed (per `.gitignore`):
- `node_modules/` (1.0G, runtime artifact)
- `packages/kg/dist/` (120K, build artifact)

NOT committed (per dispatch scope):
- `packages/kb/` T-1.2.5 carryover (in main working tree, not in this worktree)
- any `src/` business code change (no edits made)

---

## Wall-clock timing

| t (min) | Action | Outcome |
|---|---|---|
| 0:00 | Task dispatch received | start |
| 0:30 | `git worktree add` from main | sp1.3-T-1.3.0a @ b0402245 |
| 1:00 | `npm install` (default scripts) | **FAIL** at better-sqlite3 gyp (distutils) |
| 4:00 | `npm install --ignore-scripts` | **PASS** (1442 pkgs, 26s) |
| 6:30 | `cd packages/llm-client && npm run build` | **PASS** (~20s) |
| 7:30 | `cd packages/kg && npm run build` | **PASS** (~30s, dist/ emitted) |
| 8:00 | Write SELF-VERIFY + board + commit + (missing: deliverable.md) | (deliverable.md 在 12:30 PM backfill) |

---

## Terminal capture (excerpt)

```
$ git worktree add ../copilot.wt-T130a/wt-T130a -b sp1.3-T-1.3.0a main
Preparing worktree (new branch 'sp1.3-T-1.3.0a')
Updating files: 100% (759/759), done.
HEAD is now at b0402245 chore(sprint1.3): Sprint 1.3 plan v1

$ npm install --ignore-scripts --no-audit --no-fund
added 1442 packages in 26s

$ ls -la node_modules/@copilot/kg
lrwxr-xr-x@ 1 njx staff 17 Jul 10 10:58 node_modules/@copilot/kg -> ../../packages/kg

$ cd packages/llm-client && npm run build
> @copilot/llm-client@0.1.0 build
> tsc -p tsconfig.json
(bundle emitted to dist/)

$ cd ../kg && npm run build
> @copilot/kg@0.1.0 build
> tsc -p tsconfig.json
(bundle emitted to dist/)

$ ls packages/kg/dist
builder  index.d.ts  index.d.ts.map  index.js  index.js.map  store  types.d.ts  types.d.ts.map  types.js  types.js.map

$ git commit -m "chore(sprint1.3): T-1.3.0a PHASE A · workspace refresh env-only"
[sp1.3-T-1.3.0a 47c9fb3a] chore(sprint1.3): T-1.3.0a PHASE A · workspace refresh env-only
```

---

## 钉子 #14 3件齐 self-check (post-backfill)

| 件 | 状态 | 路径 / SHA |
|---|---|---|
| 1. commit code | ✅ | `47c9fb3a` chore(sprint1.3): T-1.3.0a PHASE A · workspace refresh env-only |
| 2. deliverable.md | ✅ (backfilled 2026-07-10 12:30) | `outputs/T-1.3.0a/deliverable.md` (本文档) |
| 3. SELF-VERIFY | ✅ | `outputs/T-1.3.0a/SELF-VERIFY-T-1.3.0a.md` (7463B) |
| 4. board entry | ✅ | `sprint1.3/board.md` line 11-21 [2026-07-10 11:02:30] coder \| T-1.3.0a \| done (PHASE A) |

钉子 #14 闭环 ✓ · PM backfill 标注已留痕

---

## VERDICT: PASS (PHASE A scope)

- All 4 PHASE A acceptance signals met
- kg dist compiled cleanly (after llm-client precondition built first)
- Known limitations explicit for PHASE B pickup
- 钉子 #14 3件齐通过 PM backfill 闭环

**Handoff to PHASE B (T-1.3.0b)**:
- better-sqlite3 native binding missing → needs fix (`npm_config_python=/usr/bin/python3 npm rebuild better-sqlite3 --build-from-source` 是实际路径)
- After fix: `npm run check` + `npm run test`
- PHASE B 最终: tsc 0 errors + vitest 21/21 files / 181/181 tests PASS (NJX override A)