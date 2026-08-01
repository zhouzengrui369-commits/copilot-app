# Copilot App TODO — Mirror

`BLOCKED / MVP_NOT_COMPLETE`

Root `TODO.md` and `PROJECT_STATE.yaml` are authoritative. This file mirrors the exact next handoff.

## GitHub Source — Complete Pending Final Authority-Bootstrap CI

- [x] Preserve pre-R30 authority/history and permanently reject never-run R28.
- [x] Build the bounded R30 GitHub-bound candidate runner on PR #13.
- [x] Complete R31 product/source work on `agent/r31-source-completion`, Draft PR #14.
- [x] Add embedded-local deterministic RAG default and explicit Ollama opt-in.
- [x] Enforce one vector model while retaining durable local text.
- [x] Close fail-closed product/source branches and strict per-file critical coverage.
- [x] Pass Node 24 source gate, production CycloneDX SBOM, and exact `113 tests in 9 files` list discovery at the last green checkpoint.
- [x] Expand the candidate runner to twelve gates and synchronize governance.
- [x] Add `scripts/candidate-r30/minimax-authority.mjs` plus tests so deployment authority is read from the exact Git object, not a stale worktree.
- [x] Rewrite `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` with explicit PR-head fetch, exact-SHA comparison, authority hashing, and fail-closed pre-candidate blockers.
- [ ] Freeze and externally report the new exact PR #14 SHA only after the authority-bootstrap HEAD passes the complete source gate.

## MiniMax Code — Next

- [ ] Use the externally reported exact final 40-character PR #14 HEAD, not a mutable branch tip or current checkout.
- [ ] Fetch `refs/pull/14/head` and prove `FETCH_HEAD` equals the supplied SHA.
- [ ] Materialize the authority document and receipt from `<EXACT_FINAL_HEAD>:docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` with `scripts/candidate-r30/minimax-authority.mjs`.
- [ ] Treat a stale-worktree file search as non-authoritative; stop on exact-object authority blockers.
- [ ] Create a new clean detached worktree; do not reuse dirty/stale candidate inputs.
- [ ] Use a new absolute evidence directory outside the repository; it must not exist.
- [ ] Run `node --test scripts/candidate-r30/*.test.mjs`.
- [ ] Run the candidate dry-run and confirm `PLAN_ONLY_NOT_A_CANDIDATE`.
- [ ] Execute `scripts/candidate-r30/run-candidate.mjs` once.
- [ ] On cache blocker, stop; no online retry or silent source edit.
- [ ] Return authority receipt, all-tracked SHA256 ledger/aggregate, canonical snapshot/SBOM/package identities, focused 2/2, exact 113/9, full 113/113, complete E2E source manifest, three performance raws/aggregate, runtime ID, commands, screenshots, process terminal state, `CANDIDATE-MANIFEST.json`, `R30-COMPLETE.json`, exact commit, and clean Git status.

Detailed command sequence: `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md`.

## Codex — After Complete Receipt

- [ ] Verify deployment authority and source/artifact/runtime bindings independently.
- [ ] Operate the packaged app on the real computer.
- [ ] Run focused product-experience and Release Gate acceptance.
- [ ] Verify real packaged offline local-ASR.
- [ ] Report P0/P1/P2 and exact verdict without repairing source.

## Still Blocking MVP/Release

- [ ] Candidate-bound local execution and performance.
- [ ] Three verify-fix rounds on the same final candidate.
- [ ] Developer ID signing and Apple notarization/stapling/validation.
- [ ] Gatekeeper install/launch evidence.
- [ ] Human Owner Gate and required use evidence.

Windows is Phase 1.1. Tencent deployment, Remote/live, optional Backup, and 3D graph remain post-MVP/owner-deferred.
