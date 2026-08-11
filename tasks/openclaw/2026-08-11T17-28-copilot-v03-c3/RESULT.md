# RESULT — COPILOT-SKE-V03-C3-R1

## Final source verdict

```text
C3_SOURCE=PASS
C3_PROJECTION_RETRIEVAL_SOURCE_PASS=YES
SOURCE_GATE_SHA=0a0ee4d285588224ed518296dbcb7552596e1f47
SOURCE_GATE_RUN=31478139200
SOURCE_GATE_JOB=93736615923
SOURCE_GATE_RESULT=PASS
PRODUCT_RUNTIME_CHANGED=NO
PHYSICAL_SCHEMA_CHANGED=NO
PACKAGE_LOCK_CHANGED=NO
PR20_CHANGED=NO
PREDECESSOR_EVIDENCE_CHANGED=NO
REFERENCE_IMPLEMENTATION=NOT_YET_CLAIMED
MERGE_TO_MAIN_AUTHORIZED=NO
```

## Implemented C3 projection/retrieval slice

### Rebuildable projections

Projection kinds:

- `CARD_2D`
- `WIKI`
- `FULL_TEXT`
- `VECTOR`
- `GRAPH`
- `DIALOGUE_CONTEXT`

Every projection binds the same canonical object ID/type/content hash/revision, namespace, source refs, privacy class, permission fingerprint, recipe/version and projection payload hash. Projection records are explicitly `authoritative=false` and `rebuildable=true`.

Projection IDs are deterministic for the same canonical revision, recipe and projection payload. The projection contract contains no physical row/chunk/table identity.

Freshness validation detects drift in:

- canonical object ID;
- object type;
- content hash;
- revision;
- namespace;
- source refs;
- privacy class;
- permission fingerprint.

Malformed projection records fail closed.

### Permission-first unified retrieval

Unified retrieval:

1. validates canonical objects and rejects conflicting versions for one canonical object ID;
2. validates projection records and finite scores in `[0,1]`;
3. rejects unknown/stale projection hits before authorization;
4. executes the C1 canonical read policy before ranked result exposure;
5. deduplicates multi-index hits by canonical object ID;
6. ranks only authorized objects and retains authorized projection evidence;
7. returns content-safe denied/stale audit receipts without denied scores, payload text or projection payload hashes.

### Grounded context

Grounded context binds:

- retrieval receipt ID;
- authorized canonical object ID/type/hash/revision;
- canonical source refs;
- authorized score;
- authorized projection evidence.

The evidence envelope does not copy canonical object payload text and cannot contain denied/stale object content.

## Source Gate evidence

Final run `31478139200`, job `93736615923`:

```text
EXACT_HEAD=PASS
PACKAGE_AND_LOCK_AUTHORITY_UNCHANGED=PASS
LEGACY_CRITICAL_INPUTS_UNCHANGED=PASS
NPM_CI=PASS (1454 packages)
KB_BUILD=PASS
KB_CHECK=PASS
C1_EXPLICIT_FOCUSED_TESTS=28/28_PASS
KB_COMPLETE_TESTS=220/220_PASS (19 files)
KB_GLOBAL_COVERAGE=PASS
SHARED_ENGINE_STRICT_TESTS=86/86_PASS (6 files)
SHARED_ENGINE_STRICT_PER_FILE_COVERAGE=PASS
STORAGE_NEUTRAL_SHARED_ENGINE_BOUNDARY=PASS
TRACKED_SOURCE_UNCHANGED_AFTER_TESTS=PASS
```

Whole KB global coverage:

```text
statements=94.03%
branches=82.22%
functions=98.09%
lines=94.03%
```

Strict Shared Engine coverage:

```text
ALL_SHARED_ENGINE:
  statements=99.85%
  branches=97.69%
  functions=100%
  lines=99.85%

projection.ts:
  statements=100%
  branches=100%
  functions=100%
  lines=100%

retrieval.ts:
  statements=98.60%
  branches=90.47%
  functions=100%
  lines=98.60%
```

All other C1/C2 Shared Engine source files remain above the same per-file 90% statements/lines/branches/functions threshold.

## C3 acceptance

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

## Remaining boundary

C3 is contract/source conformance only. It does not prove real persistence into the current Wiki/KG/RAG stores, packaged Electron Runtime conformance, a real Agent/MCP client, portability/delete/sync, product experience, Human Owner customer-value acceptance or release readiness.

Next Goal: `COPILOT-SKE-V03-C4-R1 — versioned policy-filtered Agent capability/API contract`.