# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY`

GitHub-side Phase 1 source development is complete on Draft PR #14 (`agent/r31-source-completion`). The exact final PR HEAD must still be executed locally by MiniMax Code. No local R30/R31 candidate, artifact SHA256, runtime ID, packaged Electron result, candidate-bound performance receipt, independent Codex verdict, Developer ID signing, Apple notarization, Release, or Human Owner Gate exists yet.

## Authority

The owner-approved baseline remains `goal.md`, `plan.md`, `rules.md`, and `delivery.md` v6.2, interpreted through the macOS-first and MiniMax-first/Tencent-post-MVP amendments. `AGENTS.md` and `docs/DEVELOPMENT_WORKFLOW.md` define the GitHub → MiniMax Code → Codex role boundary. Root `PROJECT_STATE.yaml`, this file, `TODO.md`, `DECISIONS.md`, and `CHANGELOG.md` are current truth. The six `docs/*` handoff files are mirrors and cannot override root truth.

The complete pre-R30 state/status/TODO/changelog/architecture remains byte-preserved under `docs/history/`.

## Source Chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Original takeover: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- Original parent PR: #12
- Candidate-runner parent: `agent/r30-github-bound-candidate-runner`, PR #13
- Active source-completion branch: `agent/r31-source-completion`
- Active Draft PR: #14
- Final identity rule: use the externally reported final 40-character PR #14 HEAD after the final governance CI; tracked documents do not attempt to embed the commit that contains themselves.

## Deployment Authority Incidents And Resolution

MiniMax correctly stopped twice before candidate creation.

The first stop occurred because two old local worktrees did not contain `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md`. GitHub inspection proved the document existed in the approved PR commit. That incident was a stale-worktree lookup, not a missing exact-commit authority file.

The second stop occurred after MiniMax correctly read the document and verifier from the exact commit object. `minimax-authority.mjs` required the literal contiguous marker `git worktree add --detach`, while the versioned authority document correctly used the repository-scoped command `git -C "$REPO" worktree add --detach`. The old `String.prototype.includes` check therefore produced `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID` even though the executable command was valid.

The source contract now closes both defects:

