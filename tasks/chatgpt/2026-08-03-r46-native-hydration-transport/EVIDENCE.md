# EVIDENCE — R46 Native Hydration Transport Stability

## Incident evidence accepted

```text
R45 source: 43f151a3a1eb7e0592ff833f0e42892db47d3d65
R45 source gate: 30793536929 / 17 steps SUCCESS
R45 source contracts: 83/83 PASS
R45 first hydration result: ECONNRESET before PASS receipt
R45 Candidate executions: 0
R45 partial cache: EVIDENCE_ONLY / reuse forbidden
R45 second hydrator invocation: blocked by output-exists before hydration
Source changes by MiniMax: NONE
```

The local absolute paths and raw logs remain on the Owner Mac and are not committed.

## Source controls added

- `nativeHydrationTransportPolicy()` fixes retry count, timeouts, socket concurrency, keepalive, and partial-cache reuse truth.
- `configureNativeTunnelSocket()` applies keepalive, no-delay, and idle timeout to client and upstream sockets.
- the CONNECT proxy records each allowed request's timing, byte counts, socket policy, and terminal error.
- `classifyNativeTransportFailure()` maps `ECONNRESET`, timeout, pipe, and abort conditions to stable fail-closed codes.
- the hydrator writes `HYDRATION-FAILED.json` after a classified transport failure and does not write a PASS receipt.
- the Candidate validator rejects the partial marker before accepting any claimed receipt.
- strict receipt audit requires the exact transport policy and zero fatal tunnel records.

## Source tests

Added or extended tests cover:

- exact no-retry transport policy;
- keepalive/no-delay/timeout application;
- `ECONNRESET` stable classification;
- CONNECT summary counts, bytes, and errors;
- diagnostic-only partial-failure document;
- online environment retry/timeout/socket settings;
- receipt transport-policy binding;
- partial-marker rejection;
- fatal tunnel and retry-policy audit rejection.

## Evidence not produced remotely

```text
new native hydration receipt
new Candidate worktree
Candidate Gate 1–12 result
Electron launch
artifact SHA-256
runtime ID
113/113 packaged Electron
three performance receipts
screenshots
Codex focused retest
signing/notarization/Gatekeeper
Human Owner Gate
```

Those remain local and independent acceptance gates after the final exact PR #20 head passes source CI.
