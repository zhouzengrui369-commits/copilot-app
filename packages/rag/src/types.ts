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
  /** dense embedding (mxbai-embed-large → 1024 dims) */
  embedding: Float32Array;
  /** embedding model id (e.g. "mxbai-embed-large") */
  model: string;
  /** unix-ms timestamp of embedding */
  embeddedAt: number;
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

export type RetrievalEvidence = 'vector' | 'kg-entity' | 'kg-neighbor';

export interface RagSourceDetail {
  notePath: string;
  evidence: RetrievalEvidence[];
  score: number;
}

export interface RetrievalResult {
  query: string;
  queryEmbedding: Float32Array;
  hits: RetrievalHit[];
  /** total candidates considered before top-k selection (for diagnostics) */
  candidates: number;
}

export interface RagAnswerChunk {
  /** delta token from the streaming LLM (already a string fragment) */
  delta: string;
  /** which sources are cited so far (notePaths surfaced from the retrieval pass) */
  citedSources: string[];
  sourceDetails?: RagSourceDetail[];
}

export interface RagAnswerResult {
  query: string;
  /** final assembled answer */
  answer: string;
  /** unique note paths cited (deduped, stable order) */
  sources: string[];
  sourceDetails?: RagSourceDetail[];
  /** total tokens streamed (rough estimate) */
  totalChars: number;
}

export interface EmbedderConfig {
  /** Ollama HTTP endpoint, default http://127.0.0.1:11434 */
  baseUrl?: string;
  /** Embedding model id, default "bge-m3:latest" (1024 dims) */
  model?: string;
  /** request timeout in ms, default 8000 */
  timeoutMs?: number;
  /** fetch implementation (for tests); default globalThis.fetch */
  fetchImpl?: typeof fetch;
  /**
   * Override expected embedding dim. Default 1024. Must match the actual
   * model output — used to validate Ollama responses. Set this when
   * using a non-default model with a different dim (e.g. nomic-embed-text
   * → 768).
   */
  dimensions?: number;
}

export interface VectorStoreConfig {
  /** sqlite db file path, default ":memory:" — persistent store is ".rag.db" in caller cwd */
  dbPath?: string;
  /** embedding dimensions; default 1024 (mxbai-embed-large) */
  dimensions?: number;
}

export interface VectorSearchOptions {
  /** top-k, default 5 (Sprint 1.3 acceptance) */
  topK?: number;
  /** cosine similarity floor in [-1, 1], default -1 (no filter) */
  minScore?: number;
}
