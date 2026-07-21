# Startup terminal causal-order fix

Status: PASS (source/test gate only; no candidate build or release claim)

## Scope

- Cause: `STARTUP_APP_ROOT_VISIBLE` reported both renderer terminal flags before `markAppRootVisibleIfComplete()`. When the window, release identity, and probe were already ready, the coordinator could publish `terminalReady` before the `appRootVisible` milestone was written.
- Fix: move `markAppRootVisibleIfComplete()` before the handler's explicit `startupCoordinator.reportTerminal(...)` call. This keeps the invisible-window cache path: the helper first reports `nativeWindowVisible: false`, then the explicit call caches both renderer flags. It also keeps the direct-probe terminal report inside the helper.
- Product source changed: `apps/copilot-desktop/src/main/main.ts` only.
- Test changed: `apps/copilot-desktop/tests/r22-startup-lazy-red.test.tsx` only.
- No performance config/controller, probe attribution, settings, package/lock, candidate, signing, notarization, finalizer, GUI, or raw evidence change.

## Test-first evidence

RED, before source reorder:

```text
tests/r22-startup-lazy-red.test.tsx: 22 passed, 1 failed
expected 3 to be less than 2
```

The failing AST-bound assertion located the real `registerIpc()` listener for `IPC_CHANNELS.STARTUP_APP_ROOT_VISIBLE` and proved `markAppRootVisibleIfComplete()` followed the explicit coordinator terminal report.

GREEN, after source reorder:

```text
tests/r22-startup-lazy-red.test.tsx: 23/23 passed
related startup/probe tests: 39/39 passed
```

The same test also drives a coordinator terminal-ready callback and asserts the app-root milestone state is already marked when that callback observes readiness.

## Required verification

| Gate | Result |
|---|---|
| `npm run check --workspace @copilot/desktop` | PASS |
| `npm run build --workspace @copilot/desktop` | PASS; renderer verifier `files=7` |
| Desktop global canonical coverage | PASS; 50 files, 765/765 tests; S 77.70%, B 88.52%, F 93.17%, L 77.70% |
| Desktop critical canonical coverage | PASS; 50 files, 765/765 tests; S 97.86%, B 94.55%, F 97.37%, L 97.86%; per-file threshold satisfied |
| `git diff --check` on both scoped files | PASS |

Existing test-suite warnings (`act(...)`, unawaited rejection deprecation, jsdom canvas) remained non-fatal and were outside this bounded fix.

## Current SHA256

```text
773bc49302c0ce7074ead28f340b9b8ec65e1a16ca04d00cf6924f08cbb8558a  apps/copilot-desktop/src/main/main.ts
4e2159bfa60fbad2b02e4671fc3b1b3c6ce2afa6e2a3cf6951f4f4365cf189ce  apps/copilot-desktop/tests/r22-startup-lazy-red.test.tsx
```

The workspace already contained other uncommitted Phase 1 changes. They were preserved and were not attributed to this repair. No r30 candidate was built.
