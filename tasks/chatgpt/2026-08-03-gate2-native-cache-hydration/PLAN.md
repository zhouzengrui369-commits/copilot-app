# PLAN — R45 Gate 2 Native-Toolchain Cache Repair

## Objective

Close `BLOCKED_NPM_OFFLINE_INSTALL_FAILED` without granting network to the candidate and without disabling lifecycle scripts.

## Exact source baseline

```text
chatgpt/mvp-source-finalization
74454d21910f0c01e0b9d4f8117b4394defe3228
copilot-source-gate run 30784565586 = SUCCESS
```

## Root cause

The old cache hydration ran with `--ignore-scripts`. The candidate ran full lifecycle `npm ci --offline` under deny-network. Native lifecycle inputs were therefore absent.

## Chosen design

- candidate stays deny-network;
- candidate lifecycle scripts stay enabled;
- one separate exact-commit bounded hydration receives explicit Owner authority;
- hydration children reach only a localhost CONNECT proxy;
- proxy uses exact official-host allowlist and records all requests;
- hydration proves full lifecycle install and Electron arm64 native rebuild online and offline;
- receipt binds source, lock, lifecycle set, header root, cache bytes, proxy audit, commands, and proofs;
- candidate revalidates receipt/cache, installs offline, and proves cache immutability.

## Files

### Source

- `scripts/candidate-r30/native-cache-policy.mjs`
- `scripts/candidate-r30/native-cache-runtime.mjs`
- `scripts/candidate-r30/npm-native-cache-hydrate.mjs`
- `scripts/candidate-r30/gates-build.mjs`
- `scripts/candidate-r30/run-candidate.mjs`

### Tests

- `scripts/candidate-r30/npm-native-cache-hydrate.test.mjs`
- `scripts/candidate-r30/runner.test.mjs`
- `scripts/candidate-r30/document-authority.test.mjs`

### Governance

- root state/status/TODO/CHANGELOG/DECISIONS
- architecture and handoff mirrors
- MiniMax and local acceptance contracts

## Remote gates

1. all candidate source-contract tests pass;
2. exact package-lock lifecycle package set passes;
3. static plan keeps candidate offline and lifecycle-enabled;
4. real authority document validates;
5. TypeScript/local-first workspaces pass;
6. desktop Phase 1 source suite passes;
7. strict global/per-file coverage passes;
8. production CycloneDX SBOM passes;
9. exact Electron discovery remains `113 tests in 9 files`;
10. source remains clean.

## Truth boundary

```text
REMOTE_FIX_ONLY
LOCAL_CANDIDATE_NOT_RUN_ON_FIX
NOT_RUNTIME_PROOF
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
