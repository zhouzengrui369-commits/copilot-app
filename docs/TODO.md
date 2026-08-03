# Copilot App TODO — R45 Mirror

`BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`

Root `TODO.md`, `PROJECT_STATE.yaml`, and `PROJECT_STATUS.md` are authoritative. This file mirrors the active exact-SHA handoff.

## GitHub source

- [x] Preserve pre-R30 authority/history and permanently reject never-run R28.
- [x] Complete R31 product/source work on `agent/r31-source-completion`.
- [x] Consolidate the remote macOS MVP source and pass the complete source gate at `74454d21910f0c01e0b9d4f8117b4394defe3228`.
- [x] Retain exact Electron discovery `113 tests in 9 files`, twelve candidate gates, strict coverage, production SBOM, and fail-closed source contracts.
- [x] Keep deployment authority in `scripts/candidate-r30/minimax-authority.mjs` and the exact Git object.
- [x] Replace historical PR-number authority with externally supplied `PR_NUMBER` and `EXACT_FINAL_HEAD`.

## First candidate attempt

- [x] Pass exact-object setup and authority.
- [x] Pass registry-only hydration tests `34/34`.
- [x] Pass candidate source contracts `68/68`.
- [x] Pass dry-run as `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`.
- [x] Execute the candidate exactly once.
- [x] Stop at Gate 2 on `BLOCKED_NPM_OFFLINE_INSTALL_FAILED`.
- [x] Preserve `SOURCE_CHANGES_BY_MINIMAX = NONE` and prohibit reuse of the old cache, receipt, worktrees, evidence, artifact, or runtime identity.

## R45 native-toolchain repair

- [x] Keep the candidate offline under `(deny network*)`.
- [x] Keep lifecycle scripts enabled; do not use candidate `--ignore-scripts`.
- [x] Add `scripts/candidate-r30/native-cache-policy.mjs`.
- [x] Add `scripts/candidate-r30/native-cache-runtime.mjs`.
- [x] Add `scripts/candidate-r30/npm-native-cache-hydrate.mjs`.
- [x] Require `OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION`.
- [x] Lock the exact package-lock `hasInstallScript` package set.
- [x] Use a localhost CONNECT proxy and exact official-host allowlist.
- [x] Strip inherited credentials, npm configs, mirrors, registry/proxy settings, dist URLs, and native overrides.
- [x] Require online full lifecycle install and Electron arm64 native rebuild.
- [x] Require full lifecycle `npm ci --offline` under deny-network.
- [x] Require offline Electron arm64 native rebuild with the receipt-bound header root.
- [x] Require Electron executable cache proof and all-cache aggregate SHA-256.
- [x] Require candidate receipt/cache revalidation and post-install cache immutability.
- [x] Update `docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md` and acceptance contracts.
- [ ] Pass all source contracts and the complete 17-step `copilot-source-gate` on the exact final R45 head.
- [ ] Freeze and externally report that exact SHA without another tracked source change.

## MiniMax new local attempt

- [ ] Create a new clean detached hydration worktree.
- [ ] Use a new native cache root and new exclusive receipt outside the repository.
- [ ] Run `npm-native-cache-hydrate.mjs` exactly once with the exact Owner token.
- [ ] Return source/lock/lifecycle/host-audit/header/cache/offline-proof identities.
- [ ] Create a separate new clean detached candidate worktree and evidence directory.
- [ ] Run `node --test scripts/candidate-r30/*.test.mjs`.
- [ ] Run the runner dry-run and require `PLAN_ONLY_NOT_A_CANDIDATE`.
- [ ] Execute `scripts/candidate-r30/run-candidate.mjs` exactly once.
- [ ] Pass Gate 2 full lifecycle install under deny-network with no cache mutation.
- [ ] Pass Gates 3–12, packaged Electron `113/113`, three performance runs, screenshots, identities, and clean terminal state.
- [ ] Return `CANDIDATE-MANIFEST.json` and `R30-COMPLETE.json` with the complete evidence package.

## Codex independent acceptance

- [ ] Start only after a complete internally consistent MiniMax package.
- [ ] Verify the exact source, native-cache receipt, artifact, runtime, ecosystem baseline, and test-data identity.
- [ ] Operate the real packaged Electron app.
- [ ] Verify local material → grounded Ask → source → return → Todo → edit → schedule → full quit/relaunch.
- [ ] Verify real packaged offline local ASR.
- [ ] Report P0/P1/P2; require candidate-bound `P0=0` before Human Owner Gate eligibility.

## Deferred

Windows remains Phase 1.1. Mobile/web, cloud truth, Remote/live, Backup, 3D graph, plugins, i18n, multi-user, commercial scope, enterprise expansion, and major dependency upgrades remain post-MVP.
