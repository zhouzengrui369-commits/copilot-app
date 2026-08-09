# MiniMax Code Local Handoff — Copilot App macOS MVP

R31 remains the executable twelve-gate Candidate authority. R47 remains the Knowledge Studio product source. R50 defines metadata-complete registry closure. R54 defines source-consumption and one-hydrator fail-closed rules. R56 repairs exact unresolved-root registry identities. R58 makes repository authority bootstrap-safe. R60 bounds registry-prefetch throughput. R62 makes the long-running hydrator launch itself exact-source and macOS-safe.

## Fixed truth

```text
R50_METADATA_COMPLETE_REGISTRY_PREFETCH_IN_SOURCE
R54_SINGLE_HYDRATOR_SOURCE_CONSUMPTION_POLICY_IN_SOURCE
R55_FROZEN_CONSUMED_REGISTRY_CLOSURE_EVIDENCE_ONLY
R56_EXACT_NESTED_LOCK_REGISTRY_IDENTITY_CLOSURE_IN_SOURCE
R57_FROZEN_CONSUMED_BOOTSTRAP_RUNTIME_EVIDENCE_ONLY
R58_BOOTSTRAP_SAFE_REPOSITORY_AUTHORITY_IN_SOURCE
R58_FROZEN_CONSUMED_REGISTRY_TRANSPORT_EVIDENCE_ONLY
R60_BOUNDED_REGISTRY_PREFETCH_THROUGHPUT_IN_SOURCE
R61_FROZEN_CONSUMED_LOCAL_LAUNCHER_INCIDENT_EVIDENCE_ONLY
R62_EXACT_SOURCE_BACKGROUND_HYDRATOR_LAUNCHER_IN_SOURCE
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
scripts/candidate-r30/native-cache-background-launch.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## Consumed predecessor truth

R55 consumed source `69a0e651f599403bf2427fd321d9491bd31f13b0` and exposed the strict closure gap for `typescript@6.0.3`. R56 closed the exact identity gap by keeping root `package-lock.json` as dependency-closure authority and using Git-tracked nested package-lock v3 files only as exact `name@version -> resolved + integrity` supplements.

R57 consumed `2927d0e3cd81e3997bb229ce544b95a1e3cbce8b` because the then-current implementation inferred repository location from a hydrator module extracted below `/private/tmp`. R58 removed module-location inference and requires exactly one absolute hydration `--repository` authority.

A later R58 run consumed `d29da3e6dcc9c89d680f56c23e66262e9ee967c1`: bootstrap repository authority passed; one hydrator completed 21/35 registry-prefetch batches, then `registry.npmjs.org` returned a transport reset after roughly 71 minutes. Closure was not reached, therefore `R55_BLOCKER_REGRESSION=UNVERIFIED`, not FAIL. R60 retained batch size 24 and no retry while giving only the registry-prefetch `npm pack` child an explicit bounded `--maxsockets=12`; later lifecycle/native transport policy stayed unchanged.

## R61 consumed local-launch incident

R61 used exact source:

```text
SOURCE_COMMIT=d805c6570366bc181612f712073ef7dd0e2912a8
RUN_STAMP=20260809T082410Z
```

Exact source setup and `101/101` Candidate source contracts passed. Before any online hydrator, the exact-source runtime registry manifest passed and proved:

```text
strategy=lockfile-batched-name-version-npm-pack-v2
batchSize=24
npmPackMaxSockets=12
entryCount=834
supplementalLockfileCount=4
supplementalIdentityCount=501
manifestSha256=95100e2918a013170591656ac2d8d5e902133b34c11621f78bef7c1ce4551061
typescript@6.0.3 present
resolved=https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz
integrity=sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==
```

This closes the uncertainty about whether the R56 identity supplement appears in the actual exact-source runtime manifest. It does not by itself prove registry-cache closure; closure still has to pass under strict deny-network.

The first local ad-hoc launcher attempt used `setsid`, which does not exist on macOS; no hydrator started. A second ad-hoc shell wrapper used `nohup`, but it executed `mkdir -p "$NATIVE_CACHE_DIR"` before launching. The one real hydrator invocation then correctly stopped in preflight because `requireNewExternalPath()` rejects any existing cache target, even an empty directory:

```text
FAILED_PHASE=bounded-native-toolchain-hydration-preflight
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
SOURCE_CONSUMED=true
RETRY_ATTEMPTED=NO
SOURCE_CHANGES_BY_MINIMAX=NONE
NATIVE_CACHE_FILES_AFTER_BLOCKER=0
NATIVE_CACHE_RECEIPT_CREATED=false
```

All R61 local task/worktree/cache/receipt/evidence identities are `FORBIDDEN_REFERENCE_ONLY`. The local evidence incident in which MiniMax accidentally overwrote the predecessor R58 `RESULT.md` and immediately reconstructed that one file is historical evidence only; it does not authorize modifying predecessor evidence again.

## R62 exact-source hydrator launcher

R62 removes ad-hoc shell launch behavior from the local execution path. The only authorized hydrator launcher for the next local successor is:

```text
scripts/candidate-r30/native-cache-background-launch.mjs
```

The launcher is self-contained Node code and may itself be copied/executed from `/private/tmp` if needed. It obtains all execution authority from explicit arguments and derives the actual hydrator only from:

```text
<absolute --repository>/scripts/candidate-r30/npm-native-cache-hydrate.mjs
```

It does not invoke a shell and does not depend on `setsid`:

```text
spawn(process.execPath, hydratorArgs, {
  cwd: repository,
  detached: true,
  shell: false,
  ...
})
```

Before spawn it requires all of these targets to be absent:

```text
NATIVE_CACHE_DIR
NATIVE_CACHE_RECEIPT
HYDRATOR_STDOUT
HYDRATOR_STDERR
HYDRATOR_LAUNCH_RECEIPT
```

The launcher may create only parent directories for its stdout/stderr/launch-receipt and those three evidence files with exclusive creation. It MUST NOT create `NATIVE_CACHE_DIR` or `NATIVE_CACHE_RECEIPT`. Log/launch-receipt paths inside the native-cache target are forbidden. An existing cache target fails closed and is never deleted or moved.

One launch returns one durable PID/process identity. The receipt explicitly binds:

```text
status=LAUNCHED
detached=true
shell=false
launcherDidCreateCacheDir=false
launcherDidCreateReceiptOutput=false
automaticRetry=false
replacementProcessAllowed=false
```

No custom shell wrapper, `setsid`, `mkdir -p "$NATIVE_CACHE_DIR"`, replacement process or second hydrator invocation is authorized.

R62 regression tests prove that cache/receipt targets remain absent at spawn time and after launcher setup, existing cache targets are preserved and rejected, evidence paths under the cache target are rejected, and the child is detached Node with `shell:false`.

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

A new source SHA is mandatory once a real hydrator starts, native-cache output/receipt exists, Candidate starts, or source changes. Partial caches are non-reusable. No retry, resume or promotion is permitted.

## Resume trigger for the next local successor

The next local run is **R63**. It starts only from an external Parent PM handoff containing:

```text
PR=20
SOURCE_COMMIT=<exact final 40-hex PR #20 head after R62 integration and authority alignment>
SOURCE_GATE=PASS
SOURCE_GATE_RUN=<completed exact run>
SOURCE_GATE_JOB=<completed exact job>
SOURCE_GATE_RESULT=17/17_SUCCESS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=7200
OWNER_AUTHORITY=OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

