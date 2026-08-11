# EVIDENCE

## Executor preflight

- MiniMax/Mavis: unavailable at `127.0.0.1:15321`.
- OpenClaw Gateway: health PASS.
- OpenClaw worker session:
  `agent:worker:copilot-exp-cop-008-r1`
- session id: `4325994b-7a8e-431e-a147-4e3571042782`
- resume run: `copilot-exp-cop-008-r1-resume-1`, accepted.

## Blocking evidence

The resumed worker attempted bounded reads/commands, but no executor route was
usable:

- `SYSTEM_RUN_DENIED: allowlist miss`
- `exec host=node requires a paired node (none available)`
- alternate host values were not allowed.

This is an executor failure, not a product implementation or acceptance
failure. No product/test file was modified by OpenClaw.

## Current source

- branch: `codex/p0-owner-gate`
- HEAD: `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
- product source remains frozen at that commit.
- only project-state documents were dirty before fallback routing.

## Next evidence required

The attempted external GPT CLI fallback was rejected by platform policy before
execution because private workspace export was not allowed. The controller did
not retry or work around that policy.

One internal Codex sub-agent has therefore been assigned the same exact
contract inside the shared workspace. It must populate current changed files, RED/GREEN
commands, focused Electron evidence, canonical Todo readback, full
quit/relaunch recovery, and fail-closed negative cases before this task can be
accepted.

## RED evidence — canonical Todo persistence

- exact test:
  `apps/copilot-desktop/tests/todo-canonical-persistence-r1.test.ts`
- command exit: `1`
- result: `7 tests / 6 failed / 1 passed`
- failed create cases:
  absent readback, wrong ID, mismatched body all resolved instead of rejecting.
- failed update cases:
  absent readback, wrong ID, mismatched body all resolved instead of rejecting.
- classification: confirmed `EXP-COP-008` false-success defect.
- dependency boundary: the controller added an ignored worktree
  `node_modules` link to the existing local dependency tree only for offline
  execution. It is not candidate or package evidence.

## GREEN evidence — canonical Todo persistence

- command: `npm run test --workspace @copilot/desktop -- tests/todo-canonical-persistence-r1.test.ts`
- exit: `0`
- result: `1 test file / 7 tests / 7 passed`
- production behavior: create/update now returns only a canonical Todo re-read
  from storage; absent ID, wrong ID, or mismatched title/body/due/status/source
  links fail closed with `TODO_CANONICAL_READBACK_FAILED`.

## Focused renderer and integration evidence

- exact focused set:
  `todo-canonical-persistence-r1`,
  `exp-cop-008-todo-closure-r1`,
  `r44-h4e-today-product-polish`,
  `r44-h4c-knowledge-truth-reader`, and
  `local-first-domain-ipc.integration`
- exit: `0`
- result: `5 files / 33 tests / 33 passed`
- renderer TypeScript direct check: exit `0`
- desktop build: exit `0`
- native binding probe: `1/1` passed

## Electron executor identity

The first focused Electron attempt resolved the root dependency bridge's
Electron `33.4.11` (`NODE_MODULE_VERSION=130`). The current native binding and
app-local Electron require ABI `139`, so the attempt failed closed as
`LOCAL_STORAGE_NATIVE_UNAVAILABLE`. This was executor drift, not a product
success or retryable assertion.

The accepted focused run explicitly bound:

- executable:
  `/Users/njx/openclaw/copilot/apps/copilot-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
- Electron: `38.8.6`
- modules ABI: `139`
- task-owned binding:
  `run/native/better_sqlite3.node`
- binding SHA256:
  `77907e9952f0d2a4d2d6a751f8828cab96ab132dd52d6610cb0e9a7192f28696`
- binding constraints: regular file, mode `0600`, `nlink=1`

No diagnostic production bypass remains in the final diff.

## Focused real Electron evidence

- exact test:
  `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts`
- JSON receipt:
  `/private/tmp/exp-cop-008-playwright.json`
- exit: `0`
- result: `1/1` passed
- test duration: `3520ms`
- suite duration: `3996.268ms`
- journey:
  real local note/WIKI/grounded source → Ask → blank due/Unscheduled →
  canonical `查看待办` → persisted title/body/due/source edit → full Electron
  close → relaunch with identical userData → canonical UI readback.

## Global baseline evidence

- command: `npm run test:copilot-desktop`
- exit: `1`
- result: `19 files failed / 104 passed`; `42 tests failed / 1266 passed`
- classification: global baseline red; failures include release/static-shell,
  backup/remote/trash, Knowledge/materialization, dependency-resolution, and
  other unrelated or pre-existing lanes.
- contract consequence: stopped before full real Electron E2E.

The tests TypeScript/global check also remains red on existing
`import.meta.env` type declarations, existing H4C optional-array checks, and
duplicate Vite/Vitest plugin types introduced by the execution dependency
bridge. This is recorded, not converted into task PASS.

## Truth boundary

- current source postimage SHA256:
  - `local-knowledge-service.ts`: `d6f405cbb4395c0e613af5f406e5391b5d59213f7555c3aa7a01e9024722099d`
  - `App.tsx`: `c590ab57f7d867da1e1ddbef5da1497e91d2bd59e3c75ee6a9806b046b0c6eb9`
  - `copilot-api.ts`: `d2a4357bcacd0340b62338b15d0c7d4bcee7df9017e21421ae0e8c2a3ccdadea`
  - `AskWorkspace.tsx`: `1105bbe5249256fa36c79cfb9673381aad4db89c6d1b932a0e4596fbe6fcd691`
  - `ScheduleWorkspace.tsx`: `ff81579a462ed40cbcb4ba0f0d2fceb7dac109307eea26ac80a0771f5e0260f9`
- `PROJECT_STATE.yaml` remains without candidate commit, artifact SHA, or
  runtime ID.
- independent product experience retest: not run.
- Owner gate: not eligible from this task alone.
- final project status: `BLOCKED / MVP_NOT_COMPLETE`.
