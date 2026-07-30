# CHANGELOG

## 2026-07-30

- Recorded R18 truth: supported offline `electronDist` packaging passed, but
  focused packaged Electron failed before settings credential save completed;
  no candidate, artifact SHA256, or runtime ID was established.
- Diagnosed and repaired the R19 packaged-E2E launch harness without changing
  production code. Exact postimages are fixture
  `b9e0d32b23bcf82e0c03f05855cb741b3b3931a5e196cb0aac9e36f992044df5`
  and unit test
  `ed3b85357c8b347669c4888613dac55f6ca16d6bac4bb4f9d065d0504f1bdbf9`.
- Independent implementation rereview returned
  `PASS / P0=0 / P1=0 / P2=0`.
- Bound the evidence labels `PACKAGED_E2E_MOCK_KEYCHAIN` and
  `REAL_MACOS_KEYCHAIN_RUNTIME_NOT_PROVEN`. The initial controller wrapper
  preserved `RESOURCE_DEFER_NO_TEST` before command start and consumed no
  attempt. Its successor ran
  `/usr/local/bin/npm run test --workspace @copilot/desktop --
  tests/electron-fixture-window-readiness.test.ts --minWorkers=1
  --maxWorkers=1` exactly once: exit `0`, `1 file / 15 tests PASS`,
  `GREEN_15_OF_15_PASS`, no retry and no Electron.
- Committed the exact two-file R19 test-only repair at
  `54cd07ec631872f9b1fd45a5c426a4fe57f3d92b`; candidate, artifact SHA256 and
  runtime ID remain unset.
- Committed the exact nine-file Electron receipt/TSC repair at
  `ee8e207b44fc5091564f292ac130d8f0bd9a492b`.
- R1 established the fixed focused receipt contract and moved its bounded
  receipt suite from valid RED (`7 failed / 22 passed`) to GREEN (`29/29`).
  R3 then completed exact dependency installation and ordered workspace builds.
- R4 closed four tests-TSC diagnostics and passed `3 files / 40 tests`.
  Independent R5 correctly rejected a manual-launch ownership and provider
  cleanup gap.
- R6 centralized launch ownership, early runtime recording, failure cleanup,
  process receipt flushing, original-error propagation, and guaranteed provider
  close; tests TSC and `2 files / 30 tests` passed.
- R7 independent read-only re-review returned
  `PASS / P1_CLOSED / MVP_NOT_COMPLETE` for the complete nine-file diff.
- The focused profile remains exactly `exp-cop-008-009-focused` with two exact
  producers. The full real Electron gate remains unchanged at `>=50`.
- No candidate, artifact SHA256, runtime ID, package, independent experience
  retest, owner gate, release, or MVP PASS is attached to these source
  receipts.
- Added a single ordered `build:workspace-deps` contract and made every macOS
  distribution script execute it before the desktop build. This closes the
  clean-install ordering defect without changing Windows scripts or dependency
  versions.
- Committed the product/test portion of that repair at
  `1167cdc55a3fa7601516edeb61a9f4fb19ecd1c2`. This commit is a source rollback
  point only: no clean candidate, package, artifact SHA256, runtime ID or
  independent retest is attached to it.
- Added a static regression test covering the exact dependency order, all four
  macOS distribution paths, and preservation of generic desktop/Windows
  scripts. Evidence moved from `5 failed / 1 passed` to `6/6 PASS`; main TSC
  passes.
- The first renderer TSC stopped on missing `vite/client` because S15C has no
  complete root dependency tree. Per first-failure policy, no retry or tests
  TSC followed. Revalidation is required after exact `npm ci` on the next clean
  committed candidate; no build, package, Electron, network or Git action was
  performed.
- Closed EXP-COP-009 development acceptance: a completed grounded Ask exchange,
  exact source/full-reader navigation, explicit return, canonical Todo receipt
  and action entry survive route changes, renderer remount and same-userData
  Electron quit/relaunch; stale, unsafe or mismatched restore state fails
  closed.
- Added a bounded main-process Ask conversation store and IPC contract with
  serialized operations, atomic `0600` writes, same-handle `O_NOFOLLOW` reads,
  source revalidation and canonical Todo receipt revalidation.
- Added deterministic late-success/late-rejection coverage and same-run focused
  Electron evidence. The controller current-byte receipt records main/renderer
  TSC PASS and 28/28 focused tests PASS; the tests TSC baseline remains red and
  R3c explicitly records `globalGate=NOT_RUN`.
- Materialized the accepted P0+P1 product/test bytes at
  `bd82407dc63fd278c0523f46bcf0e96c5344fd9b`.
- Status remains `BLOCKED / CLEAN_CANDIDATE_NOT_BUILT /
  INDEPENDENT_RETEST_PENDING / RELEASE_BASELINE_RED / MVP_NOT_COMPLETE`.

## 2026-07-29

- Closed EXP-COP-008 development acceptance on current-source Electron:
  two-source grounded Ask, exact source summary/full reader, canonical
  Unscheduled Todo creation, durable title/due/source/log/notes editing,
  explicit-date calendar discovery, full quit, and same-userData relaunch all
  pass in one 13.3-second journey.
- Bound the accepted P0 product and test bytes to commit
  `0c69b8643ca4dcf20a86623f2528195a34f402a4`; this is a development-stage
  rollback point, not a release candidate.
- Restored accepted Todo notes/execution-log UX as durable canonical local
  state instead of page-memory, and made calendar date selection immediately
  open the selected-day scope.
- Made `knowledgeBuild.ready` fail closed on exact revision: pending,
  processing, failed, stale, and done states now map to queued, running, failed,
  not-ready, and ready truthfully.
- Fixed the deterministic Electron MiniMax test provider to cite every valid,
  ordered, deduplicated local path from the grounded prompt; production
  Answerer citation filtering was intentionally unchanged.
- Exhaustively classified the current global receipt: no current P0 regression
  and no unclassified failures; the separate release baseline remains red and
  continues to block release readiness.
- Implemented the focused EXP-COP-008 canonical Todo closure: grounded
  LOCAL_PRESENT answer gating, frozen answer/source payload, body/source
  persistence, main and renderer canonical readback, All/Unscheduled discovery,
  exact “查看待办”, persisted editing, and same-userData Electron relaunch
  recovery. Focused Electron and 33 focused tests pass; independent review,
  clean candidate identity, and the pre-existing global red suite remain.
- Froze the independently accepted Stage 0 materialized product baseline at commit `2b832c20b93e07ee68b6b325dc3ad758986b7f69`; no runtime or release readiness is implied.
- Entered Stage 1 for `EXP-COP-008` Todo false-success/discoverability/readback closure.
- Materialized r3 Desktop product-layer snapshot onto `codex/p0-owner-gate@96c861706126317c27965fcb64c765973df9ac89`.
- Preserved r3 as product-layer input only: `414 files / 7 tracked deletions / 51,347,389 bytes / aggregate 026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311`.
- Added Stage 0 governance surface: `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `docs/ARCHITECTURE.md`, and `DECISIONS.md`.
- Added README ecosystem baseline reference for `zhouzengrui369-commits/knowme-ecosystem@965713b81a726279f63527eb17979f5e768423c1`.
- Corrected the current review issue mapping: `EXP-COP-008` is Todo false-success/discoverability/readback (P0), and `EXP-COP-009` is Ask source-return continuity (P1).
- Status remains `BLOCKED / COMMIT_PENDING / MVP_NOT_COMPLETE`; no tests, build, Electron, package, Git write, or product logic fix was performed.
