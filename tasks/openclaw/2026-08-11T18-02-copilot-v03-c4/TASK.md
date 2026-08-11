# TASK — COPILOT-SKE-V03-C4-R1

## Allowed source scope

- `packages/kb/src/shared-engine/**`
- `packages/kb/tests/shared-engine-*.test.ts`
- `packages/kb/vitest.shared-engine-coverage.config.ts`
- `.github/workflows/v03-shared-engine-source-gate.yml` only to authorize this stacked PR base
- this C4 task directory

## Forbidden

- current KB/KG/RAG/Wiki physical store behavior or migrations
- renderer/main IPC as cross-product API
- package.json / package-lock.json / dependencies
- PR #20 / current MVP Candidate or Runtime authority
- actual network/MCP server deployment
- direct Agent database access
- Agent accept/reject/dispute/conflict-resolution/canonical-write/delete/sync authority
- D3 enablement
- sign/notarize/release

## Required implementation

1. Exact Agent API contract version and exact capability manifest version.
2. Capability manifest binds capability ID, consumer ID, namespaces, purposes, privacy ceiling, allowed read object types, write mode and optional expiry.
3. Deterministic manifest hash/ID independent of issue time.
4. Runtime manifest validator rejects unknown version, malformed IDs, empty grants, D2/D3 ceiling and unsupported write mode.
5. Capability session validates expiry and requested contract version before use.
6. Read-by-ID API uses C1 canonical policy and manifest grants; denied objects return content-safe audit only.
7. Retrieval API uses C3 `rankAuthorizedProjectionHits`; manifest cannot bypass stale/policy filtering.
8. Write API can create only C1 `WRITE_PROPOSAL` and only with explicit manifest write mode.
9. Read-only manifest rejects write proposals.
10. No terminal knowledge-review, conflict-resolution, delete or canonical commit operation is exported.
11. API responses bind capability manifest ID and deterministic request/audit receipt.
12. Deterministic D0/D1 conformance fixture proves a client can negotiate version and execute allowed/denied read/retrieval/proposal paths.
13. Public contract source remains storage-neutral and must not contain physical table/store names.

## Acceptance

```text
C4_VERSION_NEGOTIATION=PASS
C4_CAPABILITY_MANIFEST=PASS
C4_EXPIRED_CAPABILITY=DENIED
C4_POLICY_FILTERED_OBJECT_READ=PASS
C4_POLICY_FILTERED_RETRIEVAL=PASS
C4_READ_ONLY_WRITE=DENIED
C4_WRITE_PROPOSAL_ONLY=PASS
C4_TERMINAL_WRITE_AUTHORITY=ABSENT
C4_CONTENT_SAFE_AUDIT=PASS
C4_CONFORMANCE_FIXTURE=PASS
C4_STORAGE_NEUTRAL=PASS
C4_EXISTING_SCHEMA_MUTATION=NONE
```

## Claim ceiling

`C4_AGENT_CONTRACT_SOURCE_PASS` only after final source CI. A real MCP/server/client Runtime is not claimed by C4.