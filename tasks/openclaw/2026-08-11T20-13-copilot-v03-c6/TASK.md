# TASK — COPILOT-SKE-V03-C6-R1

## Source acceptance

1. Real Copilot NoteDocument mapping is byte/body-aware but never uses the SQLite numeric `id` or absolute `md_path` as canonical identity.
2. Note path is the legacy source identity; restart/rebuild preserves stable Source/Knowledge object IDs.
3. Actual KG `entity_id`, `source_notes`, relation endpoint IDs and evidence note paths map to canonical Entity/Relation IDs/source refs; KG numeric row IDs are ignored.
4. Actual RAG `notePath` hits resolve to canonical Knowledge IDs and projection records; retrieval policy executes before rank/context return.
5. Card/Wiki/FullText/Vector/Graph/Dialogue projections for one note share one Knowledge object ID and canonical revision/hash/source refs.
6. D0/D1 synthetic fixtures prove allowed reads and D2/wrong consumer/wrong purpose denial without leaking denied score/payload.
7. C4 capability manifest/session and Agent API remain the only Agent seam; write authority stays `WRITE_PROPOSAL` only.
8. C5 portable export/import planning roundtrips real mapped note identity without physical write.
9. Local deletion lifecycle adapter cannot claim COMPLETE while Source/KG/RAG/Wiki/Card/Dialogue/Cache/Replica target proof is missing.
10. No physical table/row/chunk/IPC channel becomes Shared Engine contract.
11. New C6 adapter/harness code has focused tests and is included in a C6 source gate without lowering any existing strict coverage threshold.

## Exact Runtime acceptance after source freeze

MiniMax must prove on a fresh local candidate:

- exact source SHA and artifact SHA;
- fresh Runtime ID and synthetic D0/D1 test-data ID;
- real note create/read/update/restart mapping preserves canonical identity and revision lineage;
- actual KG reindex and RAG retrieval produce stable canonical refs;
- policy denial before result/context return;
- portable export/import validation on real local data root;
- deletion propagation reports honest incomplete/complete state across available surfaces;
- no denied data egress and D3 remains disabled;
- clean terminal state and complete evidence manifest.

## Claim ceiling

```text
C6_SOURCE_PASS=NOT_YET
C6_RUNTIME_PASS=NOT_YET
REFERENCE_IMPLEMENTATION=NOT_YET
C7_PRODUCT_EXPERIENCE=NOT_STARTED
HUMAN_OWNER_GATE=NOT_STARTED
```
