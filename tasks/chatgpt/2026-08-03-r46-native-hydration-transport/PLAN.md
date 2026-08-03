# PLAN — R46 Native Hydration Transport Stability

## Objective

Close the R45 npm transport-reset evidence gap without weakening the one-invocation, no-retry, official-host-only hydration contract or the Candidate deny-network boundary.

## Base

```text
PR #20 branch: chatgpt/mvp-source-finalization
Base commit: 43f151a3a1eb7e0592ff833f0e42892db47d3d65
Repair branch: chatgpt/r45-native-hydration-transport-fix
```

## Allowed source

- `scripts/candidate-r30/native-cache-policy.mjs`
- `scripts/candidate-r30/native-cache-runtime.mjs`
- `scripts/candidate-r30/npm-native-cache-hydrate.mjs`
- `scripts/candidate-r30/native-cache-receipt-audit.mjs`
- focused native-cache tests
- governance, status, architecture decision, development, and handoff documents.

## Non-goals

- no product code or package-version change;
- no Candidate network;
- no allowlist expansion;
- no hidden or automatic retry;
- no partial-cache reuse;
- no local Candidate execution by ChatGPT;
- no signing, notarization, cloud, credential, database, KB, vector-store, Windows, or mobile work.

## Implementation

1. add explicit keepalive/no-delay/idle-timeout socket policy;
2. set npm fetch retries to zero, explicit timeout, and bounded sockets;
3. record complete per-CONNECT transport receipts;
4. classify transport failures with stable blockers;
5. write an exclusive partial-cache marker after transport failure;
6. reject partial markers and fatal tunnel receipts;
7. update direct tests and durable handoff truth;
8. open a stacked Draft PR into PR #20's source branch;
9. require the complete Node 24 macOS source gate;
10. merge only into PR #20, rerun the complete source gate on the resulting exact PR #20 head, then issue a four-field MiniMax handoff.

## Completion boundary

```text
REMOTE_R46_SOURCE_COMPLETE
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
