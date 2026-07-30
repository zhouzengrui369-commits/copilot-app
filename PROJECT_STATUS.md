# PROJECT STATUS

## Current Stage

R28 Clean Candidate Preparation / R26 Static Full-Suite Contract PASS.

Current branch/base:

- branch: `codex/p0-owner-gate`
- Git baseline: GitHub `main@96c861706126317c27965fcb64c765973df9ac89`
- latest materialized P0+P1 product/test commit:
  `bd82407dc63fd278c0523f46bcf0e96c5344fd9b`
- latest committed product head, including the macOS build-order repair:
  `1167cdc55a3fa7601516edeb61a9f4fb19ecd1c2`
- latest committed receipt/TSC repair:
  `ee8e207b44fc5091564f292ac130d8f0bd9a492b`
- latest committed R19 test-only harness repair:
  `54cd07ec631872f9b1fd45a5c426a4fe57f3d92b`
- latest committed R22 focused-Electron producer-isolation repair:
  `92510816932d0683e95a148789227c6cda0d55a3`
- R23 governance commit:
  `2595860e3bf880ea6e357fb197153abf30b09652`
- latest committed R26 full-suite E2E contract repair:
  `deaa24fade215f0581a30f6e617bdb4362d5f22d`
- worktree: `/Users/njx/openclaw/copilot.wt-S15C`

## Verdict

`BLOCKED / R24_REJECTED_GATE_10_FULL_ELECTRON_FAILED /
R26_INDEPENDENT_REVIEW_PASS / R26_STATIC_113_OF_113_DISCOVERED /
NEW_CLEAN_CANDIDATE_NOT_BUILT / INDEPENDENT_RETEST_PENDING /
RELEASE_BASELINE_RED / MVP_NOT_COMPLETE`

r3 remains frozen at commit `2b832c20b93e07ee68b6b325dc3ad758986b7f69`
as a Desktop product-layer input. Accepted EXP-COP-008 and EXP-COP-009
product/test bytes are materialized together at
`bd82407dc63fd278c0523f46bcf0e96c5344fd9b`. This commit is not a candidate
PASS, release evidence, or MVP completion.

Latest focused review facts:

- PR: `https://github.com/zhouzengrui369-commits/copilot-app/pull/9`
- focused report: `https://github.com/zhouzengrui369-commits/copilot-app/blob/31dfd0c7f9feca77da82f4a02bf359d85818742c/reports/product-review/2026-07-28-copilot-focused-retest.md`
- verdict: `NOT_READY / BLOCKED_EXP_COP_008 / P0=1 / P1=6 / P2=3`

## R18/R19 Current Truth

- R18 proved the supported offline package path:
  `--config.electronDist=$RUN/electron-dist`. Packaging passed, but the focused
  packaged Electron gate hung before settings credential save completed.
  Therefore R18 did not establish an accepted candidate, artifact SHA256, or
  runtime ID.
- R19 diagnosed a test-harness asymmetry: packaged E2E omitted
  `--use-mock-keychain`, so a synthetic E2E credential entered the real macOS
  `safeStorage`/Keychain path and left the settings IPC unresolved.
- R19 changes only two test-harness files; production code is unchanged:
  - fixture:
    `b9e0d32b23bcf82e0c03f05855cb741b3b3931a5e196cb0aac9e36f992044df5`;
  - unit test:
    `ed3b85357c8b347669c4888613dac55f6ca16d6bac4bb4f9d065d0504f1bdbf9`.
- Independent implementation rereview:
  `PASS / P0=0 / P1=0 / P2=0`.
- Truth labels:
  `PACKAGED_E2E_MOCK_KEYCHAIN` and
  `REAL_MACOS_KEYCHAIN_RUNTIME_NOT_PROVEN`.
- The initial controller wrapper recorded `RESOURCE_DEFER_NO_TEST` before the
  command started, so that wrapper consumed no GREEN attempt.
- The successor then ran the exact command once:
  `/usr/local/bin/npm run test --workspace @copilot/desktop --
  tests/electron-fixture-window-readiness.test.ts --minWorkers=1
  --maxWorkers=1`. It exited `0` with `1 file / 15 tests PASS`;
  current status is `GREEN_15_OF_15_PASS`, with no retry and no Electron run.

## R20–R26 Current Truth

- R20 is rejected. Gates 1–7 passed, but Gate 8 focused Electron returned
  `1 passed / 1 failed`; Gates 9–11 did not run, retry remained zero, and no
  candidate was established.
