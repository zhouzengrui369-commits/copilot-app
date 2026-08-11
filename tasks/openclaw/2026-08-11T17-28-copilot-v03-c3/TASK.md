# TASK — COPILOT-SKE-V03-C3-R1

## Allowed source scope

- `packages/kb/src/shared-engine/**`
- `packages/kb/tests/shared-engine-*.test.ts`
- `packages/kb/vitest.shared-engine-coverage.config.ts`
- this C3 task directory

## Forbidden

- current KB/KG/RAG/Wiki physical store behavior or migrations
- package.json / package-lock.json / dependencies
- PR #20 / current MVP source, Candidate or Runtime authority
- renderer UI / Electron Runtime
- direct Agent database access
- D3 enablement
- sign/notarize/release

## Required implementation

1. Projection kinds: `CARD_2D`, `WIKI`, `FULL_TEXT`, `VECTOR`, `GRAPH`, `DIALOGUE_CONTEXT`.
2. Deterministic projection IDs tied to canonical object/revision/hash and projection recipe.
3. Every projection binds canonical object ID/type/hash/revision/source refs, namespace, privacy class and permission fingerprint.
4. Projection payload is hash-addressed and explicitly non-authoritative/rebuildable.
5. Freshness validation fails when object ID/hash/revision/namespace/source refs/privacy/permission fingerprint drift.
6. Retrieval hit score must be finite `[0,1]`; stale/unknown projections are excluded.
7. Retrieval authorization must use C1 canonical read policy before any result/context exposure.
8. Multiple full-text/vector/graph hits for one canonical object dedupe by canonical object ID.
9. Ranked result exposes only authorized canonical object, combined score and authorized projection evidence.
10. Denied/stale audit receipt may contain IDs/counts/reasons but no denied object content, score or projection payload hash.
11. Grounded context contains only authorized canonical object IDs/source refs/projection evidence and binds a deterministic retrieval receipt.
12. Projection/grounding code must remain storage-neutral and not import physical KB/KG/RAG/Wiki stores.

## Acceptance

```text
C3_SAME_ID_ACROSS_PROJECTIONS=PASS
C3_PROJECTION_PROVENANCE=PASS
C3_PERMISSION_FINGERPRINT=PASS
C3_STALE_PROJECTION_REJECTION=PASS
C3_MULTI_RETRIEVAL_DEDUP=PASS
C3_POLICY_BEFORE_RANKING=PASS
C3_DENIED_CONTENT_LEAK=NONE
C3_GROUNDED_CONTEXT=PASS
C3_STORAGE_NEUTRAL=PASS
C3_EXISTING_SCHEMA_MUTATION=NONE
```

## Claim ceiling

`C3_PROJECTION_RETRIEVAL_SOURCE_PASS` only after final source CI. No Runtime/reference-implementation claim.