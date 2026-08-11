# PLAN — R48 Segmented Registry Prefetch

## Trigger

MiniMax executed exact source `7d8495a23e6372e5f7e99dd45d6e73466a90ca9f` and stopped before Candidate creation with `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET` during the single Owner-authorized native-toolchain hydration. The failing upstream was `registry.npmjs.org:443`; source stayed clean, no PASS receipt was emitted, and no Candidate/artifact/runtime identity exists.

## Goal

Reduce registry transport exposure without retry, resume, partial-cache reuse, allowlist expansion, Candidate network access, package changes, or product changes.

## Design

Replace the one long registry-heavy lifecycle install with:

```text
exact package-lock v3
→ deterministic unique registry tarball manifest
→ bounded npm-pack prefetch batches (fresh npm process per batch, --ignore-scripts)
→ npm cache populated with exact lockfile tarballs
→ full lifecycle npm ci --offline inside the existing online-asset sandbox
→ lifecycle-only Node/Electron/GitHub official assets may use the existing localhost CONNECT proxy
→ existing Electron arm64 native hydration
→ existing deny-network offline install/native proofs
→ immutable cache ledger + PASS receipt
```

The hydrator invocation remains single-shot. A failed prefetch batch is a fail-closed transport blocker; it is never retried inside the invocation and the partial cache remains non-reusable.

## Allowed files

- `scripts/candidate-r30/registry-prefetch.mjs`
- `scripts/candidate-r30/registry-prefetch.test.mjs`
- `scripts/candidate-r30/npm-native-cache-hydrate.mjs`
- bounded governance/evidence documentation after source tests pass

## Explicit non-goals

- no product/UI change;
- no package or lockfile change;
- no host allowlist expansion;
- no Candidate network authority;
- no automatic retry/backoff;
- no reuse of the R48 failed partial cache;
- no modification of `main` or merge of Draft PR #20.

## Acceptance

1. deterministic lockfile-derived registry manifest;
2. bounded batch size and exact direct tarball URLs;
3. prefetch commands disable scripts and use the isolated npm cache/proxy;
4. lifecycle install uses `npm ci --offline` after prefetch;
5. `automaticRetry=false` remains unchanged;
6. all `scripts/candidate-r30/*.test.mjs` PASS;
7. complete `copilot-source-gate` PASS on the stacked repair PR;
8. merge only into `chatgpt/mvp-source-finalization`, re-run complete source gate, freeze a new exact SHA;
9. MiniMax restarts with all-new paths and one fresh hydration/Candidate attempt.

Status remains `MVP_NOT_COMPLETE / NOT_RUNTIME_PROOF / NOT_RELEASE_READY / NOT_EXPERIENCE_READY`.