# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE`.**

## P0 — GitHub Remote Development

- [x] Verify PR #12 source identity: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd` against `main@e91cafaa22ea100428b404b371aa35dce535c5bf`.
- [x] Read the complete v6.2 baseline and current detailed handoff.
- [x] Audit all six low-confidence `main` documents.
- [x] Preserve detailed architecture and fail-closed state instead of accepting generic placeholders.
- [x] Create bounded branch `agent/r30-github-bound-candidate-runner`.
- [x] Create a new R30 successor; do not execute, repair, or reuse R28.
- [x] Add RED→GREEN tests for source identity, Gate 2, Gate 3, Gate 9, runner plan, and document authority.
- [x] Keep product scope and dependency major versions unchanged.
- [ ] Complete GitHub review and record the exact final R30 PR head.

## P0 — MiniMax Code Deployment

- [ ] Checkout the exact final R30 commit in a clean worktree with no pre-existing ignored candidate outputs.
- [ ] Run `node scripts/candidate-r30/run-candidate.mjs --source-commit <EXACT_HEAD> --evidence-dir <NEW_ABSOLUTE_OUTSIDE_REPO_DIR>`.
- [ ] Do not edit source, pre-create ignored build output, or reuse an evidence directory.
- [ ] On `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`, stop and request separately reviewed minimal read-only npm registry authority; do not retry automatically.
- [ ] Return exact source snapshot, artifact SHA256, runtime ID, test-data manifest, commands/exit codes, screenshots, and process terminal state.
- [ ] Return final clean `git status` and source commit proof.

## P0 — Codex Independent Acceptance

- [ ] Start only after the MiniMax receipt is complete.
- [ ] Independently operate the packaged application on the real computer.
- [ ] Perform the focused product-experience retest and Release Gate review.
- [ ] Report P0/P1/P2 findings and exact acceptance verdict; do not repair source.

## Open Release Gates

- [ ] Candidate-bound performance.
- [ ] Three verify-fix rounds on the same final candidate.
- [ ] Embedded local-ASR real offline chain.
- [ ] Developer ID signing.
- [ ] Apple notarization, stapling, and validation.
- [ ] Human Owner Gate and one-week use evidence.

## Deferred

- Windows real-machine/signing/install/screenshots → Phase 1.1.
- Tencent deployment, Remote/live, and optional backup → post-MVP.
- 3D graph and broader product expansion → post-MVP.
