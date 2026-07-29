# TASK — EXP-COP-008 regression closure R2

## Context

The R1 focused journey passed, but independent review rejected acceptance:

1. `ScheduleWorkspace` replaced the already accepted execution-log and notes
   interaction with only title/body/due/source editing.
2. R1 Electron E2E did not prove:
   - blank-due Todo remains discoverable under `未安排` after full restart;
   - an explicit due date appears under the selected day;
   - a persisted source is actually clicked and reopened;
   - multi-source preservation;
   - partial/failed/cancelled Ask states cannot create a Todo;
   - the completed exchange used for creation remains immutable.
3. Several existing Schedule/Today tests now fail because the new interaction
   broke or silently replaced their accepted contract.

R1 task:
`tasks/openclaw/2026-07-29-exp-cop-008-todo-canonical-closure-r1/`

## Allowed production files

- `apps/copilot-desktop/src/renderer/workspaces/ScheduleWorkspace.tsx`
- `apps/copilot-desktop/src/renderer/workspaces/ScheduleWorkspace.module.css`
- `apps/copilot-desktop/src/renderer/workspaces/AskWorkspace.tsx`
- `apps/copilot-desktop/src/renderer/workspaces/AskWorkspace.module.css`
- `apps/copilot-desktop/src/renderer/lib/copilot-api.ts`
- `apps/copilot-desktop/src/main/local-knowledge-service.ts`

Use fewer files when possible. Do not change a production file unless a RED
test proves the need.

## Allowed test files

- `apps/copilot-desktop/tests/exp-cop-008-todo-closure-r1.test.tsx`
- `apps/copilot-desktop/tests/todo-canonical-persistence-r1.test.ts`
- `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts`
- `apps/copilot-desktop/tests/r44-h1-schedule-owner-feedback.test.tsx`
- `apps/copilot-desktop/tests/r44-h4-today-product-experience.test.tsx`
- `apps/copilot-desktop/tests/coverage-renderer-critical.test.tsx`
- `apps/copilot-desktop/tests/VoiceWorkspace.local-asr-draft.test.tsx`
- `apps/copilot-desktop/tests/reversible-trash-ui-r1.test.tsx`

## Required product behavior

1. Canonical truth remains main-process local persistence plus readback.
2. Blank due is supported only through a discoverable `未安排` scope.
3. `查看待办` opens the exact created ID, expands it, and keeps local source
   links actionable.
4. Title, notes/body, due date, source links, and execution log survive full
   Electron exit/relaunch.
5. Restore execution-log and notes UX durably. Do not restore page-memory
   semantics. A minimal structured encoding inside the existing Todo body is
   acceptable if it is deterministic, backward-compatible, and tested.
6. Preserve accessibility and prior product contracts:
   - one accessible `待办列表`;
   - selected-day empty copy remains explicit;
   - one fail-closed error surface per failed action;
   - trash/delete routing remains reachable.
7. Ask create action is available only for one completed, grounded, immutable
   exchange whose sources are all `LOCAL_PRESENT`.
8. Multi-source Todos preserve every local source; partial, cancelled, failed,
   zero-source, or stale exchanges cannot show success.
9. Persistence/readback/source-open failure must not show success.

## Forbidden

- no EXP-COP-009 implementation;
- no browser fixture or mock result as Electron proof;
- no localStorage/sessionStorage;
- no cloud, provider, KG, ASR, package, dependency, backup, remote, or Windows
  changes;
- no broad UI redesign;
- no deletion of accepted capabilities;
- no Git commit/push/PR;
- no credential access;
- do not touch the original dirty checkout.

## Required RED → GREEN

First run the exact currently failing Schedule/Today compatibility tests and
record RED. Then implement the smallest repair and run:

```text
npm run test --workspace @copilot/desktop -- \
  tests/todo-canonical-persistence-r1.test.ts \
  tests/exp-cop-008-todo-closure-r1.test.tsx \
  tests/r44-h1-schedule-owner-feedback.test.tsx \
  tests/r44-h4-today-product-experience.test.tsx \
  tests/coverage-renderer-critical.test.tsx \
  tests/VoiceWorkspace.local-asr-draft.test.tsx \
  tests/reversible-trash-ui-r1.test.tsx \
  tests/integration/local-first-domain-ipc.integration.test.ts
```

Run renderer TypeScript and desktop build.

Run the exact real Electron R1 spec with the app-local Electron 38.8.6
executable and ABI-139 binding. Expand the spec to prove both blank-due and
explicit-due journeys, actual source click, edit, full quit, and restart
readback. The test must use one current-source candidate and isolated userData.

After focused GREEN, run `npm run test:copilot-desktop` once. Save the exact
machine-readable failure inventory. Any remaining failures must be classified
file-by-file as:

- `R2_REGRESSION`
- `EXECUTION_BRIDGE`
- `BASELINE_OR_UNRELATED_UNPROVEN`

Do not call the task PASS while an R2 regression remains.

## Deliverables

Update this task folder:

- `RESULT.md`
- `EVIDENCE.md`
- `commands.log`
- `changed-files.txt`
- `DISPATCH_STATUS.md`
- `ACCEPTANCE_LOG.md`

Update project handoff files in the same bounded change:

- `PROJECT_STATE.yaml`
- `PROJECT_STATUS.md`
- `TODO.md`
- `CHANGELOG.md`
- `docs/ARCHITECTURE.md` and `DECISIONS.md` only if architecture/decision
  semantics changed.

## Acceptance

Only report `FOCUSED_DEVELOPMENT_ACCEPTANCE_PASS` when all required focused
tests and the expanded real Electron quit/relaunch journey pass. Keep
`MVP_NOT_COMPLETE`, `OWNER_GATE_NOT_ELIGIBLE`, and no candidate identity until
the controller accepts a clean committed candidate.
