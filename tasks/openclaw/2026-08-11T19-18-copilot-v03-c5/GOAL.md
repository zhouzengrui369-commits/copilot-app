# GOAL — Copilot Shared Knowledge Engine C5 R1

Goal ID: `COPILOT-SKE-V03-C5-R1`
State: `SOURCE_ACTIVE`
Base: `6aea3b9b249af91af25c8619fb996cde705a74ba`
Program: `ECOSYSTEM-V03-DIGITAL-TWIN-R1`
Contract: `0.3.0-draft`

## Goal

Implement a storage-neutral portability/lifecycle contract that makes canonical knowledge exportable, import-plan-verifiable, deletable across every required projection surface, and synchronizable by stable object identity without silent conflict loss.

## C5 source scope

1. `portability.ts`
   - deterministic canonical export bundle/manifest;
   - per-entry and manifest checksum identities;
   - schema/version negotiation;
   - complete validation before any import plan is returned;
   - import planning preserves canonical IDs and never performs physical writes.
2. `deletion.ts`
   - deterministic deletion request/plan;
   - explicit propagation targets across Source/canonical/Wiki/Card/Graph/Vector/FullText/Dialogue/Cache/Replica;
   - aggregate `COMPLETE/PENDING/BLOCKED/FAILED` truthfulness;
   - content-free tombstone and audit receipts.
3. `sync.ts`
   - canonical identity/revision/hash sync envelopes;
   - replay/stale/equal/divergent classification;
   - no last-write-wins for divergent accepted, policy-sensitive or review-sensitive state;
   - explicit conflict output instead of destructive overwrite.

## Hard boundaries

```text
PR20_CHANGE=NO
MAIN_CHANGE=NO
PHYSICAL_DB_WRITE=NO
PHYSICAL_SCHEMA_CHANGE=NO
PACKAGE_LOCK_CHANGE=NO
DEPENDENCY_CHANGE=NO
ELECTRON_RUNTIME_CHANGE=NO
AGENT_AUTHORITY_EXPANSION=NO
D3_ENABLEMENT=NO
SIGNING_NOTARIZATION_RELEASE=NO
```

C5 is source/conformance only. Real export files, backup media, physical deletion propagation, replica transport and exact Runtime proof belong to C6.
