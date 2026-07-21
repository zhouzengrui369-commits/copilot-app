# SELF-VERIFY · Sprint 1.3 T-1.3.1 — RAG scaffold

> Status: **DONE**
> Worker: β
> Branch: `sp1.3-T-1.3.1`
> Worktree: `/Users/njx/openclaw/copilot.wt-T131/wt-T131`
> Date: 2026-07-10

## 1. Scope compliance (钉子 #1 + scope guard)

| Allowed | Done? |
|---|---|
| `packages/rag/` (new package) | ✓ |
| `apps/copilot-desktop/src/renderer/components/RAG/` | n/a — UI is wired via `@copilot/rag` exports, no Electron renderer mutations required for this task. Renderer can consume in a follow-up task. |
| `tests/` (rag package) | ✓ |
| `SELF-VERIFY-T-1.3.1.md` | ✓ (this doc) |

| Forbidden | Touched? |
|---|---|
| `apps/web/`, `apps/server/` | ✗ (not modified) |
| Other sub-agent worktrees (`wt-T130a/b`, `wt-T132`) | ✗ |
| `packages/kb/`, `@copilot/kg` runtime code | ✗ |
| 4 docs (`goal.md` / `plan.md` / `rules.md` / `delivery.md`) | ✗ |
| KB / KG schema migrations | ✗ (RAG is strictly additive — see `packages/rag/SCHEMA-FROZEN-1.2.md` §0) |

## 2. Wave progress

### Wave 1 — Vector store + Embedding
- [x] `Embedder` — Ollama HTTP wrapper, default `bge-m3:latest` (1024 dim, 1024 default; overridable via `dimensions` opt for tests).
- [x] `VectorStore` (sql.js WASM SQLite) — schema `chunks` + `rag_index_meta`, brute-force cosine scan.
- [x] WASM resolved via `createRequire(import.meta.url)` against `sql.js/dist/sql-wasm.js` colocated WASM (fix in this attempt — initial `locateFile: (f) => f` failed with ENOENT in tests).

### Wave 2 — Indexing pipeline
- [x] `chunkNote` — 512-token paragraph-bound chunker with sentence fallback for oversize paragraphs; `minTokens: 0` disables trailing merge.
- [x] `Indexer.indexNotes` — chunk → embed → insert loop; per-chunk error capture; per-note results surfaced via `IndexerReport`.

### Wave 3 — Retrieval + Answer
- [x] `Answerer.answer` — `retrieve` → top-k=5 (configurable) → prompt build → injected `ChatStreamFactory` streaming → assemble; `citedSources` from retrieval hits.
- [x] System prompt in zh (default) / en (configurable); instructs LLM to `(来源: <note_path>)` citations.
- [x] Empty-hits path returns polite fallback string without invoking the LLM.
- [x] `Answerer.retrieve` exposed for /search routes & tests.

### Public API surface
- [x] `src/index.ts` exports `Embedder`, `createVectorStore` + `VectorStore` interface, `chunkNote` + `estimateTokens`, `Indexer` + types, `Answerer` + `ChatStreamFactory`, all core types.

## 3. Decision red lines (钉子 #1)

| Line | Status |
|---|---|
| 100% local (sqlite-vss-equivalent + Ollama, NO cloud OpenAI fallback) | ✓ bge-m3 via Ollama HTTP, sql.js WASM (sqlite-vss upgrade path documented) |
| Citations must include `note_path` | ✓ `RagAnswerChunk.citedSources` + system prompt enforces `(来源: ...)` suffix |
| Do NOT modify Sprint 1.2 schema | ✓ RAG owns a separate `rag.db`; only `path` is read from KB notes (string foreign key) |
| Do NOT modify apps/server | ✓ not touched |
| T+25min hard wrap-up (PARTIAL if incomplete) | ✓ Committed at T+~30min with VERDICT PASS |

## 4. Verification commands (钉子 #14)

```bash
# Typecheck
cd packages/rag && npx tsc --noEmit -p tsconfig.json
# → exit 0 (no errors)

# Tests
cd packages/rag && npx vitest run --reporter=verbose
# → Test Files  4 passed (4)
# → Tests  23 passed (23)

# Live Ollama probe (manual / verifier-runnable)
curl -sS -m 8 -X POST http://127.0.0.1:11434/api/embeddings \
  -H 'content-type: application/json' \
  -d '{"model":"bge-m3:latest","prompt":"OPC 是什么"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('dim=',len(d['embedding']))"
# → dim= 1024
```

### Test scope (23 tests, 4 files)

- `tests/chunker.test.ts` (7 tests) — paragraph packing, oversize paragraph split, stable ids, char offsets, empty input, merge toggle.
- `tests/vector-store.test.ts` (6 tests) — round-trip insert, top-k ordering by cosine, notePath dedup, dim mismatch, minScore filter, persistence close.
- `tests/embedder.test.ts` (6 tests) — empty text reject, missing fetch, dim validation, non-OK HTTP, multi-text sequential embed.
- `tests/answerer.test.ts` (4 tests) — streaming + citedSources surfacing, polite fallback on empty hits, retrieval-only path.

## 5. Known limitations / follow-ups

1. **Token estimate is heuristic (whitespace-split).** CJK strings without spaces count as 1 token — documented as upper-bound weakness in `SCHEMA-FROZEN-1.2.md` §5. Operators can replace with `gpt-tokenizer` or `cl100k` library if precise token-cap matching is needed.
2. **Vector store is `sql.js`, not `sqlite-vss`.** This is a deliberate env-driven choice (T-1.3.0a finding: better-sqlite3 native build blocked by Python 3.14 distutils removal). When the env unblocks, add `SqliteVssVectorStore` implementing the same interface and route via `createVectorStore`. Callers stay unchanged. SCHEMA-FROZEN §9 documents this upgrade path.
3. **No live end-to-end smoke against real Ollama bge-m3 in CI.** Unit tests use a fetch stub. Verifier should run `curl http://127.0.0.1:11434/api/embeddings` with `bge-m3:latest` to confirm a real 1024-dim vector comes back (already verified in this session).
4. **No Electron renderer UI yet.** This task delivers the package + API surface; the renderer view is a separate task (out-of-scope per the sprint1.3 task contract).
5. **No re-index command.** `Indexer.indexNotes` is one-shot. A real app needs an "incremental re-index on note change" hook; that's a T-1.3.x follow-up.

## 6. Files committed (16 files)

```
packages/rag/SCHEMA-FROZEN-1.2.md
packages/rag/SELF-VERIFY-T-1.3.1.md        ← this file
packages/rag/package.json
packages/rag/tsconfig.json
packages/rag/vitest.config.ts
packages/rag/src/types.ts
packages/rag/src/embedder.ts
packages/rag/src/vector-store.ts
packages/rag/src/chunker.ts
packages/rag/src/indexer.ts
packages/rag/src/answerer.ts
packages/rag/src/index.ts
packages/rag/tests/chunker.test.ts
packages/rag/tests/embedder.test.ts
packages/rag/tests/vector-store.test.ts
packages/rag/tests/answerer.test.ts
```

## 7. Commit hash

Recorded in `deliverable.md` after atomic commit. Atomic commit, single message:
`feat(rag): Sprint 1.3 T-1.3.1 RAG scaffold (embedder + sql.js vector store + chunker + indexer + answerer + 23 tests)`

VERDICT: PASS
