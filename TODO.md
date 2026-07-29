# TODO

## Next Single Action

Stage 0 input is frozen at `2b832c20b93e07ee68b6b325dc3ad758986b7f69`.
Accepted P0 product/test bytes are committed at
`0c69b8643ca4dcf20a86623f2528195a34f402a4`.

- `EXP-COP-008` (P0, DEVELOPMENT ACCEPTANCE PASS; INDEPENDENT RETEST PENDING):
  canonical persistence/readback, All/Unscheduled discoverability, exact
  “查看待办”, two-source retention, full source reading, durable log/notes,
  selected-day discovery, and same-userData full quit/restart recovery pass.
- `EXP-COP-009` (P1, IN PROGRESS): persist the same Ask question, completed
  answer, sources, Todo receipt, and action entry across source summary/full
  reading, explicit return, route changes, renderer remount, and full restart.

## Required Before Human Owner Gate

- Independent Focused Retest must close `EXP-COP-008` on the final P0+P1
  candidate.
- `EXP-COP-009` must restore the same Ask exchange after source reading, not ask the user to repeat the question.
- Candidate commit, runtime ID, artifact SHA256, package evidence, screenshots, and Electron runtime evidence must be newly produced.
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
- No claim of candidate, release, or MVP readiness.
