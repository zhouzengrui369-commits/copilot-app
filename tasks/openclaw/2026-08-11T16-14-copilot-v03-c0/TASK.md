# TASK — COPILOT-SKE-V03-C0-R1

## Goal

Complete the repository-level C0 transition without touching the protected macOS MVP runtime lane. Freeze the exact ecosystem contract, map current implementation truth, and prepare one bounded C1 canonical-object/provenance adapter slice.

## Allowed paths

- `tasks/openclaw/2026-08-11T16-14-copilot-v03-c0/**`
- `docs/plans/COPILOT_SHARED_KNOWLEDGE_ENGINE_V03.md` only for later factual state synchronization after C0 review
- future C1 branch paths only after Parent PM explicitly authorizes C1

## Forbidden changes

- PR #20 source branch or exact source `d450badfc85b65d3eef20f05eeb0607c1bf6a912`
- package/dependency/lockfile/Electron/native hydration/network policy
- current SQLite/KG/RAG physical schemas during C0
- Candidate, signing, notarization or release state
- predecessor evidence from R72/R73/R75
- direct Agent physical-table access
- D3 enablement
- upstream LLM Wiki code/assets

## Current truth to preserve

```text
CURRENT_MVP_PR=20
CURRENT_MVP_SOURCE=d450badfc85b65d3eef20f05eeb0607c1bf6a912
CURRENT_CODE_GATE=PASS_17_OF_17
CURRENT_LOCAL_DEPLOYMENT_GATE=BLOCKED_LOCAL_NETWORK_TRANSPORT_STABILITY
CURRENT_RUNTIME_SHA=UNSET
CURRENT_CANDIDATE=UNSET
R75_STATE=CONSUMED
```

## Pinned v0.3 contract

```text
ECOSYSTEM_SHA=e46c4be501c465884486a4417adca2e158a58ccc
ECOSYSTEM_PR=17
SHARED_ENGINE_CONTRACT_VERSION=0.3.0-draft
SHARED_ENGINE_CONTRACT_GIT_BLOB_SHA1=caf9864f49dfb923f88f7125b7359d69b08865e4
PERSONAL_DATA_SECURITY_VERSION=0.1.0
PERSONAL_DATA_SECURITY_GIT_BLOB_SHA1=43e75d53e5e4cdd5afbf182a5dad13a16dc28ee7
```

## Required C0 work

1. Inventory Note, Source, Wiki, KG, RAG, Model, Todo, Schedule, ASR and lifecycle capabilities.
2. Inventory current physical stores and public/product-internal APIs.
3. Classify each surface as `CONFORMS`, `ADAPT`, `MIGRATE`, `DEPRECATE`, `PRODUCT_UI_ONLY`, `OUT_OF_SCOPE` or `MISSING`.
4. Identify duplicate identity/truth risks and missing provenance/review/privacy/permission fields.
5. Record LLM Wiki code reuse as blocked pending license/clean-room decision while allowing independent concept-level design.
6. Select C1 initial slice: `Source + Knowledge/Note + Entity/Relation` canonical envelope plus read-only adapter; Wiki/RAG/graph remain projections consuming the same IDs.
7. Define C1 source tests and migration/rollback acceptance before implementation begins.
8. Define C6 exact Runtime conformance and C7 independent product/customer-value gates now, so source tests cannot later be mistaken for completion.

## C1 acceptance contract to prepare

- stable `object_id` independent of UI row IDs and rebuildable indexes;
- `object_type`, `namespace`, `schema_version`, `source_refs`, `content_hash`;
- observed/valid time;
- assertion type and confidence;
- review state;
- privacy class and permission scope;
- supersede/tombstone lifecycle;
- created/updated actor identity;
- deterministic migration and rollback receipts;
- existing notes remain readable and recoverable;
- no physical table exposed as ecosystem API;
- no Agent write directly becomes accepted canonical knowledge.

## Deliverables

- `GOAL.md`
- `TASK.md`
- `PLAN.md`
- `RESULT.md`
- `EVIDENCE.md`
- `commands.log`
- `CONTRACT_PIN.md`
- `CURRENT_SCHEMA_MAPPING.md`

## C0 verdict ceiling

```text
V03_MIGRATION_STATE=ACTIVATED
C0_STATE=MAPPING_IN_PROGRESS|CONTRACT_MAPPING_COMPLETE
PRODUCT_RUNTIME_CHANGED=NO
REFERENCE_IMPLEMENTATION=NOT_YET_CLAIMED
MERGE_RELEASE_AUTHORIZED=NO
```