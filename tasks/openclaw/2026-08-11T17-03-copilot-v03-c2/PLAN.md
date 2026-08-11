# PLAN — COPILOT-SKE-V03-C2-R1

1. Extend only the pure TypeScript Shared Engine submodule; do not import SQLite/filesystem/Electron/KG/RAG stores.
2. Implement deterministic ingestion outcomes and content-safe receipts.
3. Implement compiler receipts that bind source/object IDs, hashes, recipe and outcome; outputs remain proposed until review.
4. Implement review queue items and explicit decisions. Review authority is user/policy only; Agent capability identity cannot self-accept.
5. Implement conflict records that preserve left/right assertions and evidence; never choose a winner implicitly.
6. Implement explicit conflict resolution plus supersession receipts; original objects remain recoverable.
7. Implement user-correction proposal lineage without changing the stable object identity contract.
8. Add focused lifecycle tests for idempotency, stale/partial/failed fail-closed behavior, compiler provenance, review authorization, conflicts, supersession and correction.
9. Extend Shared Engine strict per-file coverage to all new lifecycle files and preserve >=90% four-dimensional threshold.
10. Run the complete KB suite, global coverage, strict Shared Engine coverage, storage-neutral scan and source-clean gate.
11. Freeze exact source-gated SHA; add RESULT/EVIDENCE only after the gate and prove post-gate commits are evidence-only.
12. Merge only to the v0.3 planning branch. Do not merge to main or dispatch local Runtime workers from C2.

## Rollback

C2 remains additive contract source. Rollback is closing/reverting the C2 PR; no physical schema/data migration is performed.