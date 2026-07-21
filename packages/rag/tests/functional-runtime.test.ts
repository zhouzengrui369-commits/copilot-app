import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { Answerer, fuseRetrievalHits, type ChatStreamFactory } from '../src/answerer.js';
import type { Embedder } from '../src/embedder.js';
import { Indexer } from '../src/indexer.js';
import { createVectorStore, type VectorStore } from '../src/vector-store.js';
import type { EmbeddedChunk, RetrievalHit } from '../src/types.js';

function chunk(id: string, notePath: string, ordinal: number, value = 1): EmbeddedChunk {
  return {
    id,
    notePath,
    ordinal,
    text: `${notePath}:${ordinal}`,
    tokenCount: 1,
    charRange: [0, 4],
    embedding: new Float32Array([value, 0, 0, 0]),
    model: 'test-4d',
    embeddedAt: ordinal,
  };
}

describe('persistent note-scoped RAG mutations', () => {
  it('atomically replaces, lists, deletes, and persists a note before close', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'copilot-rag-'));
    const dbPath = join(directory, 'rag.sqlite');
    const store = await createVectorStore({ dbPath, dimensions: 4 });
    try {
      await store.replaceNote('notes/a', [chunk('a0', 'notes/a', 0), chunk('a1', 'notes/a', 1)]);
      await store.insert(chunk('b0', 'notes/b', 0));
      expect(store.listChunksForNote('notes/a').map((item) => item.id)).toEqual(['a0', 'a1']);

      await store.replaceNote('notes/a', [chunk('a2', 'notes/a', 0)]);
      expect(store.listChunksForNote('notes/a').map((item) => item.id)).toEqual(['a2']);

      const concurrentlyOpened = await createVectorStore({ dbPath, dimensions: 4 });
      expect(concurrentlyOpened.listNotePaths()).toEqual(['notes/a', 'notes/b']);
      expect(concurrentlyOpened.listChunksForNote('notes/a')[0]).toEqual(
        expect.objectContaining({ id: 'a2', model: 'test-4d' }),
      );
      await concurrentlyOpened.close();

      await store.deleteNote('notes/a');
      expect(store.listChunksForNote('notes/a')).toEqual([]);
      expect(store.listNotePaths()).toEqual(['notes/b']);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects mismatched note ownership and duplicate ids without deleting the old note', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 4 });
    await store.replaceNote('notes/a', [chunk('old', 'notes/a', 0)]);
    await expect(store.replaceNote('notes/a', [chunk('wrong', 'notes/b', 0)]))
      .rejects.toThrow(/does not match/);
    await expect(store.replaceNote('notes/a', [
      chunk('dup', 'notes/a', 0), chunk('dup', 'notes/a', 1),
    ])).rejects.toThrow(/duplicate/);
    expect(store.listChunksForNote('notes/a').map((item) => item.id)).toEqual(['old']);
    await expect(store.deleteNote(' ')).rejects.toThrow(/required/);
    await store.close();
  });

  it('re-indexes by replacement and exposes Indexer.deleteNote', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 4 });
    const fakeEmbedder = {
      modelId: 'fake-4d',
      embed: async () => new Float32Array([1, 0, 0, 0]),
    } as unknown as Embedder;
    const indexer = new Indexer(fakeEmbedder, store);
    const first = await indexer.indexOneNote({ path: 'notes/a', title: 'A', body: 'one\n\ntwo' });
    expect(first.chunksInserted).toBeGreaterThan(0);
    const originalText = store.listChunksForNote('notes/a').map((item) => item.text);
    const second = await indexer.indexOneNote({ path: 'notes/a', title: 'A2', body: 'replacement' });
    expect(second.chunksInserted).toBe(1);
    expect(store.listChunksForNote('notes/a')).toHaveLength(1);
    expect(store.listChunksForNote('notes/a').map((item) => item.text)).not.toEqual(originalText);
    expect(store.listChunksForNote('notes/a')[0]?.text).toBe('replacement');
    await indexer.deleteNote('notes/a');
    expect(store.listChunksForNote('notes/a')).toEqual([]);
    await store.close();
  });
});

describe('aligned vector and KG source evidence', () => {
  it('deduplicates per note, merges evidence, and ranks deterministically', () => {
    const vector: RetrievalHit[] = [
      { chunk: chunk('v-a', 'notes/a', 1), score: 0.7, evidence: ['vector'] },
      { chunk: chunk('v-b', 'notes/b', 0), score: 0.8, evidence: ['vector'] },
    ];
    const kg: RetrievalHit[] = [
      { chunk: chunk('kg-a', 'notes/a', 0), score: 0.9, evidence: ['kg-entity'] },
      { chunk: chunk('kg-c', 'notes/c', 0), score: 0.6, evidence: ['kg-neighbor'] },
    ];
    const fused = fuseRetrievalHits(vector, kg, 3);
    expect(fused.map((hit) => hit.chunk.notePath)).toEqual(['notes/a', 'notes/b', 'notes/c']);
    expect(fused[0]?.evidence).toEqual(['vector', 'kg-entity']);
  });

  it('answers from KG-only supplemental hits without invoking embedding and keeps source arrays aligned', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 4 });
    const embedder = {
      embed: async () => { throw new Error('embedding should not be called for KG-only retrieval'); },
    } as unknown as Embedder;
    const stream: ChatStreamFactory = async function* () {
      yield { content: 'answer' };
    };
    const answerer = new Answerer(embedder, store, stream, { topK: 2 });
    const supplementalHits: RetrievalHit[] = [
      { chunk: chunk('kg-b', 'notes/b', 0), score: 0.7, evidence: ['kg-neighbor'] },
      { chunk: chunk('kg-a', 'notes/a', 0), score: 0.9, evidence: ['kg-entity'] },
    ];
    const iterator = answerer.answer('who?', { supplementalHits });
    let item = await iterator.next();
    expect(item.done).toBe(false);
    if (!item.done) {
      expect(item.value.citedSources).toEqual(['notes/a', 'notes/b']);
      expect(item.value.sourceDetails?.map((source) => source.notePath))
        .toEqual(item.value.citedSources);
    }
    item = await iterator.next();
    expect(item.done).toBe(true);
    if (item.done) {
      expect(item.value.sources).toEqual(['notes/a', 'notes/b']);
      expect(item.value.sourceDetails?.map((source) => source.notePath))
        .toEqual(item.value.sources);
    }
    await store.close();
  });
});