1. MiniMax first fetches `refs/pull/14/head` and proves it equals the externally supplied exact SHA.
2. It reads `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and `scripts/candidate-r30/minimax-authority.mjs` from the exact Git commit object, not from the currently checked-out files.
3. `minimax-authority.mjs` validates required fail-closed prose markers and separately validates the detached-worktree command with a bounded semantic pattern that accepts both direct `git worktree add --detach` and repository-scoped `git -C <repo> worktree add --detach` forms.
4. The validator still rejects a worktree command that omits `--detach`.
5. The tests validate both command forms and call `validateAuthorityDocument` against the real versioned `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` file, preventing another verifier/document drift.
6. The verifier hashes the authority bytes, verifies the candidate runner exists in the same commit, and emits an exclusive receipt.
7. The verifier itself performs no network operation, creates no candidate worktree, and creates no candidate evidence. The explicit GitHub fetch occurs before the verifier and does not grant npm registry authority.
8. `BLOCKED_EXACT_COMMIT_NOT_FETCHED`, `BLOCKED_DEPLOYMENT_AUTHORITY_MISSING`, `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID`, or `BLOCKED_DEPLOYMENT_RUNNER_MISSING` still stops the handoff before candidate execution.

A cron or file-presence probe is not authority and may not auto-run the candidate.

## GitHub Source Completion

R31 closes the remote source boundary without launching Electron:

1. The production embedding default is the self-contained deterministic `embedded-local-hash-v1`; it performs no HTTP request, process spawn, model download, cloud fallback, or external local-service call.
2. Ollama remains available only as an explicit local-service compatibility option.
3. Vector persistence enforces one embedding model at a time. A model change removes incompatible vectors while retaining durable local text for deterministic fallback and re-indexing.
4. Grounded Ask, canonical Todo readback, reversible Trash, WIKI revision truth, local-ASR source/package contracts, IPC/preload boundaries, and renderer product paths remain fail-closed.
5. The Node 24 macOS source gate validates the exact PR HEAD, exact lockfile, ordered workspace builds, all checks, core unit/integration suites, desktop Phase 1 suite, strict global coverage, strict per-file critical coverage, production CycloneDX SBOM, exact Electron list-only discovery, and clean tracked source.
6. The current source-completion checkpoint passed the desktop Phase 1 suite at `1107/1107`; every critical file met the 90% per-file threshold, including `local-knowledge-service.ts` branch coverage at exactly 90.00%; Electron list-only discovery remained exactly `113 tests in 9 files`.
7. The exact-object authority suite now covers the real versioned authority document, direct and repository-scoped detached-worktree commands, and fail-closed rejection when `--detach` is absent.

The final externally supplied deployment SHA is valid only after the last tracked governance commit passes the same complete 17-step source gate. These are source-development results, not packaged runtime or product-release evidence.

## Twelve-Gate Local Candidate Contract

The executable runner is `scripts/candidate-r30/run-candidate.mjs`. MiniMax Code must run all gates against one exact final commit in a new clean detached worktree and a new evidence directory outside the repository:

1. Exact source identity and clean preimage.
2. Absolute reviewed npm executable under macOS `sandbox-exec` with `deny network*`; offline install only; cache miss stops for separate approval.
3. Complete SHA256 ledger for every Git-tracked regular file plus aggregate digest.
4. Candidate source contracts and ordered LLM → KB → KG → RAG build.
5. Checks, unit/integration tests, strict global/critical coverage, desktop build, Phase 1 release suite, and CycloneDX SBOM.
6. Existing canonical unsigned macOS arm64 ZIP/DMG builder.
7. Canonical source snapshot and ZIP/DMG/app/executable/`app.asar` identity.
8. Focused packaged Electron `2/2`.
9. Exact `113 tests in 9 files` discovery plus hashes for all E2E specs, fixtures, and helpers.
10. Full packaged Electron `113/113`, zero skipped/unexpected/flaky, clean process termination.
11. Three distinct candidate-bound `r31-v1` performance runs and one hash-bound aggregate.
12. Final candidate manifest, SBOM, commands, screenshots, source/test-data identities, runtime ID, performance evidence, and terminal process state.

A successful execution is still an **unsigned diagnostic candidate**. It does not by itself close signing, notarization, independent acceptance, owner use, or MVP completion.

## Role Boundary

1. ChatGPT changes source and governance only through GitHub branch/PR. It does not run the local candidate.
2. MiniMax Code fetches and verifies the exact approved final commit, materializes authority from the exact Git object, executes the runner, and returns evidence. It must not silently repair source, reuse old candidate identity, reuse an evidence directory, or retry online.
3. Codex starts only after a complete MiniMax receipt exists. It independently operates the packaged app on the real computer and reports acceptance findings; it does not fix source in the acceptance lane.

## Remaining Blocks

- Final governance source gate on the exact deployment SHA.
- Local twelve-gate candidate execution and complete receipt.
- Independent Codex focused product-experience retest and Release Gate review.
- Candidate-bound three verify-fix rounds.
- Real packaged offline local-ASR chain.
- Developer ID signing, Apple notarization, stapling, validation, and Gatekeeper installation evidence.
- Human Owner Gate and required use evidence.

Windows real-machine/signing/install/screenshots remain Phase 1.1. Tencent deployment, Remote/live service, and optional Backup remain post-MVP unless the owner changes scope.

## Next Single Action

After the exact final governance PR HEAD passes the complete source gate, MiniMax receives that 40-character SHA. It fetches PR #14, proves HEAD equality, materializes the deployment document and receipt from the exact Git object with `scripts/candidate-r30/minimax-authority.mjs`, creates a clean detached worktree, verifies no stale generated candidate inputs exist, runs source contracts and dry-run, then executes the R30 successor exactly once with a new absolute outside-repository evidence directory. On `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED`, it stops without online retry. Codex remains idle until the receipt is complete.
