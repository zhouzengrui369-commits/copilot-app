# PROJECT STATUS

## Current Stage

Clean Candidate Materialization / Receipt Governance Bind.

Current branch/base:

- branch: `codex/p0-owner-gate`
- Git baseline: GitHub `main@96c861706126317c27965fcb64c765973df9ac89`
- latest materialized P0+P1 product/test commit:
  `bd82407dc63fd278c0523f46bcf0e96c5344fd9b`
- latest committed product head, including the macOS build-order repair:
  `1167cdc55a3fa7601516edeb61a9f4fb19ecd1c2`
- latest committed receipt/TSC repair:
  `ee8e207b44fc5091564f292ac130d8f0bd9a492b`
- governance base commit: `d9ee8f5fc5cc6a07a441a0131afd2324f1b7b6bb`
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

Electron candidate receipt/TSC repair (2026-07-30):

- R1 implemented the seven-file receipt contract. Its valid RED receipt was
  `7 failed / 22 passed`; the bounded GREEN rerun was `2 files / 29 tests
  PASS`. Tests TSC was initially blocked by the borrowed dependency tree.
- R3 removed the stale dependency symlink, ran exact
  `npm ci --ignore-scripts` (`exit 0`, `added 1454 packages in 3m`), then built
  `@copilot/llm-client`, `@copilot/kb`, `@copilot/kg`, and `@copilot/rag` in
  order with `exit 0`. The receipt slice remained `29/29 PASS`. Tests TSC then
  exposed exactly four source diagnostics.
- R4 added the test-side `vite/client` type and made the one optional note tag
  access fail-safe. Tests TSC passed; `3 files / 40 tests PASS`; focused
  diff-check and forbidden scan passed.
- R5 independent source review returned
  `FAIL / P1_MANUAL_LAUNCH_OWNERSHIP_GAP / MVP_NOT_COMPLETE`: readiness failure
  could occur before the caller owned the Electron process, and recorder flush
  could skip provider cleanup.
- R6 introduced one shared launch/receipt owner. It records runtime immediately
  after launch, closes and records process state before rethrowing the original
  readiness error, avoids duplicate runtime rows, and guarantees provider
  cleanup. Tests TSC passed; `2 files / 30 tests PASS`; focused diff-check and
  scan passed.
- R7 independent read-only re-review returned
  `PASS / P1_CLOSED / MVP_NOT_COMPLETE`, with no remaining P0/P1 in the complete
  nine-file diff. R7 did not replace or rerun the R6 command receipts.
- Stage A committed those exact nine files at
  `ee8e207b44fc5091564f292ac130d8f0bd9a492b`.

The focused profile remains exactly `exp-cop-008-009-focused`: exactly two
tests and the exact producers `exp-cop-008` and `exp-cop-009`. Runtime and
process receipts are exclusively owned per producer. The full gate is
unchanged and still requires at least 50 real Electron tests plus its required
manual and fixture-worker producers.

This repair is source acceptance only. No clean candidate, package, artifact
SHA256, runtime ID, candidate-bound Electron run, independent product
experience retest, owner gate, release, or MVP PASS exists yet.

macOS build-order contract repair (2026-07-30):

- `apps/copilot-desktop/package.json` defines one ordered
  `build:workspace-deps` chain for `@copilot/llm-client`, `@copilot/kb`,
  `@copilot/kg`, and `@copilot/rag`; every macOS distribution script invokes
  it before the desktop build.
- its product repair remains committed at
  `1167cdc55a3fa7601516edeb61a9f4fb19ecd1c2`.
- R3's exact install and ordered builds close the earlier executor dependency
  blocker for the receipt repair, but they are not candidate-bound package
  evidence and must be rerun from the clean candidate.

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

Commit this governance postimage after receipt/TSC repair commit
`ee8e207b44fc5091564f292ac130d8f0bd9a492b`, then reuse the existing candidate
worktree to create a clean candidate from that governance HEAD. Run exact
`npm ci`, main/renderer/tests TSC, macOS package, focused Electron, runner list
proving `>=50`, and the eligible full Electron gate. Only after those pass may
the flow bind the clean source commit, immutable source snapshot, artifact
SHA256, runtime ID, deterministic test-data manifest, packaged Electron
evidence and screenshots.

The release baseline remains red outside the accepted P0 slice. R3 classified
30 existing baseline/evidence failure records; complete Electron package
resolution exposed one additional existing r22 literal-shell assertion. These
remain release blockers and are not hidden by the focused P0/P1 development
passes. The active R3c receipt also states `globalGate=NOT_RUN`; the required
project-wide real Electron minimum of 50 has not been run.

## Deferred Scope

Do not start Windows, Remote/Backup expansion, major dependency upgrades, or visual redesign in this stage.
