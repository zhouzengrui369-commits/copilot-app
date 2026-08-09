# MiniMax Code Local Handoff — Copilot App macOS MVP

R31 remains the executable twelve-gate Candidate authority. R47 Knowledge Studio remains product source. R50 remains the metadata-complete npm registry closure architecture. R54 defines the pre-hydration redispatch / durable-process contract. R56 repairs the exact registry-identity gap exposed by the consumed R55 hydration.

## Fixed truth

```text
R50_METADATA_COMPLETE_REGISTRY_PREFETCH_IN_SOURCE
R53_FROZEN_PRE_HYDRATION_DISPATCH_EVIDENCE_ONLY
R54_PRE_HYDRATION_REDISPATCH_POLICY_IN_SOURCE
R55_FROZEN_CONSUMED_HYDRATION_EVIDENCE_ONLY
R56_EXACT_NESTED_LOCK_REGISTRY_IDENTITY_CLOSURE_IN_SOURCE
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

## R55 consumed terminal state

R55 used exact source `69a0e651f599403bf2427fd321d9491bd31f13b0` and RUN_STAMP `20260809T032400Z`. Exact-head/fresh-path/authority checks and the detached hydration worktree passed. One durable background hydrator invocation completed all 15 bounded registry-prefetch batches, then strict deny-network `npm ci --offline --ignore-scripts` registry-cache closure failed because the cache did not contain `typescript@6.0.3`.

```text
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
SOURCE_CONSUMED=true
SOURCE_CHANGES_BY_MINIMAX=NONE
CANDIDATE_ESTABLISHED=false
```

R55 source/run/worktree/cache/receipt/evidence identities are immutable `FORBIDDEN_REFERENCE_ONLY`. No R55 partial cache may be resumed, promoted or reused.

## R56 exact registry-identity closure repair

The exact source proved that root `package-lock.json` contained `apps/mobile/node_modules/typescript@6.0.3` as a closure-required exact version without `resolved` / `integrity`, while the Git-tracked `apps/mobile/package-lock.json` contained the same exact `typescript@6.0.3` with canonical registry tarball and integrity. R50 had skipped root entries lacking registry identity, creating a manifest-to-closure gap.

R56 preserves the root lock as dependency-closure authority and changes only registry identity completion:

```text
root package-lock v3 exact node_modules specs
→ existing root resolved+integrity identities unchanged
→ for an unresolved root exact name@version only:
   enumerate Git-tracked nested **/package-lock.json files from the exact worktree
   build exact name@version -> canonical resolved + integrity identity index
   supplement only the matching root exact spec
→ do not union unrelated nested dependency graphs into the prefetch manifest
→ preserve reviewed registry origins and integrity-conflict fail-closed checks
→ bounded npm pack name@version batches
→ strict deny-network npm ci --offline --ignore-scripts closure proof
```

R56 regression coverage explicitly proves:

1. current repository manifest contains canonical `typescript@6.0.3` with integrity;
2. an unresolved root exact spec can be supplemented from a nested tracked lock;
3. unrelated nested packages are excluded from the root prefetch graph.

No package/lockfile, product UI/runtime, workflow, host allowlist, retry policy or Candidate network authority was changed by R56.

## Two-tier successor identity policy

### Tier A — pure pre-hydration dispatch failure

Parent PM may explicitly reauthorize the same exact source SHA with a new unique RUN_STAMP only when all are proven:

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

The redispatch must use six all-new paths. Every predecessor task/worktree/evidence path remains frozen. A predecessor hydration worktree is never reused even if clean.

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

Partial/failed native cache is non-reusable. No retry, resume or promotion is permitted.

## Resume trigger

A local run starts only from an explicit Parent PM handoff containing:

```text
SOURCE_COMMIT=<exact 40-character current PR #20 head>
PR=20
SOURCE_GATE=PASS
SOURCE_GATE_RUN=<exact completed run>
SOURCE_GATE_JOB=<exact completed job>
SOURCE_GATE_RESULT=17/17_SUCCESS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
OWNER_AUTHORITY=OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

Any missing or mismatched field means `STOPPED`.

MiniMax must fetch `refs/pull/20/head` and prove:

```text
FETCH_HEAD = supplied SOURCE_COMMIT
```

No branch-tip assumption may replace the exact object.

## New paths only

Every authorized run creates a new:

```text
TASK_ROOT
HYDRATION_WORKTREE
NATIVE_CACHE_DIR
NATIVE_CACHE_RECEIPT
CANDIDATE_WORKTREE
EVIDENCE_DIR
```

All six must be absent before creation. If any exists, stop with `BLOCKED_NEW_PATH_ALREADY_EXISTS`; do not delete or move it and continue.

