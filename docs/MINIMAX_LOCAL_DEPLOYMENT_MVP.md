# MiniMax Code Local Handoff — Copilot App macOS MVP

This document coordinates the next exact-SHA macOS candidate attempt after the first PR #20 candidate stopped correctly at Gate 2 with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED`.

The authoritative executable handoff is:

```text
docs/MINIMAX_LOCAL_DEPLOYMENT_R31.md
scripts/candidate-r30/minimax-authority.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/run-candidate.mjs
```

## Fixed truth

```text
REMOTE_SOURCE_FIX_UNDER_REVIEW
LOCAL_CANDIDATE_NOT_RUN_ON_FIX
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```

The prior source `74454d21910f0c01e0b9d4f8117b4394defe3228`, its old registry-only cache, old receipt, old candidate worktree, and old evidence package are reference-only. They cannot be reused because the source and cache receipt schema have changed.

## Gate 2 incident

The old hydration performed:

```text
npm ci --ignore-scripts --offline
```

The candidate then performed:

```text
npm ci --offline
```

with lifecycle scripts enabled under `(deny network*)`. `better-sqlite3` attempted a prebuilt download and then a node-gyp header download. Both were correctly denied, so the candidate stopped before build or Electron launch.

The repair does not weaken the candidate sandbox and does not add `--ignore-scripts` to the candidate. Instead it requires a new native-toolchain receipt that proves the exact full lifecycle install and Electron arm64 native rebuild can both complete offline before candidate execution begins.

## New owner authority

The new hydration requires the exact token:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

The token authorizes one hydration attempt for one exact commit. It does not authorize the candidate to use network.

Hydration is restricted to a source-defined allowlist of official package and toolchain hosts. Every child command runs under `sandbox-exec`, can connect only to a localhost CONNECT proxy, and the proxy records and rejects destinations outside the allowlist. Inherited credentials, Electron mirrors, npm registry overrides, dist URLs, proxy authority, and npm config files are removed.

## Required hydration proof

The new hydrator must produce one receipt that binds:

- exact source commit;
- package-lock SHA-256;
- exact reviewed install-script package set;
- npm executable and version;
- exact allowed hosts and complete CONNECT audit;
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

MiniMax must receive the externally frozen final 40-character fix SHA, fetch the exact open Draft PR head, and prove:

```text
FETCH_HEAD = supplied SHA = detached candidate git HEAD
```

The candidate runner then:

1. validates the native receipt, source, lockfile, lifecycle set, headers, and every cache byte;
2. runs a full lifecycle `npm ci --offline` under `(deny network*)`;
3. directs `better-sqlite3` to build from source with the receipt-bound Node headers;
4. redirects npm logs to evidence;
5. revalidates the cache identity after install;
6. supplies the receipt-bound Electron headers to later native staging;
7. continues the unchanged Gate 3–12 contract only after Gate 2 passes.

No candidate command receives the hydration proxy or online authority. A missing or invalid receipt fails closed.

## Required candidate output

MiniMax must use a new detached hydration worktree, new cache, new receipt, separate detached candidate worktree, and new evidence directory. It must not edit source locally.

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

It must bind source snapshot, artifact, app, executable, `app.asar`, runtime, test-data, commands, screenshots, test results, performance receipts, and process terminal state.

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
