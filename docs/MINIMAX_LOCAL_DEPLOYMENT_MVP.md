# MiniMax Code Local Handoff — Copilot App macOS MVP

This document coordinates the next exact-SHA macOS Candidate attempt after R49 stopped before Candidate creation. R31 remains the executable Candidate authority. R47 Knowledge Studio remains product source. R50 supersedes R48's tarball-only prefetch assumption with an explicit npm registry metadata-cache closure proof.

Authoritative executable surfaces:

```text
docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md
scripts/candidate-r30/minimax-authority.mjs
scripts/candidate-r30/registry-prefetch.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## Fixed truth

```text
R50_METADATA_COMPLETE_REGISTRY_PREFETCH_IN_SOURCE
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

All previously attempted source identities, including `74454d21910f0c01e0b9d4f8117b4394defe3228`, `43f151a3a1eb7e0592ff833f0e42892db47d3d65`, `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f`, and `32ff3ebc0b1dc217bf0954974127b0aa68de61f2`, plus their worktrees, caches, partial caches, receipts, evidence, logs, screenshots, artifacts and runtime identities are `FORBIDDEN_REFERENCE_ONLY`. Failed caches remain immutable diagnostic evidence and cannot be deleted, resumed, upgraded or supplied to a later Candidate.

## R49 trigger and deterministic root cause

R49 fetched exact source `32ff3ebc0b1dc217bf0954974127b0aa68de61f2`, passed exact-object authority and `95/95` source contracts, then executed one bounded hydration. Candidate execution count remained zero. R48's lockfile-derived tarball batches warmed tarball content, but the following strict lifecycle `npm ci --offline` reported:

```text
ENOTCACHED: request to https://registry.npmjs.org/typescript failed:
cache mode is 'only-if-cached' but no cached response is available
```

The deterministic gap is npm packument/metadata cache closure. Cumulative proxy evidence also contained a registry transport reset, but R50 scopes transport evidence to each stage so an earlier tunnel error cannot mask a later offline-cache blocker.

## R50 metadata-complete registry hydration

The successor preserves all security boundaries:

- one Owner authorization for one hydration invocation;
- `automaticRetry=false`;
- no retry/backoff, online resume, partial-cache reuse or Candidate fallback;
- exact official-host allowlist unchanged;
- localhost CONNECT proxy only during the bounded hydration phase;
- Candidate Gate 1–12 remains `(deny network*)`;
- source, tests, package files, lockfile, credentials, global configuration, signing, notarization and cloud state remain untouched during local execution.

The single hydration invocation now executes:

```text
exact package-lock v3
→ deterministic exact name@version + canonical tarball + integrity manifest
→ metadataMode=name-version-packument-and-tarball
→ bounded 24-item npm pack --ignore-scripts name@version batches
→ isolated npm metadata/packument + tarball cache
→ strict (deny network*) npm ci --offline --ignore-scripts registry-cache closure proof
→ remove closure-proof node_modules
→ full lifecycle npm ci --offline with the existing bounded lifecycle-asset proxy
→ require zero registry.npmjs.org requests after closure
→ Electron 38 arm64 native hydration
→ remove node_modules
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ cache ledger + PASS receipt
```

R50 exact strategy values:

```text
registryPrefetch.strategy=lockfile-batched-name-version-npm-pack-v2
registryPrefetch.metadataMode=name-version-packument-and-tarball
registryPrefetch.batchSize=24
registryCacheClosure.strategy=deny-network-offline-ci-ignore-scripts-v1
registryCacheClosure.networkAuthority=deny-network
onlineHydration.registryMode=lockfile-name-version-prefetch-closure-then-offline-ci
onlineHydration.registryRequestCountAfterClosure=0
```

A prefetch or closure failure stops the single invocation. `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE` means the cache cannot satisfy npm offline reify and is non-reusable. Any registry request after closure is `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH`. No PASS receipt may coexist with either condition.

## Resume trigger

MiniMax remains stopped until one handoff contains all four fields:

