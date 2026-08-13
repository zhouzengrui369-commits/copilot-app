# EVIDENCE — COPILOT-SKE-V03-C1-R1

## Authority

```text
PROGRAM=ECOSYSTEM-V03-DIGITAL-TWIN-R1
ECOSYSTEM_SHA=e46c4be501c465884486a4417adca2e158a58ccc
SHARED_ENGINE_CONTRACT=git-blob-sha1:caf9864f49dfb923f88f7125b7359d69b08865e4
PERSONAL_DATA_SECURITY_VERSION=0.1.0
C1_BASE_SHA=66509b4eda084f08aa3bc957d92a59a59e097a4a
C1_SOURCE_GATE_SHA=8a591d1d9fb60e545c306e009222b3b990781421
```

## Protected parallel MVP lane

```text
AUTHORITATIVE_MVP_PR=20
MVP_HEAD=d450badfc85b65d3eef20f05eeb0607c1bf6a912
R75=CONSUMED
R75_LOCAL_GATE=BLOCKED_LOCAL_NETWORK_TRANSPORT_STABILITY
CURRENT_MVP_CANDIDATE=ABSENT
CURRENT_MVP_RUNTIME=ABSENT
```

C1 made no change to PR #20 or R72/R73/R75 predecessor evidence.

## Source implementation evidence

New storage-neutral surface:

- `packages/kb/src/shared-engine/contract.ts`
- `packages/kb/src/shared-engine/identity.ts`
- `packages/kb/src/shared-engine/adapters.ts`
- `packages/kb/src/shared-engine/policy.ts`
- `packages/kb/src/shared-engine/write-proposal.ts`
- `packages/kb/src/shared-engine/index.ts`

Public package addition:

- `packages/kb/src/index.ts` export-only Shared Engine addition

Tests:

- `packages/kb/tests/shared-engine-contract.test.ts`
- `packages/kb/tests/shared-engine-boundaries.test.ts`
- `packages/kb/vitest.shared-engine-coverage.config.ts`

CI:

- `.github/workflows/v03-shared-engine-source-gate.yml`

The Shared Engine module contains no current physical table/store integration and the final CI grep boundary rejects known SQLite/KG/RAG physical store/table identifiers or direct store imports.

## CI history

### Initial gate — correctly exposed unrelated legacy debt

```text
RUN=31474531940
JOB=93725075637
C1_BUILD=PASS
C1_CHECK=PASS
C1_FOCUSED_TESTS=9/9_PASS
KB_COMPLETE_TESTS=143/143_PASS
KB_GLOBAL_COVERAGE=PASS
FAIL=PRE_EXISTING_LEGACY_KB_CRITICAL_COVERAGE
```

Legacy failure metrics:

```text
md-file-store.ts statements/lines=87.47%, branches≈74%
sqlite-store.ts branches≈78%
```

C1 had not changed those files/config/tests. Parent PM opened Issue #44 instead of lowering the 90% legacy threshold.

### Boundary-test gate — found a real C1 validator bug

```text
RUN=31475224910
JOB=93727324759
BUILD=PASS
CHECK=PASS
FOCUSED_TEST=FAIL
BUG=NaN confidence incorrectly accepted by validateCanonicalObject
```

The bug was fixed in source. No test was weakened.

### Final source gate

```text
RUN=31475428608
JOB=93727905759
HEAD=8a591d1d9fb60e545c306e009222b3b990781421
RESULT=PASS
```

Final steps:

- exact checkout identity: PASS
- package.json/package-lock.json/packages/kb/package.json unchanged: PASS
- legacy critical store/config/tests byte-identical to base: PASS
- npm ci: PASS, 1454 packages
- `@copilot/kb` build: PASS
- `@copilot/kb` check: PASS
- focused Shared Engine tests: 28/28 PASS
- complete KB tests: 162/162 PASS across 15 files
- existing KB global coverage: PASS
- new Shared Engine per-file 90% four-dimensional coverage: PASS
- storage-neutral source boundary: PASS
- source clean after execution: PASS

Strict Shared Engine coverage:

| file | statements | branches | functions | lines |
|---|---:|---:|---:|---:|
| adapters.ts | 100% | 95.55% | 100% | 100% |
| contract.ts | 100% | 100% | 100% | 100% |
| identity.ts | 100% | 100% | 100% | 100% |
| policy.ts | 100% | 100% | 100% | 100% |
| write-proposal.ts | 100% | 100% | 100% | 100% |
| total | 100% | 98.63% | 100% | 100% |

## Contract evidence

Focused tests prove:

- deterministic canonical serialization;
- stable IDs independent from database rows;
- Source + Knowledge mapping without duplicating Markdown body;
- canonical related-object IDs;
- idempotent unchanged mapping;
- revised content/provenance increments revision while stable object ID remains;
- Source/Entity/Relation source lineage participates in hashes/receipts;
- system inference defaults to proposed review state;
- malformed/unknown schema/privacy/confidence/permission fails closed;
- D0/D1 read policy filters by namespace, purpose, consumer, privacy and object type;
- denied receipts contain no user content;
- Agent writes produce only `WRITE_PROPOSAL`;
- no direct proposal acceptance or canonical write export exists in C1;
- public fixtures contain no current physical table names.

## Known open debt

Issue #44: legacy KB critical coverage baseline remains below its declared 90% per-file threshold in pre-existing store code. It is not fixed or hidden by C1.

## Evidence boundary

No Electron Candidate, real database migration, Agent client, MCP server, product UI, D3 data, signing/notarization or release action was executed by C1.