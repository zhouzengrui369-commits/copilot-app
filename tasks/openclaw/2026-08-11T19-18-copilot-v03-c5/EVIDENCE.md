# EVIDENCE — COPILOT-SKE-V03-C5-R1

## Authority

```text
REPOSITORY=zhouzengrui369-commits/copilot-app
PR=50
BRANCH=chatgpt/v03-c5-portability-deletion-sync-r1
SOURCE_GATED_SHA=cdc6c194ac996808420f7f22603efa4e3cfe06b3
SOURCE_GATE_RUN=31489206879
SOURCE_GATE_JOB=93771466308
BASE_C4_PLANNING_SHA=6aea3b9b249af91af25c8619fb996cde705a74ba
ECOSYSTEM_SHA=e46c4be501c465884486a4417adca2e158a58ccc
SHARED_ENGINE_CONTRACT=0.3.0-draft
```

## Gate evidence

GitHub Actions job `93771466308` completed successfully. All source-gate steps passed:

1. exact PR head checkout;
2. Node 24 / npm / Python / macOS identity;
3. package and lock authority unchanged;
4. legacy KB critical inputs byte-identical;
5. exact `npm ci` (`1454` packages);
6. `@copilot/kb` build;
7. `@copilot/kb` type check;
8. C1 focused conformance (`28/28`, `2/2` files);
9. complete KB suite (`303/303`, `25/25` files);
10. KB global coverage;
11. strict Shared Engine per-file coverage (`169/169`, `12/12` files);
12. storage-neutral Shared Engine source scan;
13. tracked and untracked source-clean proof.

## Coverage evidence

Global KB:

```text
95.33 statements
85.82 branches
98.47 functions
95.33 lines
```

Strict Shared Engine aggregate:

```text
99.44 statements
97.38 branches
100 functions
99.44 lines
```

C5 modules:

```text
portability.ts  99.34 statements / 97.97 branches / 100 functions / 99.34 lines
deletion.ts     97.05 statements / 95.00 branches / 100 functions / 97.05 lines
sync.ts        100.00 statements /100.00 branches / 100 functions /100.00 lines
```

Every Shared Engine source file remains above the hard per-file threshold of `90%` for statements, lines, branches and functions.

## Portability evidence

Focused tests demonstrate:

- logical export bundle identity is stable across object ordering, receipt ordering and export timestamps;
- canonical IDs/hashes/revisions/provenance/permission fingerprints are preserved;
- included source bytes use raw-byte SHA-256, exact byte length and canonical base64;
- zero-byte source content validates correctly;
- omitted/redacted source descriptors carry no source bytes;
- D2/D3 source-byte export is denied in C5;
- duplicate exact entries dedupe; divergent duplicate canonical/source entries fail closed;
- malformed digest/length/encoding/base64 or checksum mismatch fails closed;
- unsupported contract/schema or manifest/entry identity tamper fails closed;
- import validates the whole bundle before planning;
- import returns only `ADD`, `UNCHANGED`, or `REVIEW_REQUIRED`;
- divergent local state is never silently overwritten;
- `physical_write_performed=false`.

## Deletion evidence

Required surfaces are frozen as:

```text
SOURCE_BYTES
CANONICAL_OBJECT
WIKI
CARD_2D
GRAPH
VECTOR
FULL_TEXT
DIALOGUE_CONTEXT
CACHE
REPLICA
```

Tests demonstrate:

- deletion authority is USER or POLICY only and reason is a bounded machine code;
- plan identity is deterministic and validates direct runtime structure/timestamp/authority;
- runtime target and state values are validated explicitly;
- success cannot carry errors; failed/blocked surfaces require bounded machine error codes;
- missing targets remain pending;
- aggregate state is truthful: FAILED > BLOCKED > PENDING unless all targets succeed;
- `COMPLETE` is impossible until all required targets are deleted/tombstoned;
- global tombstone exists only after complete propagation;
- tombstone stores object identity, deleted hash/revision, plan/receipt IDs and `content_retained=false` only;
- no deleted payload/source bytes are written into deletion receipts/tombstones;
- wrong-plan, tampered and duplicate target receipts fail closed.

## Sync evidence

Tests demonstrate:

- sync envelopes bind canonical object type/id/namespace/hash/revision/privacy/review/assertion/tombstone/permission fingerprint/supersession lineage;
- runtime enum values are validated even if an attacker recomputes the envelope identity;
- exact state is idempotent;
- older incoming revisions are stale;
- same-revision divergence is conflict, never LWW;
- automatic successor planning is limited to consecutive D0/D1 `PROPOSED` inference/hypothesis state with unchanged permissions, unchanged tombstone and explicit `supersedes` lineage;
- revision gaps, permission changes, D2/D3, review-sensitive states, tombstone changes, non-auto-mergeable assertions and missing lineage become explicit conflicts;
- multi-reason conflict ordering is deterministic;
- sync decisions copy no object payload content and perform no physical writes.

## Storage / security boundary

```text
STORAGE_NEUTRAL_SHARED_ENGINE_BOUNDARY=PASS
PHYSICAL_TABLE_NAMES_IN_CONTRACT=NONE
@copilot/kg_or_rag_IMPORTS_IN_SHARED_ENGINE=NONE
PACKAGE_JSON_CHANGE=NONE
PACKAGE_LOCK_CHANGE=NONE
DEPENDENCY_CHANGE=NONE
LEGACY_CRITICAL_INPUTS_UNCHANGED=PASS
PR20_CHANGE=NONE
MAIN_CHANGE=NONE
ELECTRON_RUNTIME_CHANGE=NONE
AGENT_AUTHORITY_EXPANSION=NONE
D3=DISABLED
```

## Claim limit

This evidence proves C5 source/conformance contracts only. It does not prove a real filesystem export/import roundtrip, physical backup/restore, actual multi-surface deletion propagation, replica transport, Electron Runtime behavior, release readiness or reference-implementation completion. Those belong to C6/C7 and Human Owner Gate.
