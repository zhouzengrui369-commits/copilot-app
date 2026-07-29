# PROJECT STATUS

## Current Stage

Owner Gate P1 Closure / Stage 2 EXP-COP-009.

Current branch/base:

- branch: `codex/p0-owner-gate`
- Git baseline: GitHub `main@96c861706126317c27965fcb64c765973df9ac89`
- latest materialized product commit: `0c69b8643ca4dcf20a86623f2528195a34f402a4`
- worktree: `/Users/njx/openclaw/copilot.wt-S15C`

## Verdict

`BLOCKED / EXP-COP-008_DEVELOPMENT_ACCEPTANCE_PASS /
EXP-COP-009_IN_PROGRESS / INDEPENDENT_RETEST_PENDING / MVP_NOT_COMPLETE`

r3 remains frozen at commit `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
as a Desktop product-layer input. Accepted EXP-COP-008 product/test bytes are
committed separately at `0c69b8643ca4dcf20a86623f2528195a34f402a4`.
Neither commit alone is a candidate PASS, release evidence, or MVP completion.

Latest focused review facts:

- PR: `https://github.com/zhouzengrui369-commits/copilot-app/pull/9`
- focused report: `https://github.com/zhouzengrui369-commits/copilot-app/blob/31dfd0c7f9feca77da82f4a02bf359d85818742c/reports/product-review/2026-07-28-copilot-focused-retest.md`
- verdict: `NOT_READY / BLOCKED_EXP_COP_008 / P0=1 / P1=6 / P2=3`

## Open Gates

P0 development acceptance:

- `EXP-COP-008`: canonical create/readback, All/Unscheduled discovery, exact
  “查看待办”, title/due/source edit, durable notes/execution logs, two-source
  alignment, exact source summary/full reader, selected-day discovery, and
  full Electron quit/relaunch readback pass.
- final current-source Electron journey: `1/1 PASS`, `13.3s`.
- focused desktop slice: `69/69 PASS`; renderer TSC and desktop build PASS.
- global R3 classification: 37 failure records, current P0 regression `0`,
  unclassified `0`; seven execution-resolution records were separately driven
  into behavior, leaving one existing r22 literal-shell assertion.
- independent product-experience retest remains pending until EXP-COP-009 and a
  clean candidate identity are ready.

P1 first:

- `EXP-COP-009`: opening a source and returning clears the current Ask question, answer, sources, and actions.

Old source/runtime IDs are not reproducible and must not be reused. New candidate, runtime ID, artifact SHA256, package identity, screenshots, and Electron evidence remain unset.

## Next Single Action

Implement the frozen EXP-COP-009 Ask → source summary/full reader → explicit
return contract, preserving the same question, answer, sources, Todo receipt,
and action entry across route changes and full restart. Then bind P0 and P1 to
a clean committed candidate for independent Focused Retest.

The release baseline remains red outside the accepted P0 slice. R3 classified
30 existing baseline/evidence failure records; complete Electron package
resolution exposed one additional existing r22 literal-shell assertion. These
remain release blockers and are not hidden by the P0 PASS.

## Deferred Scope

Do not start Windows, Remote/Backup expansion, major dependency upgrades, or visual redesign in this stage.
