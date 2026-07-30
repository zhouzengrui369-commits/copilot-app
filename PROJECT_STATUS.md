# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`

No local R30 candidate has been executed. There is no current artifact SHA256, runtime ID, source snapshot receipt, packaged Electron result, independent Codex verdict, signing, notarization, Release, or Human Owner Gate.

## Authority

The owner-approved baseline remains `goal.md`, `plan.md`, `rules.md`, and `delivery.md` v6.2, interpreted through the 2026-07-16 MiniMax-first/Tencent-post-MVP amendment and the 2026-07-15 macOS-first amendment. `AGENTS.md` and `docs/DEVELOPMENT_WORKFLOW.md` define the GitHub → MiniMax → Codex execution boundary. The six `docs/*` handoff files are mirrors and cannot override root truth.

## Exact Takeover Source

- Repository: `zhouzengrui369-commits/copilot-app`
- Parent branch: `codex/p0-owner-gate`
- Parent commit: `6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- `main` observed: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Parent Draft PR: `#12`
- Bounded successor branch: `agent/r30-github-bound-candidate-runner`

## Preserved Detailed Handoff

The complete pre-R30 root state, status, TODO, changelog, and architecture are preserved byte-for-byte under `docs/history/PROJECT_STATE_PRE_R30.yaml`, `docs/history/PROJECT_STATUS_PRE_R30.md`, `docs/history/TODO_PRE_R30.md`, `docs/history/CHANGELOG_PRE_R30.md`, and `docs/history/ARCHITECTURE_PRE_R30.md`. R30 updates current fields only; it does not erase accepted development evidence or historical blockers.

## Phase 1 — Documentation Reconciliation

The six low-confidence documents added on `main` were reviewed against the detailed root handoff. The generic architecture/status/risk/todo language was not accepted as a new baseline. The successor supplies explicit authority mirrors and preserves detailed strict local-first, fail-closed, Electron trust, grounded Ask/Todo, candidate receipt, and deferred-scope truth.

## Phase 2 — R30 Successor

R28 remains `NEVER_RUN / PERMANENTLY_REJECTED`; its files, hash ledger, network authority, candidate identity, and evidence are not reused.

R30 is a new committed runner under `scripts/candidate-r30/`:

- Gate 1: exact full Git commit and clean source.
- Gate 2: macOS network sandbox denies all network; offline npm only; cache miss stops for separate owner approval.
- Gate 3: complete regular-file SHA256 ledger with exact 64 lower-case hex digests.
- Gates 4–7: ordered workspace build, TSC/build, unsigned arm64 package, source snapshot, artifact identity.
- Gate 8: focused packaged Electron 2/2.
- Gate 9: exact list-only discovery `113 tests in 9 files`.
- Gate 10: full packaged Electron 113/113, zero skipped/unexpected/flaky, clean process terminal state.
- Gate 11: source/artifact/runtime/test-data/command/screenshot/terminal-state manifest.

A successful local R30 run is explicitly an unsigned diagnostic candidate, not a signed/notarized final release.

## RED→GREEN Evidence

Pure Node tests were used so ChatGPT did not launch Electron:

- Gate contract RED: module absent, `exit 1`.
- Gate contract baseline GREEN: 9/9, `exit 0`; pre-commit path/generated-input hardening RED: missing exports, `exit 1`; final GREEN: 11/11, `exit 0`.
- Runner RED: module absent, `exit 1`.
- Runner baseline GREEN: 5/5, `exit 0`; final ownership/no-overwrite suite: 6/6, `exit 0`.
- Documentation authority RED: target mirrors absent, `exit 1`.
- Documentation authority GREEN: 6/6, `exit 0`.
- Combined pure Node suite: 23/23, `exit 0`.
- Syntax checks and dry-run planning pass; dry-run reports `PLAN_ONLY_NOT_A_CANDIDATE` and `MVP_NOT_COMPLETE`.

## Role Boundary

1. ChatGPT changes source only through GitHub branch/PR.
2. MiniMax Code checks out one exact final commit, runs the runner locally, and never silently fixes source.
3. Codex begins only after complete MiniMax receipts and independently verifies the real computer; it never fixes source in the acceptance lane.

## Next Single Action

Review the bounded R30 PR. Then MiniMax Code checks out its exact final GitHub commit and executes the runner once in a clean worktree with a new absolute evidence directory outside the repository. If the cache is insufficient, MiniMax stops and requests minimal registry authority; it does not retry online. Codex remains idle until candidate-bound receipts are complete.
