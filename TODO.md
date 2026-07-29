# TODO

## Next Single Action

Stage 0 input is frozen at `2b832c20b93e07ee68b6b325dc3ad758986b7f69`.
Accepted P0+P1 product/test bytes are committed at
`bd82407dc63fd278c0523f46bcf0e96c5344fd9b`.

- `EXP-COP-008` (P0, DEVELOPMENT ACCEPTANCE PASS; INDEPENDENT RETEST PENDING):
  canonical persistence/readback, All/Unscheduled discoverability, exact
  “查看待办”, two-source retention, full source reading, durable log/notes,
  selected-day discovery, and same-userData full quit/restart recovery pass.
- `EXP-COP-009` (P1, DEVELOPMENT ACCEPTANCE PASS; INDEPENDENT RETEST PENDING):
  the same completed grounded Ask exchange survives exact source/full reading,
  explicit return, route changes, renderer remount and same-userData restart;
  stale or unsafe persisted state fails closed.

## Required Before Human Owner Gate

- Commit the separate governance update.
- Prove the committed source tree is clean and contains no execution bridge or
  untracked candidate input.
- Build a fresh macOS candidate from the clean commits; do not reuse
  current-source `dist/` or any old source/runtime ID.
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
