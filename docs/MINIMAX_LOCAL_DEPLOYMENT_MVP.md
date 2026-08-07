# MiniMax Code Local Handoff — Copilot App macOS MVP

R31 remains the executable twelve-gate Candidate authority. R47 Knowledge Studio remains product source. R50 remains the current registry metadata-cache closure implementation. R52 is a governance-only successor authorization after R51 was consumed by an outer dispatcher timeout and a later duplicate-run path collision.

## Fixed truth

```text
R50_METADATA_COMPLETE_REGISTRY_PREFETCH_IN_SOURCE
R51_FROZEN_EVIDENCE_ONLY
R52_NEW_EXACT_SHA_REQUIRED
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

Authoritative executable surfaces remain:

```text
docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md
scripts/candidate-r30/minimax-authority.mjs
scripts/candidate-r30/registry-prefetch.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## R51 terminal state

Exact source `2835e36ee37a417bd88e5a8dc1187421eb61e966` had already passed `copilot-source-gate` run `31162006562`, job `92814322597`, `17/17 PASS`. An earlier R51 local dispatch then created the fixed-run task root, detached hydration worktree and fresh native-cache root and entered the single Owner-authorized hydrator invocation. The outer command driver terminated that process at a 120-second wall-clock limit before a PASS receipt, registry-cache closure proof, Candidate worktree, artifact or runtime ID existed. The partial cache was marked non-reusable.

A later R51 dispatch using the same fixed run stamp correctly stopped at `BLOCKED_NEW_PATH_ALREADY_EXISTS` before authority bootstrap or hydration because those R51 paths already existed. Both R51 evidence sets and all R51 paths are immutable `FORBIDDEN_REFERENCE_ONLY`.

The R51 event is not a product or R50 source defect. It is an execution-envelope failure. It does not authorize deletion, resume, partial-cache reuse, a second hydration invocation on the consumed source, or same-SHA re-dispatch.

## Resume trigger

MiniMax remains stopped until one handoff contains all fields:

```text
SOURCE_COMMIT=<new exact 40-character PR #20 head>
PR=20
SOURCE_GATE=PASS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
```

Any missing field means `STOPPED`. **The source SHA and run stamp must differ from every attempted predecessor.**

`OUTER_DRIVER_TIMEOUT_SECONDS` is a caller/dispatcher wall-clock allowance only. It must not be implemented as hydrator retry logic. Do not wrap the hydrator in a 120-second command timeout; the caller must permit at least 3600 seconds for the one invocation to finish or emit its own stable blocker.

## R50 metadata-complete hydration remains unchanged

The single Owner-authorized hydration executes:

```text
exact package-lock v3
→ deterministic exact name@version + canonical tarball + integrity manifest
→ metadataMode=name-version-packument-and-tarball
→ bounded 24-item npm pack --ignore-scripts name@version batches
→ isolated npm packument/metadata + tarball cache
→ strict (deny network*) npm ci --offline --ignore-scripts registry-cache closure proof
→ remove closure-proof node_modules
→ full lifecycle npm ci --offline with bounded reviewed lifecycle/native asset proxy
→ require zero registry.npmjs.org requests after closure
→ Electron 38 arm64 native hydration
→ remove node_modules
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ cache ledger + PASS receipt
```

Exact strategy values remain:

```text
registryPrefetch.strategy=lockfile-batched-name-version-npm-pack-v2
registryPrefetch.metadataMode=name-version-packument-and-tarball
registryPrefetch.batchSize=24
registryCacheClosure.strategy=deny-network-offline-ci-ignore-scripts-v1
registryCacheClosure.networkAuthority=deny-network
onlineHydration.registryMode=lockfile-name-version-prefetch-closure-then-offline-ci
onlineHydration.registryRequestCountAfterClosure=0
```

A registry-cache closure failure stops with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE`. Any registry request after closure stops with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH`. No PASS receipt may coexist with either condition.

## Security and retry boundary

The exact Owner token remains:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

It authorizes **one hydration invocation for the new exact source only**. It does not authorize retry or resume. Preserve:

- `automaticRetry=false`;
- no retry/backoff/online resume;
- no predecessor cache or receipt reuse;
- no deletion or mutation of R51 evidence;
- no mirror switching or host-allowlist expansion;
- no package/lockfile/source repair during local execution;
- Candidate Gate 1–12 `(deny network*)`.

If the single hydrator invocation returns a stable blocker, stop immediately and preserve evidence.

## New paths only

For the new source and new run stamp create a new detached hydration worktree, native cache root, exclusive receipt, detached Candidate worktree, evidence directory and task root. Every R44–R51 source/run/worktree/cache/receipt/evidence/artifact/runtime identity is `FORBIDDEN_REFERENCE_ONLY`.

MiniMax must prove:

```text
FETCH_HEAD = supplied SOURCE_COMMIT = detached hydration HEAD = detached candidate HEAD
```

## Candidate execution after hydration PASS

Only after a PASS native-cache receipt:

1. create a fresh detached Candidate worktree;
2. run exact-source Candidate contracts;
3. run `scripts/candidate-r30/run-candidate.mjs --dry-run` and require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`;
4. execute one real Candidate exactly once;
5. stop on the first fail-closed blocker with no source repair or online retry.

The twelve Candidate gates remain the R31 contract, including exact `113 tests in 9 files`, packaged Electron `113/113` with zero skipped/unexpected/flaky, three distinct Candidate-bound performance runs, identities/manifests/screenshots, clean process termination and final receipt.

## Product journey

The same packaged Candidate must prove the preserved critical loop plus R47 Knowledge Studio:

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

Also exercise packaged `知识台 / Wiki Studio`: Sources, Wiki/provenance, Review Queue, Activity, Graph, 4-Signal Connections and explicit `重新整理`, with Review metadata remaining separate from canonical local truth. Packaged offline local ASR must be verified independently of mocks/fixtures.

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

Bind source snapshot, R50 native-cache receipt and aggregate hash, registry manifest and closure proof, artifact/ZIP/DMG/app/executable/`app.asar`, runtime ID, ecosystem baseline, deterministic test-data manifest, commands/exit codes, `113/113`, performance receipts, Wiki Studio/critical-loop screenshots, local ASR proof and terminal state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

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
