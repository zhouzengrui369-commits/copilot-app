# EVIDENCE

## Input Authority

- GOAL/TASK/PLAN were read before execution.
- Preflight branch/head matched:
  `codex/p0-owner-gate@96c861706126317c27965fcb64c765973df9ac89`.
- r3 manifest SHA matched:
  `3425aba76d6d79b326b11b178ec96ad306ac8364feba84420f5ce9a2de812ec4`.
- r3 independent review contains:
  `SNAPSHOT_POSTIMAGE=PASS` and `MATERIALIZATION_INPUT_AUTHORIZED=YES`.

## Materialization Evidence

`MATERIALIZED_SOURCE_MANIFEST.json`

- SHA256:
  `157a29c17b65562c3c0fbe61c08757067a15d2a9b64033e2429405e621876f99`
- status:
  `STAGE0_MATERIALIZATION_PASS / COMMIT_PENDING / MVP_NOT_COMPLETE`
- mode: final `verify-only`
- entries: `414`
- tracked deletions: `7`
- bytes: `51,347,389`
- aggregate:
  `026060bbc505e7f5fafceae98df600e067b97aaedbd087e2248195e74fd7f311`

Initial materialization removed 10 ordinary files inside manifest recursive
roots that were absent from r3. The manifest-declared 7 tracked deletion paths
are absent in the final worktree.

## Governance Evidence

Created or updated:

- `README.md`
- `PROJECT_STATE.yaml`
- `PROJECT_STATUS.md`
- `TODO.md`
- `CHANGELOG.md`
- `DECISIONS.md`
- `docs/ARCHITECTURE.md`

Governance state remains:

- `verdict: BLOCKED`
- `active_candidate_commit: null`
- `artifact_sha256: null`
- `runtime_id: null`
- `release_gate: HUMAN_OWNER_GATE_NOT_ELIGIBLE`
- `mvp_status: MVP_NOT_COMPLETE`

## Diff And Scope Evidence

- `git diff --check`: exit `0`, no output.
- `git diff --stat`: `92 files changed, 14893 insertions(+), 5592 deletions(-)`.
- `git status --short --untracked-files=all`: `165` changed paths.
- `SCOPE_AND_SECRET_SCAN.json` SHA256:
  `399f17f7a813ccbcfdebbd4456f353cc6413d0478c9b6ed3cd6c9a3770a89758`
- scope scan: `PASS`, `outsideAllowedScope=[]`.
- secret scan: `PASS`, `unclassifiedSecretMatches=[]`.
- classified test fixture hits only:
  `apps/copilot-desktop/tests/e2e/window-nav-settings.spec.ts`
  line `156` (`OPENAI_SK`, `GENERIC_SECRET_ASSIGNMENT`) and line `169`
  (`OPENAI_SK`). Matched content was not emitted.

## Boundary Evidence

Not run:

- tests
- typecheck
- build
- Electron
- package
- dependency install
- Git add/commit/push/PR
- network fetch
- credential, remote, or global config modification

Not modified:

- `/Users/njx/openclaw/copilot`
- `/Users/njx/openclaw/copilot/.worktrees/exp-cop-p0`
- review Core/Profile/report
- old EXP-COP-008 overlay bytes

## Controller Post-Acceptance Corrections

- Corrected governance issue mapping to the current independent report:
  `EXP-COP-008` = Todo false-success/discoverability/readback (P0);
  `EXP-COP-009` = Ask source-return continuity (P1).
- Replaced the premature unscheduled-Todo decision with a source-audit gate.
- Re-ran current-source materialization verification, scope/secret scan, and
  `git diff --check`; all passed without changing the 414-file product input.
