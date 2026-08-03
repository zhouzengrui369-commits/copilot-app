# MiniMax Code Local Handoff — Copilot App macOS MVP

This document coordinates the next exact-SHA macOS candidate attempt after the R45 native-toolchain hydration stopped before candidate creation because the npm registry transport reset during the single authorized hydration invocation.

The authoritative executable handoff remains:

```text
docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md
scripts/candidate-r30/minimax-authority.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## Fixed truth

```text
REMOTE_TRANSPORT_FIX_UNDER_REVIEW
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

The prior sources `74454d21910f0c01e0b9d4f8117b4394defe3228` and `43f151a3a1eb7e0592ff833f0e42892db47d3d65`, their worktrees, caches, receipts, evidence packages, logs, screenshots, artifacts, and runtime identities are `FORBIDDEN_REFERENCE_ONLY`. The R45 partial cache remains immutable diagnostic evidence and cannot be deleted, resumed, upgraded, or supplied to a candidate.

## R45 transport incident

R45 reached the bounded native-toolchain hydration on exact source `43f151a3a1eb7e0592ff833f0e42892db47d3d65`. Exact-object authority, new-path checks, and `83/83` source contracts passed. The only authorized online hydration then stopped after a long npm fetch sequence with `ECONNRESET`. The failed invocation left a partial cache and no PASS receipt, candidate worktree, artifact, runtime ID, or Electron evidence.

A second hydrator invocation was attempted contrary to the one-invocation contract and was immediately rejected by `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS`. It performed no additional network hydration and created no candidate state. This process deviation remains part of the immutable R45 evidence.

## Transport repair

The successor retains all R45 security boundaries:

- one Owner authorization for one hydration invocation;
- no automatic retry, hidden retry, online resume, or candidate fallback;
- exact official-host allowlist unchanged;
- localhost CONNECT proxy only;
- candidate Gate 1–12 remains `(deny network*)`;
- source, tests, runner, package files, credentials, global configuration, signing, notarization, and cloud state remain untouched during local execution.

The transport layer now adds:

- TCP keepalive and no-delay on both tunnel sockets;
- a twenty-minute idle timeout for long artifact transfers;
- explicit npm fetch timeout and bounded socket concurrency;
- npm fetch retries fixed to zero;
- per-CONNECT timestamps, duration, directional byte counts, socket policy, and terminal error evidence;
- stable transport blockers such as `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`;
- an exclusive `HYDRATION-FAILED.json` marker inside a failed cache root with `status=partial_failed_transport`, `reusable=false`, and `passReceiptCreated=false`;
- receipt validation that rejects any partial marker, retry-policy drift, or fatal tunnel record.

No PASS hydration receipt can be emitted after a transport failure. A failed cache can never be used by the candidate.

## Resume trigger

MiniMax remains stopped until one handoff contains all four fields:

```text
SOURCE_COMMIT=<new exact 40-character PR head>
PR=<open Draft PR number>
SOURCE_GATE=PASS
RUN_STAMP=<new unique value>
```

A missing field means `STOPPED`. The supplied source SHA must differ from the consumed R45 SHA, and the run stamp must differ from `20260803T123238Z`.

## New paths only

The next run must create a new detached hydration worktree, new native cache root, new exclusive receipt, separate detached candidate worktree, new evidence directory, and new task root. It must not search for a reusable partial cache and must not remove the R45 evidence.

The exact Owner token remains:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The token authorizes one hydration invocation for the new exact commit. It does not authorize a retry and never grants network access to the candidate.

## Required hydration proof

A PASS receipt must bind:

- exact source commit and package-lock SHA-256;
- exact reviewed install-script package set;
- npm executable and version;
- exact no-retry transport policy;
- exact allowed hosts and complete nonfatal CONNECT audit;
- npm, Electron, electron-builder, node-gyp/header, and prebuild cache layout;
- all regular cache-file hashes and aggregate SHA-256;
- exact Electron header root;
- online full lifecycle install result;
- online Electron 38 arm64 native rebuild result;
- deny-network full lifecycle `npm ci --offline` result;
- deny-network Electron arm64 native rebuild result;
- restored Electron executable proof;
- final clean detached source state;
- `candidateCreated=false` and `evidenceCreated=false`.

The hydrator deletes all `node_modules` trees before producing the receipt. It does not create a candidate.

## Candidate requirements

MiniMax must prove:

```text
FETCH_HEAD = supplied SOURCE_COMMIT = detached hydration HEAD = detached candidate HEAD
```

The runner validates the native receipt and every cache byte, performs full lifecycle `npm ci --offline` under deny-network, revalidates cache identity, and continues Gates 3–12 only after Gate 2 passes. No candidate command receives the hydration proxy or online authority.

MiniMax may execute one hydration and one candidate exactly once. On the first blocker it must stop, preserve evidence, make no local source repair, and request a new GitHub task rather than retrying.

## Required candidate output

The evidence package must contain:

```text
PLAN.md
RESULT.md
EVIDENCE.md
commands.log
changed-files.txt
CANDIDATE-MANIFEST.json
R30-COMPLETE.json
```

It must bind source snapshot, native-cache receipt, artifact, app, executable, `app.asar`, runtime, test-data, commands, screenshots, test results, performance receipts, and process terminal state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

## Product journey

The exact packaged candidate must still prove:

```text
local material
→ grounded Ask answer
→ click and verify local source
→ return to the same Ask exchange
→ canonical Todo create/readback
→ exact Todo in All / Unscheduled
→ edit and source preservation
→ due-date / plan association
→ complete Electron quit
→ same-artifact relaunch and persistence readback
```

## Codex boundary

MiniMax technical evidence is not product acceptance. Codex may begin only after a complete internally consistent evidence package exists and must independently operate the same source commit, artifact SHA-256, runtime ID, and test-data manifest.

Until then, and even after a successful unsigned technical candidate, the truthful status remains:

```text
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

MiniMax must not merge the PR, change `main`, sign, notarize, alter credentials or global configuration, run Windows/mobile scope, or declare `MVP_READY`, `RELEASE_READY`, `EXPERIENCE_READY`, or `HUMAN_OWNER_GATE_PASS`.
