# PLAN — COPILOT-SKE-V03-C4-R1

1. Add a deterministic capability manifest contract with exact API/manifest versions and D0/D1-only privacy ceiling.
2. Sort/deduplicate namespace/purpose/object-type grants so semantically identical manifests have the same identity.
3. Validate capability/consumer IDs, grant sets, expiry and write mode fail-closed.
4. Add capability negotiation/session validation; an expired session is denied even if it was valid when created.
5. Add transport-neutral read-by-ID operation that resolves only requested canonical IDs and delegates every object to C1 policy using manifest-derived request authority.
6. Add transport-neutral retrieval operation that delegates to C3 permission-first/stale-safe retrieval and binds the capability manifest/session in an API receipt.
7. Add write-proposal operation that is absent for read-only manifests and calls C1 `createWriteProposal` only when explicitly authorized.
8. Do not implement accept/reject/dispute/conflict resolution/canonical commit/delete/sync/admin operations.
9. Add deterministic D0/D1 conformance fixture and client test vectors for version negotiation, allowed/denied reads, retrieval and write proposal.
10. Keep Agent audit receipts content-safe: IDs, action, decision/reason and manifest/session identity only; no denied object payload or score.
11. Extend strict per-file coverage to C4 files and run complete KB regression plus storage-neutral scan.
12. Because PR #46 is source-accepted but still Draft due connector transition blocking, keep C4 as a stacked PR based on the C3 branch; never merge C4 ahead of C3.

## Rollback

C4 is additive transport-neutral source only. Rollback requires no physical schema/server/runtime migration.