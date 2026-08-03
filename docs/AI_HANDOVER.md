# Copilot App AI Handover — R45

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

This file is a mirror. Read root authority first, in this order:

1. `AGENTS.md`
2. `goal.md`
3. `plan.md`
4. `rules.md`
5. `delivery.md`
6. `PROJECT_STATE.yaml`
7. `PROJECT_STATUS.md`
8. `TODO.md`
9. `DECISIONS.md`
10. `CHANGELOG.md`

The complete pre-R30 detail remains under `docs/history/`. This mirror cannot override root truth.

## Current source truth

- The R31/R44 macOS MVP product source was consolidated at `74454d21910f0c01e0b9d4f8117b4394defe3228` and passed all 17 GitHub source-gate steps.
- That source includes grounded Ask/source truth, Ask → source → return continuity, canonical Todo readback and Unscheduled navigation, local-first persistence, app-embedded local-ASR source contracts, strict coverage, production SBOM, and exact Electron discovery `113 tests in 9 files`.
- Source completion did not create a packaged candidate, artifact SHA-256, runtime ID, Electron acceptance, signing, notarization, Release, Experience acceptance, or Human Owner Gate result.

## First candidate attempt

MiniMax Code executed the exact source once in clean detached worktrees. Exact-object authority, one registry-only hydration, source contracts, and dry-run passed. Candidate Gate 2 then stopped with:

```text
BLOCKED_NPM_OFFLINE_INSTALL_FAILED
```

The old hydration disabled lifecycle scripts, while the candidate correctly enabled them under `(deny network*)`. `better-sqlite3` therefore could not obtain its prebuild or node-gyp headers. No source was changed and no online retry occurred.

## Active R45 repair

R45 introduces a new source-bound native-toolchain receipt:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The hydrator:

- runs only in a new exact detached worktree;
- strips inherited credentials, npm configs, mirrors, registry/proxy authority, dist URLs, and native overrides;
- permits child network only through a localhost CONNECT proxy;
- restricts that proxy to the exact source-defined official npm/Node/Electron/GitHub release-host allowlist;
- enables lifecycle scripts and build-from-source native work;
- hydrates npm, Electron, electron-builder, Node/Electron headers, and prebuild caches;
- proves a full lifecycle offline install and Electron arm64 native rebuild under deny-network;
- hashes every cache file and aggregate identity;
- creates no candidate or candidate evidence.

Candidate Gate 2 remains offline, revalidates the new receipt and cache bytes, runs full lifecycle `npm ci --offline`, and proves the cache remains immutable.

## Role boundary

- ChatGPT performs bounded GitHub remote source work and Draft PR contracts; ChatGPT does not run the local candidate.
- MiniMax Code uses the exact externally frozen SHA in new clean worktrees and produces technical evidence; MiniMax self-test is not acceptance.
- Codex independently operates the exact packaged Electron candidate on the real Mac and issues the candidate-bound product-experience/runtime verdict.
- Owner decides Human Owner Gate and release scope.

## Next action

Pass the complete GitHub source gate on the exact final R45 repair head. Then obtain explicit Owner approval for one new bounded native-toolchain hydration and one new candidate attempt. Do not reuse the old cache, receipt, worktrees, evidence, artifacts, or runtime identity.
