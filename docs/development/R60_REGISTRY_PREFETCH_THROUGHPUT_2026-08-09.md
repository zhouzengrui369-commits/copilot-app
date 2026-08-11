# R60 Registry Prefetch Throughput Repair

Date: 2026-08-09
Parent PM: ChatGPT
Repository: `zhouzengrui369-commits/copilot-app`
Stacked PR: #32 -> Draft PR #20

## Trigger

A prior local R58 execution consumed source `d29da3e6dcc9c89d680f56c23e66262e9ee967c1`. Bootstrap-safe repository authority worked and registry prefetch reached batch 21 of 35, then `registry.npmjs.org` reset one transport connection after roughly 71 minutes. No Candidate was created. A later same-source/same-run dispatch correctly stopped on existing-path freshness without starting hydration.

The prior R58 run did not reach registry-cache closure. Therefore the R55 `typescript@6.0.3` closure regression remains `UNVERIFIED`; absence from the first 21 alphabetically ordered completed batches is not evidence that the R56 supplemental identity is absent from the manifest.

## Repair

R60 leaves registry batch size at 24 and leaves all lifecycle/native transport settings unchanged. Only the `npm pack` registry-prefetch subprocess receives an explicit bounded `--maxsockets=12` setting.

This is a throughput bound, not retry authority:

- `automaticRetry=false` remains unchanged;
- npm fetch retries remain zero;
- one hydrator process remains mandatory;
- no mirror switch or host allowlist expansion;
- no parallel hydrators;
- no Candidate network authority;
- no package/lockfile/product/workflow change.

The purpose is to shorten the 35-batch registry exposure window that previously exceeded one hour while keeping one-shot fail-closed transport semantics.

## Focused successor evidence

Before the next online hydration starts, MiniMax must materialize the exact-source registry manifest into task evidence and prove canonical `typescript@6.0.3` with exact integrity is present. That runtime manifest proof is separate from network completion. If a later prefetch transport failure occurs, the identity-closure question must not be misclassified.

## Source gate

Code Head `5fffa0aef0813af50602f73b2d7425188958de6e`:

- initial run: `31302092459`
- initial job: `93216409717`
- initial terminal: Desktop strict coverage only failure
- exact diff from source-green base: only `registry-prefetch.mjs` and one Candidate source-contract test; no Desktop/product/package/lock/workflow changes
- failed job rerun: `93216854694`
- rerun result: `17/17 SUCCESS`
- tracked source change between attempts: none
- coverage threshold change between attempts: none

The final evidence-containing R60 Head must pass the complete source gate before PR #32 may merge into PR #20. The resulting PR #20 Head must then pass the complete source gate before local execution is authorized.

## Status

```text
R58=FROZEN_SOURCE_CONSUMED
R58_TRANSPORT_BLOCKER=BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET
R55_BLOCKER_REGRESSION=UNVERIFIED
R60_SOURCE_REPAIR=IMPLEMENTED
LOCAL_SUCCESSOR=NOT_RUN
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