MiniMax must fetch `refs/pull/20/head` and prove `FETCH_HEAD = supplied SOURCE_COMMIT`. Any missing or mismatched field means `STOPPED`.

## Six new local paths

R63 must create six fresh absent paths:

```text
TASK_ROOT
HYDRATION_WORKTREE
NATIVE_CACHE_DIR
NATIVE_CACHE_RECEIPT
CANDIDATE_WORKTREE
EVIDENCE_DIR
```

If any exists, stop with `BLOCKED_NEW_PATH_ALREADY_EXISTS`; never delete/move it and continue. Ultimately prove:

```text
FETCH_HEAD = SOURCE_COMMIT = detached hydration HEAD = detached candidate HEAD
```

## Pre-network runtime registry-manifest proof

After the exact detached hydration worktree exists and source contracts pass, but before launching the hydrator, use that worktree's exact `buildRegistryPrefetchManifest` implementation to write task evidence such as:

```text
$TASK_ROOT/runtime-registry-manifest.json
```

It must bind:

```text
RUNTIME_REGISTRY_MANIFEST_SOURCE=<SOURCE_COMMIT>
RUNTIME_REGISTRY_MANIFEST_REPOSITORY=<exact hydration worktree>
strategy=lockfile-batched-name-version-npm-pack-v2
batchSize=24
npmPackMaxSockets=12
manifestSha256=<64hex>
typescript@6.0.3 present
resolved=https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz
integrity=<exact tracked nested-lock integrity>
```

