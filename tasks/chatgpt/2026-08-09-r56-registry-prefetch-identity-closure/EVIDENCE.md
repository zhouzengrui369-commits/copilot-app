# EVIDENCE

## R55 terminal receipt

PR #20 comment records the consumed R55 local receipt:

- exact source `69a0e651f599403bf2427fd321d9491bd31f13b0`
- `HYDRATION_EXECUTIONS=1`
- `CANDIDATE_EXECUTIONS=0`
- blocker `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_CACHE_CLOSURE`
- exact missing cache request `typescript@6.0.3`
- source changes `NONE`

## Exact-source root-cause evidence

- root `package-lock.json`: `apps/mobile/node_modules/typescript` version `6.0.3`, no `resolved`/`integrity` identity;
- tracked `apps/mobile/package-lock.json`: exact `typescript@6.0.3` with canonical registry tarball and SHA-512 integrity;
- R50 `buildRegistryPrefetchManifest` previously skipped entries with no `resolved`.

## Regression evidence

R56 source-contract tests include:

1. fixture: unresolved root exact spec is supplemented from a nested lock;
2. fixture: unrelated nested package is excluded;
3. repository regression: auto-discovered tracked nested locks produce canonical `typescript@6.0.3` in the root closure manifest.

## Source gate

Code head: `0b405ef6e9758e04320f60be6ff38682bfee6ca0`

- workflow: `copilot-source-gate`
- run: `31293949510`
- job: `93195844225`
- conclusion: `SUCCESS`
- required steps: `17/17 SUCCESS`

The final evidence-containing R56 head must independently pass the same complete source gate before merge.
