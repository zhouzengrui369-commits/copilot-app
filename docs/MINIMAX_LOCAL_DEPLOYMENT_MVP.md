# MiniMax Code Local Handoff — Copilot App macOS MVP

R31 remains the executable twelve-gate Candidate authority. R47 is the Knowledge Studio product source. R50 defines metadata-complete registry closure. R54 defines durable single-process hydration and source-consumption rules. R56 repairs exact unresolved-root registry identity. R58 makes repository authority bootstrap-safe. R60 reduces the registry-prefetch exposure window without adding retry, mirrors, hosts or Candidate network authority.

## Fixed truth

```text
R50_METADATA_COMPLETE_REGISTRY_PREFETCH_IN_SOURCE
R54_DURABLE_SINGLE_HYDRATOR_POLICY_IN_SOURCE
R55_FROZEN_CONSUMED_REGISTRY_CLOSURE_EVIDENCE_ONLY
R56_EXACT_NESTED_LOCK_REGISTRY_IDENTITY_CLOSURE_IN_SOURCE
R57_FROZEN_CONSUMED_BOOTSTRAP_RUNTIME_EVIDENCE_ONLY
R58_BOOTSTRAP_SAFE_REPOSITORY_AUTHORITY_IN_SOURCE
R58_FROZEN_CONSUMED_REGISTRY_TRANSPORT_EVIDENCE_ONLY
R60_BOUNDED_REGISTRY_PREFETCH_THROUGHPUT_IN_SOURCE
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

Authoritative executable surfaces:

```text
docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md
docs/MINIMAX_LOCAL_DEPLOYMENT_MVP.md
scripts/candidate-r30/minimax-authority.mjs
scripts/candidate-r30/registry-prefetch.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## Consumed predecessor truth

R55 consumed source `69a0e651f599403bf2427fd321d9491bd31f13b0` and exposed the strict closure gap for `typescript@6.0.3`. R56 closed the exact identity gap by keeping the root lock as dependency-closure authority and using Git-tracked nested package-lock v3 files only as exact `name@version -> resolved + integrity` supplements.

R57 consumed source `2927d0e3cd81e3997bb229ce544b95a1e3cbce8b` because repository root was inferred from an extracted `/private/tmp` module location. R58 removed module-location inference: production supplemental-lock discovery is rooted by exactly one absolute hydration `--repository` argument.

A later R58 local run consumed source `d29da3e6dcc9c89d680f56c23e66262e9ee967c1`, RUN_STAMP `20260809T053600Z`. Bootstrap repository authority passed. One durable hydrator completed 21/35 registry-prefetch batches and then stopped fail-closed on `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` after roughly 71 minutes. Closure was never reached, so:

```text
REGISTRY_CACHE_CLOSURE=NOT_REACHED
R55_BLOCKER_REGRESSION=UNVERIFIED
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
SOURCE_CONSUMED=true
```

All R44-R58 local task/worktree/cache/receipt/evidence/artifact/runtime identities are immutable `FORBIDDEN_REFERENCE_ONLY`. A later same-run dispatch stopping on existing paths does not unconsume the earlier R58 hydration identity.

## R60 bounded registry-prefetch throughput

R60 changes only the registry-prefetch npm subprocess throughput bound:

```text
registryPrefetch.strategy=lockfile-batched-name-version-npm-pack-v2
registryPrefetch.metadataMode=name-version-packument-and-tarball
registryPrefetch.batchSize=24
registryPrefetch.npmPackMaxSockets=12
```

The bounded `npm pack` subprocess receives explicit `--maxsockets=12`. Later lifecycle/native transport policy is unchanged. The following remain mandatory:

- `automaticRetry=false`;
- npm fetch retries remain zero;
- one hydrator process only;
- no retry/backoff/resume/replacement process;
- no predecessor cache reuse;
- no mirror switch;
- no reviewed-host allowlist expansion;
- no package/lockfile/source/test/runner repair during local execution;
- Candidate Gates 1–12 remain deny-network.

R60 stacked PR #32 final evidence Head `3481596fc1067386cce86c04ac5c775129e001b9` was source-green under run `31302623273`; initial job `93217952392` had a Desktop-coverage-only transient, exact evidence diff was governance-only, and unchanged same-SHA job `93218396820` completed `17/17 SUCCESS`. It squash-merged only into Draft PR #20 as `6e59fabee878df681bca6d70c94eb5808b3e4a3c`.

## Source identity policy

### Tier A — pure pre-hydration dispatcher failure

Parent PM may explicitly reauthorize the same source only when all are true:

```text
HYDRATION_EXECUTIONS=0
CANDIDATE_EXECUTIONS=0
SOURCE_CHANGES_BY_MINIMAX=NONE
NATIVE_CACHE_DIR=ABSENT
NATIVE_CACHE_RECEIPT=ABSENT
CANDIDATE_WORKTREE=ABSENT
PR_HEAD_UNCHANGED=true
SOURCE_GATE_STILL_PASS=true
```

A new RUN_STAMP and six all-new paths are mandatory. Old paths are never reused.

### Tier B — consumed hydration or Candidate

A new source SHA is mandatory once any hydrator actually starts, native-cache output/receipt exists, Candidate starts, or source changes. Partial caches are non-reusable. No retry/resume/promotion is permitted.

## Resume trigger for the next local successor

The next local run is **R61**. It starts only from an external Parent PM handoff containing:

