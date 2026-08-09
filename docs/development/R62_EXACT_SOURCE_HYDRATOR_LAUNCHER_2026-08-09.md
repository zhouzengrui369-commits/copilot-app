# R62 Exact-Source Hydrator Launcher

Date: 2026-08-09
Parent PM: ChatGPT
Repository: `zhouzengrui369-commits/copilot-app`
Stacked PR: #33 -> Draft PR #20

## Trigger

R61 consumed source `d805c6570366bc181612f712073ef7dd0e2912a8` after one real hydrator invocation. Before launch, the R61 pre-network runtime registry-manifest proof succeeded and bound canonical `typescript@6.0.3`, batch size 24, `npmPackMaxSockets=12`, 834 registry entries, 4 supplemental locks and 501 supplemental identities.

The local ad-hoc launcher then created `NATIVE_CACHE_DIR` with `mkdir -p` before starting the hydrator. `requireNewExternalPath()` correctly failed closed on the now-existing empty target with `BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS`. The cache had zero files, no PASS receipt existed, Candidate was never created, but `HYDRATION_EXECUTIONS=1` means the source identity was consumed.

## Repair

R62 adds `scripts/candidate-r30/native-cache-background-launch.mjs` as the only source-defined launcher for the next local successor.

The launcher:

- is self-contained Node code and does not rely on shell or `setsid`;
- accepts one explicit absolute repository authority and derives the exact hydrator beneath that repository;
- requires cache target, PASS receipt, stdout, stderr and launch-receipt outputs to be absent before spawn;
- may create only evidence/log parent directories and the stdout/stderr/launch-receipt files with exclusive creation;
- never creates `NATIVE_CACHE_DIR` or `NATIVE_CACHE_RECEIPT`;
- rejects evidence paths inside the cache target;
- starts exactly one detached Node child with `shell:false`, records its PID and unrefs it;
- records `launcherDidCreateCacheDir=false`, `launcherDidCreateReceiptOutput=false`, `automaticRetry=false`, and `replacementProcessAllowed=false`.

An existing cache target remains untouched and is rejected. No deletion, move, resume or promotion is permitted.

## Regression proof

`native-cache-background-launch.test.mjs` proves:

1. launch arguments are complete, unique and absolute;
2. cache and PASS-receipt targets are absent at child-spawn time and remain absent after launcher setup;
3. stdout/stderr/launch receipt are created outside the cache target;
4. an existing cache target is rejected without deleting a sentinel file;
5. evidence paths under the cache target are rejected;
6. the child is detached Node with `shell:false` and no `setsid` dependency.

No product UI/runtime, package/lockfile, workflow, registry strategy, reviewed-host allowlist, retry policy, Candidate network authority, signing/notarization, cloud/global configuration or `main` change is part of R62.

## Source-gate history

Implementation Head `4eefd70786c8e8a4c5c5a5b7aeda1205e8918735` ran `copilot-source-gate` run `31311068596`.

The first job `93238866921` passed Candidate source contracts, RAG, workspace checks, core suites and desktop build, then failed only at Desktop Phase 1. Exact diff from the already source-green PR #20 base proved R62 changed only the launcher and its candidate-r30 test, with no Desktop/product/package/lock/workflow bytes. Without any tracked change or threshold change, the same exact Head job `93239595966` completed the full `17/17 SUCCESS`. The initial Step 12 failure is therefore adjudicated as CI transient, not an R62 source regression.

The final evidence-containing R62 Head must independently pass the complete source gate before PR #33 may squash-merge into Draft PR #20. The resulting exact PR #20 Head must then pass the complete source gate before MiniMax R63 is authorized.

## Terminal status

```text
R61=BLOCKED_NATIVE_CACHE_HYDRATION_OUTPUT_EXISTS
R61_SOURCE_CONSUMED=true
R62_EXACT_SOURCE_LAUNCHER=IMPLEMENTED
LOCAL_SUCCESSOR=NOT_RUN
NOT_RUNTIME_PROOF_BY_CODEX
MVP_NOT_COMPLETE
NOT_RELEASE_READY
NOT_EXPERIENCE_READY
```