```text
SOURCE_COMMIT=<new exact 40-character PR #20 head>
PR=20
SOURCE_GATE=PASS
RUN_STAMP=<new unique value>
```

Any missing field means `STOPPED`. The source SHA and run stamp must differ from every attempted predecessor.

## New paths only

Create a new detached hydration worktree, native cache root, exclusive receipt, detached Candidate worktree, evidence directory and task root. Never search for or reuse a predecessor partial cache. Old evidence stays intact.

The exact Owner token remains:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

It authorizes one hydration invocation for the supplied exact commit, not a retry, and never grants network to Candidate Gates.

## Required hydration proof

A PASS receipt must bind:

- exact source commit and package-lock SHA-256;
- exact reviewed lifecycle package set;
- npm executable/version and `automaticRetry=false`;
- exact allowed hosts and complete nonfatal CONNECT audit;
- deterministic R50 `name@version` manifest SHA-256, entry count, metadata mode, batch size/count and batch receipts;
- strict deny-network registry-cache closure PASS with lifecycle scripts disabled;
- zero `registry.npmjs.org` requests after closure;
- npm/Electron/electron-builder/node-gyp/header/prebuild cache layout;
- exact Electron header root;
- full lifecycle `npm ci --offline` result after closure;
- bounded Electron arm64 native hydration;
- final deny-network full install and Electron native proofs;
- all regular cache-file hashes and aggregate SHA-256;
- restored Electron executable;
- final clean detached source;
- `candidateCreated=false` and `evidenceCreated=false`.

## Candidate requirements

MiniMax must prove:

```text
FETCH_HEAD = supplied SOURCE_COMMIT = detached hydration HEAD = detached candidate HEAD
```

Then run exact-source contracts, `run-candidate.mjs --dry-run`, and one real Candidate execution only. The runner validates source/receipt/cache and Gate 2 performs the full lifecycle install under deny-network. Stop at the first blocker; do not repair source or retry online.

The twelve Candidate gates remain the R31 contract, including exact `113 tests in 9 files`, packaged Electron `113/113` with zero skipped/unexpected/flaky, three distinct Candidate-bound performance runs, identities/manifests/screenshots, clean process termination and final receipt.

## Product journey and R47 Knowledge Studio

The same packaged Candidate must prove:

```text
local material
→ grounded Ask answer
→ verified local source
→ full reader
→ same Ask exchange after return
→ Todo create/readback
→ exact Todo in All / Unscheduled
→ edit with source preservation
→ due-date / schedule association
→ complete Electron quit
→ same-artifact relaunch and persistence readback
```

It must also exercise packaged `知识台 / Wiki Studio`: Sources, Wiki/provenance, Review Queue, Activity, Graph, 4-Signal Connections and explicit `重新整理`, with Review metadata remaining separate from canonical local truth. Packaged offline local ASR must be verified independently of mocks/fixtures.

## Required evidence

```text
PLAN.md
RESULT.md
EVIDENCE.md
commands.log
changed-files.txt
CANDIDATE-MANIFEST.json
R30-COMPLETE.json
```

Bind source snapshot, R50 native-cache receipt and aggregate hash, artifact/ZIP/DMG/app/executable/`app.asar`, runtime ID, ecosystem baseline, deterministic test-data manifest, commands/exit codes, `113/113`, performance receipts, Wiki Studio/critical-loop screenshots, local ASR proof and terminal state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

## Codex boundary

MiniMax technical evidence is not independent product acceptance. Codex starts only after a complete internally consistent same-source/artifact/runtime/test-data package exists and must operate that exact packaged Candidate on the real Mac.

Even a fully successful unsigned MiniMax Candidate remains:

```text
PASS_UNSIGNED_DIAGNOSTIC_CANDIDATE
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
BLOCKED_UNSIGNED_NOT_NOTARIZED
```

MiniMax must not merge PR #20, change `main`, sign, notarize, modify credentials/global configuration, expand deferred platforms/scope, or declare `MVP_READY`, `RELEASE_READY`, `EXPERIENCE_READY` or `HUMAN_OWNER_GATE_PASS`.
