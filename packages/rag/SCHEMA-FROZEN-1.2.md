# KB Schema Freeze · Sprint 1.2 (T-1.2.5) + Sprint 1.3 (T-1.3.1) — RAG additive contract

> Status: **FROZEN** as of 2026-07-10 (Sprint 1.3 wave 1)
> Owner: PM (Mavis)
> Consumers: Sprint 1.3 T-1.3.1 RAG (@copilot/rag) + Sprint 1.3 T-1.3.4 error/crash
> Implementation: `/packages/rag/` (workspace `@copilot/rag`)

This document is the **additive contract** for the local RAG layer.
Any change to schema fields, table drops, or extension requirements below
MUST go through the PM change-request channel (rules.md §1.4).
**Worker self-service edits are forbidden.**

---

## 0. Scope discipline (钉子 #6 + 钉子 #14)

The RAG layer is **strictly additive** with respect to:

- `@copilot/kb` schema v0 (`notes` / `note_links` / `kg_pending` / `todos`)
- `@copilot/kg` schema (kg_nodes / kg_edges / note_entities / kg_tags)
- SQLite metadata schema (`schema_meta`)

RAG introduces a **separate database file** `<userData>/.rag/rag.db` so the
frozen Sprint 1.1 / 1.2 layouts stay untouched. The only field RAG
**reads** from the KB / KG layer is `note_path` (string). It never writes
back to those tables.

---

## 1. Storage layout

| Concern | Tech | Path |
|---|---|---|
| Vector store | sql.js (WASM SQLite) — brute-force cosine scan | `<userData>/.rag/rag.db` |

Why sql.js instead of sqlite-vss:
- The active workspace env cannot build better-sqlite3 native bindings
  (Python 3.14 + node-gyp 9.4.1 — distutils removed; see T-1.3.0a finding).
- sqlite-vss **requires** better-sqlite3 (sqlite-vss ships as a SQLite
  extension — it must be loaded into a better-sqlite3 process). Cannot
  fall back to sql.js.
- sql.js compiles SQLite to WebAssembly. No native deps. Runs in Node 24
  out of the box. RAG keeps the same `VectorStore` interface so when
  better-sqlite3 becomes available we can swap in
  `SqliteVssVectorStore` without touching the rest of RAG.
- For an MVP KB of ≤ 5,000 chunks, brute-force cosine over 1024-dim
  Float32 vectors is ~30–50 ms per query — well under the 500 ms user
  interaction budget.

Persistence:
- `createVectorStore({ dbPath })` opens the file if present, else creates.
- On `close()`, if any writes happened (`dirty` flag), the db is exported
  to disk. Callers are expected to call `close()` once at shutdown.

---

## 2. Schema (inside rag.db, schema version 1)

```sql
CREATE TABLE chunks (
  id            TEXT PRIMARY KEY,        -- deterministic: <notePath>#<ordinal>
  note_path     TEXT    NOT NULL,        -- KB note.path (citation source)
  ordinal       INTEGER NOT NULL,        -- 0-based ordinal within note
  text          TEXT    NOT NULL,        -- chunk text (≤ 512 tokens)
  token_count   INTEGER NOT NULL,        -- heuristic whitespace-split count
  char_start    INTEGER NOT NULL,        -- start offset in original note body
  char_end      INTEGER NOT NULL,        -- end offset in original note body
  embedding     BLOB    NOT NULL,        -- 4-byte-floats, dim * 4 bytes
  model         TEXT    NOT NULL,        -- e.g. 'bge-m3:latest' or 'mxbai-embed-large'
  embedded_at   INTEGER NOT NULL         -- unix-ms timestamp
);

CREATE INDEX idx_chunks_note_path ON chunks(note_path);

CREATE TABLE rag_index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Required rows in `rag_index_meta`:
- `('schema_version', '1')`  — bump on schema change
- `('embedding_model', '<model_id>')` — used for diagnostics

---

## 3. Public API surface (typescript)

```ts
import {
  // Vector store
  createVectorStore, type VectorStore, type VectorStoreConfig, type VectorSearchOptions,
  generateChunkId,

  // Embedding
  Embedder, type EmbedderConfig,

  // Chunker
  chunkNote, estimateTokens, type ChunkerConfig,

  // Indexer pipeline
  Indexer, type IndexerOptions, type IndexerReport, type NoteInput,

  // Retrieval + Answer
  Answerer, type AnswererConfig, type AnswererStreamChunk, type ChatStreamFactory,

  // Core types
  type NoteChunk, type EmbeddedChunk,
  type RetrievalHit, type RetrievalResult,
  type RagAnswerChunk, type RagAnswerResult,
} from '@copilot/rag';
```

---

## 4. Embedding configuration

| Field | Default | Rationale |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:11434` | local Ollama default |
| `model`   | `bge-m3:latest`       | 1024 dim, available on dev host (mxbai-embed-large not installed) |
| `timeoutMs` | 8000               | local Ollama should respond in < 2 s |