MiniMax must ultimately prove:

```text
FETCH_HEAD = SOURCE_COMMIT = detached hydration HEAD = detached candidate HEAD
```

## Persistent single hydrator protocol

The hydrator must not be coupled to a foreground caller/tool hard cap shorter than the approved outer window.

Preferred execution:

```text
run_in_background=true
```

Record one background process identity/PID, start time, stdout and stderr, then poll that same process until terminal exit. A shell-only fallback may use one recorded `nohup` PID with redirected logs. No replacement process is permitted.

```text
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
```

This is only a caller wall-clock allowance. It is not retry budget. If the process disappears without a terminal hydrator result, stop and preserve evidence; do not launch another hydrator.

## R50 + R56 hydration contract

The single Owner-authorized hydration executes:

```text
exact root package-lock v3
→ R56 exact unresolved-root registry identity supplementation from Git-tracked nested locks
→ deterministic exact name@version + canonical tarball + integrity manifest
→ metadataMode=name-version-packument-and-tarball
→ bounded 24-item npm pack --ignore-scripts name@version batches
→ isolated npm packument/metadata + tarball cache
→ strict deny-network npm ci --offline --ignore-scripts registry-cache closure proof
→ remove closure-proof node_modules
→ full lifecycle npm ci --offline with bounded reviewed lifecycle/native asset proxy
→ require zero registry.npmjs.org requests after closure
→ Electron 38 arm64 native hydration
→ remove node_modules
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ immutable cache ledger + PASS receipt
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

Before accepting registry-cache closure PASS, R57 must prove the prefetch manifest includes:

```text
typescript@6.0.3
resolved=https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz
integrity=<exact nested-lock integrity>
```

A closure failure stops with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE`. Any registry request after closure stops with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_LEAK_AFTER_PREFETCH`. No PASS receipt may coexist with either condition.

## Security and retry boundary

Exact Owner token:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

It authorizes one hydration invocation for the supplied exact source/run identity. Preserve:

- `automaticRetry=false`;
- no retry/backoff/online resume;
- no predecessor cache, receipt, worktree or evidence reuse;
- no deletion or mutation of predecessor evidence;
- no mirror switching or host-allowlist expansion;
- no package/lockfile/source repair during local execution;
- Candidate Gate 1–12 `(deny network*)`.

If the single hydrator invocation returns a stable blocker, stop immediately and preserve evidence. Because hydration then counts as consumed, Parent PM must issue a new source SHA before another local attempt.

## Candidate execution after hydration PASS

Only after one PASS native-cache receipt:

1. create a fresh detached Candidate worktree;
2. prove exact source identity again;
3. run exact-source Candidate contracts;
4. run `scripts/candidate-r30/run-candidate.mjs --dry-run` and require `PLAN_ONLY_NOT_A_CANDIDATE / MVP_NOT_COMPLETE`;
5. execute one real Candidate exactly once;
6. stop on the first fail-closed blocker with no source repair or online retry.

The twelve Candidate gates remain the R31 contract, including exact `113 tests in 9 files`, packaged Electron `113/113` with zero skipped/unexpected/flaky, three distinct Candidate-bound performance runs, identities/manifests/screenshots, clean process termination and final receipt.

## Product journey

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
→ process absent
→ same-artifact relaunch and persistence readback
```

Also exercise packaged `知识台 / Wiki Studio`: Sources, Wiki/provenance, Review Queue, Activity, Graph, 4-Signal Connections and explicit `重新整理`. Review metadata stays separate from canonical local truth. Packaged offline local ASR must be proven independently of browser fixtures/mocks.

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

Bind source snapshot, R56/R50 native-cache receipt and aggregate hash, registry manifest and closure proof, artifact/ZIP/DMG/app/executable/`app.asar`, runtime ID, ecosystem baseline, deterministic test-data manifest, commands/exit codes, `113/113`, performance receipts, Wiki Studio/critical-loop screenshots, local ASR proof and terminal state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

## Codex boundary

MiniMax technical evidence is not independent product acceptance. Codex starts only after a complete internally consistent same-source/artifact/runtime/test-data package exists and must independently operate that exact packaged Candidate on the real Mac.

Even a fully successful unsigned MiniMax Candidate remains:

```text
PASS_UNSIGNED_DIAGNOSTIC_CANDIDATE
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
BLOCKED_UNSIGNED_NOT_NOTARIZED
```

MiniMax must not merge PR #20, change `main`, sign, notarize, modify credentials/global configuration, expand deferred scope, or declare `MVP_READY`, `RELEASE_READY`, `EXPERIENCE_READY` or `HUMAN_OWNER_GATE_PASS`.
