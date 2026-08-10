# MiniMax Code Local Handoff — Copilot App macOS MVP

R31 remains the executable twelve-gate Candidate authority. R62 remains the only authorized exact-source hydrator launcher. R65 repairs root exact-spec completeness. R67 repairs npm alias/install-path identity exposed by R66.

## Current authority override — R67 / next R68

```text
R66_SOURCE_CONSUMED
R66_BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH
R66_BLOCKER_SAMPLE=string-width-cjs@4.2.3_ETARGET
R67_LOCKFILE_ALIAS_REGISTRY_IDENTITY_REPAIR_IN_SOURCE
R68_LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

The R66 blocker was not evidence that the entire root lockfile must be regenerated. Exact lockfile inspection proves npm alias semantics:

```text
node_modules/string-width-cjs
  name=string-width
  version=4.2.3

node_modules/strip-ansi-cjs
  name=strip-ansi
  version=6.0.1

node_modules/wrap-ansi-cjs
  name=wrap-ansi
  version=7.0.0
```

For exact-version-only `node_modules/...` entries, registry-prefetch MUST prefer a valid lock entry `name` when present; only entries without a lock entry name may fall back to the package name encoded by the install path. Entries outside `node_modules` remain excluded. The install path is filesystem placement metadata, not automatically an npm registry package name.

R67 source contracts require real registry specs:

```text
string-width@4.2.3
strip-ansi@6.0.1
wrap-ansi@7.0.0
```

and forbid fake registry specs:

```text
string-width-cjs@4.2.3
strip-ansi-cjs@6.0.1
wrap-ansi-cjs@7.0.0
```

R66 cache/worktree/task/evidence identities remain immutable `FORBIDDEN_REFERENCE_ONLY`. No predecessor cache, receipt, manifest, task root, evidence or runtime identity is an input to R68.

## Fixed truth

```text
R31_TWELVE_GATE_CANDIDATE_AUTHORITY_IN_SOURCE
R50_METADATA_COMPLETE_REGISTRY_PREFETCH_IN_SOURCE
R54_SINGLE_HYDRATOR_SOURCE_CONSUMPTION_POLICY_IN_SOURCE
R56_TRACKED_NESTED_LOCK_EXACT_IDENTITY_SUPPLEMENT_IN_SOURCE
R58_BOOTSTRAP_SAFE_REPOSITORY_AUTHORITY_IN_SOURCE
R60_BOUNDED_REGISTRY_PREFETCH_MAXSOCKETS_12_IN_SOURCE
R62_EXACT_SOURCE_BACKGROUND_HYDRATOR_LAUNCHER_IN_SOURCE
R64_FROZEN_CONSUMED_REGISTRY_CLOSURE_EVIDENCE_ONLY
R65_ROOT_CLOSURE_SPEC_COMPLETENESS_IN_SOURCE
R66_FROZEN_CONSUMED_REGISTRY_PREFETCH_EVIDENCE_ONLY
R67_LOCKFILE_ALIAS_REGISTRY_IDENTITY_REPAIR_IN_SOURCE
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

## R64 consumed terminal truth

R64 used exact source `5924aa96df9a15399fde281c9a4935392c8123b8`, RUN_STAMP `20260809T134000Z`.

Verified before the blocker:

```text
SOURCE_TESTS=105/105_PASS
AUTHORITY_BOOTSTRAP=PASS
RUNTIME_REGISTRY_MANIFEST=PASS
RUNTIME_REGISTRY_MANIFEST_TYPESCRIPT_6_0_3=PASS
EXACT_SOURCE_LAUNCHER=PASS
LAUNCHER_DID_CREATE_CACHE_DIR=false
LAUNCHER_DID_CREATE_RECEIPT_OUTPUT=false
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
REGISTRY_PREFETCH_BATCHES=35/35_PASS
```

The strict deny-network registry-cache closure then failed on `ENOTCACHED zustand@4.5.7`:

```text
FAILED_PHASE=bounded-native-toolchain-hydration-registry-cache-closure-proof
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE
REGISTRY_CACHE_CLOSURE=FAIL
SOURCE_CONSUMED=true
RETRY_ATTEMPTED=NO
SOURCE_CHANGES_BY_MINIMAX=NONE
```

R64 cache/worktree/task/evidence identities are immutable `FORBIDDEN_REFERENCE_ONLY` and are not inputs to the next local successor.

## R65 root closure completeness repair

The R64 report compared root lock `packages` path count with manifest entry count. That comparison is not authoritative because the manifest deduplicates by exact `name@version` while lockfile `packages` is path-based.

