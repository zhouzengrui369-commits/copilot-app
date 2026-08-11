import type {
  EmbeddedChunk,
  NoteChunk,
  RetrievalResult,
  StoredChunk,
  VectorSearchOptions,
  VectorStoreConfig,
} from './types.js';
import {
  createVectorStore as createRawVectorStore,
  type VectorStore as RawVectorStore,
} from './vector-store.js';

const MODEL_SCOPE_VERSION = '1';
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_EXPECTED_MODEL_PREFIX = 'embedded-local-hash-v1';

/**
 * Production-facing vector store contract.
 *
 * The underlying sql.js store remains the durable text/vector engine. This
 * wrapper adds one fail-closed invariant: a database may contain vectors from
 * exactly one embedding model. When the packaged default changes, incompatible
 * vectors are removed while `text_chunks` remain intact for deterministic
 * local-text retrieval and later re-indexing.
 */
export interface ModelScopedVectorStore extends RawVectorStore {
  /** wrapper contract version; independent from the underlying SQL schema */
  modelScopeVersion(): string;
  /** active vector model or null when only durable text is present */
  embeddingModel(): string | null;
}

export async function createModelScopedVectorStore(
  config: VectorStoreConfig = {},
): Promise<ModelScopedVectorStore> {
  const raw = await createRawVectorStore(config);
  const expected = config.expectedEmbeddingModel
    ?? `${DEFAULT_EXPECTED_MODEL_PREFIX}:${config.dimensions ?? DEFAULT_DIMENSIONS}`;
  const store = new ModelScopedStore(raw, expected);
  await store.reconcilePersistedModel();
  return store;
}

class ModelScopedStore implements ModelScopedVectorStore {
  private activeModel: string | null = null;

  constructor(
    private readonly raw: RawVectorStore,
    private readonly expectedModel: string,
  ) {}

  async reconcilePersistedModel(): Promise<void> {
    const models = this.collectModels();
    if (models.size === 0) {
      this.activeModel = null;
      return;
    }
    if (models.size === 1 && models.has(this.expectedModel)) {
      this.activeModel = this.expectedModel;
      return;
    }
    await this.clearAllVectorsPreservingText();
    this.activeModel = null;
  }

  modelScopeVersion(): string {
    return MODEL_SCOPE_VERSION;
  }

  embeddingModel(): string | null {
    return this.activeModel;
  }

  async close(): Promise<void> {
    await this.raw.close();
  }

  async insert(chunk: EmbeddedChunk): Promise<void> {
    await this.rotateForModel(chunk.model);
    await this.raw.insert(chunk);
    this.activeModel = chunk.model;
  }

  async insertMany(chunks: readonly EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return this.raw.insertMany(chunks);
    const model = requireSingleModel(chunks);
    await this.rotateForModel(model);
    await this.raw.insertMany(chunks);
    this.activeModel = model;
  }

  async replaceNote(notePath: string, chunks: readonly EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) {
      await this.raw.replaceNote(notePath, chunks);
      if (this.raw.vectorCount() === 0) this.activeModel = null;
      return;
    }
    const model = requireSingleModel(chunks);
    await this.rotateForModel(model);
    await this.raw.replaceNote(notePath, chunks);
    this.activeModel = model;
  }

  async replaceNoteIndex(
    notePath: string,
    textChunks: readonly NoteChunk[],
    vectorChunks: readonly EmbeddedChunk[],
  ): Promise<void> {
    if (vectorChunks.length === 0) {
      await this.raw.replaceNoteIndex(notePath, textChunks, vectorChunks);
      if (this.raw.vectorCount() === 0) this.activeModel = null;
      return;
    }
    const model = requireSingleModel(vectorChunks);
    await this.rotateForModel(model);
    await this.raw.replaceNoteIndex(notePath, textChunks, vectorChunks);
    this.activeModel = model;
  }

  async deleteNote(notePath: string): Promise<void> {
    await this.raw.deleteNote(notePath);
    if (this.raw.vectorCount() === 0) this.activeModel = null;
  }

  search(
    queryEmbedding: Float32Array,
    options?: VectorSearchOptions,
  ): Promise<RetrievalResult> {
    return this.raw.search(queryEmbedding, options);
  }

  count(): number {
    return this.raw.count();
  }

  textCount(): number {
    return this.raw.textCount();
  }

  vectorCount(): number {
    return this.raw.vectorCount();
  }

  listNotePaths(): string[] {
    return this.raw.listNotePaths();
  }

  listChunksForNote(notePath: string): StoredChunk[] {
    return this.raw.listChunksForNote(notePath);
  }

  schemaVersion(): string {
    return this.raw.schemaVersion();
  }

  private collectModels(): Set<string> {
    const models = new Set<string>();
    for (const notePath of this.raw.listNotePaths()) {
      for (const chunk of this.raw.listChunksForNote(notePath)) {
        if (typeof chunk.model === 'string' && chunk.model.length > 0) models.add(chunk.model);
      }
    }
    return models;
  }

  private async rotateForModel(nextModel: string): Promise<void> {
    if (!nextModel.trim()) throw new Error('ModelScopedVectorStore: embedding model is required');
    if (this.activeModel === null || this.activeModel === nextModel) return;
    await this.clearAllVectorsPreservingText();
    this.activeModel = null;
  }

  private async clearAllVectorsPreservingText(): Promise<void> {
    for (const notePath of this.raw.listNotePaths()) {
      const textChunks = this.raw.listChunksForNote(notePath).map(stripVector);
      await this.raw.replaceNoteIndex(notePath, textChunks, []);
    }
  }
}

function requireSingleModel(chunks: readonly EmbeddedChunk[]): string {
  const models = new Set(chunks.map((chunk) => chunk.model));
  if (models.size !== 1) {
    throw new Error('ModelScopedVectorStore: one transaction must use a single embedding model');
  }
  const model = [...models][0];
  if (!model?.trim()) throw new Error('ModelScopedVectorStore: embedding model is required');
  return model;
}

function stripVector(chunk: StoredChunk): NoteChunk {
  return {
    id: chunk.id,
    notePath: chunk.notePath,
    ordinal: chunk.ordinal,
    text: chunk.text,
    tokenCount: chunk.tokenCount,
    charRange: [...chunk.charRange] as [number, number],
  };
}
