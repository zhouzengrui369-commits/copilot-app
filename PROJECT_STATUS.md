# PROJECT STATUS

## Current Stage

Clean Candidate Materialization / Stage 3.

Current branch/base:

- branch: `codex/p0-owner-gate`
- Git baseline: GitHub `main@96c861706126317c27965fcb64c765973df9ac89`
- latest materialized P0+P1 product/test commit:
  `bd82407dc63fd278c0523f46bcf0e96c5344fd9b`
- governance base commit: `bd82407dc63fd278c0523f46bcf0e96c5344fd9b`
- worktree: `/Users/njx/openclaw/copilot.wt-S15C`

## Verdict

`BLOCKED / EXP-COP-008_DEVELOPMENT_ACCEPTANCE_PASS /
EXP-COP-009_DEVELOPMENT_ACCEPTANCE_PASS / CLEAN_CANDIDATE_NOT_BUILT /
INDEPENDENT_RETEST_PENDING / RELEASE_BASELINE_RED / MVP_NOT_COMPLETE`

r3 remains frozen at commit `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
as a Desktop product-layer input. Accepted EXP-COP-008 and EXP-COP-009
product/test bytes are materialized together at
`bd82407dc63fd278c0523f46bcf0e96c5344fd9b`. This commit is not a candidate
PASS, release evidence, or MVP completion.

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

- `EXP-COP-009`: one versioned latest-completed grounded Ask exchange is
  persisted in the local Electron main process; exact source/full-reader
  navigation, explicit return, route change, renderer remount and same-userData
  quit/relaunch preserve the same question, terminal answer, sources and
  canonical Todo receipt/action.
- source and Todo truth is revalidated on load; missing, stale, corrupt,
  unsafe, nonterminal or mismatched state fails closed.
- final controller receipt: main and renderer TSC PASS; five focused files /
  28 tests PASS; exact tests TSC remains exit 2 with zero diagnostics in the
  two R3d target files and only separated pre-existing diagnostics elsewhere.
- active R3c Electron evidence is one focused 1/1 PASS run with two clean child
  exits; its wrapper explicitly records `globalGate=NOT_RUN`.
- this is development acceptance only. Independent product-experience retest
  remains pending.

Old source/runtime IDs are not reproducible and must not be reused. New candidate, runtime ID, artifact SHA256, package identity, screenshots, and Electron evidence remain unset.

## Next Single Action

Materialize the accepted P0+P1 product/test commit and the separate governance
commit, prove the resulting source tree clean, then build one new unsigned
macOS focused-retest candidate. Bind the clean source commit, immutable source
snapshot, artifact SHA256, runtime ID, deterministic test-data manifest,
packaged Electron evidence and screenshots before asking the independent
product-experience thread for Focused Retest.

The release baseline remains red outside the accepted P0 slice. R3 classified
30 existing baseline/evidence failure records; complete Electron package
resolution exposed one additional existing r22 literal-shell assertion. These
remain release blockers and are not hidden by the focused P0/P1 development
passes. The active R3c receipt also states `globalGate=NOT_RUN`; the required
project-wide real Electron minimum of 50 has not been run.

## Deferred Scope

Do not start Windows, Remote/Backup expansion, major dependency upgrades, or visual redesign in this stage.
