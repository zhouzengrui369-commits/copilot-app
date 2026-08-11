# TASK

## Allowed production

- `apps/copilot-desktop/src/main/local-knowledge-service.ts`

## Allowed tests

- `apps/copilot-desktop/tests/integration/note-wiki-before-rag-background.integration.test.ts`
- one new focused readiness test only if the existing file cannot express the
  exact revision cases
- existing P0 canonical/integration tests for compatibility assertions only
- this task's evidence and handoff status files

## Required behavior

- `knowledgeBuild.ready` means the exact note revision has:
  - current WIKI digest;
  - required KG/RAG pending entry completed successfully;
  - no newer revision or failed/running work superseding it.
- slow/running KG/RAG => `running`, never ready.
- failed KG/RAG => `failed`, never ready.
- completed exact revision => `ready`.
- update/delete/restart must not surface stale readiness.
- preserve local-first, current RAG ranking, sources, and background owner.

## RED → GREEN

Existing behavior that reports ready while slow/failed RAG is pending must be
captured RED, then inverted to the truthful contract. Add exact-revision,
failure, update, and restart assertions where the current harness supports it.

## Forbidden

- no provider/helper/UI/ranking/embedding/vector-schema changes;
- no broad RAG redesign;
- no test-only status override;
- no Git/network/credentials.

## Required checks

Run focused readiness integration, canonical Todo/integration compatibility,
main TypeScript, desktop build, and `git diff --check`. Do not run the same
Electron spec concurrently with the test-helper lane.

## Deliverables

`RESULT.md`, `EVIDENCE.md`, `commands.log`, `changed-files.txt`,
`DISPATCH_STATUS.md`, `ACCEPTANCE_LOG.md`, plus required handoff state updates.
