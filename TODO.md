# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE`.**

GitHub Phase 1 product/source work is complete on Draft PR #14. The remaining handoff begins only after the final governance HEAD passes the complete source gate. No candidate or Release evidence is implied by checked source tasks.

## P0 — GitHub Remote Development

- [x] Verify the original takeover source `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd` and preserve its detailed governance history under `docs/history/`.
- [x] Establish the bounded R30 candidate runner on `agent/r30-github-bound-candidate-runner` / PR #13; reject and never reuse R28.
- [x] Complete R31 source work on `agent/r31-source-completion` / Draft PR #14.
- [x] Make embedded-local deterministic embeddings the production default; keep Ollama explicit opt-in only.
- [x] Enforce single-model vector rotation while preserving durable local text.
- [x] Close grounded Ask/Todo, WIKI revision truth, reversible Trash, local-ASR, IPC/preload, renderer, and native-binding source branches under fail-closed tests.
- [x] Require Node 24, exact lockfile, checks, unit/integration tests, desktop Phase 1 suite, strict global coverage, strict per-file critical coverage, CycloneDX SBOM, exact `113 tests in 9 files` list discovery, and clean tracked source.
- [x] Expand the local candidate contract to 12 gates, including absolute npm identity, all-tracked-file SHA256 ledger, canonical arm64 package identity, complete E2E source manifest, three-run candidate-bound performance, and Gate 12 screenshot/final receipt ownership.
- [x] Add `scripts/candidate-r30/minimax-authority.mjs` and `minimax-authority.test.mjs` so deployment authority is read, validated, and hashed from the exact Git commit object rather than a stale checkout.
- [x] Rewrite `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` to fetch PR #14, compare the supplied SHA, materialize an exclusive authority receipt, and stop before candidate execution on any exact-object authority blocker.
- [x] Reproduce the exact-object `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID` marker mismatch reported by MiniMax.
- [x] Replace the brittle contiguous `git worktree add --detach` substring check with a bounded command pattern that accepts both direct Git and repository-scoped `git -C <repo>` forms while still requiring `--detach`.
- [x] Add RED→GREEN coverage for both detached-worktree command forms, the missing-`--detach` blocker, and the real versioned `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` authority document.
- [x] Synchronize root governance for the stale-worktree incident and the subsequent verifier/document drift incident without embedding a self-referential final commit.
- [x] Keep product scope, local-first/macOS-first boundaries, and dependency major versions unchanged.
- [ ] Require the final governance PR HEAD to pass the complete 17-step `copilot-source-gate`; after that result, freeze and externally report the new exact 40-character SHA without another tracked commit.

## P0 — MiniMax Code Local Deployment

- [ ] Receive the exact externally reported final 40-character PR #14 HEAD. The previously supplied `205eef52927c44c4eff65d72e6cea3ac9c0c064c` is invalidated by the authority-validator repair and must not be executed again.
- [ ] From the existing repository, explicitly fetch `refs/pull/14/head` and prove `FETCH_HEAD` equals the supplied SHA.
- [ ] Read `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and `scripts/candidate-r30/minimax-authority.mjs` from `<EXACT_FINAL_HEAD>:<path>`, not from the currently checked-out worktree.
- [ ] Run the exact-object verifier and return its authority SHA256 receipt; a stale worktree search is non-authoritative.
- [ ] Verify the authority bootstrap accepts the repository-scoped `git -C "$REPO" worktree add --detach` command in the versioned document before creating candidate state.
- [ ] Perform a read-only reuse inventory of worktrees, npm cache, candidate tools, signing/notary tools, screenshots, and performance tools; reuse valid tools/cache only, never candidate identity or old evidence.
- [ ] Create a new clean detached worktree at the exact final HEAD.
- [ ] Verify tracked/untracked source is clean and every governed ignored generated candidate input is absent.
- [ ] Use a new absolute evidence directory outside the repository; it must not already exist, including through symlink aliases.
- [ ] Run `node --test scripts/candidate-r30/*.test.mjs`.
- [ ] Run the candidate runner dry-run and verify `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [ ] Execute `node scripts/candidate-r30/run-candidate.mjs --source-commit <EXACT_FINAL_HEAD> --evidence-dir <NEW_ABSOLUTE_OUTSIDE_REPO_DIR>` exactly once.
- [ ] Do not execute R28, edit source/tests/runner/governance, clean stale outputs in place, pre-create candidate output, reuse an evidence directory, or silently retry.
- [ ] On `BLOCKED_EXACT_COMMIT_NOT_FETCHED`, `BLOCKED_DEPLOYMENT_AUTHORITY_MISSING`, `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID`, or `BLOCKED_DEPLOYMENT_RUNNER_MISSING`, stop before creating candidate state and return the exact authority receipt/blocker.
- [ ] On `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`, stop and return `R30-BLOCKED.json`; request a separately reviewed minimal read-only registry exception. Do not retry online automatically.
- [ ] Return exact authority receipt, source ledger/aggregate SHA256, canonical snapshot, SBOM, ZIP/DMG/app/executable/`app.asar` identities, runtime ID, focused/full Electron evidence, exact discovery evidence, complete test-data manifest, three raw performance records and aggregate, commands/exit codes, screenshots/SHA256, process terminal state, `CANDIDATE-MANIFEST.json`, `R30-COMPLETE.json`, and final clean Git status.

## P0 — Codex Independent Acceptance

- [ ] Start only after the complete MiniMax receipt is available and internally consistent.
- [ ] Independently verify authority/source/artifact/runtime identity before operating the app.
- [ ] Operate the packaged application on the real macOS computer, including the focused product-experience journeys and Release Gate checks.
- [ ] Verify real packaged offline local-ASR behavior; source/package contracts alone are insufficient.
- [ ] Report P0/P1/P2 findings and an exact fail-closed verdict; do not repair product source in the acceptance lane.

## Open Release Gates

- [ ] Candidate-bound performance receipt from the exact final candidate.
- [ ] Three verify-fix rounds on one final candidate identity.
- [ ] Developer ID signing.
- [ ] Apple notarization, stapling, validation, Gatekeeper installation, and launch evidence.
- [ ] Human Owner Gate and required use evidence.

## Deferred

- Windows real-machine/signing/install/screenshots → Phase 1.1.
- Tencent deployment, Remote/live, and optional Backup → post-MVP.
- 3D graph and broader product expansion → post-MVP.