The actual bug was concrete: root `package-lock.json` contains a closure-required `node_modules/zustand` entry at exact version `4.5.7` with no `resolved` or `integrity`. No tracked supplemental lock provided that exact tarball identity. The previous manifest silently omitted this exact spec even though `npm ci` requires it.

R65 defines completeness as coverage of every unique root-lock exact registry spec, not raw package-path count:

```text
completenessMode=root-unique-exact-specs-covered-v1
rootClosureSpecCount=<unique non-link node_modules exact name@version specs>
coveredRootClosureSpecCount=rootClosureSpecCount
entryCount=rootClosureSpecCount
```

Three identity classes are allowed:

```text
lockfile-resolved-integrity
tracked-supplemental-lock
root-lock-exact-version-only
```

Rules:

1. A root entry with reviewed registry `resolved` + valid lockfile integrity keeps that exact identity.
2. A root exact spec without identity may use a Git-tracked nested package-lock v3 identity only when exact `name@version` matches.
3. If the root lock itself requires an exact `name@version` but neither root nor supplemental lock contains tarball identity, the spec is still included as `root-lock-exact-version-only` with `resolved=null` and `integrity=null`.
4. Exact-version-only entries are prefetched only as the exact `name@version` through the reviewed npm registry. The implementation MUST NOT invent a tarball URL or integrity absent from the lock authority.
5. Unrelated nested-lock dependency graphs are not imported.
6. Missing root exact specs fail before batching with `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST`.
7. R67 clarification: when a non-link `node_modules/...` entry provides its own valid `name`, that locked name is authoritative for the exact registry spec; the install-path tail is only the fallback when `name` is absent.

Current repository source contracts require:

```text
typescript@6.0.3
  identitySource=tracked-supplemental-lock
  canonical resolved + integrity present

zustand@4.5.7
  identitySource=root-lock-exact-version-only
  resolved=null
  integrity=null

string-width@4.2.3
strip-ansi@6.0.1
wrap-ansi@7.0.0
  alias install paths MUST NOT become fake *-cjs registry specs
```

They also require:

```text
coveredRootClosureSpecCount == rootClosureSpecCount
entryCount == rootClosureSpecCount
```

R65 code Head `cb7cbd5051da759c388564ee87d6dc21f55d2e83` passed complete source gate run `31348549679`, job `93334962219`, `17/17 SUCCESS`.

## R66 consumed terminal truth

R66 used exact source `beb951b95695233911da0a17543ef342acc6df93`, RUN_STAMP `20260810T015500Z`.

Verified before the blocker:

```text
SOURCE_TESTS=106/106_PASS
ROOT_CLOSURE_COMPLETENESS=PASS
rootClosureSpecCount=1361
coveredRootClosureSpecCount=1361
RUNTIME_REGISTRY_MANIFEST_TYPESCRIPT_6_0_3=PASS
RUNTIME_REGISTRY_MANIFEST_ZUSTAND_4_5_7=PASS
EXACT_SOURCE_LAUNCHER=PASS
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
```

Registry prefetch completed 50 batches and stopped at batch 51 on an invalid registry spec derived from an npm alias install path:

```text
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH
BLOCKER_SAMPLE=string-width-cjs@4.2.3_ETARGET
SOURCE_CONSUMED=true
RETRY_ATTEMPTED=NO
SOURCE_CHANGES_BY_MINIMAX=NONE
```

The registry transport itself returned normally; the package path/name interpretation was wrong. R66 is Tier B consumed and all R66 local identities are immutable predecessor evidence.

## Source identity policy

### Tier A — pure pre-hydration dispatch failure

Same source may be reauthorized only when all are true:

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

A new RUN_STAMP and six new paths are mandatory.

### Tier B — consumed hydration or Candidate

A new source SHA is mandatory once a real hydrator starts, native-cache output/receipt exists, Candidate starts, or source changes. No retry, resume, promotion, predecessor cache reuse, mirror switch, host expansion, or local source/test/runner/package/lockfile repair is permitted.

R66 is Tier B consumed, so R68 MUST use a new SOURCE_COMMIT.

## Resume trigger for R68

R68 starts only from an external Parent PM handoff containing:

