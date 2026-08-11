# TASK — COPILOT-SKE-V03-C4-R2

## Allowed source scope

- `packages/kb/src/shared-engine/**`
- `packages/kb/tests/shared-engine-*.test.ts`
- `packages/kb/vitest.shared-engine-coverage.config.ts`
- `.github/workflows/v03-shared-engine-stacked-source-gate.yml`
- this C4 R2 task directory

## Required implementation

1. Exact Agent API version `0.3.0-draft` and manifest version `1`.
2. Deterministic manifest identity over capability ID, consumer ID, namespaces, purposes, D0/D1 privacy ceiling, read object types, write mode and expiry.
3. Unknown/malformed/tampered/expired capabilities and sessions fail closed.
4. Read-by-ID delegates every object to canonical policy and returns content-safe allow/deny audit.
5. Retrieval delegates to C3 stale-first/policy-first retrieval; wrapper cannot revive stale/denied hits.
6. `WRITE_PROPOSAL` requires explicit manifest mode **and** target object must pass the same namespace/purpose/consumer/privacy/object-type policy scope.
7. Proposal/audit reason is a short bounded machine code; user free text is rejected.
8. Read-only manifest rejects proposal.
9. No Agent accept/reject/dispute/conflict resolution/canonical commit/delete/sync/admin operation is exported.
10. Deterministic D0/D1 conformance fixture.
11. Storage-neutral contract; no physical table/store/renderer IPC contract.
12. Strict per-file >=90% statements/lines/branches/functions for all Shared Engine files.

## Acceptance

```text
C4_VERSION_NEGOTIATION=PASS
C4_CAPABILITY_MANIFEST=PASS
C4_EXPIRED_CAPABILITY=DENIED
C4_POLICY_FILTERED_OBJECT_READ=PASS
C4_POLICY_FILTERED_RETRIEVAL=PASS
C4_READ_ONLY_WRITE=DENIED
C4_WRITE_TARGET_POLICY=PASS
C4_WRITE_PROPOSAL_ONLY=PASS
C4_TERMINAL_WRITE_AUTHORITY=ABSENT
C4_CONTENT_SAFE_AUDIT=PASS
C4_CONFORMANCE_FIXTURE=PASS
C4_STORAGE_NEUTRAL=PASS
C4_EXISTING_SCHEMA_MUTATION=NONE
```

## Forbidden

No PR #20/main mutation, predecessor evidence reuse, physical schema migration, dependency/lock change, Runtime/MCP deployment, D3, sign/notarize/release or C4 merge ahead of C3.