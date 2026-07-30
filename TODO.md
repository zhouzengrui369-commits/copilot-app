# TODO

## Next Single Action

Stage 0 input is frozen at `2b832c20b93e07ee68b6b325dc3ad758986b7f69`.
Accepted P0+P1 product/test bytes are committed at
`bd82407dc63fd278c0523f46bcf0e96c5344fd9b`.
The macOS build-order product repair is committed at
`1167cdc55a3fa7601516edeb61a9f4fb19ecd1c2`.
The independently accepted Electron receipt/TSC repair is committed at
`ee8e207b44fc5091564f292ac130d8f0bd9a492b`.

R18 packaged successfully through the supported offline `electronDist` path,
but its focused packaged Electron gate failed before settings credential save;
no candidate was established. R19 now has an independently rereviewed
test-only harness repair:

- fixture SHA256:
  `b9e0d32b23bcf82e0c03f05855cb741b3b3931a5e196cb0aac9e36f992044df5`;
- unit-test SHA256:
  `ed3b85357c8b347669c4888613dac55f6ca16d6bac4bb4f9d065d0504f1bdbf9`;
- rereview: `PASS / P0=0 / P1=0 / P2=0`;
- `PACKAGED_E2E_MOCK_KEYCHAIN`;
- `REAL_MACOS_KEYCHAIN_RUNTIME_NOT_PROVEN`;
- initial wrapper: `RESOURCE_DEFER_NO_TEST` before command start; no attempt
  consumed;
- focused unit GREEN: exact command ran once, exit `0`,
  `1 file / 15 tests PASS`, `GREEN_15_OF_15_PASS`; no retry and no Electron.
- exact two-file test-only repair commit:
  `54cd07ec631872f9b1fd45a5c426a4fe57f3d92b`.

- `EXP-COP-008` (P0, DEVELOPMENT ACCEPTANCE PASS; INDEPENDENT RETEST PENDING):
  canonical persistence/readback, All/Unscheduled discoverability, exact
  “查看待办”, two-source retention, full source reading, durable log/notes,
  selected-day discovery, and same-userData full quit/restart recovery pass.
- `EXP-COP-009` (P1, DEVELOPMENT ACCEPTANCE PASS; INDEPENDENT RETEST PENDING):
  the same completed grounded Ask exchange survives exact source/full reading,
  explicit return, route changes, renderer remount and same-userData restart;
  stale or unsafe persisted state fails closed.

Receipt repair status:

- R3 exact dependency install and ordered workspace builds passed.
- R4 tests TSC and `3 files / 40 tests` passed.
- R5 correctly rejected manual-launch ownership and cleanup gaps.
- R6 closed those gaps; tests TSC and `2 files / 30 tests` passed.
- R7 independent re-review returned
  `PASS / P1_CLOSED / MVP_NOT_COMPLETE`.
- focused profile is exactly `exp-cop-008-009-focused` with producers
  `exp-cop-008` and `exp-cop-009`; the full real Electron gate remains
  unchanged at `>=50`.

## Required Before Human Owner Gate

- [x] Preserve the initial resource-defer receipt, then run the single R19
  focused unit GREEN command once: `GREEN_15_OF_15_PASS`.
- Obtain independent review of the current governance postimage.
- Commit only this separate governance update after the R19 test-only commit
  `54cd07ec631872f9b1fd45a5c426a4fe57f3d92b`, before any new candidate
  attempt.
- Prove the committed source tree is clean and contains no execution bridge or
  untracked candidate input.
- Reuse the existing candidate worktree. From the subsequent governance HEAD,
  build a fresh macOS candidate only after exact `npm ci` and all three desktop
  TSC checks pass; then run macOS package, focused Electron, runner list
  `>=50`, and eligible full Electron. Do not reuse current-source `dist/` or
  any old source/runtime ID.
- Bind source commit/snapshot, artifact SHA256, runtime ID, deterministic
  test-data manifest, packaged Electron evidence and current screenshots.
- Run the required candidate-bound checks, including the project-wide real
  Electron gate; R3c focused evidence explicitly has `globalGate=NOT_RUN`.
- Independent Focused Retest must return P0=0 on that exact candidate before
  Human Owner Gate becomes eligible.
- Current global receipt is exhaustively classified: P0 regression `0`,
  unclassified `0`, execution bridge `7` (focused into behavior), baseline
  contract/evidence `30` plus one exposed r22 literal-shell assertion. The
  release baseline remains red and must be closed before release promotion;
  focused green checks do not overwrite it.

## Do Not Do In Stage 0

- No Windows expansion.
- No Remote or Backup expansion.
- No major dependency upgrade.
- No visual redesign.
- No reuse of old source/runtime IDs.
- No candidate build from dirty source or ignored task evidence.
- No reuse of the stale R3b wrapper.
- No force-add of `tasks/openclaw/**` as product source.
- No claim of candidate, release, or MVP readiness.
