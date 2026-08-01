/**
 * @copilot/rag — Core types for local-first RAG.
 *
 * Sprint 1.3 T-1.3.1 (worker β). Frozen schema for Sprint 1.2 (notes /
 * note_links / kg_pending / todos) is NOT modified — only additive RAG
 * tables (chunks, rag_index_meta) are introduced inside rag.db.
 */

export interface NoteChunk {
  /** chunk id (uuid v4); primary key inside rag.db.chunks */
  id: string;
  /** note_path of the source note (Sprint 1.2 schema, KB notes.id) */
  notePath: string;
  /** chunk ordinal within the note (0-based) */
  ordinal: number;
  /** chunk text (≤ 512 tokens, paragraph-bounded) */
  text: string;
  /** token count (rough, whitespace-split heuristic) */
  tokenCount: number;
  /** char offsets [start, end] within the source note body */
  charRange: [number, number];
}

export interface EmbeddedChunk extends NoteChunk {
  /** dense embedding produced by the selected local provider */
  embedding: Float32Array;
  /** stable embedding model id, including provider/dimension identity */
  model: string;
  /** unix-ms timestamp of embedding */
  embeddedAt: number;
}

/**
 * Durable local-text row. Vector metadata is present only when the same chunk
 * also has a successfully persisted embedding; text-only rows never receive a
 * sentinel vector.
 */
export interface StoredChunk extends NoteChunk {
  embedding?: Float32Array;
  model?: string;
  embeddedAt?: number;
}

/**
 * One chunk returned by retrieval — chunk + similarity score + which note it
 * came from. The notePath field is what we surface to the UI as the citation
 * (goal.md R5 "sources 显示").
 */
export interface RetrievalHit {
  chunk: NoteChunk;
  /** cosine similarity in [-1, 1] */
  score: number;
  /** Why this note was selected. */
  evidence?: RetrievalEvidence[];
}

/**
 * Retrieval provenance enum — surfaces WHY a chunk landed in the candidate
 * set. RAG R2 adds `local-text` to distinguish the deterministic indexed text
 * fallback from vector and KG signals.
 */
export type RetrievalEvidence =
  | 'vector'
  | 'kg-entity'
  | 'kg-neighbor'
  | 'local-text';

/** Stable, non-sensitive diagnostics safe for renderer/log surfaces. */
export type RagDiagnosticCode =
  | 'RAG_VECTOR'
  | 'RAG_LOCAL_TEXT_FALLBACK'
  | 'RAG_KG_SUPPLEMENTAL'
  | 'RAG_PROVIDER_UNAVAILABLE'
  | 'RAG_PROVIDER_FAILURE'
  | 'RAG_VECTOR_INDEX_DEGRADED'
  | 'RAG_NO_CANDIDATE'
  | 'RAG_CITATION_SOURCE_MISMATCH';

export type RetrievalMode = 'vector' | 'local-text' | 'kg' | 'empty';
export type ProviderStatus = 'ok' | 'degraded' | 'unavailable' | 'failed';

/** The packaged default is embedded-local. Ollama remains explicit opt-in. */
export type EmbeddingProviderKind = 'embedded-local' | 'ollama';
export type EmbeddingPrivacyClass = 'embedded-local' | 'local-service';
export type EmbeddingHealthStatus = 'ok' | 'configured' | 'unavailable' | 'failed';

export interface EmbeddingHealth {
  status: EmbeddingHealthStatus;
  providerId: string;
  dimensions: number;
  modelRevision: string;
  privacyClass: EmbeddingPrivacyClass;
}

/** Narrow provider interface shared by indexing and retrieval. */
export interface EmbeddingProvider {
  readonly providerId: string;
  readonly dimensions: number;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly privacyClass: EmbeddingPrivacyClass;
  health(): Promise<EmbeddingHealth>;
  embed(text: string, signal?: AbortSignal): Promise<Float32Array>;
  embedAll(texts: readonly string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

export interface RagSourceDetail {
  notePath: string;
  evidence: RetrievalEvidence[];
  score: number;
  chunkId: string;
  charRange: [number, number];
  excerpt: string;
  mode: RetrievalMode;
}

export interface RetrievalResult {
  query: string;
  queryEmbedding: Float32Array;
  hits: RetrievalHit[];
  /** total candidates considered before top-k selection */
  candidates: number;
  mode?: RetrievalMode;
  providerStatus?: ProviderStatus;
  diagnostics?: RagDiagnosticCode[];
}

export interface RagAnswerChunk {
  delta: string;
  citedSources: string[];
  sourceDetails?: RagSourceDetail[];
  retrievalMode?: RetrievalMode;
  providerStatus?: ProviderStatus;
  diagnostics?: RagDiagnosticCode[];
}

export interface RagAnswerResult {
  query: string;
  answer: string;
  sources: string[];
  sourceDetails?: RagSourceDetail[];
  totalChars: number;
  retrievalMode?: RetrievalMode;
  providerStatus?: ProviderStatus;
  diagnostics?: RagDiagnosticCode[];
}

export interface EmbedderConfig {
  /** Default is embedded-local; Ollama must be selected or inferred explicitly. */
  provider?: EmbeddingProviderKind;
  /** Ollama HTTP endpoint, default http://127.0.0.1:11434. */
  baseUrl?: string;
  /** Ollama model id. Supplying this without provider infers Ollama compatibility mode. */
  model?: string;
  /** Stable implementation/model revision for evidence and migration. */
  modelRevision?: string;
  /** Ollama request timeout in ms, default 8000. */
  timeoutMs?: number;
  /** Fetch implementation for explicit Ollama mode and tests. */
  fetchImpl?: typeof fetch;
  /** Expected vector dimension. Embedded-local defaults to 1024. */
  dimensions?: number;
}

export interface VectorStoreConfig {
  /** sqlite db file path, default ":memory:" */
  dbPath?: string;
  /** embedding dimensions; production default is 1024 */
  dimensions?: number;
  /**
   * Expected packaged model. Existing incompatible vector rows are invalidated
   * while durable text rows remain available for local-text retrieval.
   */
  expectedEmbeddingModel?: string;
}

export interface VectorSearchOptions {
  /** top-k, default 5 */
  topK?: number;
  /** cosine similarity floor in [-1, 1], default -1 */
  minScore?: number;
}
