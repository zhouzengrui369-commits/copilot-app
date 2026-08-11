import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
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

function textChunk(
  id: string,
  notePath: string,
  text: string,
  start = 0,
): EmbeddedChunk {
  return {
    id,
    notePath,
    ordinal: 0,
    text,
    tokenCount: text.split(/\s+/u).length,
    charRange: [start, start + text.length],
    embedding: new Float32Array([1, 0, 0, 0]),
    model: 'test-4d',
    embeddedAt: 0,
  };
}

async function consumeFinal(answerer: Answerer, query: string) {
  const chunks = [];
  const iterator = answerer.answer(query);
  let item = await iterator.next();
  while (!item.done) {
    chunks.push(item.value);
    item = await iterator.next();
  }
  return { chunks, result: item.value };
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

  it('keeps text-only updates durable and removes stale rows after delete/reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'copilot-rag-text-only-'));
    const dbPath = join(directory, 'rag.sqlite');
    const unavailableEmbedder = {
      modelId: 'offline-4d',
      embed: async () => {
        throw new TypeError('fetch failed');
      },
    } as unknown as Embedder;
    let store = await createVectorStore({ dbPath, dimensions: 4 });
    try {
      const indexer = new Indexer(unavailableEmbedder, store);
      const first = await indexer.indexOneNote({
        path: 'notes/offline',
        body: 'alpha old local text',
      });
      expect(first).toMatchObject({
        chunksInserted: 1,
        vectorChunksInserted: 0,
        vectorStatus: 'unavailable',
      });
      expect(store.listChunksForNote('notes/offline')[0]?.text)
        .toBe('alpha old local text');

      const second = await indexer.indexOneNote({
        path: 'notes/offline',
        body: 'beta replacement local text',
      });
      expect(second.chunksInserted).toBe(1);
      expect(store.textCount()).toBe(1);
      expect(store.vectorCount()).toBe(0);
      await store.close();

      store = await createVectorStore({ dbPath, dimensions: 4 });
      expect(store.listChunksForNote('notes/offline').map((item) => item.text))
        .toEqual(['beta replacement local text']);
      const answerer = new Answerer(
        unavailableEmbedder,
        store,
        async function* () {},
      );
      expect((await answerer.retrieve('alpha')).hits).toEqual([]);
      expect((await answerer.retrieve('beta')).hits.map((hit) => hit.chunk.notePath))
        .toEqual(['notes/offline']);

      await new Indexer(unavailableEmbedder, store).deleteNote('notes/offline');
      await store.close();
      store = await createVectorStore({ dbPath, dimensions: 4 });
      expect(store.listChunksForNote('notes/offline')).toEqual([]);
      expect(store.textCount()).toBe(0);
      expect(store.vectorCount()).toBe(0);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
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
      yield {
        content: 'answer (source: notes/a) and (source: notes/b)',
        finishReason: 'stop',
      };
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

describe('R2 real local-text fallback and grounding', () => {
  it('is deterministic with a real in-memory store and reports provider failure without sensitive text', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 4 });
    const longText = `alpha ${'x'.repeat(300)}`;
    await store.insert(textChunk('b0', 'notes/b', 'alpha beta', 5));
    await store.insert(textChunk('a0', 'notes/a', longText, 17));
    const providerError = new Error('private provider detail must not escape');
    const embedder = {
      embed: vi.fn(async () => { throw providerError; }),
    } as unknown as Embedder;
    const validStream: ChatStreamFactory = async function* () {
      yield { content: 'Grounded (source: notes/a)', finishReason: 'stop' };
    };
    const answerer = new Answerer(embedder, store, validStream, { topK: 5 });

    try {
      const first = await answerer.retrieve('alpha');
      const second = await answerer.retrieve('alpha');
      const stableProjection = (result: typeof first) => result.hits.map((hit) => ({
        path: hit.chunk.notePath,
        id: hit.chunk.id,
        score: hit.score,
        evidence: hit.evidence,
      }));

      expect(stableProjection(first)).toEqual(stableProjection(second));
      expect(first.hits.map((hit) => hit.chunk.notePath)).toEqual(['notes/a', 'notes/b']);
      expect(first.hits.every((hit) => hit.evidence?.includes('local-text'))).toBe(true);
      expect(first.mode).toBe('local-text');
      expect(first.providerStatus).toBe('failed');
      expect(first.diagnostics).toEqual([
        'RAG_PROVIDER_FAILURE',
        'RAG_LOCAL_TEXT_FALLBACK',
      ]);
      expect(first.diagnostics?.join(' ')).not.toContain(providerError.message);

      const noMatch = await answerer.retrieve('omega');
      expect(noMatch.hits).toEqual([]);
      expect(noMatch.mode).toBe('empty');
      expect(noMatch.diagnostics).toEqual([
        'RAG_PROVIDER_FAILURE',
        'RAG_LOCAL_TEXT_FALLBACK',
        'RAG_NO_CANDIDATE',
      ]);

      const grounded = await consumeFinal(answerer, 'alpha');
      expect(grounded.chunks).toHaveLength(1);
      expect(grounded.result.sources).toEqual(['notes/a']);
      expect(grounded.result.sourceDetails).toEqual([
        {
          notePath: 'notes/a',
          evidence: ['local-text'],
          score: 1,
          chunkId: 'a0',
          charRange: [17, 17 + longText.slice(0, 240).length],
          excerpt: longText.slice(0, 240),
          mode: 'local-text',
        },
      ]);
      expect(grounded.result.sourceDetails?.[0]?.excerpt.length).toBeLessThanOrEqual(240);
      expect(longText.startsWith(grounded.result.sourceDetails?.[0]?.excerpt ?? '')).toBe(true);
      const detail = grounded.result.sourceDetails?.[0];
      expect((detail?.charRange[1] ?? 0) - (detail?.charRange[0] ?? 0))
        .toBe(detail?.excerpt.length);
    } finally {
      await store.close();
    }
  });

  it('distinguishes provider unavailable, propagates abort, and fails closed on citation mismatch', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 4 });
    await store.insert(textChunk('a0', 'notes/a', 'alpha grounded text'));
    const unavailableEmbedder = {
      embed: vi.fn(async () => { throw new TypeError('fetch failed'); }),
    } as unknown as Embedder;
    const mismatchedStream: ChatStreamFactory = async function* () {
      yield { content: 'Hallucinated (source: notes/not-real)', finishReason: 'stop' };
    };
    const answerer = new Answerer(unavailableEmbedder, store, mismatchedStream);

    try {
      const retrieval = await answerer.retrieve('alpha');
      expect(retrieval.providerStatus).toBe('unavailable');
      expect(retrieval.diagnostics).toEqual([
        'RAG_PROVIDER_UNAVAILABLE',
        'RAG_LOCAL_TEXT_FALLBACK',
      ]);

      const controller = new AbortController();
      const reason = new Error('caller aborted');
      controller.abort(reason);
      await expect(answerer.retrieve('alpha', { signal: controller.signal })).rejects.toBe(reason);

      const failedClosed = await consumeFinal(answerer, 'alpha');
      expect(failedClosed.result.answer).toMatch(/核验/);
      expect(failedClosed.result.sources).toEqual([]);
      expect(failedClosed.result.sourceDetails).toEqual([]);
      expect(failedClosed.result.diagnostics).toEqual([
        'RAG_PROVIDER_UNAVAILABLE',
        'RAG_LOCAL_TEXT_FALLBACK',
        'RAG_CITATION_SOURCE_MISMATCH',
      ]);
      expect(failedClosed.chunks[0]?.citedSources).toEqual([]);
      expect(failedClosed.chunks[0]?.sourceDetails).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it('rethrows direct and wrapped embedder AbortError values with a real store', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 4 });
    await store.insert(textChunk('a0', 'notes/a', 'alpha grounded text'));
    const directAbort = new DOMException('provider aborted', 'AbortError');
    const wrappedAbort = Object.assign(new Error('wrapped provider abort'), {
      cause: directAbort,
    });
    const embedder = {
      embed: vi.fn()
        .mockRejectedValueOnce(directAbort)
        .mockRejectedValueOnce(wrappedAbort),
    } as unknown as Embedder;
    const answerer = new Answerer(embedder, store, async function* () {});

    try {
      await expect(answerer.retrieve('alpha')).rejects.toBe(directAbort);
      await expect(answerer.retrieve('alpha')).rejects.toBe(directAbort);
    } finally {
      await store.close();
    }
  });

  it('classifies an arbitrary embedder TypeError as provider failure with a real store', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 4 });
    await store.insert(textChunk('a0', 'notes/a', 'alpha grounded text'));
    const programmingError = new TypeError('local schema invariant failed');
    const embedder = {
      embed: vi.fn(async () => { throw programmingError; }),
    } as unknown as Embedder;
    const answerer = new Answerer(embedder, store, async function* () {});

    try {
      const retrieval = await answerer.retrieve('alpha');
      expect(retrieval.providerStatus).toBe('failed');
      expect(retrieval.diagnostics).toEqual([
        'RAG_PROVIDER_FAILURE',
        'RAG_LOCAL_TEXT_FALLBACK',
      ]);
      expect(retrieval.diagnostics).not.toContain('RAG_PROVIDER_UNAVAILABLE');
    } finally {
      await store.close();
    }
  });
});
