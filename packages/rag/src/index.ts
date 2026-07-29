/**
 * @copilot/rag — Public API surface (Sprint 1.3 T-1.3.1 worker β).
 *
 * Frozen cross-package contract (see SCHEMA-FROZEN-1.2.md at end of wave 3):
 *   - `Embedder`               — Ollama HTTP embedding wrapper (bge-m3 default)
 *   - `VectorStore` / `createVectorStore` — sql.js + brute-force cosine
 *                                          (sqlite-vss upgrade path documented)
 *   - `chunkNote`              — 512-token paragraph-bound chunker
 *   - `Indexer`                — chunk + embed + insert pipeline
 *   - `Answerer`               — retrieval → LLM answer with note_path citations
 *
 * RAG is 100% local (goal.md R5 + decision red line #2):
 *   - Embedding runs against the user's local Ollama endpoint
 *     (default http://127.0.0.1:11434, bge-m3:latest, 1024 dim).
 *   - LLM answer streaming goes through `@copilot/llm-client`
 *     (default provider = local MiniMax-M3 endpoint); cloud OpenAI / Claude
 *     are configurable via Sprint 1.2 settings panel but **never** the
 *     default RAG path.
 *
 * Usage:
 *   import { Embedder, createVectorStore, Indexer, Answerer } from '@copilot/rag';
 *   import { LLMClient } from '@copilot/llm-client';
 *
 *   const embedder = new Embedder();
 *   const store = await createVectorStore({ dbPath: '/abs/.cache/rag.db' });
 *   const indexer = new Indexer(embedder, store);
 *   await indexer.indexNotes([
 *     { path: 'inbox/quick', body: 'OPC 是 ...' },
 *   ]);
 *
 *   const client = new LLMClient();
 *   const answerer = new Answerer(embedder, store, async (messages, { model }) =>
 *     client.chatStream({ model, messages, stream: true }),
 *   );
 *
 *   let final;
 *   for await (const delta of answerer.answer('OPC 是什么')) {
 *     process.stdout.write(delta.delta);
 *     final = delta;
 *   }
 *   console.log('sources:', final.citedSources);
 */

export { Embedder } from './embedder.js';

export {
  createVectorStore,
  generateChunkId,
  type VectorStore,
} from './vector-store.js';

export type {
  EmbedderConfig,
  VectorStoreConfig,
  VectorSearchOptions,
} from './types.js';

export {
  chunkNote,
  estimateTokens,
  type ChunkerConfig,
} from './chunker.js';

export {
  Indexer,
  type IndexerOptions,
  type IndexerReport,
  type NoteInput,
} from './indexer.js';

export {
  Answerer,
  fuseRetrievalHits,
  type AnswerOptions,
  type AnswererConfig,
  type AnswererStreamChunk,
  type ChatStreamFactory,
} from './answerer.js';

export type {
  NoteChunk,
  EmbeddedChunk,
  StoredChunk,
  RetrievalHit,
  RetrievalEvidence,
  RetrievalMode,
  ProviderStatus,
  RagDiagnosticCode,
  RetrievalResult,
  RagSourceDetail,
  RagAnswerChunk,
  RagAnswerResult,
} from './types.js';
