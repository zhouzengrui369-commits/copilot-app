# MiniMax Code Local Handoff — Copilot App macOS MVP

This document coordinates the next exact-SHA macOS Candidate attempt after the source-green R47 attempt stopped before Candidate creation with `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` during the single Owner-authorized native-toolchain hydration. R48 changes only the hydration preparation shape; Candidate authority and the twelve fail-closed gates remain unchanged.

The authoritative executable handoff remains:

```text
docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md
scripts/candidate-r30/minimax-authority.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## Fixed truth

```text
R48_SEGMENTED_REGISTRY_PREFETCH_IN_SOURCE
LOCAL_SUCCESSOR_NOT_RUN
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

All prior attempted source identities, including `74454d21910f0c01e0b9d4f8117b4394defe3228`, `43f151a3a1eb7e0592ff833f0e42892db47d3d65`, and `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f`, plus their worktrees, caches, partial caches, receipts, evidence, logs, screenshots, artifacts and runtime identities are `FORBIDDEN_REFERENCE_ONLY`. Failed caches remain immutable diagnostic evidence and cannot be deleted, resumed, upgraded or supplied to a later Candidate.

## R48 trigger

The `7d8495…` source passed the complete GitHub source gate. MiniMax then proved exact-object authority and `90/90` source contracts and invoked native-toolchain hydration once. The hydration stopped before Candidate creation after an upstream `registry.npmjs.org:443` `ECONNRESET`. The failed cache was marked `partial_failed_transport`, `reusable=false`, no PASS receipt was emitted, and no Candidate/artifact/runtime identity existed.

R46 had already provided TCP keepalive/no-delay, long idle timeout, zero npm retries and complete CONNECT evidence. R48 addresses the remaining shape: one registry-heavy lifecycle install could keep a small number of CONNECT tunnels alive while hundreds of MiB were transferred.

## R48 segmented registry hydration

The successor preserves all security boundaries:

- one Owner authorization for one hydration invocation;
- `automaticRetry=false`;
- no hidden retry/backoff, online resume, partial-cache reuse or Candidate fallback;
- exact official-host allowlist unchanged;
- localhost CONNECT proxy only;
- Candidate Gate 1–12 remains `(deny network*)`;
- source, tests, package files, lockfile, credentials, global configuration, signing, notarization and cloud state remain untouched during local execution.

The single hydration invocation now executes:

```text
exact package-lock v3
→ deterministic unique registry tarball manifest
→ canonical registry.npmjs.org tarball URLs
→ bounded 24-item npm pack --ignore-scripts batches
→ isolated npm content cache
→ full lifecycle npm ci --offline inside the bounded hydration sandbox
→ lifecycle-only official Node/Electron/GitHub assets through the unchanged proxy
→ Electron 38 arm64 native hydration
→ remove node_modules
→ full npm ci --offline under deny-network
→ Electron arm64 native rebuild under deny-network
→ cache ledger + PASS receipt
```

Each prefetch batch is a fresh npm child process. Retries remain disabled. A failed batch immediately becomes a fail-closed transport blocker and the invocation stops. The partial cache cannot be reused.

The prefetch manifest is derived from the exact package-lock, is integrity-bound, deduplicated and sorted. Only already-reviewed npm registry origins may be canonicalized to `registry.npmjs.org`; no arbitrary remote package origin is accepted.

## Resume trigger

MiniMax remains stopped until one handoff contains all four fields:

```text
SOURCE_COMMIT=<new exact 40-character PR #20 head>
PR=20
SOURCE_GATE=PASS
RUN_STAMP=<new unique value>
```

A missing field means `STOPPED`. The supplied source SHA must differ from all prior attempted source SHAs and the run stamp must be new.

## New paths only

The next run must create a new detached hydration worktree, new native cache root, new exclusive receipt, separate detached Candidate worktree, new evidence directory, and new task root. It must not search for a reusable failed cache and must not remove old evidence.

The exact Owner token remains:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The token authorizes one hydration invocation for the new exact commit. It does not authorize a retry and never grants network access to the Candidate.

## Required hydration proof

A PASS receipt must bind:

- exact source commit and package-lock SHA-256;
- exact reviewed install-script package set;
- npm executable and version;
- exact no-retry transport policy;
- exact allowed hosts and complete nonfatal CONNECT audit;
- R48 registry-prefetch strategy, deterministic manifest SHA-256, entry count, batch size/count and each command receipt;
- npm, Electron, electron-builder, node-gyp/header and prebuild cache layout;
- all regular cache-file hashes and aggregate SHA-256;
- exact Electron header root;
- registry-offline full lifecycle install result after prefetch;
- online-bounded Electron 38 arm64 native rebuild result;
- deny-network full lifecycle `npm ci --offline` result;
- deny-network Electron arm64 native rebuild result;
- restored Electron executable proof;
- final clean detached source state;
- `candidateCreated=false` and `evidenceCreated=false`.

The hydrator deletes all `node_modules` trees before producing the receipt. It does not create a Candidate.

## Candidate requirements

MiniMax must prove:

```text
FETCH_HEAD = supplied SOURCE_COMMIT = detached hydration HEAD = detached candidate HEAD
```

The runner validates the native receipt and every cache byte, performs full lifecycle `npm ci --offline` under deny-network, revalidates cache identity, and continues Gates 3–12 only after Gate 2 passes. No Candidate command receives the hydration proxy or online authority.

MiniMax may execute one hydration and one Candidate exactly once. On the first blocker it must stop, preserve evidence, make no local source repair, and request a new GitHub task rather than retrying.

## Required Candidate output

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

It must bind source snapshot, native-cache receipt, artifact, app, executable, `app.asar`, runtime, test-data, commands, screenshots, test results, performance receipts and process terminal state. `changed-files.txt` must state `SOURCE_CHANGES_BY_MINIMAX = NONE`.

## Product journey

The exact packaged Candidate must prove both the preserved critical loop and the R47 Knowledge Studio:

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

It must also exercise Sources, Wiki, Review Queue, Activity, Graph, 4-Signal Connections and explicit `重新整理` in the packaged Electron app, with Review metadata remaining separate from canonical local truth.

## Codex boundary

MiniMax technical evidence is not product acceptance. Codex may begin only after a complete internally consistent evidence package exists and must independently operate the same source commit, artifact SHA-256, runtime ID and test-data manifest.

Until then, and even after a successful unsigned technical Candidate, the truthful status remains:

```text
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

MiniMax must not merge PR #20, change `main`, sign, notarize, alter credentials or global configuration, run Windows/mobile scope, or declare `MVP_READY`, `RELEASE_READY`, `EXPERIENCE_READY`, or `HUMAN_OWNER_GATE_PASS`.