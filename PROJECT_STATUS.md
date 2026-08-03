# Copilot App — Current Project Status

## Verdict

`BLOCKED / MVP_NOT_COMPLETE / RELEASE_NOT_READY / EXPERIENCE_NOT_READY / NOT_RUNTIME_PROOF`

The macOS MVP remote source is complete enough for another exact-SHA local candidate attempt, but no current candidate, artifact SHA-256, runtime ID, packaged Electron result, independent Codex acceptance, or Human Owner Gate exists.

## Current source chain

- Repository: `zhouzengrui369-commits/copilot-app`
- Main observed at takeover: `e91cafaa22ea100428b404b371aa35dce535c5bf`
- Original product takeover: `codex/p0-owner-gate@6aa6b8c0792c5549b818107a0f64e4f32651dacd`
- Consolidated remote MVP source: `chatgpt/mvp-source-finalization@74454d21910f0c01e0b9d4f8117b4394defe3228`
- Source gate: run `30784565586`, all 17 steps PASS
- Active repair branch: `chatgpt/gate2-native-cache-hydration`
- Exact repair deployment SHA: externally supplied only after the final source gate; tracked files do not self-embed their containing commit.

The exact Git commit object, not a branch tip or stale worktree, is the only deployment authority.

## Source checkpoint

The consolidated R31/R44 product source contains:

- local-first notes, KB, WIKI, KG, RAG, Todo, schedule, and persistence boundaries;
- embedded-local production embeddings and explicit Ollama compatibility;
- grounded Ask answers with verifiable local sources;
- Ask → source reader → same-exchange return continuity;
- canonical Todo create/list/readback, source links, All/Unscheduled discovery, editing, and focused navigation;
- app-embedded local-ASR source and package contracts;
- twelve fail-closed candidate gates;
- desktop Phase 1 source suite `1107/1107`;
- strict global and per-file critical coverage;
- production CycloneDX SBOM;
- exact Electron list-only discovery `113 tests in 9 files`;
- clean tracked and untracked source.

These are source results, not Electron runtime proof.

## First exact MVP candidate attempt

MiniMax Code executed the exact frozen source `74454d21910f0c01e0b9d4f8117b4394defe3228` under the approved contract.

Completed before the blocker:

- exact PR fetch, SHA binding, exact-object authority, and new-path checks PASS;
- clean hydration worktree and `34/34` focused cache/runner contracts PASS;
- one registry-only cache hydration PASS: 5,388 files, approximately 464 MiB;
- online npm hydration and deny-network `--ignore-scripts` offline probe PASS;
- clean candidate worktree and all stale-input checks PASS;
- complete candidate source contracts `68/68` PASS;
- dry-run PASS with `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`;
- one candidate execution started.

The candidate stopped at Gate 2 with:

```text
BLOCKED_NPM_OFFLINE_INSTALL_FAILED
```

No source changes were made by MiniMax. No package, Electron candidate, artifact identity, runtime ID, screenshot, performance receipt, signing, notarization, Release, or Human Owner Gate was produced.

## Root cause

The prior hydration intentionally ran `npm ci --ignore-scripts`, while the candidate correctly ran full lifecycle `npm ci --offline` under `(deny network*)`.

`better-sqlite3` then attempted its install lifecycle:

1. prebuilt binary acquisition from GitHub;
2. fallback node-gyp header acquisition from nodejs.org.

Both network attempts were correctly denied. The old registry-only cache proved npm tarball availability but did not prove lifecycle and native-toolchain closure. Adding `--ignore-scripts` to the candidate would hide the native runtime requirement and is rejected. Allowing candidate egress is also rejected.

## R45 Gate 2 repair

The active repair introduces a separate bounded native-toolchain hydration:

- new exact owner token: `OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION`;
- new hydrator: `scripts/candidate-r30/npm-native-cache-hydrate.mjs`;
- new source-defined official-host allowlist;
- localhost CONNECT proxy only;
- inherited npm config, registry, proxy, credentials, Electron mirrors, and native overrides stripped;
- exact package-lock `hasInstallScript` set locked;
- lifecycle scripts enabled during hydration and candidate install;
- `better-sqlite3` built from source;
- Node and Electron headers stored under the new receipt-bound cache;
- online Electron 38 arm64 native rebuild required;
- full lifecycle `npm ci --offline` proof under deny-network required;
- offline Electron arm64 native rebuild proof required;
- Electron executable cache proof required;
- all cache bytes and the aggregate cache identity hashed;
- candidate install revalidates the receipt, uses no network, and proves the cache did not mutate.

The old hydration cache, receipt, worktrees, evidence, and failed candidate are `FORBIDDEN_REFERENCE_ONLY` and cannot be reused after this source change.

## Role boundary

1. ChatGPT develops the bounded GitHub repair and Draft PR only.
2. MiniMax Code may execute only the exact externally frozen repair SHA in new detached worktrees and may not edit source locally.
3. Codex may begin independent real Electron acceptance only after a complete source/artifact/runtime-bound MiniMax evidence package exists.
4. MiniMax self-test, CI, browser fixtures, package success, or PR merge cannot substitute for Codex acceptance.

## Remaining gates

- Complete `copilot-source-gate` on the exact R45 fix head.
- Obtain explicit Owner authority for one bounded native-toolchain hydration.
- Run one new hydration using new paths and a new receipt.
- Run one new candidate exactly once.
- Pass Gate 2 full lifecycle install under deny-network.
- Pass Gates 3–12, including packaged Electron `113/113`, three performance runs, screenshots, identities, and clean terminal state.
- Independently verify the exact candidate through Codex on the real Mac.
- Complete candidate-bound verify-fix rounds.
- Prove real packaged offline local ASR.
- Complete signing, notarization, stapling, Gatekeeper, and Human Owner Gate unless Owner explicitly revises the v6.2 release boundary.

## Next single action

Pass the complete source gate on the exact R45 repair head. Then MiniMax Code may perform one new explicitly authorized bounded native-toolchain hydration and one new candidate attempt using entirely new cache, receipt, worktree, evidence, artifact, and runtime identities.
