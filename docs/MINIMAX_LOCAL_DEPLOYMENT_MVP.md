# MiniMax Code Local Handoff — Copilot App macOS MVP

R31 remains the executable twelve-gate Candidate authority. R47 Knowledge Studio remains product source. R50 defines metadata-complete npm registry closure. R54 defines durable single-process hydration and source-consumption rules. R56 repairs exact unresolved-root registry identities. R58 repairs bootstrap-safe repository authority. R60 reduces the long registry-prefetch exposure window without adding retry, mirrors, hosts or Candidate network authority.

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

## R55 consumed terminal state

R55 used source `69a0e651f599403bf2427fd321d9491bd31f13b0`, completed all bounded registry-prefetch batches, then failed strict deny-network `npm ci --offline --ignore-scripts` because `typescript@6.0.3` was missing from the cache.

```text
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
SOURCE_CONSUMED=true
SOURCE_CHANGES_BY_MINIMAX=NONE
```

Every R55 local identity is immutable `FORBIDDEN_REFERENCE_ONLY`.

## R56 exact registry-identity closure

The root lock remains dependency-closure authority. When one exact root `node_modules` spec has a version but lacks registry `resolved` / `integrity`, R56 uses only Git-tracked nested package-lock v3 files as an exact `name@version -> canonical resolved + integrity` identity index. It supplements only the matching unresolved root spec. It never unions unrelated nested dependency graphs into the root prefetch manifest.

This closes the R55 `typescript@6.0.3` identity gap without package/lockfile changes, host expansion, retry, Candidate network authority, or product-runtime changes.

## R57 consumed bootstrap-runtime state

R57 used exact source:

```text
SOURCE_COMMIT=2927d0e3cd81e3997bb229ce544b95a1e3cbce8b
RUN_STAMP=20260809T044928Z
```

Exact-head, fresh-path, authority bootstrap, detached worktree and `98/98` source contracts passed. One durable background hydrator then stopped before registry prefetch because R56 had derived a repository root from `import.meta.url` while the real hydrator had been extracted under `/private/tmp/...`.

```text
FAILED_PHASE=registry_prefetch_manifest_enumeration
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
SOURCE_CONSUMED=true
SOURCE_CHANGES_BY_MINIMAX=NONE
R55_BLOCKER_REGRESSION=UNVERIFIED
```

All R57 local identities are immutable `FORBIDDEN_REFERENCE_ONLY`.

## R58 bootstrap-safe repository authority

R58 removes repository-root inference from module location. Supplemental tracked-lock discovery obtains its production repository root from exactly one absolute hydration CLI authority:

```text
--repository <absolute detached hydration worktree>
```

Direct library/test use may provide an explicit absolute `repositoryRoot`. Production bootstrap must not infer source location from `import.meta.url`, `fileURLToPath(import.meta.url)`, `process.cwd()` or module-relative `../..`.

R58 regression coverage proves a simulated `/private/tmp/.../npm-native-cache-hydrate.mjs` argv with `--repository <real worktree>` discovers the real tracked nested locks and retains canonical `typescript@6.0.3` identity.

## R58 consumed registry-prefetch state

A later local R58 run used source `d29da3e6dcc9c89d680f56c23e66262e9ee967c1` and RUN_STAMP `20260809T053600Z`.

Bootstrap repository authority succeeded. One durable hydrator entered the online registry-prefetch stage and completed 21 of 35 deterministic batches. After roughly 71 minutes, one `registry.npmjs.org` transport reset stopped the run fail-closed:

```text
FAILED_PHASE=bounded-registry-prefetch-0021
BLOCKER=BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
RETRY_ATTEMPTED=NO
SOURCE_CONSUMED=true
SOURCE_CHANGES_BY_MINIMAX=NONE
REGISTRY_CACHE_CLOSURE=NOT_REACHED
R55_BLOCKER_REGRESSION=UNVERIFIED
```

The fact that `typescript@6.0.3` was not among the first 21 completed alphabetically ordered batches is not evidence that the R56 identity supplement is absent. Closure was never reached, so the R55 regression must remain `UNVERIFIED`, not `FAIL`.

