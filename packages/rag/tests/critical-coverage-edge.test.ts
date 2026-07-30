import { describe, expect, it, vi } from 'vitest';
import { Answerer, type ChatStreamFactory } from '../src/answerer.js';
import type { Embedder } from '../src/embedder.js';
import { Indexer } from '../src/indexer.js';
import { createVectorStore, type VectorStore } from '../src/vector-store.js';
import type { EmbeddedChunk, RetrievalHit } from '../src/types.js';

function supplementalHit(evidence: RetrievalHit['evidence']): RetrievalHit {
  const text = 'locally grounded edge evidence';
  return {
    chunk: {
      id: 'notes/edge#0',
      notePath: 'notes/edge',
      ordinal: 0,
      text,
      tokenCount: 4,
      charRange: [0, text.length],
    },
    score: 0.9,
    evidence,
  };
}

function supplementalAnswerer(
  factory: ChatStreamFactory,
  language: 'zh' | 'en' = 'zh',
): Answerer {
  const embedder = { embed: vi.fn() } as unknown as Embedder;
  const store = {
    textCount: vi.fn(() => 0),
    count: vi.fn(() => 0),
  } as unknown as VectorStore;
  return new Answerer(embedder, store, factory, { language });
}

async function consume(
  answerer: Answerer,
  options: { supplementalHits: RetrievalHit[] },
) {
  const iterator = answerer.answer('edge question', options);
  const deltas: string[] = [];
  let item = await iterator.next();
  while (!item.done) {
    deltas.push(item.value.delta);
    item = await iterator.next();
  }
  return { deltas, result: item.value };
}

function failingEmbedder(errorSequence: readonly unknown[]): Embedder {
  let call = 0;
  return {
    modelId: 'critical-edge-8d',
    embed: vi.fn(async () => {
      const error = errorSequence[Math.min(call, errorSequence.length - 1)];
      call += 1;
      throw error;
    }),
  } as unknown as Embedder;
}

function vector(id = 'edge#0'): EmbeddedChunk {
  return {
    id,
    notePath: 'notes/edge',
    ordinal: 0,
    text: 'edge',
    tokenCount: 1,
    charRange: [0, 4],
    embedding: Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0]),
    model: 'critical-edge-8d',
    embeddedAt: 1,
  };
}

describe('Answerer critical branches', () => {
  it('reports an empty source mode when a valid citation has no evidence classification', async () => {
    const answerer = supplementalAnswerer(async function* () {
      yield { content: 'grounded (source: notes/edge)', finishReason: 'stop' };
    });

    const output = await consume(answerer, { supplementalHits: [supplementalHit([])] });

    expect(output.result.sources).toEqual(['notes/edge']);
    expect(output.result.sourceDetails).toEqual([
      expect.objectContaining({
        notePath: 'notes/edge',
        evidence: [],
        mode: 'empty',
      }),
    ]);
  });

  it('returns the exact English grounding failure when a completed answer is uncited', async () => {
    const answerer = supplementalAnswerer(async function* () {
      yield { content: 'unsupported answer', finishReason: 'stop' };
    }, 'en');

    const output = await consume(answerer, {
      supplementalHits: [supplementalHit(['kg-entity'])],
    });

    expect(output.deltas).toEqual([
      'No verifiable answer could be produced from the local notes.',
    ]);
    expect(output.result.sources).toEqual([]);
    expect(output.result.diagnostics).toContain('RAG_CITATION_SOURCE_MISMATCH');
  });
});

describe('Indexer provider classification branches', () => {
  it('classifies a non-Error embedding rejection as a provider failure and preserves text truth', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 8 });
    try {
      const report = await new Indexer(failingEmbedder(['plain provider failure']), store)
        .indexOneNote({ path: 'notes/plain', body: 'plain provider failure body' });

      expect(report.vectorStatus).toBe('failed');
      expect(report.vectorChunksInserted).toBe(0);
      expect(report.chunksInserted).toBe(1);
      expect(report.errors[0]?.reason).toBe('plain provider failure');
      expect(store.textCount()).toBe(1);
    } finally {
      await store.close();
    }
  });

  it('recognizes unavailable providers through top-level and nested names, codes, and messages', async () => {
    const unavailableErrors = [
      { name: 'NetworkError' },
      { cause: { name: 'NetworkError' } },
      { name: 'ProviderUnavailableError' },
      { cause: { name: 'ProviderUnavailableError' } },
      { code: 'ECONNREFUSED' },
      { cause: { code: 'ECONNRESET' } },
      { message: 'embedding fetch failed because the service is unavailable' },
    ];
    const notes = unavailableErrors.map((_, index) => ({
      path: `notes/unavailable-${index}`,
      body: `unavailable body ${index}`,
    }));
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 8 });
    try {
      const report = await new Indexer(failingEmbedder(unavailableErrors), store)
        .indexNotes(notes);

      expect(report.vectorStatus).toBe('unavailable');
      expect(report.vectorChunksInserted).toBe(0);
      expect(report.chunksInserted).toBe(notes.length);
      expect(report.errors).toHaveLength(notes.length);
      expect(store.textCount()).toBe(notes.length);
    } finally {
      await store.close();
    }
  });
});

describe('VectorStore transaction rollback branch', () => {
  it('rolls back a delete transaction when the underlying delete statement fails', async () => {
    const store = await createVectorStore({ dbPath: ':memory:', dimensions: 8 });
    await store.insert(vector());
    const database = (store as unknown as { db: any }).db;
    const originalPrepare = database.prepare.bind(database);
    database.prepare = (sql: string) => {
      if (sql.startsWith('DELETE FROM chunks')) throw new Error('synthetic delete failure');
      return originalPrepare(sql);
    };

    try {
      await expect(store.deleteNote('notes/edge')).rejects.toThrow('synthetic delete failure');
    } finally {
      database.prepare = originalPrepare;
    }

    expect(store.vectorCount()).toBe(1);
    expect(store.textCount()).toBe(1);
    await store.insert(vector('edge#1'));
    expect(store.vectorCount()).toBe(2);
    await store.close();
  });
});
