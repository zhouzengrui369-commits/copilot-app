# TASK — EXP-COP-008 Todo Canonical Closure R1

## Authority

- workspace: `/Users/njx/openclaw/copilot.wt-S15C`
- branch: `codex/p0-owner-gate`
- required preimage HEAD:
  `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
- GitHub baseline:
  `main@96c861706126317c27965fcb64c765973df9ac89`
- latest independent report:
  `/Users/njx/openclaw/copilot/reports/product-review/2026-07-28-copilot-focused-retest.md`
- current status remains `BLOCKED / MVP_NOT_COMPLETE`

Read `README.md`, `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`,
`docs/ARCHITECTURE.md`, `DECISIONS.md`, `CHANGELOG.md`, and the four v6.2
baseline files before editing.

## Product Decision

The existing domain and local persistence support `due_at_ms=null`.
Keep unscheduled Todo. Do not add a forced-due regression. Complete the missing
All/Unscheduled discoverability and canonical view/edit/restart contract.

## Required Behavior

1. Only a terminal completed answer whose complete source set is
   `LOCAL_PRESENT` may expose a working “转为待办” action.
2. Freeze the submitted question, final answer text, and all verified source
   paths as one immutable completed exchange. Editing the composer must not
   mutate the action payload.
3. The confirmation UI may edit title and optional due date. Empty due date
   means Unscheduled.
4. Persist answer text in Todo body and every verified source path in
   `note_links`.
5. Main-process create/update must read back the same canonical ID and verify
   title/body/due/status/source links. Missing or mismatched readback is an
   error.
6. Renderer must perform a single canonical list/readback by returned ID before
   showing success. Failure or mismatch must not display success.
7. Success receipt includes “查看待办”. It navigates to All, Unscheduled, or
   the corresponding day, focuses and expands the exact same Todo ID.
8. The expanded Todo supports real persisted editing of title, body, due date,
   and verified source links. Each save is read back and verified.
9. Source links remain clickable and open the exact local note.
10. Full Electron quit followed by relaunch with the same userData must recover
    the same Todo, body, due state, and source links.
11. No internal exception, fake object, stale object, fixture, or in-memory-only
    remount may be presented as a successful persisted Todo.

## Production Allowlist

Only these product files may change:

- `apps/copilot-desktop/src/main/local-knowledge-service.ts`
- `apps/copilot-desktop/src/renderer/lib/copilot-api.ts`
- `apps/copilot-desktop/src/renderer/App.tsx`
- `apps/copilot-desktop/src/renderer/workspaces/AskWorkspace.tsx`
- `apps/copilot-desktop/src/renderer/workspaces/AskWorkspace.module.css`
- `apps/copilot-desktop/src/renderer/workspaces/ScheduleWorkspace.tsx`
- `apps/copilot-desktop/src/renderer/workspaces/ScheduleWorkspace.module.css`

Do not modify shared domain/IPC/preload unless a RED compile failure proves the
existing typed contract cannot represent required canonical data. If that
happens, stop and report the exact blocker instead of widening scope.

## Test Allowlist

May create:

- `apps/copilot-desktop/tests/todo-canonical-persistence-r1.test.ts`
- `apps/copilot-desktop/tests/exp-cop-008-todo-closure-r1.test.tsx`
- `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts`

May modify:

- `apps/copilot-desktop/tests/integration/local-first-domain-ipc.integration.test.ts`
- `apps/copilot-desktop/tests/r44-h4c-today-blockers.test.tsx`
- `apps/copilot-desktop/tests/r44-h4e-today-product-polish.test.tsx`
- `apps/copilot-desktop/tests/e2e/schedule-privacy.spec.ts` only if the new
  All/Unscheduled entry changes an existing assertion.

Update in the same bounded change:

- `PROJECT_STATE.yaml`
- `PROJECT_STATUS.md`
- `TODO.md`
- `docs/ARCHITECTURE.md`
- `CHANGELOG.md`
- `DECISIONS.md`
- this task directory evidence files.

## Mandatory RED → GREEN Coverage

- create/update persistence succeeds but canonical readback is absent;
- readback returns wrong ID or mismatched critical fields;
- streaming/partial/cancelled/failed answer cannot create Todo;
- composer edits cannot combine a new question with an old answer;
- all verified sources are retained;
- empty due appears in Unscheduled and All;
- explicit due appears on the correct date and in All;
- “查看待办” navigates, focuses, and expands the exact ID;
- title/body/due/source edit survives canonical readback;
- full Electron quit/relaunch with same userData recovers the same object;
- source link reopens the exact local note;
- persistence/readback failure is visible and never says success.

## Commands

Run in this order, stopping on first failure and recording exact output:

1. `npm run check:copilot-desktop`
2. focused Vitest for new P0 tests plus changed existing tests
3. `npm run test:integration --workspace @copilot/desktop`
4. `npm run build --workspace @copilot/desktop`
5. focused real Electron E2E with grep `EXP-COP-008`
6. `npm run test:copilot-desktop`
7. full real Electron E2E only after focused checks pass
8. `git diff --check`

Do not retry a failing command without first recording and fixing its root
cause. Do not close applications or impose a hard resource threshold.

## Forbidden

- no EXP-COP-009 source-return implementation in this task;
- no Windows, cloud, Remote, Backup, provider, KG, ASR, or visual redesign;
- no dependency or lockfile upgrade;
- no copying the old overlay byte-for-byte;
- no mock answer or browser prototype as Electron proof;
- no credentials, network, real provider, upload, package, signing, release;
- no Git add/commit/push/PR;
- no modification of the original dirty worktree or review reports.

## Deliverables

Complete `PLAN.md`, `RESULT.md`, `EVIDENCE.md`, `commands.log`,
`changed-files.txt`, `DISPATCH_STATUS.md`, and `ACCEPTANCE_LOG.md`.

Report only `PASS`, `FAIL`, or `BLOCKED`. A worker PASS is not owner
acceptance; Codex will independently inspect the diff and rerun bounded checks.
