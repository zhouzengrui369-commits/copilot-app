/**
 * Knowledge Graph type definitions (Sprint 1.2 T-1.2.1).
 *
 * Frozen cross-Sprint contract surface (see `SCHEMA-FROZEN-1.2.md` at end of
 * Sprint 1.2 wave 3). Sprint 1.2 T-1.2.2 (2D render), T-1.2.3 (note preview),
 * and Sprint 1.3 T-1.3.1 (RAG) consume these types.
 *
 * KG is 100% local (decision red line #2 in goal.md v6.2): the four tables
 * `kg_nodes` / `kg_edges` / `note_entities` / `kg_tags` all live in
 * `<userData>/kg.sqlite`. Extraction calls `@copilot/llm-client` directly
 * against the user's local MiniMax-M3 endpoint; nothing is sent to the
 * Tencent cloud server.
 */

// ---------- Entity ----------

/**
 * Entity taxonomy. LLM is asked to pick from this set; unrecognised labels
 * fall back to "concept".
 */
export type EntityType =
  | 'person'
  | 'org'
  | 'concept'
  | 'event'
  | 'place'
  | 'product'
  | 'document'
  | 'topic'
  | 'other';

export interface Entity {
  /** Auto-increment surrogate key (PK in SQLite). */
  id: number;
  /**
   * Stable id assigned by the LLM (e.g. "person:张三"). UNIQUE.
   * Sprint 1.2 builders must normalise: lowercase + collapse whitespace
   * + type prefix to enable cross-note entity merge.
   */
  entity_id: string;
  type: EntityType;
  name: string;
  /** JSON array of alternative spellings/nicknames. */
  aliases: string[];
  /** LLM-generated short summary (≤ 60 chars; filled by `Summarizer`). */
  summary: string | null;
  /** LLM confidence 0..1 (entities with conf < 0.5 dropped at ingest). */
  confidence: number | null;
  /** JSON array of note paths that mention this entity. */
  source_notes: string[];
  created_at: number;
  updated_at: number;
}

export interface EntityInput {
  entity_id: string;
  type: EntityType | string; // allow string during ingest, then validate
  name: string;
  aliases?: string[];
  summary?: string | null;
  confidence?: number | null;
  source_note: string; // required for note_entities back-link
}

// ---------- Relation ----------

/** Relation labels follow a small closed-set prompt with `other` fallback. */
export type RelationType =
  | 'works_at'
  | 'founded'
  | 'located_in'
  | 'part_of'
  | 'related_to'
  | 'depends_on'
  | 'cites'
  | 'follows_up'
  | 'defines'
  | 'mentions'
  | 'tagged_with'
  | 'attends'
  | 'created_by'
  | 'other';

export interface Relation {
  /** Auto-increment surrogate key. */
  id: number;
  from_entity_id: string;
  to_entity_id: string;
  rel: RelationType | string;
  weight: number | null; // 0..1
  /** JSON array of note paths supporting this relation. */
  evidence: string[];
  created_at: number;
}

export interface RelationInput {
  from_entity_id: string;
  to_entity_id: string;
  rel: string;
  weight?: number | null;
  evidence_note: string;
}

// ---------- Tag ----------

export interface Tag {
  id: number;
  name: string;
  note_count: number;
  created_at: number;
}

export interface TagInput {
  name: string;
  /** Optional — defaults to 1; only used when first inserted. */
  note_count?: number;
}

// ---------- Note ↔ Entity bridge ----------

export interface NoteEntityLink {
  note_path: string;
  entity_id: string;
}

// ---------- Builder orchestration ----------

export interface KgBuildOptions {
  /** Limit notes drained per run. Default: 50. */
  maxNotes?: number;
  /** Skip LLM extractors (only re-derive local projections). Default: false. */
  skipLlm?: boolean;
  /** Per-note timeout in ms. Default 30_000. */
  perNoteTimeoutMs?: number;
}

export interface KgBuildError {
  note_path: string;
  stage: 'entity' | 'relation' | 'tag' | 'summary' | 'commit';
  message: string;
}

export interface KgBuildResult {
  /** Notes successfully processed this run. */
  processed: number;
  /** Notes that failed; surfaced for visibility without aborting. */
  failed: { path: string; reason: string }[];
  /** Net new entities inserted. */
  entitiesAdded: number;
  /** Net new relations inserted. */
  relationsAdded: number;
  /** Net new tag rows touched. */
  tagsAdded: number;
  /** Total wall-clock ms for the run. */
  elapsedMs: number;
  /** Total persisted graph size after the run. */
  nodeCount: number;
  edgeCount: number;
}

/** Stable note shape accepted by the production KG builder. */
export interface KgNoteInput {
  path: string;
  title: string;
  body: string;
  tags?: string[];
  related?: string[];
  metadata?: Record<string, unknown>;
}

export interface KgNoteBuildResult extends IncrementalStats {
  entitiesTotal: number;
  relationsTotal: number;
  tagsTotal: number;
}

/** Storage-agnostic seam used by the optional pending-queue builder. */
export interface KgKnowledgeSource {
  listKgPending(status: 'pending'): Array<{
    note_path: string;
    status: 'pending' | 'processing' | 'done' | 'failed';
    queued_at: number;
  }>;
  setKgStatus(path: string, status: 'processing' | 'done' | 'failed'): void;
  readNote(path: string): {
    note: { path: string; title: string; tags: string[]; related: string[] };
    body: string;
  } | null;
}

// ---------- Incremental runner ----------

export interface IncrementalStats {
  note_path: string;
  entitiesAdded: number;
  relationsAdded: number;
  tagsTouched: number;
  elapsedMs: number;
  status: 'done' | 'failed';
  reason?: string;
}

// ---------- Query API ----------

export interface QueryRequest {
  /** Center entity_id; expands neighbours by `hops` edges. */
  center: string;
  /** BFS depth: 1 (direct), 2 (friend-of-friend), max 3. */
  hops?: number;
  /** Optional filter: only include entities whose type ∈ set. */
  types?: EntityType[];
  /** Cap on returned nodes; default 1000. */
  maxNodes?: number;
}

export interface SearchNodesOptions {
  type?: EntityType;
  limit?: number;
}

export interface Subgraph {
  nodes: Entity[];
  edges: Relation[];
  /** entity_id → 1..N; useful for layout & centrality. */
  degree: Record<string, number>;
}

export interface QueryResult {
  nodes: Entity[];
  edges: Relation[];
}
