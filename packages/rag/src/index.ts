/**
 * @copilot/rag — public local-first RAG surface.
 *
 * Production now defaults to an embedded, deterministic no-egress provider.
 * Ollama remains an explicit local-service compatibility option. The exported
 * vector-store factory enforces one embedding model at a time while retaining
 * durable local text for fallback/re-indexing.
 */

export { Embedder } from './embedder.js';

export {
  createModelScopedVectorStore as createVectorStore,
  type ModelScopedVectorStore as VectorStore,
} from './model-scoped-vector-store.js';

export { generateChunkId } from './vector-store.js';

export type {
  EmbedderConfig,
  EmbeddingHealth,
  EmbeddingHealthStatus,
  EmbeddingPrivacyClass,
  EmbeddingProvider,
  EmbeddingProviderKind,
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
