# PLAN — COPILOT-SKE-V03-C5-R1

1. Build pure TypeScript portability descriptors and checksum validation; no filesystem/database imports.
2. Build deterministic deletion plan/receipt/tombstone aggregation with truthful non-complete states.
3. Build object-level sync classification with explicit conflict instead of LWW.
4. Add focused happy-path and fail-closed tests using D0/D1 synthetic fixtures only.
5. Export the C5 contract through `shared-engine/index.ts` and extend strict per-file coverage to C5 modules.
6. Open one Draft C5 PR against the current planning branch and run the unchanged v0.3 Source Gate.
7. Fix only real source/test defects on new SHAs; never lower thresholds or alter package/lock/dependencies.
8. On PASS, write RESULT/EVIDENCE/commands.log, prove evidence-only post-gate diff and merge only to the planning branch.
9. C6 starts only from the accepted C5 planning SHA and owns physical/runtime/security conformance.
