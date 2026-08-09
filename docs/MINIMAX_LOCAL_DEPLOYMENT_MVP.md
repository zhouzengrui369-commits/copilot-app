# MiniMax Code Local Handoff — Copilot App macOS MVP

R31 remains the executable twelve-gate Candidate authority. R47 Knowledge Studio remains product source. R50 remains the current registry metadata-cache closure implementation. R54 refines only the local dispatch/reauthorization contract after R53 failed before the hydrator ever started.

## Fixed truth

```text
R50_METADATA_COMPLETE_REGISTRY_PREFETCH_IN_SOURCE
R51_FROZEN_EVIDENCE_ONLY
R53_FROZEN_PRE_HYDRATION_DISPATCH_EVIDENCE_ONLY
R54_PRE_HYDRATION_REDISPATCH_POLICY_IN_SOURCE
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

## R53 terminal state

R53 used exact source `0e097811650e2ca79a79a1ab095fdbad1f933ce3`. The first dispatch created a task root, detached clean hydration worktree and evidence directory, passed exact-source setup, then the caller/tool execution envelope terminated before `npm-native-cache-hydrate.mjs` was invoked. No native cache directory, PASS receipt, Candidate worktree, artifact or runtime ID existed. Reported counts were:

```text
HYDRATION_EXECUTIONS=0
CANDIDATE_EXECUTIONS=0
SOURCE_CHANGES_BY_MINIMAX=NONE
```

A later same-run dispatch correctly stopped at `BLOCKED_NEW_PATH_ALREADY_EXISTS`. Both R53 dispatch evidence sets and all R53 paths are immutable `FORBIDDEN_REFERENCE_ONLY`.

This is a **pre-hydration dispatcher failure**, not a hydration attempt and not a Candidate attempt.

## Two-tier successor identity policy

### Tier A — pre-hydration dispatch failure

Parent PM may explicitly reauthorize the **same exact source SHA** with a **new unique RUN_STAMP** only when every condition below is proven:

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

The re-dispatch must create all-new paths for task root, hydration worktree, native cache, receipt, Candidate worktree and evidence. Previous task/worktree/evidence paths remain frozen and may not be deleted, moved, resumed or reused.

Tier A does **not** authorize reuse of a predecessor hydration worktree even if it is clean. The new run uses a new run stamp and a new detached hydration worktree from the same exact Git object.

### Tier B — hydration or Candidate consumed

A **new source SHA is mandatory** if any of the following is true:

```text
HYDRATION_EXECUTIONS>=1
NATIVE_CACHE_DIR exists or contains hydrator output
NATIVE_CACHE_RECEIPT exists
CANDIDATE_EXECUTIONS>=1
CANDIDATE_WORKTREE exists because a real Candidate attempt began
source changed
```

A partial/failed native cache remains non-reusable. No retry, resume or promotion is permitted. Parent PM must create/freeze a new exact source identity before another local attempt.

This distinction prevents pure dispatcher/tool failures from causing needless source churn while preserving the stronger source-rotation rule once hydration or Candidate state has actually been consumed.

## Resume trigger

A local run starts only from an explicit Parent PM handoff containing:

```text
SOURCE_COMMIT=<exact 40-character PR #20 head>
PR=20
SOURCE_GATE=PASS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
OWNER_AUTHORITY=OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

Any missing field means `STOPPED`.

If Tier A applies, `SOURCE_COMMIT` may equal the immediately preceding pre-hydration-dispatch source, but `RUN_STAMP` and all six local paths must be new. If Tier B applies, both source SHA and run stamp must be new.

## Persistent hydrator invocation protocol

The hydrator must not be coupled to a foreground tool/shell hard cap shorter than the approved outer window.

Preferred MiniMax execution method:

```text
run_in_background=true
```

The background invocation must still be **one and only one** hydrator process. Record its PID/process identity, start time, stdout path and stderr path, then poll that same process until it exits. Do not launch a replacement if the caller disconnects or a poll fails.

A shell-only fallback may use one durable background process such as `nohup` with stdout/stderr redirected to evidence paths, record `$!`, and poll that exact PID. The fallback must not create a second hydrator invocation.

Required outer allowance:

```text
OUTER_DRIVER_TIMEOUT_SECONDS>=3600
```

Do not wrap the hydrator with a 120-second timeout. If the background process disappears without a terminal hydrator receipt/error, stop with a dispatcher/process-loss blocker and preserve evidence; do not retry.

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

It authorizes one hydration invocation for the supplied exact source and run identity. It does not authorize retry or resume. Preserve:

- `automaticRetry=false`;
- no retry/backoff/online resume;
- no predecessor cache, receipt, worktree or evidence reuse;
- no deletion or mutation of predecessor evidence;
- no mirror switching or host-allowlist expansion;
- no package/lockfile/source repair during local execution;
- Candidate Gate 1–12 `(deny network*)`.

If the single hydrator invocation returns a stable blocker, stop immediately and preserve evidence.

## New paths only

Every authorized run creates a new detached hydration worktree, native cache root, exclusive receipt, detached Candidate worktree, evidence directory and task root derived from its run stamp. Predecessor paths are evidence only.

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
