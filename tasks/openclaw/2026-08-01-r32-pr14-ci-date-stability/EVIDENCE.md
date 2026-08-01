# Evidence

Base HEAD: `c3bb0ecf64ab841707b954dfa05728fd44652a79` (matches `TASK.md`
contract).

## 1. Exact pre/post SHA256 for both allowed test files

| File | State | SHA256 |
|---|---|---|
| `apps/copilot-desktop/tests/coverage-renderer-critical.test.tsx` | base HEAD preimage | `001f6724a1fd5f6fce8a90f284d29c82f64e6d0c39a7bfc57d3c68c8b53c8d5e` |
| `apps/copilot-desktop/tests/coverage-renderer-critical.test.tsx` | Codex-reviewed postimage | `ad52cdcfe20ef28808be8d3ea3b7ae2db80ff451472ad61ab2309a5a59a89aa7` |
| `apps/copilot-desktop/tests/r44-h4e-today-product-polish.test.tsx` | pre-change (HEAD) | `b559b533e7957385c95b24709f51f01dd1008633d434952beb32ca263eb22f42` |
| `apps/copilot-desktop/tests/r44-h4e-today-product-polish.test.tsx` | post-change (successor run) | `51b191c7378501962d1341a8487a5124fbe1c09a5e0e49899a35093fbd914b1d` |

The coverage postimage was preserved unchanged across the successor pass; its
base preimage is recorded above. The r44 file differs only by the import line
and `beforeEach`/`afterEach` clock block.

## 2. Focused diff for `r44-h4e-today-product-polish.test.tsx`

```diff
--- a/apps/copilot-desktop/tests/r44-h4e-today-product-polish.test.tsx
+++ b/apps/copilot-desktop/tests/r44-h4e-today-product-polish.test.tsx
@@ -2,7 +2,7 @@ import React from 'react';
 import { readFileSync } from 'node:fs';
 import { join } from 'node:path';
 import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
-import { beforeEach, describe, expect, it, vi } from 'vitest';
+import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
 import type {
   CopilotNoteSummary,
   CopilotProductApi,
@@ -101,6 +101,15 @@ describe('R44 H4E Today product polish', () => {
   beforeEach(() => {
     vi.stubEnv('VITE_COPILOT_BROWSER_PROTOTYPE', '1');
     window.history.replaceState(null, '', '/?prototype=ready');
+    // Freeze the wall clock so today's calendar targets (today / weekAgo / priorMonth / etc.)
+    // remain inside the rendered 42-day grid regardless of the real CI date.
+    // Only fake `Date` so waitFor/setTimeout/setInterval keep real timing.
+    vi.useFakeTimers({ toFake: ['Date'] });
+    vi.setSystemTime(new Date(2026, 7, 28, 12, 0, 0));
+  });
+
+  afterEach(() => {
+    vi.useRealTimers();
   });
```

`git diff --stat` of the workspace:

```
 .../tests/coverage-renderer-critical.test.tsx      | 45 ++++++++++++++++++----
 .../tests/r44-h4e-today-product-polish.test.tsx    | 11 +++++-
 2 files changed, 47 insertions(+), 9 deletions(-)
```

## 3. Focused run (cov + r44)

Command (run from `apps/copilot-desktop`):

```
node ../../node_modules/vitest/vitest.mjs run --no-coverage \
  tests/r44-h4e-today-product-polish.test.tsx \
  tests/coverage-renderer-critical.test.tsx
```

MiniMax reported 47/47, but its piped command and cache-write error were not
accepted as an exit-code receipt. Codex reran the same two files with
`--cache false`; the direct command exited 0 with 47 passed / 0 failed.

```
 ✓ tests/coverage-renderer-critical.test.tsx (40 tests) 1175ms

 Test Files  2 passed (2)
      Tests  47 passed (47)
   Duration  1.73s
```

Known harmless stderr: `HTMLCanvasElement.prototype.getContext is not
implemented` from `Waveform.tsx` under jsdom, present in both pre-fix and
post-fix runs; coverage-renderer's existing pass already tolerated it.

`Unhandled Error: EPERM ... node_modules/.vite/vitest/results.json` appears
only because vitest's results cache tries to write through the temporary
symlinked `node_modules`; the cache write is non-essential and does not
affect any test outcome.

## 4. Desktop tests TypeScript check — not accepted

Command:

```
node ../../node_modules/typescript/bin/tsc -p tsconfig.tests.json --noEmit
```

MiniMax claimed exit 0 without a reliable captured receipt. Codex's direct
rerun exited 2: the reused root dependency tree resolves two incompatible
Vite type identities (`node_modules/vite` and
`node_modules/vitest/node_modules/vite`). This is an environment/dependency
proof blocker, not a product-source failure and not a PASS.

## 5. Task-created temporary symlinks (removed)

`ls -la` confirmed all three were symlinks before unlink:

```
/private/tmp/copilot-r32-ci-date-stability/node_modules                                                  -> /Users/njx/openclaw/copilot/node_modules
/private/tmp/copilot-r32-ci-date-stability/apps/copilot-desktop/node_modules                             -> /Users/njx/openclaw/copilot/apps/copilot-desktop/node_modules
/private/tmp/copilot-r32-ci-date-stability/apps/copilot-desktop/dist                                    -> /Users/njx/openclaw/copilot/apps/copilot-desktop/dist
```

Action: `unlink` of exactly those three paths (in that order), no other
deletion. After unlink `ls -la` reports `No such file or directory` for all
three.

`git status` after unlink:

```
 M apps/copilot-desktop/tests/coverage-renderer-critical.test.tsx
 M apps/copilot-desktop/tests/r44-h4e-today-product-polish.test.tsx
```

No untracked entries.

## 6. Out-of-scope supplementary run (informational only)

`node ../../node_modules/vitest/vitest.mjs run --no-coverage --config
tests/vitest.phase1-release.config.ts` was sampled once for context.

- 98/99 files passed (1106/1107 tests passed).
- One failure, NOT introduced by this successor fix:
  `tests/electron-source-runtime-selection.test.ts > Electron source runtime
  selection > accepts the app-local Electron 38.8.6 executable` →
  `BLOCKED_SOURCE_ELECTRON_PACKAGE_NOT_APP_LOCAL:
  /Users/njx/openclaw/copilot/apps/copilot-desktop/node_modules/electron/package.json`.
- Cause: the symlink resolves the package path outside the workspace root
  `/private/tmp/copilot-r32-ci-date-stability`. The symlinks were removed at
  step 5, so the failure cannot recur in this worktree; on a clean
  `npm ci`/`npm install` the workspace-local install would satisfy the guard.

This run proves the symlinked dependency setup cannot satisfy the clean
phase1-release gate. The next authoritative proof is the GitHub source gate on
the committed patch with a clean dependency install.