A later same-source/same-RUN_STAMP dispatch correctly stopped at `BLOCKED_NEW_PATH_ALREADY_EXISTS` before authority/hydration. That second dispatch did not consume an additional hydration identity. All R58 local paths and partial cache remain immutable `FORBIDDEN_REFERENCE_ONLY`.

## R60 bounded registry-prefetch throughput

R60 changes only the registry-prefetch npm subprocess throughput bound:

```text
registryPrefetch.batchSize=24
registryPrefetch.npmPackMaxSockets=12
```

The `npm pack` subprocess receives explicit `--maxsockets=12`. The later lifecycle/native transport policy is unchanged. No parallel hydrators are introduced.

This does **not** authorize retry:

- `automaticRetry=false`;
- npm fetch retries remain zero;
- no retry/backoff/resume;
- one hydrator process only;
- no predecessor cache reuse;
- no mirror switch;
- no host-allowlist expansion;
- Candidate Gates 1–12 remain deny-network.

The purpose is to shorten the 35-batch registry exposure window that previously exceeded one hour.

Before the next online hydration starts, MiniMax must materialize an exact-source runtime registry manifest into task evidence and prove canonical `typescript@6.0.3` plus exact integrity is present. This separates identity proof from transport completion; a later network blocker must not be misclassified as an identity-closure failure.

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

A new RUN_STAMP and six all-new paths are mandatory.

### Tier B — hydration or Candidate consumed

A new source SHA is mandatory if any is true:

```text
HYDRATION_EXECUTIONS>=1
NATIVE_CACHE_DIR exists or contains hydrator output
NATIVE_CACHE_RECEIPT exists
CANDIDATE_EXECUTIONS>=1
real CANDIDATE_WORKTREE was created
source changed
```

Partial caches are non-reusable. No retry, resume or promotion is permitted.

## Resume trigger

A local R60 successor starts only from an explicit Parent PM handoff containing:

