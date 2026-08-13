# TASK — COPILOT-SKE-V03-C1-R1

## Allowed source scope

- `packages/kb/src/shared-engine/**`
- `packages/kb/tests/shared-engine-contract.test.ts`
- `packages/kb/src/index.ts` export-only additions
- this C1 task directory

## Forbidden

- existing KB/KG/RAG physical store behavior or migrations
- package.json / package-lock.json
- PR #20 or current MVP candidate source
- renderer UI / Electron runtime
- network/provider/hydration policy
- signing/notarization/release
- direct database Agent access

## Required implementation

1. Canonical envelope for Source, Knowledge, Entity and Relation.
2. Deterministic SHA-256 object identity independent of database row IDs.
3. Deterministic content hash with stable canonical serialization.
4. Note adapter producing a first-class Source object and Knowledge object.
5. Structural Entity/Relation adapters without importing the KG store.
6. Revision/mapping receipt proving no silent overwrite.
7. D0/D1 policy-filtered read helper with content-safe deny receipts.
8. Agent `WRITE_PROPOSAL` object only; no direct canonical write API.
9. Runtime validation that fails closed on unknown schema/privacy/review state.
10. Focused tests for stable identity, revisions, source refs, privacy/purpose filtering, proposal-only writes and absence of physical-table contract leakage.

## Acceptance

```text
C1_OBJECT_ID_STABILITY=PASS
C1_PROVENANCE=PASS
C1_REVISION_LINEAGE=PASS
C1_REVIEW_PRIVACY=PASS
C1_POLICY_FILTERED_READ=PASS
C1_AGENT_WRITE_PROPOSAL_ONLY=PASS
C1_PHYSICAL_SCHEMA_EXPOSURE=PASS_NO_EXPOSURE
C1_EXISTING_SCHEMA_MUTATION=NONE
```

## Claim ceiling

`CONFORMANCE_SLICE_SOURCE_PASS` only after CI. No Runtime or reference implementation claim.