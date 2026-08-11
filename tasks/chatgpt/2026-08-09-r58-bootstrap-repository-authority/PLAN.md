# PLAN

1. Verify Draft PR #20 exact head is the consumed R57 source.
2. Inspect `registry-prefetch.mjs` and hydrator call flow.
3. Confirm the exact root cause: repository authority was inferred from `import.meta.url` after bootstrap extraction.
4. Create a stacked repair branch from the exact PR #20 head.
5. Remove module-location inference and bind supplemental-lock discovery to the hydration `--repository` authority, with explicit-library override for tests.
6. Add regression coverage for `/private/tmp` bootstrap execution, unique/absolute repository authority, canonical `typescript@6.0.3`, and prohibition of the old inference.
7. Run the complete Node 24/macOS source gate on the code head.
8. Align `PROJECT_STATE.yaml` and `docs/MINIMAX_LOCAL_DEPLOYMENT_MVP.md` to R57 consumed / R58 repair truth.
9. Add durable Parent PM evidence.
10. Run the complete source gate on the final evidence head.
11. If green, squash PR #31 only into Draft PR #20.
12. Run the complete source gate on the resulting exact PR #20 head, freeze that SHA, and issue a fresh MiniMax local successor with a new RUN_STAMP and six all-new paths.
