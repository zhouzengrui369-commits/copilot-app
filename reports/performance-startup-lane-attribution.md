# Direct-performance startup lane attribution

Status: **PASS (source/test lane only)**  
Date: 2026-07-15 (Asia/Shanghai)  
Scope: startup attribution only; no candidate build, signing, notarization, GUI, raw performance run, threshold/config/package change, commit, or push.

## Result

`createStartupCoordinator` now converts unexpected direct-mode failures into a stable, data-free blocker error for each real startup lane:

| Lane | Blocker code |
| --- | --- |
| first window | `BLOCKED_DIRECT_PERF_STARTUP_WINDOW` |
| release identity | `BLOCKED_DIRECT_PERF_STARTUP_RELEASE_IDENTITY` |
| direct probe | `BLOCKED_DIRECT_PERF_STARTUP_PROBE` |
| settings load | `BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_LOAD` |
| settings apply | `BLOCKED_DIRECT_PERF_STARTUP_SETTINGS_APPLY` |

Synchronous throws are captured as rejected lane promises, so the four independent initial lanes are still invoked in the established order before awaiting. Promise rejections use the same attribution. An existing valid `BLOCKED_*` code is preserved, but its error is rebuilt with only the code as the message. `directMode: false` returns the original error unchanged and never calls direct fail-closed. Settings application remains downstream of `shellCommitted`; the existing write-once terminal/fail-closed controls are unchanged.

## Test-first evidence

RED command (from `apps/copilot-desktop`):

```text
../../node_modules/.bin/vitest run tests/r22-startup-lazy-red.test.tsx
Test Files 1 failed (1)
Tests 5 failed | 17 passed (22)
```

All five failures showed the pre-fix raw `TypeError` instead of the expected lane code. The initial repo-root invocation was discarded because it used the wrong root/environment and also selected immutable candidate snapshots; it is not acceptance evidence.

GREEN focused command:

```text
../../node_modules/.bin/vitest run tests/r22-startup-lazy-red.test.tsx
Test Files 1 passed (1)
Tests 22 passed (22)
exit 0
```

The new cases cover all five lanes for both synchronous throw and asynchronous rejection, raw-detail exclusion from `failClosed`, existing blocker-code preservation, initial lane invocation order, one fail-closed call per failure, and normal-mode non-rewriting.

## Regression evidence

```text
../../node_modules/.bin/vitest run \
  tests/direct-performance-probe.test.ts \
  tests/direct-performance.test.ts \
  tests/r22-direct-diagnostics-review-fix.test.ts \
  tests/r22-startup-lazy-red.test.tsx \
  tests/r22-startup-review-fixes.test.tsx \
  tests/startup-performance.test.ts
Test Files 6 passed (6)
Tests 59 passed (59)
exit 0

npm run check --workspace @copilot/desktop
exit 0

npm run build --workspace @copilot/desktop
exit 0
RENDERER_BUNDLE_VERIFIED: files=7

node_modules/.bin/vitest run --coverage \
  --config apps/copilot-desktop/tests/vitest.critical-coverage.config.ts
Test Files 50 passed (50)
Tests 757 passed (757)
All files: statements/lines 97.86%, branches 94.55%, functions 97.37%
exit 0

node_modules/.bin/vitest run --coverage \
  --config apps/copilot-desktop/tests/vitest.desktop-coverage.config.ts
Test Files 50 passed (50)
Tests 757 passed (757)
All files: statements/lines 77.38%, branches 88.25%, functions 92.85%
exit 0

node --check apps/copilot-desktop/dist/main/main.js
exit 0

git diff --check
exit 0
```

Canonical suites emitted existing non-failing React `act(...)`, jsdom canvas, and one future Vitest awaiting warning; none was introduced or altered in this bounded lane.

## Exact diff and hashes

```text
apps/copilot-desktop/src/main/direct-performance-probe.ts        | 81 ++++++++++++---
apps/copilot-desktop/tests/r22-startup-lazy-red.test.tsx         | 114 +++++++++++++++++++++
2 files changed, 181 insertions(+), 14 deletions(-)
```

```text
719724e280152b7fe05f0cb1e40a3c551200c9da00fefdd04c14e60d0fa48fae  apps/copilot-desktop/src/main/direct-performance-probe.ts
903583d37f530eda22d24f91c87fcc81448b1803926354c86fe48be3f0e8d581  apps/copilot-desktop/tests/r22-startup-lazy-red.test.tsx
```

No candidate directory (`r22`–`r27`) was modified and `r28` was not created.
