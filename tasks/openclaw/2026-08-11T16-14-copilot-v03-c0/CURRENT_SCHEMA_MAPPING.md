# CURRENT SCHEMA MAPPING — Copilot v0.3 C0

Status: `C0_MAPPING_BASELINE_R1`

This file is factual mapping only. It does not promote current tables or renderer IPC to the ecosystem contract.

## 1. Current local storage truth

### KB metadata/body split

Evidence: `packages/kb/SCHEMA-FROZEN-1.1.md`.

Current stores:

- `<userData>/kb.sqlite`
- `<userData>/notes/<compound-path>.md`

Current physical tables include:

- `schema_meta`
- `notes`
- `note_links`
- `kg_pending`
- append-only trash lifecycle tables introduced by later KB migrations

Current identifier:

- `notes.path` is the product-local canonical note path.

v0.3 classification: `ADAPT`.

Reason: useful stable local identity exists, but current rows do not provide the complete shared envelope (`namespace`, explicit `schema_version` per object, first-class `source_refs`, observed/valid time, assertion taxonomy, review state, privacy class, permission scope, supersession/tombstone actor fields).

`notes.path` must not be exposed as the universal ecosystem object ID without an explicit deterministic mapping/version contract.

### KG store

Evidence: `packages/kg/src/store/sqlite-store.ts`.

Current physical tables include:

- `kg_nodes`
- `kg_edges`
- `note_entities`
- `kg_tags`
- `note_tags`
- `kg_schema_meta`

Current identity/provenance surfaces:

- `kg_nodes.entity_id`
- `source_notes`
- `kg_edges.evidence`
- confidence/weight

v0.3 classification: `ADAPT`.

Reason: entity/relation identity and evidence concepts exist, but relation/object versioning, namespace, source object IDs, assertion/review/privacy/permission state, temporal validity and supersession are incomplete. KG is a projection/derived knowledge surface until bound to canonical objects.

### RAG vector store

Evidence: `packages/rag/SCHEMA-FROZEN-1.2.md`.

Current store:

- `<userData>/.rag/rag.db`

Current physical tables:

- `chunks`
- `rag_index_meta`

Current chunk identity:

- deterministic `<notePath>#<ordinal>`

v0.3 classification: `ADAPT / PROJECTION_ONLY`.

Reason: deterministic chunk IDs and `note_path` citation linkage are useful projection evidence, but chunks are not canonical truth. Index rebuild must be allowed without changing canonical object identity. Current chunk metadata lacks complete object/provenance/review/privacy/permission contract.

## 2. Current product-internal API truth

Evidence: `apps/copilot-desktop/src/shared/domain-api.ts`.

Current renderer/main IPC exposes product-local types for:

- `NoteRecord` / `NoteDocument`
- KG entity/relation/subgraph
- RAG answer/source details/stream events
- Todo
- Trash lifecycle

v0.3 classification: `PRODUCT_UI_ONLY / ADAPT`.

It is a useful internal boundary because renderer responses intentionally omit secrets and raw filesystem paths, but it is not a cross-product API because it lacks:

- contract version negotiation;
- tenant/namespace authorization;
- purpose/privacy filtering;
- capability identity;
- read/write audit receipts;
- shared canonical object envelope;
- stable ecosystem compatibility guarantees.

## 3. Capability mapping

| Current capability | Current truth | v0.3 classification | Required change |
|---|---|---|---|
| Note/local KB | SQLite metadata + Markdown body | ADAPT | canonical object adapter, provenance/review/privacy fields, stable mapping receipt |
| Source | `source_hash` and note/source references exist, but no proven first-class shared Source object in C0 scan | MIGRATE / MISSING_CANONICAL_OBJECT | introduce Source envelope and source revision identity |
| Wiki | product capability exists as derived knowledge organization/navigation | ADAPT / PROJECTION | bind Wiki sections/pages to canonical object IDs + section source mappings/compiler receipts |
| KG | local entity/relation projection | ADAPT / PROJECTION | bind entities/relations to canonical IDs, lineage, review/privacy state |
| RAG | local vector chunks + grounded sources | ADAPT / PROJECTION | retrieve canonical IDs/evidence envelope, permission filter before context assembly |
| Model | configurable provider/runtime exists | ADAPT | transformation receipt: provider/model/recipe/source/time/cost/confidence/review policy |
| Todo/Schedule | standalone product workflow | OUT_OF_INITIAL_C1 | later map to Goal/Project/Decision only where contract semantics are explicit |
| Trash/recovery | durable local lifecycle exists | ADAPT | extend to cross-projection delete/tombstone receipts and backup/replica state |
| ASR | current MVP target is packaged local ASR | OUT_OF_INITIAL_C1_INGESTION_ADAPTER_LATER | when adopted, produce Signal/Source provenance and permission receipts |
| Agent API/MCP | no accepted versioned policy-filtered shared interface proven | MISSING | C4 read-only gateway first; write proposal later |
| Privacy/permission | product security boundaries exist, but no complete D0-D3 object policy plane proven | MIGRATE | canonical privacy/purpose/consumer grants + fail-closed access gateway |

## 4. Duplicate truth and identity risks

### Risk A — Note identity vs graph identity vs chunk identity

Today, note path, `entity_id` and `<notePath>#ordinal` serve different local purposes. Treating all three as independent canonical objects without lineage would create duplicate truth.

Required C1 rule:

- canonical object owns identity;
- graph/Wiki/RAG are rebuildable projections;
- projection IDs carry canonical object/source references.

### Risk B — Markdown body vs SQLite metadata

The KB explicitly has separate body and metadata authorities. C1 must not create a third content truth copy.

Required rule:

- adapter reads existing authority;
- shared canonical envelope stores identity/provenance/lifecycle metadata or content references according to migration ADR;
- no silent divergent body copy.

### Risk C — Source hash is not provenance

`source_hash` is useful integrity metadata but does not answer source identity, observed time, transformation recipe, review decision or allowed consumer.

Required C1 rule: first-class Source/revision/provenance receipt.

### Risk D — confidence is not assertion/review state

Current `confidence`/`agent` fields cannot distinguish source fact, user-declared fact, observation, inference, hypothesis, disputed/stale/superseded knowledge.

Required C1 rule: explicit taxonomy and review state.

### Risk E — product IPC mistaken for Agent API

Renderer/main IPC has no ecosystem capability/purpose/privacy contract.

Required rule: C4 creates a separate versioned policy-filtered boundary. Physical tables and renderer IPC remain implementation details.

## 5. Initial C1 mapping decision

C1 scope is deliberately narrow:

```text
Source
Knowledge/Note
Entity
Relation
```

Add a storage-neutral canonical envelope/adapter and conformance fixtures without wholesale database migration.

Wiki, KG and RAG must be able to consume or project the same canonical IDs later, but C1 does not rewrite their entire runtime.

## 6. Current physical-schema exposure verdict

```text
PHYSICAL_SCHEMA_EXPOSED_AS_ECOSYSTEM_CONTRACT=NO_CURRENT_ACCEPTED_CONTRACT
RISK=HIGH_IF_DIRECT_TABLE_ACCESS_IS_ADDED
DECISION=CREATE_VERSIONED_ADAPTER_AND_POLICY_GATEWAY
```

Any implementation that exposes `notes`, `kg_nodes`, `kg_edges`, `chunks` or other internal tables as the stable cross-product API without a versioned policy-filtered view must fail with:

`BLOCKED_PHYSICAL_SCHEMA_EXPOSED_AS_CONTRACT`.