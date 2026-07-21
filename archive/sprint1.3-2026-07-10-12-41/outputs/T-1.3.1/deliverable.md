# T-1.3.1 Deliverable · Sprint 1.3 worker β — RAG scaffold

## Summary

Implemented the local-first RAG (Retrieve-Augment-Generate) layer for Sprint 1.3 T-1.3.1 as a new `@copilot/rag` package. Three waves delivered:

1. **Vector store + Embedding** — sql.js (WASM SQLite) vector store with `chunks` + `rag_index_meta` schema; brute-force cosine scan over 1024-dim Float32 vectors. Ollama HTTP wrapper (`Embedder`) defaulting to `bge-m3:latest` (1024 dim).
2. **Indexing pipeline** — 512-token paragraph-bound `chunkNote` + `Indexer.indexNotes` orchestrator (chunk → embed → insert with per-chunk error capture).
3. **Retrieval + Answer** — `Answerer` with retrieve-only and answer-streaming paths; streaming LLM answer with `(来源: <note_path>)` citation requirements surfaced via `citedSources` per `goal.md R5`.

RAG is **strictly additive** to Sprint 1.1 / Sprint 1.2 schemas (no changes to `notes` / `note_links` / `kg_pending` / `todos` / `kg_*` tables). The new `rag.db` lives at `<userData>/.rag/rag.db` and reads only `note_path` (string) from KB notes.

VERDICT: PASS

## Commit

- Branch: `sp1.3-T-1.3.1` @ `49f110d417ee4a76cf91b4e11930ae25413f8d1c`
- Worktree: `/Users/njx/openclaw/copilot.wt-T131/wt-T131`
- Message: `feat(rag): Sprint 1.3 T-1.3.1 RAG scaffold (embedder + sql.js vector store + chunker + indexer + answerer + 23 tests)`

## Changed files

- `packages/rag/package.json` — `@copilot/rag` workspace package, sql.js + @copilot/llm-client deps
- `packages/rag/tsconfig.json` — extend workspace base config
- `packages/rag/vitest.config.ts` — node environment, tests/**/*.test.ts
- `packages/rag/SCHEMA-FROZEN-1.2.md` — RAG additive contract (frozen schema, API surface, behaviour, upgrade path)
- `packages/rag/SELF-VERIFY-T-1.3.1.md` — worker self-verify doc
- `packages/rag/src/types.ts` — `NoteChunk`, `EmbeddedChunk`, `RetrievalHit`, `RetrievalResult`, `RagAnswerChunk`, `RagAnswerResult`, `EmbedderConfig`, `VectorStoreConfig`, `VectorSearchOptions`
- `packages/rag/src/embedder.ts` — `Embedder` class (Ollama HTTP, `bge-m3:latest` default, 1024 dim, dim override opt)
- `packages/rag/src/vector-store.ts` — `VectorStore` interface + sql.js impl (`SqlJsVectorStore`) + `createVectorStore` factory + `generateChunkId`
- `packages/rag/src/chunker.ts` — `chunkNote` (512-token, paragraph-bound, sentence fallback for oversize) + `estimateTokens` + `ChunkerConfig`
- `packages/rag/src/indexer.ts` — `Indexer` + `NoteInput` + `IndexerReport` + `IndexerOptions`
- `packages/rag/src/answerer.ts` — `Answerer` + `AnswererConfig` + `ChatStreamFactory` (duck-typed LLM surface)
- `packages/rag/src/index.ts` — public API re-exports
- `packages/rag/tests/chunker.test.ts` — 7 tests
- `packages/rag/tests/vector-store.test.ts` — 6 tests
- `packages/rag/tests/embedder.test.ts` — 6 tests
- `packages/rag/tests/answerer.test.ts` — 4 tests

## Verification commands run

```
$ cd /Users/njx/openclaw/copilot.wt-T131/wt-T131/packages/rag
$ npx tsc --noEmit -p tsconfig.json
exit=0   # clean

$ npx vitest run --reporter=verbose
Test Files  4 passed (4)
Tests  23 passed (23)
Duration  ~1.1s

$ curl -sS -m 8 -X POST http://127.0.0.1:11434/api/embeddings \
    -H 'content-type: application/json' \
    -d '{"model":"bge-m3:latest","prompt":"OPC 是什么"}' \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('dim=',len(d['embedding']))"
dim= 1024
```

## Notes for the verifier

1. **No live end-to-end test against real Ollama in CI.** Unit tests use a fetch stub. Use the bash command above to verify a real 1024-dim embedding comes back.
2. **Default model is `bge-m3:latest`, NOT `mxbai-embed-large`.** Originally the @copilot/rag skeleton specified `mxbai-embed-large`, but that model is not installed on the dev host. `bge-m3:latest` (1024 dim) is the next-best candidate. Operators can override with `new Embedder({ model: 'mxbai-embed-large' })` if they pull that model.
3. **Vector store is sql.js (WASM SQLite), NOT sqlite-vss.** T-1.3.0a finding: better-sqlite3@11.10.0 native build fails (Python 3.14 distutils removed + node-gyp 9.4.1). sqlite-vss requires better-sqlite3, so I used sql.js — no native build, no node-gyp. SCHEMA-FROZEN §9 documents the upgrade path (when env supports it, swap in `SqliteVssVectorStore` implementing the same `VectorStore` interface — callers don't change).
4. **Dep `@copilot/kb` was removed** from `packages/rag/package.json` to keep RAG decoupled from kb's better-sqlite3 native binding at install time. RAG receives notes from the caller (e.g. `Indexer.indexNotes([{path, body}])`) and only reads `note_path` as a string foreign key. KB / KG schema is not modified.
5. **Embedder `dimensions` is now an opt** (default 1024). Tests use this to mock non-default dims; operators should also override when switching to a model with different dim (e.g. `nomic-embed-text` → 768).
6. **No Electron renderer UI yet.** RAG package + API surface is the deliverable; the Electron renderer view is a follow-up (out of scope for T-1.3.1 per the sprint1.3 task contract).
7. **package-lock.json is modified** but intentionally NOT committed (the change is a side-effect of `npm install --ignore-scripts` needed for T-1.3.0b's `better-sqlite3` env; it's the T-1.3.0b worker's call whether to commit it). Worktree-local only.
8. **No known conflict with siblings.** T-1.3.0a and T-1.3.2 were on different files; my work only adds `packages/rag/*` and does not touch `apps/copilot-desktop/`, `apps/server/`, `apps/web/`, `packages/kb/`, `packages/kg/`. Verifier can `git show --stat 49f110d4` to confirm scope.
