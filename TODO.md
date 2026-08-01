# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE`.**

Draft PR #14 passed the source gate at
`e91b37618638da0b2ac864c368cde232079e3bee`; PR #16 now contains R33, and R34
is the test-only repair for its single async KnowledgeGraph CI failure.
No checked source task implies a local candidate, packaged runtime, Release,
or MVP completion.

## P0 — R33 Candidate Bootstrap Recovery

- [x] Reconcile GitHub PR #14, its current HEAD, latest CI, local worktrees,
  and candidate truth.
- [x] Repair only the two date-sensitive tests; independently rerun both files
  with `47/47 PASS`.
- [x] Commit/push the exact R32 two-test patch and require clean GitHub
  `copilot-source-gate` PASS.
- [x] Merge R32 into PR #14 and pass the complete 17-step source gate at
  `e91b37618638da0b2ac864c368cde232079e3bee`.
- [x] Reproduce the exact npm 11.8.0 duplicate-config blocker and stop before
  candidate creation.
- [x] Commit/push R33 and run the GitHub `copilot-source-gate`; run
  `30691755888` passed through core coverage and `1106/1107` critical tests,
  then failed only the async KnowledgeGraph harness assertion.
- [ ] Commit/push R34 and require clean GitHub `copilot-source-gate` PASS.
  Unlock: one green run bound to the R34 commit with all 17 steps complete.
- [ ] Merge R33 into PR #14, freeze and report that new exact commit without
  another tracked source change.
- [ ] Create a reproducible unsigned macOS candidate. Unlock: clean detached
  worktree, exact dependency receipt, artifact SHA256, runtime ID, and complete
  candidate manifest.
- [ ] Run the real Electron Knowledge → Ask → source → return → Todo → edit →
  quit/relaunch journey and three candidate-bound verify-fix rounds.

## P0 — GitHub Remote Development

- [x] Preserve original takeover and detailed pre-R30 governance under `docs/history/`.
- [x] Establish the bounded R30 successor; reject and never reuse R28.
- [x] Complete R31 embedded-local RAG, vector rotation, fail-closed product paths, twelve candidate gates, exact `113 tests in 9 files`, strict coverage, SBOM, and arm64 authority.
- [x] Add exact-Git-object deployment bootstrap and semantic detached-worktree validation through `scripts/candidate-r30/minimax-authority.mjs`.
- [x] Reproduce and close `BLOCKED_DEPLOYMENT_AUTHORITY_INVALID`.
- [x] Reproduce MiniMax Gate 2 `BLOCKED_NPM_CACHE_MISSING_APPROVAL_REQUIRED` on `4e46dad574804b38b2a10b05f70d1aa2b551c64b`.
- [x] Add `scripts/candidate-r30/npm-cache-hydrate.mjs`.
- [x] Require exact owner token `OWNER_APPROVAL_FOR_MINIMAL_NPM_REGISTRY_READ_ONLY_EGRESS`.
- [x] Validate exact commit, detached/clean hydration worktree, package-lock version/SHA256, and reviewed HTTPS registry origins before egress.
- [x] Reject credential-bearing, non-HTTPS, GitHub, Git, SSH, and unreviewed dependency origins.
- [x] Strip inherited proxy, registry, token, and npm user/global config authority.
- [x] Disable lifecycle scripts for cache hydration.
- [x] Restrict the npm child to a localhost CONNECT proxy under `sandbox-exec`; allow the parent proxy to connect only to `registry.npmjs.org:443`.
- [x] Require a deny-network `npm ci --ignore-scripts --offline` probe.
- [x] Bind an exclusive receipt to exact source, package-lock SHA256, cache path/aggregate SHA256, npm identity, commands, logs, proxy audit, and offline probe.
- [x] Add RED→GREEN tests for owner token/path parsing, proxy sandbox profile, real lock-origin policy, cache identity tamper, paired runner arguments, and offline plan truth.
- [x] Add candidate `--npm-cache-dir` and `--npm-cache-receipt` arguments.
- [x] Revalidate receipt/source/lock/cache bytes before Gate 2.
- [x] Keep candidate Gate 2 `npm ci --offline` under `(deny network*)`; map a receipt-bound miss to `BLOCKED_NPM_APPROVED_CACHE_INCOMPLETE`.
- [x] Rewrite `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` for a dedicated hydration worktree, separate candidate worktree, new cache/receipt/evidence, and exact return package.
- [x] Keep product scope and dependency major versions unchanged.
- [x] Require the R32 PR HEAD to pass the complete 17-step `copilot-source-gate`.
- [ ] Repeat the complete gate after R33, then freeze and externally report the
  new exact SHA without another tracked commit.

## P0 — MiniMax Code Local Hydration And Candidate

- [ ] Receive the final 40-character PR #14 HEAD as `EXACT_FINAL_HEAD`. All previously reported deployment SHAs are invalid after tracked hydration changes.
- [ ] Fetch `refs/pull/14/head` and prove `FETCH_HEAD` equality.
- [ ] Materialize authority from the exact Git object.
- [ ] Treat the old `4e46...` failed worktree/evidence as `REFERENCE_ONLY`; never reuse them.
- [ ] Create a new dedicated clean detached hydration worktree.
- [ ] Use a new isolated cache and new exclusive receipt outside the repository.
- [ ] Run `npm-cache-hydrate.mjs` once with the exact owner token.
- [ ] Return hydration receipt/SHA256, lock SHA256, proxy audit, npm identity, cache identity, commands/logs, and deny-network offline-probe PASS.
- [ ] Create a separate new clean detached candidate worktree and new evidence directory.
- [ ] Run all candidate source contracts.
- [ ] Dry-run with paired `--npm-cache-dir` and `--npm-cache-receipt`; require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [ ] Execute `scripts/candidate-r30/run-candidate.mjs` exactly once with the paired cache/receipt.
- [ ] Never edit source/tests/runner/governance, broaden egress, enable lifecycle scripts, reuse paths, clean in place, or retry automatically.
- [ ] On `BLOCKED_NPM_CACHE_HYDRATION_*`, `BLOCKED_NPM_CACHE_RECEIPT_*`, or `BLOCKED_NPM_APPROVED_CACHE_INCOMPLETE`, stop and return exact evidence.
- [ ] Return complete Gate 2–12 evidence, source/artifact/runtime identities, `113/113`, three performance runs, screenshots, process terminal state, `CANDIDATE-MANIFEST.json`, and `R30-COMPLETE.json`.

## P0 — Codex Independent Acceptance

- [ ] Start only after a complete internally consistent MiniMax receipt.
- [ ] Independently verify authority/source/cache/artifact/runtime identity.
- [ ] Operate the packaged application on the real macOS computer.
- [ ] Verify focused product journeys and real packaged offline local-ASR.
- [ ] Report P0/P1/P2 findings and a fail-closed Release Gate verdict without source repair.

## Open Release Gates

- [ ] Candidate-bound performance and three verify-fix rounds.
- [ ] Developer ID signing.
- [ ] Apple notarization, stapling, validation, Gatekeeper install/launch evidence.
- [ ] Human Owner Gate and required use evidence.

## Deferred

- Windows real-machine/signing/install/screenshots → Phase 1.1.
- Tencent deployment, Remote/live, and optional Backup → post-MVP.
- 3D graph and broader expansion → post-MVP.
- Mobile/web, multi-user, plugins, i18n, broad enterprise security review, and
  major dependency upgrades → post-MVP.
