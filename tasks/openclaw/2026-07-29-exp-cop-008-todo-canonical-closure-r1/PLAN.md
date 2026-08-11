# PLAN

`IMPLEMENTATION_COMPLETE / FOCUSED_ACCEPTANCE_PASS / GLOBAL_BASELINE_RED / MVP_NOT_COMPLETE`

## Preconditions

- workspace: `/Users/njx/openclaw/copilot.wt-S15C`
- branch: `codex/p0-owner-gate`
- required and observed HEAD:
  `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
- pre-existing dirty files are governance-only:
  `CHANGELOG.md`, `DECISIONS.md`, `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`,
  and `TODO.md`
- OpenClaw executor blocker evidence is retained in this task directory.

## Ordered implementation

1. Add RED unit/integration coverage for canonical create/update readback:
   absent object, wrong ID, and critical-field mismatch must fail closed.
2. Make main-process Todo create/update return only verified canonical local
   truth.
3. Preserve Todo body through the renderer adapter.
4. Add one immutable completed-grounded-exchange action in Ask:
   confirmation, optional due date, all verified sources, one list readback,
   fail-closed receipt, and “查看待办”.
5. Route the exact returned Todo ID into Schedule.
6. Add selected-day / All / Unscheduled discovery without replacing the
   accepted Today layout. Focus and expand the exact requested ID.
7. Replace page-memory Todo detail with persisted title/body/due editing and
   canonical readback verification; keep source links clickable.
8. Add real Electron E2E using the existing grounded fake provider and an
   isolated same-userData full quit/relaunch.
9. Run the mandatory commands in contract order, stopping at the first
   unrecorded failure.
10. Update task evidence and project handoff documents without claiming owner
    acceptance, candidate, release, or MVP readiness.

## Execution outcome

- Steps 1–8 completed for the exact EXP-COP-008 lane.
- Focused unit, renderer, integration, build, and real Electron quit/relaunch
  checks passed.
- The repository-wide desktop test command failed on the pre-existing/global
  suite, so the ordered contract stopped before the full Electron suite.
- Controller review, a clean committed candidate, and independent product
  experience retest remain pending.

## Boundaries

- no EXP-COP-009 implementation
- no shared domain/IPC/preload change unless a real compile blocker proves the
  existing contract insufficient; if so, stop as `BLOCKED`
- no package, dependency, lockfile, provider, cloud, ASR, Windows, Git, network,
  credentials, signing, or release work
- no second implementation lane

## Acceptance risks

- The browser prototype and renderer remount are not Electron persistence
  proof; the final focused E2E must close and relaunch Electron with the same
  isolated userData.
- A persisted write followed by mismatched readback may leave local bytes, but
  the UI must fail closed and must not claim success.
- Full suite failures outside the exact changed scope must be recorded as
  residual baseline failures, never hidden or converted to PASS.
