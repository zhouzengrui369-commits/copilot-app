# R58 Bootstrap Repository Authority Repair

Date: 2026-08-09
Parent PM: ChatGPT
Repository: `zhouzengrui369-commits/copilot-app`
Stacked PR: #31 -> Draft PR #20

## Trigger

R57 consumed source `2927d0e3cd81e3997bb229ce544b95a1e3cbce8b` with one durable background hydrator. Exact source setup and `98/98` source contracts passed, but the hydrator stopped before registry prefetch with:

```text
FAILED_PHASE=registry_prefetch_manifest_enumeration
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
SOURCE_CONSUMED=true
```

The extracted bootstrap executed under `/private/tmp/...`. R56 had derived `SOURCE_REPOSITORY_ROOT` from `import.meta.url`, so `git ls-files` targeted `/private/tmp` instead of the exact detached hydration worktree.

## Verified root cause

`hydrateNativeToolchainCache()` already validates `options.repository` as the exact detached clean worktree, but `registry-prefetch.mjs` ignored that runtime authority and inferred source location from its own module path. That assumption is false after the authority bootstrap extracts the hydrator surface outside the repository.

## Repair

R58 removes module-location repository inference. Tracked supplemental lock discovery now resolves repository authority from the exact hydration CLI `--repository` argument. The parser requires exactly one absolute repository path and fails closed otherwise. Direct library/tests may pass an explicit absolute `repositoryRoot`.

R56 closure semantics remain unchanged:

```text
root lock = dependency closure authority
tracked nested locks = exact name@version registry identity index only
unrelated nested graph import = forbidden
```

No package/lockfile, product runtime, workflow, host allowlist, retry/resume policy, Candidate network authority, signing/notarization or cloud configuration changed.

## Regression proof

The R58 tests prove:

1. simulated bootstrap argv uses `/private/tmp/.../npm-native-cache-hydrate.mjs` plus `--repository <real worktree>` and still discovers canonical `typescript@6.0.3`;
2. missing or relative repository authority fails closed;
3. source contracts forbid `SOURCE_REPOSITORY_ROOT` and `fileURLToPath(import.meta.url)` inference;
4. R56 exact-spec supplementation and unrelated-package exclusion remain green.

## Code-green source gate

```text
HEAD=277e103ae26d56c6b1700456b9786cb0ee2b678b
RUN=31296301736
JOB=93201820414
RESULT=17/17_SUCCESS
```

A final evidence-containing R58 head must pass the same complete source gate before PR #31 may merge into Draft PR #20. The resulting exact PR #20 head must then pass the complete source gate again before the next MiniMax local run is authorized.

## Terminal project status

```text
R57=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST
R57_SOURCE_CONSUMED=true
R58_SOURCE_REPAIR=IMPLEMENTED
LOCAL_SUCCESSOR=NOT_RUN
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
