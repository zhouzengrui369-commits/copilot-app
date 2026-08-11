# R46 Native Hydration Transport Stability

## Status

```text
SOURCE_FIX_UNDER_REVIEW
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

## Incident

The R45 exact source `43f151a3a1eb7e0592ff833f0e42892db47d3d65` passed authority, new-path checks, and `83/83` candidate source contracts. Its single Owner-authorized native-toolchain hydration stopped before Candidate creation after npm reported `ECONNRESET` during a long official-registry fetch sequence.

The resulting partial cache is immutable diagnostic evidence. A prohibited second hydrator invocation was immediately rejected by `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS`; it performed no additional hydration and created no Candidate.

## Scope

R46 changes only hydration transport and its evidence contract:

- TCP keepalive and no-delay on both tunnel sockets;
- twenty-minute idle timeout;
- explicit npm fetch timeout, zero retries, and bounded socket concurrency;
- per-CONNECT timing, bytes, socket policy, and terminal error evidence;
- stable transport blocker codes;
- exclusive partial-failure cache marker;
- Candidate receipt rejection of partial caches or fatal tunnel evidence.

It does not change product behavior, package versions, the official-host allowlist, Candidate deny-network policy, database, KB, vector store, credentials, signing, notarization, cloud resources, or release authority.

## No-retry invariant

```text
one Owner authority
→ one hydration invocation
→ PASS receipt or fail-closed blocker
```

There is no hidden retry, automatic resume, mirror fallback, or second npm install. A new attempt requires a new exact source SHA, new run stamp, new worktrees, new cache, new receipt, and new evidence.

## Partial cache truth

A transport failure writes `HYDRATION-FAILED.json` inside the failed cache root:

```text
status=partial_failed_transport
reusable=false
passReceiptCreated=false
automaticRetry=false
```

The Candidate receipt validator rejects the marker before reading a claimed PASS receipt.

## Local handoff gate

MiniMax remains stopped until the handoff contains all four values:

```text
SOURCE_COMMIT=<new exact SHA>
PR=20
SOURCE_GATE=PASS
RUN_STAMP=<new unique value>
```

R45 source, run stamp `20260803T123238Z`, cache, evidence, and logs remain `FORBIDDEN_REFERENCE_ONLY`.
