# Copilot App TODO

**Current verdict: `BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`.**

The R31/R44 macOS MVP source has passed the complete GitHub source gate, but the first exact candidate stopped correctly at Gate 2. No checked source task implies a packaged Electron candidate, Release, Experience acceptance, signing, notarization, or Human Owner Gate completion.

## P0 — R45 Gate 2 Native-Cache Repair

- [x] Freeze PR #20 source `74454d21910f0c01e0b9d4f8117b4394defe3228` after complete `copilot-source-gate` run `30784565586` PASS.
- [x] Execute exact-object setup, source authority, and new-path gates.
- [x] Complete one registry-only cache hydration and deny-network `--ignore-scripts` probe.
- [x] Pass hydration contracts `34/34`, candidate source contracts `68/68`, and dry-run.
- [x] Execute the candidate exactly once and stop at the first fail-closed blocker.
- [x] Record `BLOCKED_NPM_OFFLINE_INSTALL_FAILED` at Gate 2 with `SOURCE_CHANGES_BY_MINIMAX = NONE`.
- [x] Identify the exact contradiction: hydration disabled lifecycle scripts while candidate correctly enabled them under deny-network.
- [x] Reject candidate `--ignore-scripts` because native runtime truth must not be hidden.
- [x] Reject candidate egress because Gate 2 remains deny-network.
- [x] Add `scripts/candidate-r30/native-cache-policy.mjs`.
- [x] Add `scripts/candidate-r30/native-cache-runtime.mjs`.
- [x] Add `scripts/candidate-r30/npm-native-cache-hydrate.mjs`.
- [x] Require `OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION`.
- [x] Lock the exact package-lock `hasInstallScript` package set.
- [x] Restrict hydration child processes to a localhost CONNECT proxy and exact official-host allowlist.
- [x] Strip inherited npm config, registry, proxy, credentials, Electron mirrors, dist URLs, and native-build overrides.
- [x] Require lifecycle scripts and build-from-source native work during hydration.
- [x] Require Node/Electron headers and Electron distribution caches under one new receipt-bound root.
- [x] Require online Electron 38 arm64 `better-sqlite3` rebuild.
- [x] Require full lifecycle `npm ci --offline` under `(deny network*)` before receipt emission.
- [x] Require offline Electron arm64 native rebuild using the exact receipt-bound header root.
- [x] Hash every regular cache file and aggregate cache identity.
- [x] Require candidate Gate 2 to revalidate the receipt and prove cache immutability after full lifecycle install.
- [x] Replace historical PR #14 bootstrap literals with generic `PR_NUMBER` + `EXACT_FINAL_HEAD` exact-object authority.
- [ ] Pass all source contracts and the complete 17-step GitHub source gate on the exact final R45 repair head.
- [ ] Freeze and externally report the new exact 40-character `EXACT_FINAL_HEAD` without another tracked source change.

## P0 — MiniMax Code New Hydration And Candidate

- [ ] Use a new clean detached hydration worktree at the exact R45 head.
- [ ] Treat the prior 74454d registry-only cache, receipt, worktrees, evidence, and blocker package as `FORBIDDEN_REFERENCE_ONLY`.
- [ ] Use a new native cache root and new exclusive receipt outside the repository.
- [ ] Run `scripts/candidate-r30/npm-native-cache-hydrate.mjs` exactly once with the exact Owner token.
- [ ] Return exact source, package-lock, lifecycle set, CONNECT audit, header root, cache ledger, and offline proof identities.
- [ ] Create a separate new clean detached candidate worktree and evidence directory.
- [ ] Fetch the active Draft PR head and prove `FETCH_HEAD == EXACT_FINAL_HEAD == git HEAD`.
- [ ] Materialize authority through `scripts/candidate-r30/minimax-authority.mjs` from the exact Git object.
- [ ] Run `node --test scripts/candidate-r30/*.test.mjs`.
- [ ] Run `scripts/candidate-r30/run-candidate.mjs --dry-run`; require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [ ] Execute `scripts/candidate-r30/run-candidate.mjs` exactly once with the native cache and receipt.
- [ ] Pass Gate 2 full lifecycle install under deny-network with no cache mutation.
- [ ] Pass Gates 3–12 without source edits, online retry, authority expansion, or skipped evidence.
- [ ] Return complete source/artifact/runtime/test-data identities, packaged Electron `113/113`, three performance runs, screenshots, terminal state, `CANDIDATE-MANIFEST.json`, and `R30-COMPLETE.json`.
- [ ] Stop and return exact evidence on any `BLOCKED_NATIVE_CACHE_*`, candidate, build, package, Electron, performance, identity, or process blocker.

## P0 — Codex Independent Acceptance

- [ ] Start only after a complete internally consistent MiniMax receipt.
- [ ] Independently verify source, native-cache receipt, artifact, runtime, ecosystem baseline, and test-data identity.
- [ ] Operate the exact packaged Electron candidate on the real macOS computer.
- [ ] Verify local material → grounded Ask → source → return → Todo → edit → schedule → full quit/relaunch.
- [ ] Verify All / Unscheduled discoverability and exact Todo navigation.
- [ ] Verify real packaged offline local ASR.
- [ ] Report P0/P1/P2 and a fail-closed product/release verdict without source repair.
- [ ] Require candidate-bound `P0=0` before Human Owner Gate eligibility.

## Open release gates

- [ ] Candidate-bound three verify-fix rounds.
- [ ] Developer ID signing.
- [ ] Apple notarization, stapling, validation, and Gatekeeper install/launch evidence.
- [ ] Human Owner Gate and required use evidence.

## Deferred

- Windows real-machine/signing/install/screenshots → Phase 1.1.
- Tencent deployment, Remote/live, and optional Backup → post-MVP.
- 3D graph and broader expansion → post-MVP.
- Mobile/web, multi-user, plugins, i18n, enterprise expansion, and major dependency upgrades → post-MVP.