```text
PR=20
SOURCE_COMMIT=<exact final 40-hex PR #20 head after this authority alignment>
SOURCE_GATE=PASS
SOURCE_GATE_RUN=<completed exact run>
SOURCE_GATE_JOB=<completed exact job>
SOURCE_GATE_RESULT=17/17_SUCCESS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=7200
OWNER_AUTHORITY=OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

`7200` seconds is only outer wall-clock allowance for the one hydrator process; it is not retry budget.

MiniMax must fetch `refs/pull/20/head` and prove:

```text
FETCH_HEAD = supplied SOURCE_COMMIT
```

Any missing or mismatched field means `STOPPED`.

## Six new local paths

R61 must create six new absent paths:

```text
TASK_ROOT
HYDRATION_WORKTREE
NATIVE_CACHE_DIR
NATIVE_CACHE_RECEIPT
CANDIDATE_WORKTREE
EVIDENCE_DIR
```

If any exists, stop with `BLOCKED_NEW_PATH_ALREADY_EXISTS`; never delete/move it and continue.

## Pre-network runtime registry-manifest proof

After the exact detached hydration worktree is created and source contracts pass, but **before the online hydrator starts**, R61 must use the exact worktree's `buildRegistryPrefetchManifest` implementation to materialize a read-only task-evidence file such as:

```text
$TASK_ROOT/runtime-registry-manifest.json
```

This evidence must bind:

```text
RUNTIME_REGISTRY_MANIFEST_SOURCE=<SOURCE_COMMIT>
RUNTIME_REGISTRY_MANIFEST_REPOSITORY=<exact detached hydration worktree>
strategy=lockfile-batched-name-version-npm-pack-v2
batchSize=24
npmPackMaxSockets=12
manifestSha256=<64hex>
typescript@6.0.3 present
resolved=https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz
integrity=<exact tracked nested-lock integrity>
```

This evidence is not a native-cache input and must not modify tracked/untracked source. If the exact runtime manifest lacks `typescript@6.0.3`, stop **before** starting hydration and return a focused manifest blocker to Parent PM.

## One durable hydrator

Preferred execution is `run_in_background=true`. Record one process/PID, start time, stdout and stderr, and poll only that process. Shell fallback may use one recorded `nohup` PID. No replacement process is authorized.

The single Owner-authorized hydration then executes:

```text
exact detached repository from --repository
→ exact root package-lock v3
→ R56 exact unresolved-root identity supplementation
→ deterministic registry manifest
→ bounded 24-item npm pack batches with --maxsockets=12
→ strict deny-network npm ci --offline --ignore-scripts closure proof
→ remove closure-proof installs
→ lifecycle npm ci --offline with reviewed lifecycle/native asset proxy
→ zero registry.npmjs.org requests after closure
→ Electron 38 arm64 native hydration
→ remove installs
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ immutable cache ledger + PASS receipt
```

Before closure can be called PASS, R61 must prove:

```text
BOOTSTRAP_REPOSITORY_AUTHORITY=PASS
SUPPLEMENTAL_LOCK_ENUMERATION_ROOT=<exact detached hydration worktree>
RUNTIME_REGISTRY_MANIFEST_TYPESCRIPT_6_0_3=PASS
R55_BLOCKER_REGRESSION=PASS
REGISTRY_CACHE_CLOSURE=PASS
POST_CLOSURE_REGISTRY_REQUESTS=0
```

Any transport failure, manifest failure, closure `ENOTCACHED`, registry leak, process loss or other stable blocker stops immediately. If the hydrator started, report `SOURCE_CONSUMED=true`; no second invocation or local repair is permitted.

## Candidate after hydration PASS

Only after one valid native-cache PASS receipt:

1. create a fresh detached Candidate worktree;
2. prove `FETCH_HEAD = SOURCE_COMMIT = hydration HEAD = Candidate HEAD`;
3. rerun exact source contracts;
4. run `run-candidate.mjs --dry-run` and require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`;
5. execute one real Candidate exactly once;
6. stop at the first fail-closed blocker.

R31 Gates 1–12 remain authoritative. Required technical success includes packaged Electron exact `113/113` with zero skipped/unexpected/flaky, three distinct Candidate-bound performance runs, hashes/receipts/screenshots, clean process termination and final evidence.

## Product proof

The same packaged Candidate must prove:

```text
local material
→ grounded Ask
→ verified local source
→ full reader
→ return preserving same Ask Q/A/sources/actions
→ Todo create/readback
→ exact Todo in All / Unscheduled
→ edit preserving source
→ due date + Schedule
→ complete Electron quit and process absent
→ same-artifact relaunch
→ persisted Ask/source/Todo/edit/due/schedule
```

Also verify packaged `知识台 / Wiki Studio`: Sources, Wiki/provenance, Review Queue, Activity, Graph, 4-Signal Connections and explicit `重新整理`, with Review metadata separate from canonical local truth. Packaged offline local ASR must be proven independently of mocks/browser fixtures.

## Required evidence

```text
PLAN.md
RESULT.md
EVIDENCE.md
commands.log
changed-files.txt
CANDIDATE-MANIFEST.json
R30-COMPLETE.json
runtime-registry-manifest.json
```

Bind source snapshot, runtime registry manifest, bootstrap repository authority, registry closure, native-cache receipt/cache aggregate, ZIP/DMG/app/executable/app.asar/native identities, artifact SHA256, runtime ID, deterministic test-data manifest, `113/113`, three performance receipts, product/Wiki/ASR screenshots and final process/Git state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

## Codex and release boundary

MiniMax technical evidence is not independent product acceptance. Codex starts only after one coherent same-source/artifact/runtime/test-data package exists and must independently operate that exact packaged Candidate on the real Mac.

Even a fully successful unsigned MiniMax Candidate remains:

```text
PASS_UNSIGNED_DIAGNOSTIC_CANDIDATE
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
BLOCKED_UNSIGNED_NOT_NOTARIZED
```

MiniMax must not merge PR #20, change `main`, sign, notarize, modify credentials/global configuration, expand deferred scope, or declare MVP/Release/Experience/Human-Owner readiness.
