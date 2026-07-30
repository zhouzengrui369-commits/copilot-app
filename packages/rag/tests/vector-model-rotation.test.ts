import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createModelScopedVectorStore,
  type ModelScopedVectorStore,
} from '../src/model-scoped-vector-store.js';
import type { EmbeddedChunk, NoteChunk } from '../src/types.js';

const DIMENSIONS = 4;

function textChunk(notePath: string, ordinal: number, text: string): NoteChunk {
  return {
    id: `${notePath}#${ordinal}`,
    notePath,
    ordinal,
    text,
    tokenCount: text.length,
    charRange: [0, text.length],
  };
}

function vectorChunk(
  notePath: string,
  ordinal: number,
  text: string,
  model: string,
  values: readonly number[],
): EmbeddedChunk {
  return {
    ...textChunk(notePath, ordinal, text),
    embedding: Float32Array.from(values),
    model,
    embeddedAt: 1_700_000_000_000 + ordinal,
  };
}

describe('single-model vector-store rotation', () => {
  let store: ModelScopedVectorStore;

  beforeEach(async () => {
    store = await createModelScopedVectorStore({ dbPath: ':memory:', dimensions: DIMENSIONS });
  });

  afterEach(async () => {
    await store.close();
  });

  it('retains the existing SQL schema and exposes the model-scope contract', () => {
    expect(store.schemaVersion()).toBe('2');
    expect(store.modelScopeVersion()).toBe('1');
    expect(store.embeddingModel()).toBeNull();
  });

  it('clears incompatible vectors while retaining local text truth', async () => {
    const oldText = textChunk('notes/old', 0, 'legacy vector text');
    await store.replaceNoteIndex('notes/old', [oldText], [
      vectorChunk('notes/old', 0, oldText.text, 'ollama:bge-m3:1024', [1, 0, 0, 0]),
    ]);
    expect(store.embeddingModel()).toBe('ollama:bge-m3:1024');
    expect(store.vectorCount()).toBe(1);
    expect(store.textCount()).toBe(1);

    const nextText = textChunk('notes/new', 0, 'embedded local vector text');
    await store.replaceNoteIndex('notes/new', [nextText], [
      vectorChunk('notes/new', 0, nextText.text, 'embedded-local-hash-v1:4', [0, 1, 0, 0]),
    ]);

    expect(store.embeddingModel()).toBe('embedded-local-hash-v1:4');
    expect(store.vectorCount()).toBe(1);
    expect(store.textCount()).toBe(2);
    expect(store.listChunksForNote('notes/old')).toEqual([
      expect.objectContaining({
        id: 'notes/old#0',
        notePath: 'notes/old',
        text: 'legacy vector text',
        embedding: undefined,
        model: undefined,
      }),
    ]);
    expect(store.listChunksForNote('notes/new')).toEqual([
      expect.objectContaining({
        id: 'notes/new#0',
        model: 'embedded-local-hash-v1:4',
      }),
    ]);
  });

  it('rejects one note transaction containing multiple embedding models', async () => {
    const first = textChunk('notes/mixed', 0, 'first');
    const second = textChunk('notes/mixed', 1, 'second');
    await expect(store.replaceNoteIndex('notes/mixed', [first, second], [
      vectorChunk('notes/mixed', 0, first.text, 'model-a', [1, 0, 0, 0]),
      vectorChunk('notes/mixed', 1, second.text, 'model-b', [0, 1, 0, 0]),
    ])).rejects.toThrow(/single embedding model/u);
    expect(store.textCount()).toBe(0);
    expect(store.vectorCount()).toBe(0);
    expect(store.embeddingModel()).toBeNull();
  });
});
