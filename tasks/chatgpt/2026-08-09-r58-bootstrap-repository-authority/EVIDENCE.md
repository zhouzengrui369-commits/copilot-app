# EVIDENCE

## R57 local evidence accepted by Parent PM

```text
SOURCE_COMMIT=2927d0e3cd81e3997bb229ce544b95a1e3cbce8b
RUN_STAMP=20260809T044928Z
FAILED_PHASE=registry_prefetch_manifest_enumeration
BLOCKER=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH_MANIFEST
HYDRATION_EXECUTIONS=1
CANDIDATE_EXECUTIONS=0
RETRY_ATTEMPTED=NO
SOURCE_CONSUMED=true
SOURCE_CHANGES_BY_MINIMAX=NONE
```

Observed runtime detail: extracted bootstrap path under `/private/tmp` caused the old module-relative repository root to resolve outside the Git worktree; `git ls-files` returned `fatal: not a git repository`.

## Exact source inspection

The consumed source showed:

- `registry-prefetch.mjs` defined `SOURCE_REPOSITORY_ROOT` from `fileURLToPath(import.meta.url)` + `../..`;
- `npm-native-cache-hydrate.mjs` already obtained and validated `repository = await realpath(options.repository)` before manifest construction;
- the registry manifest call did not carry that repository authority into the helper.

## R58 regression evidence

The R58 tests now cover:

- simulated `/private/tmp/.../npm-native-cache-hydrate.mjs --repository <real worktree>`;
- canonical `typescript@6.0.3` discovery from the real worktree;
- missing/relative repository authority fail-closed;
- prohibition of `SOURCE_REPOSITORY_ROOT` and `fileURLToPath(import.meta.url)` inference;
- preservation of R56 exact-match supplementation and unrelated nested-package exclusion.

## Code source gate

```text
HEAD=277e103ae26d56c6b1700456b9786cb0ee2b678b
RUN=31296301736
JOB=93201820414
RESULT=17/17_SUCCESS
```

All source-gate steps passed: exact checkout/toolchain, exact lockfile install, Candidate fail-closed contracts, R31 RAG slice, ordered workspace build, local-first checks, core unit/integration, desktop build, Desktop Phase 1, core strict coverage, Desktop strict coverage, CycloneDX SBOM, exact Electron discovery and tracked-source-unchanged verification.

## Boundary evidence

No package/lockfile, workflow, product feature/runtime, host allowlist, retry/resume, Candidate network authority, signing/notarization, cloud/global config or `main` change was used to obtain the pass.
