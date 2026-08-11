# Copilot App Risks — R45 Mirror

`BLOCKED / MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF`

Root `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `DECISIONS.md`, and `rules.md` are authoritative.

## R1 — Source evidence could be misreported as product completion

**State:** OPEN / P0 governance risk.

GitHub source gates, TypeScript tests, coverage, SBOM, exact discovery, PR merge, and package commands cannot prove the packaged Electron product, persistence, performance, signing, notarization, or Human Owner Gate.

**Control:** all current surfaces retain `MVP_NOT_COMPLETE`; candidate/artifact/runtime fields remain unset until a complete exact-SHA MiniMax package and independent Codex acceptance exist.

## R2 — Mutable branch or stale worktree could become false authority

**State:** CONTROLLED.

A branch can move and a stale worktree can omit files that exist in the approved Git object.

**Control:** MiniMax receives `PR_NUMBER` and `EXACT_FINAL_HEAD`, fetches the exact PR object, proves equality, and reads authority through `git cat-file`/`git show`. `scripts/candidate-r30/minimax-authority.mjs` creates a SHA256 receipt without network, worktree, or evidence side effects.

## R3 — Registry-only cache cannot satisfy native lifecycle scripts

**State:** REPRODUCED / R45 REPAIR UNDER REVIEW.

The old hydration disabled lifecycle scripts, while candidate Gate 2 enabled them under deny-network. `better-sqlite3` attempted a GitHub prebuild and then Node headers and stopped with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED`.

**Control:** the new native-toolchain hydrator must prove a full lifecycle install and Electron arm64 native rebuild both online through the bounded proxy and offline under deny-network before a cache receipt is accepted.

## R4 — Native hydration could silently expand network authority

**State:** CONTROLLED BY SOURCE CONTRACT.

Node/Electron lifecycle tooling may contact npm, nodejs.org, Electron distribution hosts, or GitHub release-asset hosts. Unbounded process network would violate the local candidate contract.

**Control:** every hydration child runs under `sandbox-exec` and can connect only to a localhost CONNECT proxy. The proxy permits only the exact source-defined official-host list, records all CONNECT requests, and fails on any denied destination. Candidate processes receive no proxy or network authority.

## R5 — Credentials, mirrors, or global npm config could alter hydration

**State:** CONTROLLED.

Inherited `.npmrc`, registry mirrors, proxy variables, GitHub/npm tokens, Electron mirrors, dist URLs, or node-gyp overrides could change bytes or destinations.

**Control:** hydration uses two distinct exclusive npm config files and strips registry, proxy, token, Electron mirror, dist URL, and native target authority. The receipt binds commands, source, lockfile, host audit, cache bytes, and exact header root.

## R6 — Receipt-valid cache could mutate during candidate install

**State:** CONTROLLED.

An install script could modify the shared cache after receipt validation.

**Control:** Candidate Gate 2 validates the receipt and cache, performs the full lifecycle install under deny-network, then revalidates every cache byte and aggregate SHA256 before continuing. Any mutation blocks.

## R7 — Ignoring lifecycle scripts could create a false green candidate

**State:** REJECTED DESIGN.

Using `--ignore-scripts` in the candidate could let source tests pass while native Electron dependencies remain absent or ABI-incompatible.

**Control:** lifecycle scripts stay enabled. `better-sqlite3` is built from source with receipt-bound headers. Packaged native staging and Electron runtime smoke remain later candidate gates.

## R8 — R28 or historical candidate evidence could be reused

**State:** CONTROLLED.

R28 is `NEVER_RUN / PERMANENTLY_REJECTED`. The old registry-only cache, receipt, failed candidate worktree, evidence, and runtime placeholders cannot define the new source or candidate.

**Control:** every tracked source change requires new worktrees, cache, receipt, evidence, artifact SHA256, runtime ID, screenshots, performance records, and manifests.

## R9 — Native cache receipt may not match exact source or package lock

**State:** CONTROLLED.

Package versions or lifecycle sets can drift while cache paths remain the same.

**Control:** receipt validation recomputes source/lock identity, exact `hasInstallScript` package set, Electron version, header root, cache file count/bytes/aggregate SHA256, and offline proof fields.

## R10 — Electron runtime or product continuity may still fail after Gate 2

**State:** OPEN.

Passing Gate 2 only unlocks Gates 3–12. Packaged Electron `113/113`, full quit/relaunch, grounded source continuity, Todo discoverability/editing, local ASR, performance, screenshots, and process termination remain unproven.

**Control:** MiniMax must stop at the first later blocker. Codex independently operates the same source/artifact/runtime identity. Human Owner Gate remains blocked until candidate-bound P0=0.

## R11 — Signing and notarization remain unresolved

**State:** OPEN RELEASE RISK.

The current authorized local result is at most an unsigned diagnostic candidate.

**Control:** Developer ID signing, Apple notarization, stapling, validation, Gatekeeper evidence, and Owner release decision remain separate gates. No Gate 2 work modifies credentials or signing configuration.

## R12 — Candidate performance evidence may be incomplete or unbound

**State:** OPEN UNTIL GATE 11.

One benchmark or a run against a different artifact cannot prove performance.

**Control:** Gate 11 requires three distinct candidate-bound runs and one aggregate tied to the exact source, artifact, runtime, and test-data identity. Gate 12 hashes the final evidence.

## R13 — SBOM or SHA256 evidence could omit controlling inputs

**State:** CONTROLLED BY SOURCE GATES 3, 5, AND 12.

**Control:** Gate 3 hashes every tracked regular file, Gate 5 validates the production CycloneDX SBOM, and Gate 12 binds source, native cache, artifacts, runtime, screenshots, performance, and terminal state.
