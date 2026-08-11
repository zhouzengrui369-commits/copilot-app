# PLAN — R50

1. Branch from the consumed R49 exact source without changing PR #20 directly.
2. Change lockfile registry prefetch from tarball-URL specs to exact `name@version` specs, retaining canonical resolved URL and integrity in the manifest.
3. Keep bounded 24-item `npm pack --ignore-scripts` batches, zero npm retry, and the existing localhost CONNECT proxy.
4. Add a strict deny-network registry-cache closure proof using `npm ci --offline --ignore-scripts` before any lifecycle/native asset phase.
5. Remove the closure-proof install tree, then run the full lifecycle `npm ci --offline` with the bounded proxy available only for install-script assets.
6. Fail closed if any `registry.npmjs.org` CONNECT occurs after the closure proof.
7. Bind strategy/metadata/closure/zero-registry-after-closure fields into the PASS receipt and candidate receipt validation.
8. Add direct RED→GREEN source contracts.
9. Run complete `copilot-source-gate`; fix only deterministic contract defects.
10. Freeze RESULT/EVIDENCE, re-run final source gate, merge only into Draft PR #20, update project truth, then re-run final PR #20 source gate and issue a fresh MiniMax successor SHA.
