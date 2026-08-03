# R45 Gate 2 Native-Toolchain Cache Repair

Date: 2026-08-03

## Verdict

```text
REMOTE_FIX_SOURCE = UNDER_REVIEW
LOCAL_CANDIDATE    = NOT_RUN_ON_FIX
RUNTIME_PROOF      = NOT_RUNTIME_PROOF
MVP                = MVP_NOT_COMPLETE
RELEASE            = NOT_RELEASE_READY
EXPERIENCE         = NOT_EXPERIENCE_READY
```

## Incident

The first exact macOS MVP candidate used source `74454d21910f0c01e0b9d4f8117b4394defe3228`. Exact-object setup, registry-only cache hydration, source contracts, and dry-run passed. Candidate Gate 2 then stopped with `BLOCKED_NPM_OFFLINE_INSTALL_FAILED`.

The old cache proof was intentionally created with lifecycle scripts disabled. Candidate Gate 2 correctly enabled lifecycle scripts while running under `(deny network*)`. `better-sqlite3` attempted a GitHub prebuilt asset and then node-gyp headers from nodejs.org; both were denied. The candidate produced no artifact or runtime identity and MiniMax changed no source.

## Rejected shortcuts

### Candidate `--ignore-scripts`

Rejected because it could install JavaScript packages while leaving native dependencies absent or ABI-incompatible. A green source/test result would not prove packaged Electron.

### Candidate egress

Rejected because Gate 2 is an offline reproducibility gate. Candidate commands must remain deny-network.

### Reusing the old cache

Rejected because the old receipt does not bind lifecycle results, Node/Electron headers, Electron distributions, native rebuilds, or full offline lifecycle proof. Tracked source has also changed.

## Repair

R45 adds:

```text
scripts/candidate-r30/native-cache-policy.mjs
scripts/candidate-r30/native-cache-runtime.mjs
scripts/candidate-r30/npm-native-cache-hydrate.mjs
scripts/candidate-r30/npm-native-cache-hydrate.test.mjs
```

The new exact Owner token is:

```text
OWNER_APPROVAL_FOR_BOUNDED_NATIVE_TOOLCHAIN_CACHE_HYDRATION
```

Hydration uses a new clean detached worktree and new cache root. Every child process can connect only to a localhost CONNECT proxy. The proxy accepts only the exact source-defined official npm, Node, Electron, and GitHub release-host allowlist and records each request.

The hydrator strips inherited:

- npm user/global config;
- registry and proxy settings;
- npm/GitHub credentials;
- Electron mirrors and custom filenames;
- node-gyp dist URL, target, runtime, architecture, and tool overrides.

A PASS receipt requires:

1. exact source commit and clean detached worktree;
2. exact package-lock SHA-256;
3. exact reviewed install-script package set;
4. online full lifecycle install through the bounded proxy;
5. online Electron 38 arm64 `better-sqlite3` rebuild;
6. receipt-bound npm, Electron, electron-builder, node-gyp/header, and prebuild caches;
7. removal of all installed `node_modules` trees;
8. full lifecycle `npm ci --offline` under `(deny network*)`;
9. Electron 38 arm64 native rebuild under `(deny network*)` using the exact hydrated header root;
10. Electron executable cache proof;
11. second removal of all installed `node_modules` trees and clean source;
12. all-regular-file cache ledger and aggregate SHA-256;
13. `candidateCreated=false` and `evidenceCreated=false`.

Candidate Gate 2 validates the receipt and every cache byte, runs the full lifecycle install under deny-network, redirects npm logs to evidence, revalidates the cache identity after install, and publishes only receipt-bound native build environment to later packaging.

## Exact-object handoff

The executable handoff now receives `PR_NUMBER` and `EXACT_FINAL_HEAD`. It fetches `refs/pull/${PR_NUMBER}/head`, proves exact equality, and reads authority, hydrator, and runner from the exact Git object. Historical PR #14 literals are removed from active bootstrap instructions.

## Acceptance boundary

This repair can unlock another local attempt only after the exact final repair head passes the complete Node 24 macOS source gate. MiniMax must use new worktrees/cache/receipt/evidence and execute the candidate once. Codex still owns independent real Electron acceptance.

No part of R45 claims `MVP_READY`, `RELEASE_READY`, `EXPERIENCE_READY`, signing, notarization, or Human Owner Gate completion.
