# PLAN — COPILOT-SKE-V03-C3-R1

1. Add pure TypeScript projection records with deterministic IDs and permission fingerprints.
2. Treat projections as rebuildable caches: no projection API mutates canonical objects or claims truth authority.
3. Add freshness validation against canonical ID/hash/revision/namespace/source refs/privacy/permission state.
4. Add normalized retrieval hits for full-text/vector/graph/Wiki/Card/dialogue without physical row/chunk IDs as the contract key.
5. Validate hit scores and require every hit to resolve to a known canonical object.
6. Reject stale hits before authorization and scoring exposure.
7. Execute C1 `authorizeCanonicalRead` before any result is returned.
8. Dedupe authorized hits by canonical object ID and retain multi-projection evidence.
9. Emit content-safe retrieval receipt with allowed object IDs/projection IDs and denied/stale counts/reasons only.
10. Build grounded context from authorized ranked objects, preserving source refs and retrieval receipt identity.
11. Add fail-closed tests for stale projection, unknown object, invalid score, wrong namespace/purpose/consumer/privacy, dedupe and no denied-content leakage.
12. Extend strict per-file coverage to C3 files and run complete v0.3 Shared Engine Source Gate.

## Rollback

C3 is additive storage-neutral source only. Rollback requires no physical store/data migration.