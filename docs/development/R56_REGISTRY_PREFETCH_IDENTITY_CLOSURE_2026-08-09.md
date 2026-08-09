# R56 Registry Prefetch Identity Closure Repair

Date: 2026-08-09
Parent PM: ChatGPT
Repository: `zhouzengrui369-commits/copilot-app`
Stacked PR: #29 -> Draft PR #20

## Trigger

R55 consumed source `69a0e651f599403bf2427fd321d9491bd31f13b0` and stopped fail-closed at Gate 2 precondition after one real hydrator invocation. All 15 bounded registry-prefetch batches completed, then strict deny-network `npm ci --offline --ignore-scripts` failed with `ENOTCACHED` for `typescript@6.0.3`.

## Verified root cause

The root `package-lock.json` contains `apps/mobile/node_modules/typescript` version `6.0.3` without `resolved` or `integrity`. The tracked `apps/mobile/package-lock.json` contains the same exact `typescript@6.0.3` with registry tarball and integrity. R50 `buildRegistryPrefetchManifest` skipped root entries without `resolved`, so the prefetch cache could not satisfy root npm closure.

## Repair

The root lock remains the closure authority. `registry-prefetch.mjs` now enumerates only Git-tracked nested `package-lock.json` files from the exact source worktree and builds an exact `name@version -> resolved + integrity` identity index. A nested identity is imported only when the root lock contains the same exact unresolved `node_modules` spec. Unrelated nested dependencies are never added to the prefetch graph.

No product source, package/lockfile, host allowlist, retry policy, Candidate network authority, signing/notarization, cloud state or workflow was changed.

## Regression proof

The R56 tests prove both:

1. an unresolved root `typescript@6.0.3` is supplemented from an exact nested lock identity;
2. an unrelated nested package is excluded from the manifest.

The real repository regression test additionally proves the current exact source auto-discovers the tracked mobile lock and includes canonical `typescript@6.0.3`.

## Source-gate history

Initial R56 head `2a1afd0b3be65c2d39456b50f6540e5c7922110f` failed only because one static test regex assumed `git` and `ls-files` appeared on one line. The implementation and all functional R56 tests passed. That assertion was corrected without implementation changes.

Code head `0b405ef6e9758e04320f60be6ff38682bfee6ca0` then passed the complete Node 24/macOS source gate:

- run: `31293949510`
- job: `93195844225`
- result: `17/17 SUCCESS`

A final evidence-containing head must pass the complete source gate before PR #29 may merge into PR #20. The resulting exact PR #20 head must pass the complete source gate before the next MiniMax successor is authorized.

## Terminal project status

```text
R55=BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE
R55_SOURCE_CONSUMED=true
R56_SOURCE_REPAIR=IMPLEMENTED
LOCAL_SUCCESSOR=NOT_RUN
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
