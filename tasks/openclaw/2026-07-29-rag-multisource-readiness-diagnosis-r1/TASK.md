# TASK

## Evidence

EXP-COP-008 R2 real Electron attempt 2 proved:

- two distinct exact local note paths exist;
- both report WIKI `current` and build `ready`;
- one stable query phrase is present in both notes;
- direct `window.copilot.rag.ask` for that query returns only source B for 30s;
- source A never appears.

## Read-only scope

- `apps/copilot-desktop/src/main/local-knowledge-service.ts`
- RAG/chunk/embed/vector persistence files directly imported by that service
- WIKI/build-readiness types and storage files directly involved
- `apps/copilot-desktop/tests/e2e/exp-cop-008-todo-closure.spec.ts`
- R2 Electron trace/output and prior WIKI→RAG readiness tests

## Questions

1. Does `knowledgeBuild.ready` bind WIKI, KG, and RAG to one exact
   `noteRevision`, or can it become ready before every note is searchable?
2. Does create/update/reindex replace unrelated note vectors/chunks?
3. Is retrieval intentionally deduplicating two equal/common chunks into one
   source?
4. Is the query transformed or ranked so source A is deterministically lost?
5. What is the smallest production correction that preserves local-first,
   deterministic Top-K, update/delete cleanup, and no gold-aware ranking?

## Forbidden

- no edits;
- no test/build/Electron/Git/network;
- no provider-fixture weakening;
- no test-data workaround;
- no broad RAG redesign.

## Deliverable

Return:

- exact root-cause file/function/branch;
- whether this is production, readiness-contract, or test defect;
- smallest production/test allowlist;
- RED assertion and GREEN acceptance;
- risks to update/delete/restart/source alignment.