```text
PR=20
SOURCE_COMMIT=<exact final PR #20 head after R67 integration + authority alignment>
SOURCE_GATE=PASS
SOURCE_GATE_RUN=<completed exact run>
SOURCE_GATE_JOB=<completed exact job>
SOURCE_GATE_RESULT=17/17_SUCCESS
RUN_STAMP=<new unique value>
OUTER_DRIVER_TIMEOUT_SECONDS>=7200
OWNER_AUTHORITY=OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

MiniMax must fetch `refs/pull/20/head` and prove `FETCH_HEAD = supplied SOURCE_COMMIT`.

## Six all-new local paths

R68 must start with six absent paths:

```text
TASK_ROOT
HYDRATION_WORKTREE
NATIVE_CACHE_DIR
NATIVE_CACHE_RECEIPT
CANDIDATE_WORKTREE
EVIDENCE_DIR
```

Old identities are `FORBIDDEN_REFERENCE_ONLY`.

## Pre-network runtime manifest proof

Before launching the hydrator, R68 must use the exact worktree implementation of `buildRegistryPrefetchManifest` and materialize task evidence outside Candidate `EVIDENCE_DIR`.

Required proof:

```text
strategy=lockfile-batched-name-version-npm-pack-v2
completenessMode=root-unique-exact-specs-covered-v1
rootClosureSpecCount=<positive integer>
coveredRootClosureSpecCount=rootClosureSpecCount
entryCount=rootClosureSpecCount
batchSize=24
npmPackMaxSockets=12
typescript@6.0.3 present with tracked supplemental identity
zustand@4.5.7 present with root-lock-exact-version-only identity
string-width@4.2.3 present
strip-ansi@6.0.1 present
wrap-ansi@7.0.0 present
string-width-cjs@4.2.3 absent
strip-ansi-cjs@6.0.1 absent
wrap-ansi-cjs@7.0.0 absent
```

This proof must happen before network/hydration. If identity/completeness fails, return control to Parent PM with `HYDRATION_EXECUTIONS=0`.

## Exact-source launcher

The only authorized hydrator launcher remains:

```text
scripts/candidate-r30/native-cache-background-launch.mjs
```

Before invoking it, the following must be absent:

```text
NATIVE_CACHE_DIR
NATIVE_CACHE_RECEIPT
HYDRATOR_STDOUT
HYDRATOR_STDERR
HYDRATOR_LAUNCH_RECEIPT
EVIDENCE_DIR
```

Prep may create only the evidence parent directory under TASK_ROOT. Do not pre-touch output files. The launcher exclusively creates stdout/stderr/launch receipt and starts exactly one detached Node hydrator with `shell:false`.

## Hydration focused successor proof

The one hydrator must execute:

```text
exact detached repository
→ R67 alias-aware root-closure-complete registry manifest
→ bounded 24-item npm pack batches with --maxsockets=12
→ strict deny-network npm ci --offline --ignore-scripts closure proof
→ lifecycle npm ci --offline with reviewed lifecycle/native asset proxy
→ zero registry.npmjs.org requests after closure
→ Electron 38 arm64 native hydration
→ remove installs
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ immutable cache ledger + PASS receipt
```

Focused successor conditions:

```text
EXACT_SOURCE_LAUNCHER=PASS
RUNTIME_REGISTRY_MANIFEST=PASS
ROOT_CLOSURE_COMPLETENESS=PASS
LOCKFILE_ALIAS_IDENTITY=PASS
R55_BLOCKER_REGRESSION=PASS
REGISTRY_CACHE_CLOSURE=PASS
POST_CLOSURE_REGISTRY_REQUESTS=0
```

Any stable blocker after hydrator spawn consumes the source and stops the run.

## Candidate boundary

Only after a valid native-cache PASS receipt may MiniMax create a fresh Candidate worktree, prove exact identity, run source contracts, execute `run-candidate.mjs --dry-run`, then one real Candidate through R31 Gates 1–12.

Required technical success still includes packaged Electron `113/113` with zero skipped/unexpected/flaky, three Candidate-bound performance runs, Ask/source/Todo/Schedule/full-quit-relaunch, Knowledge Studio, packaged offline local ASR, artifact/runtime/test-data identities, screenshots and clean terminal state.

Candidate `EVIDENCE_DIR` must remain absent until the one real `run-candidate.mjs` invocation creates it.

## Release boundary

Even a fully successful unsigned MiniMax Candidate remains:

```text
PASS_UNSIGNED_DIAGNOSTIC_CANDIDATE
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
BLOCKED_UNSIGNED_NOT_NOTARIZED
```

MiniMax must not merge PR #20, change `main`, sign/notarize, modify credentials/global configuration, or begin Codex acceptance on its own.
