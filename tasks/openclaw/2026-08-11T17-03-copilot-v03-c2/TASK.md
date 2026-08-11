# TASK — COPILOT-SKE-V03-C2-R1

## Allowed source scope

- `packages/kb/src/shared-engine/**`
- `packages/kb/tests/shared-engine-*.test.ts`
- `packages/kb/vitest.shared-engine-coverage.config.ts`
- `.github/workflows/v03-shared-engine-source-gate.yml` only when needed to include the new bounded source surface
- this C2 task directory

## Forbidden

- existing KB/KG/RAG physical store behavior or migrations
- package.json / package-lock.json / dependency changes
- PR #20 or current MVP source/candidate state
- renderer UI / Electron Runtime
- hydration/network/provider policy
- direct Agent database access
- D3 enablement
- sign/notarize/release

## Required implementation

1. Deterministic ingestion receipt with stable idempotency identity.
2. Success states: `INGESTED`, `UNCHANGED`, `REVISED`; non-success states: `PARTIAL`, `FAILED`, `STALE`.
3. `PARTIAL`/`FAILED`/`STALE` must never claim canonical commit success.
4. Receipt error fields contain only bounded error code/stage, never raw user content.
5. Compiler receipt binds recipe/version/source refs/input hashes/output IDs and outcome.
6. Compiler-derived objects default to `SYSTEM_INFERENCE` or `TEMPORARY_HYPOTHESIS` and `PROPOSED`.
7. Failed/partial compiler runs emit no accepted canonical output.
8. Review queue item binds one proposed object/version/hash; Agent capability cannot accept/reject/dispute its own knowledge.
9. Explicit authorized review decision returns auditable accepted/rejected/disputed object state without mutating the input object.
10. Conflicts preserve both competing canonical object IDs/hashes/source refs.
11. Conflict resolution is explicit and auditable; supersession is lineage, not destructive overwrite.
12. User correction creates a traceable revised proposal linked to the prior object/revision.
13. Strict runtime validation/fail-closed behavior for malformed lifecycle input.
14. No physical table/store names in lifecycle public fixtures or source dependencies.

## Acceptance

```text
C2_INGESTION_IDEMPOTENCY=PASS
C2_NO_FALSE_SUCCESS=PASS
C2_COMPILER_PROVENANCE=PASS
C2_REVIEW_QUEUE=PASS
C2_AGENT_SELF_ACCEPT=DENIED
C2_CONFLICT_PRESERVATION=PASS
C2_SUPERSESSION_LINEAGE=PASS
C2_USER_CORRECTION_TRACEABILITY=PASS
C2_CONTENT_SAFE_RECEIPTS=PASS
C2_STORAGE_NEUTRAL=PASS
C2_EXISTING_SCHEMA_MUTATION=NONE
```

## Claim ceiling

`C2_LIFECYCLE_SOURCE_PASS` only after final source CI. No Runtime/reference-implementation claim.