Operators may override via `Embedder({ model: 'mxbai-embed-large' })` once
that model is pulled.

---

## 5. Chunker configuration

| Field | Default | Rationale |
|---|---|---|
| `maxTokens` | 512 | common RAG tutorial default; fits in bge-m3 / MiniMax-M3 context |
| `minTokens` | 32  | tiny trailing chunks get merged into the previous one |

Token estimate is heuristic (whitespace-split). For CJK this counts each
character as one token — a safe upper bound, never an under-estimate.

---

## 6. Indexer behaviour

- Inputs: `Array<{ path: string; body: string; title?: string }>`. The
  `path` field is the same value that lives in `kb.notes.path`. RAG never
  resolves the foreign key; the caller is responsible.
- Output: `IndexerReport` (notes count, chunks attempted/inserted/skipped,
  per-error records, model id used, timestamps).
- Per-chunk error policy: skip the bad chunk, record reason, continue
  indexing the remaining notes. Indexer is best-effort, not transactional.

---

## 7. Retrieval + answer semantics (R5 contract)

- Top-k default: 5 (Sprint 1.3 acceptance signal from §2.2 plan v6.2).
- Cosine similarity in `[-1, 1]`. Default minScore = -1 (no filter).
- Prompt language: default `zh` (matches v6 product, NJX).
- Citation requirement: every chunk surface carries its `notePath`; the
  answer generator surfaces the unique set in `sources` and instructs
  the LLM to append `(来源: <note_path>)` per cited paragraph.
- Empty hit path: the answerer emits a polite fallback string instead of
  invoking the LLM (cheap deterministic answer for empty retrievals).

---

## 8. Why no cloud OpenAI / Anthropic fallback

Per `goal.md v6.2` §1 (decision red line): **knowledge + knowledge graph
+ RAG all live in app memory + local persistence; cloud = optional
backup only**. OpenAI / Anthropic providers exist in `@copilot/llm-client`
(Sprint 1.2 T-1.2.6) for the user to switch in the settings panel, but
RAG never picks a non-local provider by default. The user must
explicitly opt in via settings.

---

## 9. Upgrade path (when better-sqlite3 unblocks)

When the host env supports building better-sqlite3 + sqlite-vss
(T-1.3.0b fix lands, or the user pulls Node 24 + Python setuptools), we
can introduce `SqliteVssVectorStore implements VectorStore` and route
`createVectorStore` to that impl. Callers only depend on the
`VectorStore` interface so this swap is local to packages/rag.

---

## 10. Failure taxonomy

| Failure | Behaviour |
|---|---|
| Ollama unreachable | Embedder throws (caller decides retry). Indexer catches per-chunk and records error. |
| Dimension mismatch | Embedder and VectorStore both throw immediately. Caller bug, do not catch. |
| Empty hits on retrieval | Answerer yields fallback string without calling LLM. |
| LLM stream error mid-flight | Answerer does NOT auto-retry (cf. @copilot/llm-client retry policy). Caller should wrap. |
| sql.js WASM missing | `loadSql()` rejects on first use. Operators must run `npm install` (sql.js bundles wasm). |
