# PLAN — R52 reauthorize long hydration window

1. Preserve R51 task root, hydration worktree, partial cache, HYDRATION-FAILED marker and second-dispatch evidence unchanged as reference-only.
2. Update versioned MiniMax handoff to record the consumed R51 exact source and require a new exact successor SHA plus new run stamp.
3. Record `OUTER_DRIVER_TIMEOUT_SECONDS>=3600` as caller-envelope authority only; do not change hydrator retry semantics.
4. Preserve R50 exact values: `lockfile-batched-name-version-npm-pack-v2`, `name-version-packument-and-tarball`, `deny-network-offline-ci-ignore-scripts-v1`, zero post-closure registry requests.
5. Open stacked Draft PR targeting `chatgpt/mvp-source-finalization`.
6. Require full `copilot-source-gate` PASS on the final evidence-containing stacked head.
7. Merge only into Draft PR #20 source branch, synchronize governance truth, rerun full source gate on the resulting exact PR #20 head and freeze that 40-hex SHA.
8. Dispatch MiniMax with new SHA, new run stamp and all-new paths. Stop on first fail-closed blocker.

No product code, tests, package/lockfile, allowlist, Candidate network authority, signing/notarization or `main` change.