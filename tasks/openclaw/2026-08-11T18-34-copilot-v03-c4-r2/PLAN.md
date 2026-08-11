# PLAN — COPILOT-SKE-V03-C4-R2

1. Rebuild C4 from the accepted C3 exact Head; do not reuse the rejected r1 branch as a candidate.
2. Implement normalized deterministic capability manifests with exact contract/version, D0/D1 ceiling and optional expiry.
3. Revalidate manifest integrity/version/expiry on every operation.
4. Implement read-by-ID by delegating each canonical object to C1 policy.
5. Implement retrieval by delegating to C3 stale-safe, policy-first retrieval.
6. Implement `WRITE_PROPOSAL` only. Before proposal creation, run C1 policy against the target object using the same manifest-derived request; deny D2/D3, wrong consumer/purpose/namespace/type.
7. Require short machine-code reason metadata; never copy user free text into Agent audit/proposal receipts.
8. Add deterministic D0/D1 conformance fixtures and fail-closed tests for manifest/session tampering, expiry, denied reads/retrieval, read-only write and target-policy write denial.
9. Export no terminal review/conflict/canonical-write/delete/sync Agent operation.
10. Add a stacked-only v0.3 Source Gate trigger for the C3 PR base without modifying C3 itself.
11. Run complete KB regression, global coverage, Shared Engine per-file 90% four-dimensional coverage, storage-neutral scan and source-clean.
12. Freeze exact source SHA and evidence. C4 may be source accepted while C3 remains Draft, but cannot merge ahead of C3.

## Rollback

C4 R2 is additive transport-neutral source only; rollback requires no physical schema/server/runtime migration.