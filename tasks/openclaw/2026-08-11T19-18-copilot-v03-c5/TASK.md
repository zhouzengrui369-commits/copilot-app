# TASK — COPILOT-SKE-V03-C5-R1

## Acceptance contract

### Portability

- export bundle identity is deterministic for the same logical contents;
- canonical entries bind object ID/type/hash/revision/source refs/privacy/permission fingerprint;
- optional source bytes are represented only by allowed content-safe descriptors and checksums;
- no physical row/chunk/table identity is exported;
- duplicate conflicting canonical versions, unsupported schema/version or checksum drift fail closed;
- import validates the entire bundle before returning any operation;
- import returns a plan only; physical writes are impossible in this module;
- existing accepted objects are never silently overwritten by a divergent bundle object.

### Deletion

Required logical targets:
`SOURCE_BYTES / CANONICAL_OBJECT / WIKI / CARD_2D / GRAPH / VECTOR / FULL_TEXT / DIALOGUE_CONTEXT / CACHE / REPLICA`.

- deletion plan binds canonical ID/hash/revision and authority;
- target receipts use bounded machine error codes, never deleted payloads;
- overall `COMPLETE` is impossible while any required target is pending/blocked/failed;
- tombstone contains identity/digest/receipt metadata only and cannot contain deleted body/source bytes;
- failed/pending surfaces remain explicit and auditable.

### Sync

- sync envelope binds canonical ID/hash/revision/namespace/privacy/review/revision state;
- identical input is idempotent;
- older revisions are stale and cannot overwrite newer local state;
- exact successor lineage may be planned as an update only under non-sensitive, explicitly safe conditions;
- divergent accepted facts, permission changes, review-sensitive or D2/D3 state always produce conflict; no LWW;
- conflict outputs preserve both object identities/hashes/revisions without copying payload text.

## Gate

Run exact Node 24/macOS v0.3 Source Gate with:
- exact package/lock identity;
- complete KB regression;
- strict per-file >=90% statements/lines/branches/functions for all C1-C5 Shared Engine source files;
- storage-neutral scan;
- source-clean proof.

## Claim ceiling

```text
C5_SOURCE_PASS=NOT_YET
REAL_EXPORT_IMPORT_RUNTIME=NOT_YET
REAL_BACKUP_RESTORE=NOT_YET
REAL_DELETION_PROPAGATION=NOT_YET
REAL_SYNC_TRANSPORT=NOT_YET
REFERENCE_IMPLEMENTATION=NOT_YET
```
