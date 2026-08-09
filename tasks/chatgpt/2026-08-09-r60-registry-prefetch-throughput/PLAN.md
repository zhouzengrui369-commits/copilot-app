# PLAN

1. Freeze R58 local evidence and do not reuse any R58 path/cache.
2. Confirm PR #20 exact source and R58 source consumption.
3. Add explicit bounded registry-prefetch socket cap `12`, with no retry flag and no changes to later lifecycle/native policy.
4. Add Candidate source-contract coverage.
5. Run complete Node 24/macOS source gate on the code Head.
6. If a Desktop-only CI transient occurs with no Desktop diff, permit a bounded same-SHA GitHub job verification without changing source or thresholds.
7. Freeze Parent PM evidence and exact final stacked Head.
8. Run complete source gate on final evidence Head.
9. Squash merge only into Draft PR #20 using expected Head.
10. Run complete source gate on resulting exact PR #20 Head.
11. Authorize a fresh local successor only with new SHA, new RUN_STAMP, six new paths, one durable hydrator, and pre-network runtime registry-manifest proof.