The manifest evidence is not a cache input and must leave source clean. A manifest failure occurs before hydration and returns control to Parent PM without launching the hydrator.

## Exact-source single hydrator launch

Only after the pre-network manifest PASS may MiniMax invoke the exact-source launcher. Do **not** create `NATIVE_CACHE_DIR` or `NATIVE_CACHE_RECEIPT` first.

Example authority shape:

```text
node scripts/candidate-r30/native-cache-background-launch.mjs \
  --repository "$HYDRATION_WORKTREE" \
  --source-commit "$SOURCE_COMMIT" \
  --cache-dir "$NATIVE_CACHE_DIR" \
  --receipt-output "$NATIVE_CACHE_RECEIPT" \
  --owner-authority OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION \
  --stdout "$EVIDENCE_DIR/hydrator/hydration-stdout.log" \
  --stderr "$EVIDENCE_DIR/hydrator/hydration-stderr.log" \
  --launch-receipt "$EVIDENCE_DIR/hydrator/launch-receipt.json"
```

Validate the launch receipt, record the returned PID, and poll only that process. The launcher returns quickly; the approved outer window for the one detached hydrator remains at least 7200 seconds. That allowance is not retry budget.

The hydrator then executes the unchanged governed sequence:

```text
exact detached repository from --repository
→ exact root package-lock v3
→ R56 exact unresolved-root identity supplementation
→ deterministic registry manifest
→ bounded 24-item npm pack batches with --maxsockets=12
→ strict deny-network npm ci --offline --ignore-scripts closure proof
→ remove closure-proof installs
→ lifecycle npm ci --offline with reviewed lifecycle/native asset proxy
→ require zero registry.npmjs.org requests after closure
→ Electron 38 arm64 native hydration
→ remove installs
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ immutable cache ledger + PASS receipt
```

Before closure can be called PASS, R63 must prove:

```text
EXACT_SOURCE_LAUNCHER=PASS
LAUNCHER_DID_CREATE_CACHE_DIR=false
LAUNCHER_DID_CREATE_RECEIPT_OUTPUT=false
BOOTSTRAP_REPOSITORY_AUTHORITY=PASS
SUPPLEMENTAL_LOCK_ENUMERATION_ROOT=<exact detached hydration worktree>
RUNTIME_REGISTRY_MANIFEST_TYPESCRIPT_6_0_3=PASS
R55_BLOCKER_REGRESSION=PASS
REGISTRY_CACHE_CLOSURE=PASS
POST_CLOSURE_REGISTRY_REQUESTS=0
```

Any launcher, transport, manifest, closure, registry-leak, process-loss or other stable blocker stops immediately. Once the hydrator starts, report `SOURCE_CONSUMED=true`; no second invocation or local repair is permitted.

## Candidate after hydration PASS

Only after one valid native-cache PASS receipt:

1. create a fresh detached Candidate worktree;
2. prove exact identity again;
3. run Candidate source contracts;
4. run `run-candidate.mjs --dry-run` and require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`;
5. execute one real Candidate exactly once;
6. stop at the first fail-closed blocker.

R31 Gates 1–12 remain authoritative. Required technical success includes exact Electron discovery `113 tests in 9 files`, packaged Electron `113/113` with zero skipped/unexpected/flaky, three distinct Candidate-bound performance runs, identities/hashes/screenshots, clean process termination and final evidence.

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
hydrator/launch-receipt.json
```

Bind source snapshot, runtime registry manifest, exact-source launcher receipt/PID, bootstrap repository authority, registry closure, native-cache receipt/cache aggregate, ZIP/DMG/app/executable/app.asar/native identities, artifact SHA256, runtime ID, deterministic test-data manifest, `113/113`, three performance receipts, product/Wiki/ASR screenshots and final process/Git state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

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
