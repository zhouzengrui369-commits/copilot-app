# EVIDENCE

## Changed behavior

- Production:
  `apps/copilot-desktop/src/main/local-knowledge-service.ts:879`
- Focused integration:
  `apps/copilot-desktop/tests/integration/note-wiki-before-rag-background.integration.test.ts:204`

Current postimage SHA256:

- `local-knowledge-service.ts`:
  `50bf7043fb4830672073f1bc1ba38bfe31e4eb3c0783a49d99800264281d6e0e`
- readiness integration test:
  `d4676a923c77c8cd3729999a5a3a3a13692696372b1e31c90b75fe91c5dfb1a8`

## RED

Command:

`npx vitest run tests/integration/note-wiki-before-rag-background.integration.test.ts`

Result: exit 1; 9 tests collected; 2 failed, 7 passed.

Observed mismatches:

- expected `running`, received `ready` while `kg_pending=processing`;
- expected `not-ready`, received `ready` for a `done` row whose
  `queued_at` belonged to the previous note revision.

The first sandboxed attempt stopped before collection with a Vite temporary
file `EPERM`; the identical approved unsandboxed command produced the
assertion-level RED above.

## GREEN and compatibility

- readiness integration: exit 0; 9/9 passed;
- canonical Todo plus local-first integration: exit 0; 13/13 passed;
- `npx tsc -p tsconfig.main.json --noEmit`: exit 0;
- `npm run build --workspace @copilot/desktop`: exit 0;
- `git diff --check`: exit 0.

Build receipt included verified main, preload, and renderer bundles and:

`RENDERER_BUNDLE_VERIFIED: files=7`

## Boundaries

- no Electron;
- no provider/helper, UI, retrieval, ranking, embedding, or vector schema
  changes;
- no `PROJECT_STATE.yaml`/status/TODO/changelog updates;
- no Git, network, credentials, or global configuration.
