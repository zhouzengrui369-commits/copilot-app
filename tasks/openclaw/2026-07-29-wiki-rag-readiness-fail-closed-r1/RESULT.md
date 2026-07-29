# RESULT

`PASS / READINESS_ONLY / MVP_NOT_COMPLETE`

## Outcome

`knowledgeBuild.ready` no longer follows WIKI digest truth alone. The service
now requires the durable `kg_pending` row to belong to the current note
revision (`queued_at === note.updatedAt`) and to be `done`.

Exact state mapping:

- revision mismatch or missing row: `not-ready`;
- exact `pending`: `queued`;
- exact `processing`: `running`;
- exact `failed`: `failed`;
- exact `done` plus current digest-bound WIKI: `ready`;
- every other combination: `not-ready`.

## RED → GREEN

- RED: 9 readiness tests, 2 failed and 7 passed.
  - current WIKI plus processing RAG returned premature `ready`;
  - stale completed row from an older queued revision returned premature
    `ready`.
- GREEN: the same 9 tests passed.
- Slow RAG now reports `running`; its durable failure reports `failed`.
- Existing update, startup recovery, non-current WIKI, and latest-write tests
  remain green.

## Compatibility

- canonical Todo plus local-first integration: 13/13 passed;
- desktop main TypeScript: passed;
- desktop build: passed;
- `git diff --check`: passed.

## Scope note

`local-knowledge-service.ts` already contained a separate in-progress canonical
Todo readback diff before this lane. It was preserved byte-for-byte. This lane
only changed `readKnowledgeBuildStatus`.

No Electron run was authorized. No Git operation was performed.
