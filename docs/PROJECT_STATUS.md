# Copilot App Project Status — R45 Mirror

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

Root authority must be read first: `goal.md`, `plan.md`, `rules.md`, `delivery.md`, `PROJECT_STATE.yaml`, `PROJECT_STATUS.md`, `TODO.md`, `DECISIONS.md`, and `CHANGELOG.md`. This mirror cannot override them.

## Current stage

The R31/R44 remote macOS MVP source completed GitHub source development at `74454d21910f0c01e0b9d4f8117b4394defe3228`. Source-gate run `30784565586` passed all 17 steps, including Node 24 checks, exact lockfile install, local-first builds/tests, desktop Phase 1 `1107/1107`, strict global/per-file critical coverage, production CycloneDX SBOM, exact Electron discovery `113 tests in 9 files`, and final clean source.

That checkpoint is source evidence only. No current candidate, artifact SHA-256, runtime ID, packaged Electron result, Codex acceptance, signing, notarization, Release, Experience acceptance, or Human Owner Gate exists.

## Gate 2 incident

The first exact candidate attempt passed authority, registry-only hydration, source contracts, and dry-run, then stopped at Gate 2 with:

```text
BLOCKED_NPM_OFFLINE_INSTALL_FAILED
```

The old hydration used `npm ci --ignore-scripts`; the candidate correctly used full lifecycle `npm ci --offline` under `(deny network*)`. `better-sqlite3` attempted a GitHub prebuild and then Node headers, both correctly denied. MiniMax changed no source and made no online retry.

## Active R45 repair

R45 keeps candidate network denied and keeps lifecycle scripts enabled. It adds one separately approved native-toolchain hydration using:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The hydrator is `scripts/candidate-r30/npm-native-cache-hydrate.mjs`. It uses a new clean detached worktree, a localhost CONNECT proxy, and the exact source-defined official-host allowlist. It strips inherited credentials, npm configs, mirrors, registry/proxy settings, dist URLs, and native overrides.

A PASS receipt requires:

- exact source and package-lock identity;
- exact reviewed lifecycle package set;
- online full lifecycle install and Electron 38 arm64 native rebuild;
- receipt-bound npm/Electron/electron-builder/node-gyp/prebuild caches;
- full lifecycle offline install under deny-network;
- offline Electron arm64 native rebuild using the exact hydrated header root;
- Electron executable cache proof;
- all cache-file hashes and aggregate SHA-256;
- final clean source;
- `candidateCreated=false` and `evidenceCreated=false`.

Candidate Gate 2 revalidates the receipt and cache, runs the full lifecycle offline install, redirects npm logs to evidence, proves the cache did not mutate, and passes only the receipt-bound Electron headers to later native staging.

## Exact-object authority

The active handoff receives `PR_NUMBER` and `EXACT_FINAL_HEAD`. MiniMax fetches `refs/pull/${PR_NUMBER}/head`, proves exact equality, and reads the authority, hydrator, and runner from the exact Git object. A mutable branch or stale worktree is not authority.

## Next action

Require the complete source gate on the final R45 repair head. After the final SHA is frozen externally, MiniMax may run one new Owner-approved native hydration and one new candidate attempt using entirely new worktrees, cache, receipt, evidence, artifact, and runtime identity. Codex starts only after a complete internally consistent technical package exists.
