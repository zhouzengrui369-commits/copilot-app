# Changelog

## 2026-08-03 — R46 Native Hydration Transport Stability

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`.

### Local incident

- MiniMax executed the R45 exact source `43f151a3a1eb7e0592ff833f0e42892db47d3d65` in a fresh detached hydration worktree.
- Exact-object authority, new-path checks, and `83/83` source contracts passed.
- The one authorized native-toolchain hydration stopped before candidate creation after npm reported `ECONNRESET` during a long registry fetch sequence.
- The failed run retained a partial 477 MiB cache as immutable diagnostic evidence and produced no PASS receipt, candidate, artifact, runtime ID, Electron process, signing, notarization, Release, or Human Owner Gate result.
- A second hydrator invocation was attempted contrary to the one-invocation contract and was immediately rejected by `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS`; it performed no second hydration and created no candidate state.

### Decision

- Preserve `automaticRetry=false`; no retry is hidden inside the hydrator.
- Keep the candidate fully deny-network and keep the official-host allowlist unchanged.
- Improve the single authorized invocation with TCP keepalive, no-delay, long idle timeout, explicit fetch timeout, and bounded socket concurrency.
- Fix npm fetch retries at zero and make retry-policy drift part of the receipt contract.
- Record per-CONNECT timing, directional bytes, socket policy, and terminal transport error.
- Classify reset/timeout/pipe/abort failures with stable `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_*` codes.
- Mark transport-failed cache roots with exclusive `HYDRATION-FAILED.json`, `status=partial_failed_transport`, `reusable=false`, and `passReceiptCreated=false`.
- Reject any cache containing the partial marker and reject any PASS receipt containing a fatal tunnel record.

### Handoff

- MiniMax remains stopped until one handoff supplies `SOURCE_COMMIT`, `PR`, `SOURCE_GATE=PASS`, and a new `RUN_STAMP`.
- The next run must use entirely new hydration/candidate worktrees, cache, receipt, evidence, artifact, runtime, screenshots, and performance identities.
- R45 source, run stamp `20260803T123238Z`, partial cache, evidence, and logs remain `FORBIDDEN_REFERENCE_ONLY`.

Rollback: revert this bounded transport, audit, test, and handoff patch. Rollback changes no product data, package version, credential, cloud resource, signing state, candidate artifact, or runtime.

## 2026-08-03 — R45 Gate 2 Native-Toolchain Cache Repair

Status remains `BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`.

### Local incident

- MiniMax Code executed the exact frozen macOS MVP source `74454d21910f0c01e0b9d4f8117b4394defe3228`.
- Exact-object setup, authority, clean worktrees, new paths, one registry-only hydration, `34/34` cache contracts, `68/68` source contracts, and dry-run all passed.
- The candidate was executed exactly once and stopped at Gate 2 with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED`.
- `better-sqlite3` lifecycle execution first attempted a prebuilt GitHub asset and then node-gyp headers from nodejs.org; candidate `(deny network*)` correctly blocked both.
- MiniMax made no source change, performed no online retry, and produced no candidate, artifact SHA-256, runtime ID, Electron evidence, signing, notarization, Release, or Human Owner Gate result.

### Root cause

- The old hydration proved only npm tarball availability because it used `npm ci --ignore-scripts`.
- The candidate correctly required a full lifecycle `npm ci --offline`.
- The old receipt therefore did not bind Node/Electron headers, Electron distributions, or native rebuild proofs.
- Candidate `--ignore-scripts` is rejected because it would hide native runtime requirements.
- Candidate network expansion is rejected because Gate 2 remains deny-network.

### Source repair

- Added `scripts/candidate-r30/native-cache-policy.mjs`.
- Added `scripts/candidate-r30/native-cache-runtime.mjs`.
- Added `scripts/candidate-r30/npm-native-cache-hydrate.mjs` and direct RED→GREEN contracts.
- Added exact owner authority `OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION`.
- Locked the exact package-lock `hasInstallScript` set.
- Restricted hydration children to a localhost CONNECT proxy with a source-defined official npm/Node/Electron/GitHub release-host allowlist.
- Stripped inherited npm configs, registry, proxy, tokens, Electron mirrors, dist URLs, and native-build overrides.
- Enabled lifecycle scripts and build-from-source native work during hydration.
- Required receipt-bound npm, Electron, electron-builder, node-gyp/header, and prebuild cache surfaces.
- Required online Electron 38 arm64 native rebuild.
- Required full lifecycle `npm ci --offline` and Electron arm64 native rebuild under `(deny network*)` before a receipt can pass.
- Required an Electron executable cache proof, all-regular-file cache ledger, and aggregate SHA-256.
- Updated candidate Gate 2 to require the new receipt, perform the full lifecycle offline install, redirect logs to evidence, revalidate all cache bytes after install, and supply only the exact receipt-bound Electron headers to native staging.
- Replaced historical PR #14 bootstrap literals with generic `PR_NUMBER` and externally supplied `EXACT_FINAL_HEAD` exact Git object authority.

### Evidence and rollback

- Old cache, receipt, worktrees, evidence, artifact, and runtime identities are `FORBIDDEN_REFERENCE_ONLY` after this source change.
- The repair changes no application database, user data, credential, cloud resource, package version, signing setting, or product scope.
- Rollback is a source-only revert of the R45 hydrator, receipt validator, runner Gate 2, tests, and governance updates.

## 2026-08-03 — R44 One-Shot macOS MVP Remote Source Consolidation

- Consolidated the complete remote macOS-first product source into Draft PR #20.
- Exact source `74454d21910f0c01e0b9d4f8117b4394defe3228` passed all 17 `copilot-source-gate` steps.
- The source includes grounded Ask/source truth, EXP-COP-008 Todo closure, EXP-COP-009 source-reader return continuity, local-first persistence, app-embedded local-ASR source contracts, exact candidate identities, production SBOM, strict coverage, and exact Electron discovery `113 tests in 9 files`.
- GitHub source completion did not claim Electron runtime, artifact, runtime ID, signing, notarization, Release, Experience, or MVP completion.

## 2026-08-01 — R41 Offline Cache Identity Alignment

- Isolated npm user/global configs and stripped inherited registry, proxy, and token authority.
- Aligned online cache hydration and candidate offline install with `--replace-registry-host=always`.
- Kept candidate Gate 2 offline under `(deny network*)` and prohibited automatic online fallback.
- R41 closed registry cache-key drift but did not yet prove lifecycle/native toolchain closure.

## R31/R30 preserved source history

The complete pre-R30 changelog remains byte-preserved at [`docs/history/CHANGELOG_PRE_R30.md`](docs/history/CHANGELOG_PRE_R30.md). Git history preserves the detailed R30/R31/R32/R33/R34 incidents and repairs.

Current retained R31/R30 contracts include:

- deployment authority read from the exact Git object;
- Gate 2 deny-network dependency and native-toolchain authority;
- Gate 3 complete all-tracked-file SHA-256 ledger;
- Gate 9 exact `113 tests in 9 files` discovery and test-data manifest;
- Gate 11 three candidate-bound performance runs;
- Gate 12 final source/artifact/runtime/test-data/evidence manifest;
- `MVP_NOT_COMPLETE` until independent candidate-bound Electron acceptance succeeds.