- R20 source snapshot SHA256 is
  `bf44aa2a14e5a42a13221d94e721982a45abfd88322f431c986e7a8d56a29aec`.
  Its intermediate artifact SHA256
  `2826ff86a700096217086cc82a91edaf2bd09eb02ed7159b6061e79cab1b287b`
  is explicitly not a candidate artifact.
- R21 identified `TEST_HARNESS_ISOLATION_DEFECT`: worker-scoped shared
  userData let EXP-COP-009's note and Todo contaminate EXP-COP-008's exact
  source assertion. Diagnosis SHA256:
  `55c75a2669906d71d7a0cddb974cc7bef6aa696b337f045b40fc390311832ad4`.
- R22 added test-producer isolation at
  `<workerRoot>/producers/<producer>` and committed the exact four-file repair
  at `92510816932d0683e95a148789227c6cda0d55a3`.
- R22 independent review returned `PASS / P0=0 / P1=0 / P2=0`.
  Controller RED ran once and returned `4 failed / 15 passed`, exit `1`.
  Controller GREEN ran once and returned `1 file / 19 tests PASS`, exit `0`,
  duration `3.45s`. The desktop main/renderer/tests TSC check also passed once,
  exit `0`.
- R22 changes only test-harness data ownership. It does not change product
  persistence or provide candidate-bound Electron runtime proof.
- R23 bound the R20 rejection and R22 repair into governance commit
  `2595860e3bf880ea6e357fb197153abf30b09652`.
- R24 was a new clean candidate attempt from R23. Gates 1–9 passed, including
  offline arm64 packaging and focused packaged Electron `2/2 PASS`. Gate 10
  stopped on `33 passed / 7 failed / 73 not run`, exit `1`; Gate 11 did not
  run and retry remained zero. No candidate was established.
- R24 source snapshot SHA256 is
  `c9bdd37c443dd696e1771244db063b33afef3c95c50e742b4938d512a7a798f0`.
  Its intermediate artifact SHA256
  `03f81b4a415e7a631b2118376c7e4335182949c60dfdcda7973283424083f527`
  is explicitly not a candidate artifact.
- R25 primary and independent diagnoses agreed that Gate 10 exposed six stale
  E2E contracts and one missing screenshot-output environment, not a
  production/provider regression. Diagnosis SHA256 values are
  `ed15d2be355157cb44dcdd2071d7951bd7249a985a96bf03d25ee0c30e40f088`
  and
  `fbb58b14ac619578ced89febd4c41aa66cc0951e7057de2285437a43305fe3ea`.
- R26 repaired exactly seven E2E specs, with no production, fixture, config,
  package, or lockfile change. Independent review returned
  `PASS / P0=0 / P1=0 / P2=0`.
- R26 controller static gates ran once each: desktop main/renderer/tests TSC
  passed, exit `0`; list-only discovery passed exactly
  `113 tests in 9 files`, exit `0`. No Electron test case ran in R26.
- The seven-file R26 repair is committed at
  `deaa24fade215f0581a30f6e617bdb4362d5f22d`.
- Candidate commit, candidate artifact SHA256, runtime ID, deterministic
  candidate test-data manifest, independent candidate retest, Human Owner Gate,
  release, and MVP completion remain unset or blocked.

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

Commit this R24–R26 governance postimage separately from the already committed
seven-file test repair. Then create and independently review a fresh R28
clean-candidate runner derived mechanically from R24, changing only candidate
identity/lineage and the exact R26 Gate 10 screenshot environment. The next
attempt is not an R24 retry and must execute once with zero retry.
The exact R26 test-only repair is committed at
`deaa24fade215f0581a30f6e617bdb4362d5f22d`.
The later candidate must rerun exact `npm ci`, main/renderer/tests TSC, macOS
package, focused Electron, runner list proving `>=50`, and the eligible full
Electron gate.
Only those candidate-bound receipts may bind source commit, immutable source
snapshot, artifact SHA256, runtime ID, deterministic test-data manifest,
packaged Electron evidence and screenshots.

The release baseline remains red outside the accepted P0 slice. R24 did run the
project-wide full Electron gate, but it failed before completion and therefore
did not replace the older `globalGate=NOT_RUN` development receipt with a
passing candidate-bound receipt. The next clean candidate must rerun the full
eligible gate and reach all 113 discovered tests before independent retest.

## Deferred Scope

Do not start Windows, Remote/Backup expansion, major dependency upgrades, or visual redesign in this stage.