```text
PR=20
SOURCE_COMMIT=<exact current 40-hex PR #20 head>
SOURCE_GATE=PASS
SOURCE_GATE_RUN=<exact completed run>
SOURCE_GATE_JOB=<exact completed job>
SOURCE_GATE_RESULT=17/17_SUCCESS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
OWNER_AUTHORITY=OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

MiniMax must fetch `refs/pull/20/head` and prove `FETCH_HEAD = supplied SOURCE_COMMIT`. Any missing or mismatched field means `STOPPED`. Branch-tip, local-main or stale-object assumptions are not authority.

## Six new local paths

Every authorized run creates a new:

```text
TASK_ROOT
HYDRATION_WORKTREE
NATIVE_CACHE_DIR
NATIVE_CACHE_RECEIPT
CANDIDATE_WORKTREE
EVIDENCE_DIR
```

All six must be absent before creation. Any existing path means `BLOCKED_NEW_PATH_ALREADY_EXISTS`; do not delete/move it and continue.

The run must ultimately prove:

```text
FETCH_HEAD = SOURCE_COMMIT = detached hydration HEAD = detached candidate HEAD
```

## Persistent single hydrator

Preferred execution:

```text
run_in_background=true
```

Record exactly one PID/process identity, start time, stdout and stderr, then poll that same process until terminal exit. Shell fallback may use one recorded `nohup` PID. No replacement process is authorized.

```text
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
```

The outer allowance is not retry budget. Process loss without a terminal hydrator result is a blocker and consumes the source identity once the hydrator has started.

## R50 + R56 + R58 + R60 hydration contract

The one Owner-authorized hydration executes:

```text
exact detached repository from --repository
→ exact root package-lock v3
→ R56 exact unresolved-root identity supplementation from Git-tracked nested locks in THAT repository
→ deterministic exact name@version + canonical tarball + integrity manifest
→ bounded 24-item npm pack --ignore-scripts name@version batches with explicit --maxsockets=12
→ isolated npm metadata/tarball cache
→ strict deny-network npm ci --offline --ignore-scripts registry-cache closure proof
→ remove closure-proof node_modules
→ full lifecycle npm ci --offline with bounded reviewed lifecycle/native asset proxy
→ require zero registry.npmjs.org requests after closure
→ Electron 38 arm64 native hydration
→ remove installs
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ immutable cache ledger + PASS receipt
```

Exact strategy values remain:

```text
registryPrefetch.strategy=lockfile-batched-name-version-npm-pack-v2
registryPrefetch.metadataMode=name-version-packument-and-tarball
registryPrefetch.batchSize=24
registryPrefetch.npmPackMaxSockets=12
registryCacheClosure.strategy=deny-network-offline-ci-ignore-scripts-v1
registryCacheClosure.networkAuthority=deny-network
onlineHydration.registryMode=lockfile-name-version-prefetch-closure-then-offline-ci
onlineHydration.registryRequestCountAfterClosure=0
```

Before the online hydrator starts, the successor must create a read-only task-evidence runtime manifest using the exact worktree and exact `buildRegistryPrefetchManifest` implementation and prove:

```text
RUNTIME_REGISTRY_MANIFEST_SOURCE=<exact SOURCE_COMMIT>
RUNTIME_REGISTRY_MANIFEST_REPOSITORY=<exact detached hydration worktree>
typescript@6.0.3 present
resolved=https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz
integrity=<exact tracked nested-lock integrity>
```

This manifest evidence is not a native-cache input and must not modify the source worktree.

Before accepting closure PASS, the run must then prove:

```text
BOOTSTRAP_REPOSITORY_AUTHORITY=PASS
SUPPLEMENTAL_LOCK_ENUMERATION_ROOT=<exact detached hydration worktree>
R55_BLOCKER_REGRESSION=PASS
REGISTRY_CACHE_CLOSURE=PASS
POST_CLOSURE_REGISTRY_REQUESTS=0
```

A manifest-enumeration failure, closure `ENOTCACHED`, registry leak after closure, transport failure or any other stable blocker stops immediately. If the hydrator started, report `SOURCE_CONSUMED=true`; no local source repair or second invocation is permitted.

## Security and retry boundary

Exact Owner token:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

It authorizes one hydration invocation for one supplied exact source/run identity. Preserve no retry/backoff/online resume, no predecessor cache/receipt/worktree/evidence reuse, no deletion/mutation of predecessor evidence, no mirror switch or host expansion, no package/lockfile/source/test/runner repair during local execution, and Candidate Gates 1–12 deny-network authority.

## Candidate after hydration PASS

Only after one PASS native-cache receipt:

1. create a fresh detached Candidate worktree;
2. prove exact identity again;
3. run Candidate source contracts;
4. run `run-candidate.mjs --dry-run` and require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`;
5. execute one real Candidate exactly once;
6. stop on the first fail-closed blocker.

The twelve R31 gates remain authoritative, including exact `113 tests in 9 files`, packaged Electron `113/113` with zero skipped/unexpected/flaky, three distinct Candidate-bound performance runs, hashes/receipts/screenshots, clean process termination and final evidence.

## Product journey

The same packaged Candidate must prove:

```text
local material
→ grounded Ask
→ verified local source
→ full reader
→ return preserving same Ask Q/A/sources/actions
→ Todo create + durable readback
→ exact Todo in All / Unscheduled
→ edit preserving source
→ due date + Schedule association
→ complete Electron quit
→ process absent
→ same-artifact relaunch
→ persisted Ask/source/Todo/edit/due/schedule state
```

Also exercise packaged `知识台 / Wiki Studio`: Sources, Wiki/provenance, Review Queue, Activity, Graph, 4-Signal Connections and explicit `重新整理`. Review metadata remains separate from canonical local truth. Packaged offline local ASR must be proven independently of mocks/browser fixtures.

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

Bind source snapshot, runtime registry manifest, bootstrap repository authority, R56 registry identity including `typescript@6.0.3`, closure proof, native-cache receipt/cache aggregate, ZIP/DMG/app/executable/app.asar/native hashes, artifact SHA256, runtime ID, deterministic test-data manifest, `113/113`, three performance receipts, product-journey/Wiki Studio/local-ASR screenshots and final process/Git state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

## Codex boundary

MiniMax technical evidence is not independent product acceptance. Codex starts only after a complete internally consistent same-source/artifact/runtime/test-data package exists and independently operates that exact packaged Electron Candidate on the real Mac.

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
