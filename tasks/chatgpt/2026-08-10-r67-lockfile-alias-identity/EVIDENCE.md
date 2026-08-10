# EVIDENCE — R67

## R66 consumed local evidence

MiniMax R66:
- source: `beb951b95695233911da0a17543ef342acc6df93`
- hydration executions: 1
- candidate executions: 0
- 50/57 registry-prefetch batches passed
- terminal blocker: `BLOCKED_NATIVE_CACHE_HYDRATION_REGISTRY_PREFETCH`
- failing request: `string-width-cjs@4.2.3` -> npm `ETARGET`
- retry/resume: none
- source changes by MiniMax: none
- local cache/evidence: immutable predecessor reference only

## Lockfile truth

The root lock entry at `node_modules/string-width-cjs` explicitly records package name `string-width` at version `4.2.3`. Equivalent alias patterns exist for `strip-ansi-cjs -> strip-ansi` and `wrap-ansi-cjs -> wrap-ansi`.

Therefore the registry prefetch identity must follow the locked package name, not the install-path alias.

## Source repair evidence

Changed implementation surface:
- `scripts/candidate-r30/registry-prefetch.mjs`
- `scripts/candidate-r30/registry-prefetch-alias.test.mjs`

No package/lockfile or product bytes changed.

The exact-repository regression requires real package specs and forbids fake alias specs.

Implementation source-gate receipt:

```text
head=20003b07b8137a369263e0fadb3b4f4171d7d392
run=31354821614
job=93352458882
steps=17/17 PASS
```

Final evidence Head source gate: PENDING.
