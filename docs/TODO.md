# Copilot App TODO Mirror

**Status: `BLOCKED / MVP_NOT_COMPLETE`.** Root `TODO.md` and `PROJECT_STATE.yaml` are authoritative; this file is a synchronized navigation mirror.

## P0 — Remote Source Closure

- [x] Read `goal.md`, `plan.md`, `rules.md`, `delivery.md` v6.2 and the detailed root handoff.
- [x] Preserve exact pre-R30 root state/status/TODO/changelog/architecture under `docs/history/`.
- [x] Reconcile the six generic `main` documents without replacing detailed architecture or fail-closed truth.
- [x] Create bounded branch `agent/r30-github-bound-candidate-runner` from `6aa6b8c0792c5549b818107a0f64e4f32651dacd`.
- [x] Implement a brand-new R30 runner; do not execute, repair, or reuse R28.
- [x] Close Gate 2 source contract: offline-only network sandbox; cache miss stops for owner approval.
- [x] Close Gate 3 source contract: complete real 64-character SHA256 ledger.
- [x] Close Gate 9 source contract: exactly `113 tests in 9 files`, not `>=50`.
- [x] Add and run pure Node RED→GREEN tests; no Electron candidate launched.
- [ ] Review the bounded PR and record its exact final GitHub commit.

## P0 — MiniMax Code Local Deployment

- [ ] Checkout the exact final PR commit in a clean worktree with no pre-existing ignored candidate outputs.
- [ ] Run the R30 runner once with a new absolute evidence directory outside the repository.
- [ ] If npm cache is insufficient, stop at `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`; do not grant network or edit source.
- [ ] Return source snapshot SHA256, artifact SHA256, runtime ID, test-data manifest, command receipts/exit codes, screenshots, and process terminal state.
- [ ] Confirm no source modification and provide final `git status`.

## P0 — Codex Independent Acceptance

- [ ] Start only after complete MiniMax candidate-bound receipts exist.
- [ ] Independently operate the packaged app on the real computer.
- [ ] Execute focused product-experience retest and Release Gate review.
- [ ] Report P0/P1/P2 findings and accept/reject; do not fix source.

## Remaining Release Gates

- [ ] Candidate-bound performance and three verify-fix rounds.
- [ ] Embedded local ASR real offline candidate chain.
- [ ] Developer ID signing, Apple notarization, staple, and validation.
- [ ] Human Owner Gate and one-week usage evidence.

Windows Phase 1.1 and Tencent/Remote/backup remain owner-deferred. Current conclusion stays `BLOCKED / MVP_NOT_COMPLETE`.
