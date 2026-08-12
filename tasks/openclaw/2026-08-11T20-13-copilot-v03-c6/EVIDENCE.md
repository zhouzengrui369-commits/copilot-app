# EVIDENCE — COPILOT-SKE-V03-C6-R1

## Authority

```text
REPOSITORY=zhouzengrui369-commits/copilot-app
PR=51
BRANCH=chatgpt/v03-c6-runtime-security-conformance-r1
SOURCE_GATED_SHA=047a446076bbf6e14df8ba34e85ae16558083be8
SOURCE_GATE_RUN=31549743615
SOURCE_GATE_JOB=93969711091
BASE_C5_PLANNING_SHA=8adf7c596126306df5b7eaa07d31241d66230536
ECOSYSTEM_SHA=e46c4be501c465884486a4417adca2e158a58ccc
SHARED_ENGINE_CONTRACT=0.3.0-draft
```

## Gate evidence

GitHub Actions job `93969711091` completed successfully on exact SHA `047a446076bbf6e14df8ba34e85ae16558083be8`.

All source-gate stages passed:

1. exact PR-head checkout;
2. Node/npm/Python/macOS toolchain identity;
3. package/lock and KB/KG/LLM/Desktop package authority unchanged;
4. legacy KB critical inputs byte-identical;
5. exact `npm ci` (`1454` packages);
6. `@copilot/kb` build and typecheck;
7. C1 focused conformance (`28/28`, `2/2` files);
8. complete KB regression (`303/303`, `25/25` files);
9. KB global coverage;
10. strict C1-C5 Shared Engine per-file coverage (`169/169`, `12/12` files);
11. storage-neutral Shared Engine source scan;
12. `@copilot/llm-client` and `@copilot/kg` type dependency builds;
13. full desktop TypeScript check;
14. C6 desktop runtime-adapter conformance (`29/29`, `2/2` files);
15. strict C6 adapter per-file coverage;
16. narrow physical-implementation leak scan;
17. tracked/untracked source-clean proof.

## Coverage evidence

Global KB:

```text
95.33 statements
85.82 branches
98.47 functions
95.33 lines
```

Strict C1-C5 Shared Engine aggregate:

```text
99.44 statements
97.38 branches
100 functions
99.44 lines
```

C6 adapter strict coverage:

```text
shared-engine-runtime-adapter.ts
100.00 statements
96.55 branches
100.00 functions
100.00 lines
```

The hard C6 per-file threshold remains `90%` for statements, lines, branches and functions. It was not lowered to obtain PASS.

## Real implementation binding evidence

### NoteDocument

The C6 adapter consumes the existing public desktop `NoteDocument` DTO. Tests prove:

- numeric SQLite surrogate `note.id` does not affect canonical identity;
- note path and content/provenance determine canonical Source/Knowledge mapping through C1 adapters;
- restart-shaped DTOs with different physical row IDs preserve Source/Knowledge IDs and hashes;
- body changes preserve stable IDs and advance revision lineage;
- Agent-authored notes remain proposed inference while user-authored notes remain accepted declaration;
- malformed NoteDocument or missing runtime context fields fail closed.

### KG public DTO

Tests prove:

- public KG entity/relation identity and source/evidence fields map to canonical Entity/Relation/source refs;
- numeric physical KG row IDs are ignored;
- relation endpoints must resolve inside the supplied public subgraph;
- missing endpoints or malformed subgraphs fail closed.

### Six projection surfaces and RAG source detail

Tests prove:

- Card/Wiki/FullText/Vector/Graph/Dialogue projections retain the same canonical Knowledge object ID/hash/revision/source refs;
- identical runtime DTO input rebuilds deterministic projection IDs;
- real RAG `notePath/evidence/score` maps vector evidence to `VECTOR` and KG evidence to `GRAPH`;
- duplicate KG evidence is deduplicated before retrieval;
- scores outside `[0,1]`, unknown note paths, empty evidence and ambiguous duplicate note mappings fail closed;
- C3 policy executes before rank/context return;
- D2 or wrong-capability consumers return denied/no result without score/payload leakage.

### C4 desktop Agent seam

Tests prove:

- desktop permission scope and capability manifest use the same `desktop:<consumer>` capability identity;
- default capability authority is D1 read-only, non-expiring;
- canonical read and retrieval use the C4/C3 contracts;
- Agent writes remain `WRITE_PROPOSAL` only;
- a read-only session cannot write;
- the adapter contains no direct database authority.

### C5 real DTO portability and deletion mapping

Tests prove:

- real NoteDocument body becomes canonical portable Source bytes;
- zero-byte D1 source remains byte-exact and validates;
- import returns a plan with `physical_write_performed=false`;
- current desktop trash cleanup proof for active search + KG + RAG maps to `PENDING`, not false `COMPLETE`;
- a known failed cleanup surface maps to `FAILED`;
- deletion reaches `COMPLETE` only when all ten C5 required target proofs are explicit.

## Coverage predecessor closure

Predecessor `0802f1d68206716c60090324887700d440afb0cf` had:

```text
C6_ADAPTER_STATEMENTS=100
C6_ADAPTER_BRANCHES=89.02
C6_ADAPTER_FUNCTIONS=100
C6_ADAPTER_LINES=100
C6_STRICT_GATE=FAIL
```

The successor `047a446076bbf6e14df8ba34e85ae16558083be8` added a dedicated fail-closed branch suite and CI/coverage inclusion only. Compare proof from predecessor to final candidate contains exactly three test/CI files; `shared-engine-runtime-adapter.ts` is unchanged. The final branch coverage is `96.55%`.

## Storage / security boundary

```text
STORAGE_NEUTRAL_SHARED_ENGINE_BOUNDARY=PASS
C6_NARROW_ADAPTER_BOUNDARY=PASS
BETTER_SQLITE3_IMPORT_IN_ADAPTER=NONE
SQLITE_STORE_IMPORT_IN_ADAPTER=NONE
KG_STORE_IMPORT_IN_ADAPTER=NONE
VECTOR_STORE_IMPORT_IN_ADAPTER=NONE
PHYSICAL_TABLE_NAMES_IN_ADAPTER=NONE
ELECTRON_IPC_IMPORT_IN_ADAPTER=NONE
PACKAGE_JSON_CHANGE=NONE
PACKAGE_LOCK_CHANGE=NONE
DEPENDENCY_CHANGE=NONE
LEGACY_CRITICAL_INPUTS_UNCHANGED=PASS
PR20_CHANGE=NONE
MAIN_CHANGE=NONE
D3=DISABLED
SIGNING=NO
NOTARIZATION=NO
```

## Claim limit

This evidence proves C6 source and hermetic conformance against the real Copilot public DTO boundaries. It does not prove a fresh local Electron/runtime candidate, real filesystem/runtime identity, actual KG/RAG execution on a candidate data root, packaged artifact behavior, reference-implementation completion, C7 product experience, Human Owner acceptance, release readiness, signing or notarization.
