# PLAN — COPILOT-SKE-V03-C0-R1

## Lane A — protect current MVP

1. Preserve PR #20 as Draft.
2. Preserve current source Head `d450badfc85b65d3eef20f05eeb0607c1bf6a912`.
3. Record R75 as consumed `BLOCKED_NATIVE_CACHE_NETWORK_TRANSPORT_RESET`.
4. Do not authorize R75 retry or predecessor cache/evidence reuse.
5. Treat current first MVP blocker as local network transport stability, not a proven source defect.
6. Do not claim Candidate/Runtime/product-experience progress from R75.

## Lane B — v0.3 C0 independent channel

1. Branch from planning PR #40 Head `0bc309c506826ebc1b7865748398953ad814e6da`.
2. Pin ecosystem Draft PR #17 exact SHA `e46c4be501c465884486a4417adca2e158a58ccc` under Human Owner Copilot-use authorization.
3. Pin Shared Knowledge Engine contract blob `caf9864f49dfb923f88f7125b7359d69b08865e4` and Personal Data Security 0.1.0 blob `43e75d53e5e4cdd5afbf182a5dad13a16dc28ee7`.
4. Map current physical stores and product/internal contracts.
5. Select C1 smallest non-destructive adapter slice.
6. Open a stacked Draft PR against `chatgpt/v03-shared-knowledge-engine-plan-r1`; do not merge to `main`.
7. Update tracker Issue #41 with exact Goal, branch, SHA and contract pin.

## C0 mapping targets

### Knowledge base

- `packages/kb/SCHEMA-FROZEN-1.1.md`
- `notes`, `note_links`, `kg_pending`, append-only trash lifecycle
- Markdown body mirror

### Knowledge graph

- `packages/kg/src/store/sqlite-store.ts`
- `kg_nodes`, `kg_edges`, `note_entities`, `kg_tags`, `note_tags`

### RAG

- `packages/rag/SCHEMA-FROZEN-1.2.md`
- separate `.rag/rag.db`
- deterministic chunk projection keyed by `note_path#ordinal`

### Product-internal domain boundary

- `apps/copilot-desktop/src/shared/domain-api.ts`
- Note, KG, RAG and Todo renderer/main IPC types

### Product capabilities

- Note import/capture and local persistence
- Wiki-derived organization and navigation
- graph projection
- grounded Ask/sources
- Todo/Schedule
- provider configuration
- embedded local ASR target
- trash/recovery

## C0 risk questions

1. Is `notes.path` a product-local identifier or safe ecosystem `object_id`? Default answer: product-local; adapt, do not expose directly as universal ID.
2. Are `kg_nodes.entity_id` and RAG chunk IDs canonical truth? Default answer: no; graph/chunks are projections until mapped to canonical objects with source lineage.
3. Is `source_hash` enough provenance? No; first-class Source object, source refs, observed/valid time and transformation receipts are missing.
4. Are `confidence` and `agent` sufficient assertion/review metadata? No; fact/inference/hypothesis taxonomy, review state, privacy class and permission scope are missing.
5. Can renderer IPC become ecosystem API? No; it is product-internal and lacks version negotiation/policy filtering/capability identity.
6. Is trash lifecycle equivalent to v0.3 deletion? Partial only; deletion across Wiki/graph/vector/full-text/backups/replicas still requires lifecycle receipts.

## C1 selected slice

Create a storage-neutral adapter/library boundary over existing local stores for:

```text
Source
Knowledge/Note
Entity
Relation
```

with a shared canonical envelope and deterministic mapping receipts.

Initial C1 must be read-compatible and additive. Existing KB/KG/RAG physical schemas remain implementation details. Wiki, graph and RAG consume canonical IDs through adapters/projections; they are not rewritten wholesale in C1.

## C1 test-first gate

Before source implementation, RED tests must cover:

- stable object ID across repeated reads/reindex;
- same source revision maps idempotently;
- content hash changes create revision lineage rather than silent overwrite;
- fact vs system inference labels preserved;
- proposed/disputed state never silently presented as accepted;
- D0/D1 filtering and unknown privacy state fail closed;
- unauthorized namespace/purpose read denied;
- Agent write produces proposal receipt only;
- physical table names absent from public contract fixtures;
- export fixture preserves object/source/review/provenance identity;
- old Note/KG data remains readable after adapter activation and rollback.

## Deferred until later milestones

- broad write API
- sync service
- D3 data enablement
- multi-user/tenant product UX
- cloud service operation
- 3D graph
- unrestricted database access

## Runtime and independent review pre-definition

C6 must bind one exact Git SHA, packaged Electron artifact SHA256, real local database identity, conformance fixture version, Agent client identity and process/runtime receipt.

C7 Codex independent review must operate the real packaged Electron product and test import/source/Wiki/search/graph/answer/review/conflict/Agent permission/export/delete/relaunch journeys. It may not modify source.

Human Owner separately decides customer value/reference implementation acceptance and any release/sign/notarize action.