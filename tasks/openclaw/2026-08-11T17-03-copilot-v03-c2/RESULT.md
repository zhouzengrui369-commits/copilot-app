# RESULT — COPILOT-SKE-V03-C2-R1

## Final source verdict

```text
C2_SOURCE=PASS
C2_LIFECYCLE_SOURCE_PASS=YES
SOURCE_GATE_SHA=462e5cb3e6965c8d63e6063a339a41ff5f584ac1
SOURCE_GATE_RUN=31476951616
SOURCE_GATE_JOB=93732734016
SOURCE_GATE_RESULT=PASS
PRODUCT_RUNTIME_CHANGED=NO
PHYSICAL_SCHEMA_CHANGED=NO
PACKAGE_LOCK_CHANGED=NO
PR20_CHANGED=NO
PREDECESSOR_EVIDENCE_CHANGED=NO
REFERENCE_IMPLEMENTATION=NOT_YET_CLAIMED
MERGE_TO_MAIN_AUTHORIZED=NO
```

## Implemented C2 lifecycle

### Ingestion

- deterministic ingestion and result identities;
- `INGESTED`, `UNCHANGED`, `REVISED`, `PARTIAL`, `FAILED`, `STALE`;
- `PARTIAL`, `FAILED`, and `STALE` always set `canonical_commit_allowed=false` and return no canonical source commit;
- stable object identity across revised source content;
- previous identity/hash/revision/time fail-closed validation;
- bounded machine-code failure metadata prevents user content from entering failure receipts.

### Compiler

- compiler receipt binds recipe/version/model/parameters hash, input object IDs/hashes and output IDs/hashes;
- duplicate inputs are rejected;
- compiler cannot create Source objects;
- derived outputs require source refs present in the input set;
- outputs must remain `PROPOSED` and be `SYSTEM_INFERENCE` or `TEMPORARY_HYPOTHESIS`;
- failed compilation emits no output;
- partial compilation may preserve proposed output but never accepted canonical write;
- every compilation receipt has `accepted_canonical_write=false`.

### Review and correction

- only `PROPOSED` objects can enter the review queue;
- terminal decision is explicit `ACCEPT`, `REJECT`, or `DISPUTE`;
- Agent actor is denied terminal review authority;
- queue item binds exact object ID/content hash/revision and rejects replay/drift;
- only ACCEPT permits canonical commit;
- user correction keeps stable object ID, increments revision, records previous/next hashes, becomes `USER_DECLARED_FACT + PROPOSED`, and carries supersession lineage;
- no-op corrections are rejected;
- decision/correction reason fields are bounded machine codes rather than user free text.

### Conflict and supersession

- conflicts preserve both assertions, content hashes, revisions, source refs, assertion types and review states;
- conflict ID is stable independent of left/right ordering;
- no automatic conflict winner;
- Agent conflict resolution is denied;
- explicit strategies: `KEEP_LEFT`, `KEEP_RIGHT`, `KEEP_BOTH`, `SUPERSEDE_LEFT`, `SUPERSEDE_RIGHT`;
- supersession marks old assertion `SUPERSEDED + EXPIRED`, sets `valid_to`, links successor, and returns a dedicated supersession receipt;
- prior objects are retained rather than deleted.

## Source Gate evidence

Final run `31476951616`, job `93732734016`:

```text
EXACT_HEAD=PASS
PACKAGE_AND_LOCK_AUTHORITY_UNCHANGED=PASS
LEGACY_CRITICAL_INPUTS_UNCHANGED=PASS
NPM_CI=PASS (1454 packages)
KB_BUILD=PASS
KB_CHECK=PASS
C1_EXPLICIT_FOCUSED_TESTS=28/28_PASS
KB_COMPLETE_TESTS=196/196_PASS (17 files)
KB_GLOBAL_COVERAGE=PASS
SHARED_ENGINE_STRICT_TESTS=62/62_PASS (4 files)
SHARED_ENGINE_STRICT_PER_FILE_COVERAGE=PASS
STORAGE_NEUTRAL_SHARED_ENGINE_BOUNDARY=PASS
TRACKED_SOURCE_UNCHANGED_AFTER_TESTS=PASS
```

Whole KB global coverage:

```text
statements=93.55%
branches=81.04%
functions=97.94%
lines=93.55%
```

Strict Shared Engine coverage:

```text
ALL_SHARED_ENGINE:
  statements=100%
  branches=98.24%
  functions=100%
  lines=100%

adapters.ts:       100 / 95.74 / 100 / 100
compiler.ts:       100 / 98.41 / 100 / 100
conflict.ts:       100 / 97.67 / 100 / 100
contract.ts:       100 / 100   / 100 / 100
identity.ts:       100 / 100   / 100 / 100
ingestion.ts:      100 / 98.27 / 100 / 100
policy.ts:         100 / 100   / 100 / 100
review.ts:         100 / 96.66 / 100 / 100
write-proposal.ts: 100 / 100   / 100 / 100
```

Values are statements / branches / functions / lines.

## C2 acceptance

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

## Remaining boundary

C2 is contract/source conformance only. It does not prove persistent review/conflict storage, real ingestion against production data, Wiki/RAG/KG projection conformance, Agent client/MCP conformance, portability/delete/sync, packaged Electron Runtime, product experience, Human Owner value acceptance or release readiness.

Next Goal: `COPILOT-SKE-V03-C3-R1 — stable-ID unified projections and grounded retrieval`.