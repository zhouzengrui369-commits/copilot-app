# EVIDENCE — R48 Segmented Registry Prefetch

## Incident preimage

```text
source: 7d8495a23e6372e5f7e99dd45d6e73466a90ca9f
MiniMax result: BLOCKED
blocker: BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET
candidate established: false
artifact SHA-256: null
runtime ID: null
source changes by MiniMax: none
```

MiniMax reported six allowed CONNECT tunnels during the failed hydration, approximately 388 MiB upstream-to-client traffic in aggregate, and an upstream `ECONNRESET` from `registry.npmjs.org:443`. The failed cache is `partial_failed_transport`, `reusable=false`, and remains evidence-only.

## Source repair evidence

Changed implementation surfaces:

- `scripts/candidate-r30/registry-prefetch.mjs`
- `scripts/candidate-r30/registry-prefetch.test.mjs`
- `scripts/candidate-r30/npm-native-cache-hydrate.mjs`

Behavioral proof encoded by source tests:

- registry manifest is lockfile-derived, deterministic and deduplicated;
- reviewed legacy registry origins canonicalize to the official npm registry;
- unreviewed remote origins and missing integrity fail closed;
- batch size is bounded to 24 by default and never exceeds the policy maximum;
- prefetch uses `npm pack --ignore-scripts` into the isolated cache;
- the hydrator uses bounded prefetch before lifecycle work;
- the lifecycle `npm ci` uses `--offline`, and the previous online CI call is absent;
- existing no-retry and partial-cache fail-closed controls remain unchanged.

## GitHub validation

```text
PR: 24
branch: chatgpt/r48-segmented-registry-prefetch
implementation head: a3f87e71930857ac71abe626fea115aa709996ee
workflow: copilot-source-gate
run: 31155823536
result: 17/17 SUCCESS
```

Final evidence-containing head receives a second complete source gate before merge.

## Evidence not produced remotely

- PASS native-cache receipt;
- packaged Electron Candidate;
- artifact SHA-256;
- runtime ID;
- packaged Electron 113/113;
- performance receipts;
- runtime screenshots;
- Codex focused retest.

Those remain local successor gates.