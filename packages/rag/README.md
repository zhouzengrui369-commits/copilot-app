# `@copilot/rag`

Current authority for the Phase 1 RAG runtime is the source in this package plus the root v6.2 baseline. `SCHEMA-FROZEN-1.2.md` remains the historical additive storage contract; this document records the later provider/runtime amendment without rewriting that history.

## Production default

`new Embedder()` uses `embedded-local-hash-v1`:

- deterministic character/word n-gram hashing;
- 1024 dimensions by default;
- no HTTP request, process spawn, native addon, model download, cloud fallback, or external local service;
- stable model identity `embedded-local-hash-v1:<dimensions>`;
- stable implementation revision `char-word-ngram-v1`.

This is a retrieval embedding adapter, not a replacement for the separately configured MiniMax answer-generation provider. Notes, chunks, vectors, answers, and sources remain local product data.

## Explicit Ollama compatibility

Ollama remains available only when `provider: 'ollama'` is selected or legacy Ollama-specific fields such as `baseUrl`, `model`, `timeoutMs`, or `fetchImpl` are supplied. It is classified as a `local-service` dependency and is not required by the packaged default.

## Model-scoped persistence

The public `createVectorStore` factory wraps the existing sql.js text/vector store with a single-model invariant:

- vectors from different embedding models are never mixed;
- switching model identity removes incompatible vector rows;
- durable local text rows are retained for deterministic local-text fallback and re-indexing;
- the existing SQL schema and `schemaVersion()` remain unchanged;
- `modelScopeVersion()` identifies the wrapper contract.

## Verification

Focused source contracts:

```bash
npm run test --workspace @copilot/rag -- \
  tests/embedded-local-provider.test.ts \
  tests/vector-model-rotation.test.ts
```

Full source gates continue to require package check, unit/integration tests, strict global/critical coverage, ordered workspace builds, desktop build, and exact list-only Electron discovery. Packaged Electron runtime proof remains a later MiniMax/Codex candidate-bound gate.
