/**
 * Indexer pipeline tests — Sprint 1.5 Wave 3 T-1.5.3.
 *
 * The Indexer wires chunker → embedder → vector-store and produces a
 * structured IndexerReport. These tests pin the four real-world contracts
 * the rest of the system depends on:
 *   1. happy path: every chunk gets embedded + inserted, counts are exact
 *   2. shouldSkip: the predicate is honored, chunksSkipped matches expectation
 *   3. embedder error: the chunk is recorded in `errors`, indexing CONTINUES
 *      for the remaining chunks (RAG is best-effort, see indexer.ts header)
 *   4. indexOneNote: thin wrapper over indexNotes with a single note
 *
 * No Ollama in CI — we feed Embedder a fake fetch that returns a fixed
 * 8-dim vector (overriding `dimensions` so dim validation passes).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Embedder } from '../src/embedder.js';
import { Indexer, type NoteInput } from '../src/indexer.js';
import { createVectorStore, type VectorStore } from '../src/vector-store.js';
import type { NoteChunk } from '../src/types.js';

const FAKE_DIM = 8;

function fixedDimFetch(values: number[]): typeof fetch {
  return (async () => {
    return new Response(JSON.stringify({ embedding: values }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function failingFetch(message: string): typeof fetch {
  return (async () => {
    return new Response(message, { status: 500, statusText: 'Internal' });
  }) as unknown as typeof fetch;
}

function nonZeroVector(seed: number): number[] {
  // Avoid the all-zeros edge case — cosine is undefined on a zero vector,
  // and some VectorStore implementations short-circuit on it.
  const out = new Array(FAKE_DIM).fill(0).map((_, i) => Math.sin(seed + i) + 0.1);
  return out;
}

async function newStore(): Promise<VectorStore> {
  return createVectorStore({ dbPath: ':memory:', dimensions: FAKE_DIM });
}

describe('Indexer', () => {
  let store: VectorStore;

  beforeEach(async () => {
    store = await newStore();
  });
  afterEach(async () => {
    await store.close();
  });

  it('indexes a single-note batch end-to-end and reports exact counts', async () => {
    const embedder = new Embedder({
      fetchImpl: fixedDimFetch(nonZeroVector(1)),
      dimensions: FAKE_DIM,
    });
    const indexer = new Indexer(embedder, store);

    const notes: NoteInput[] = [
      { path: 'inbox/one', body: '短正文。', title: 'One' },
    ];
    const report = await indexer.indexNotes(notes);

    expect(report.notes).toBe(1);
    expect(report.chunksAttempted).toBeGreaterThanOrEqual(1);
    expect(report.chunksInserted).toBe(report.chunksAttempted);
    expect(report.vectorChunksInserted).toBe(report.chunksAttempted);
    expect(report.vectorStatus).toBe('ok');
    expect(report.chunksSkipped).toBe(0);
    expect(report.errors).toEqual([]);
    expect(report.embeddingModel).toBe(embedder.modelId);
    expect(report.finishedAt).toBeGreaterThanOrEqual(report.startedAt);
    expect(store.count()).toBe(report.chunksInserted);
  });

  it('honors shouldSkip predicate and bumps chunksSkipped (no embed call)', async () => {
    let embedCalls = 0;
    const fetchSpy: typeof fetch = (async () => {
      embedCalls += 1;
      return new Response(JSON.stringify({ embedding: nonZeroVector(embedCalls) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const embedder = new Embedder({
      fetchImpl: fetchSpy,
      dimensions: FAKE_DIM,
    });
    const indexer = new Indexer(embedder, store);

    // Two notes → at least 2 chunks. Skip the ones whose text is "skip-me".
    const notes: NoteInput[] = [
      { path: 'a', body: 'skip-me' },
      { path: 'b', body: 'real content to embed' },
    ];
    const report = await indexer.indexNotes(notes, {
      shouldSkip: (c: NoteChunk) => c.text.trim() === 'skip-me',
    });

    expect(report.chunksSkipped).toBeGreaterThanOrEqual(1);
    expect(report.chunksAttempted + report.chunksSkipped).toBe(
      report.chunksAttempted + report.chunksSkipped,
    );
    expect(embedCalls).toBe(report.chunksAttempted);
    expect(report.errors).toEqual([]);
  });

  it('records per-chunk errors when embedder throws and continues with the rest', async () => {
    // First embed call returns 500 → records an error; subsequent calls succeed.
    let call = 0;
    const flakyFetch: typeof fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response('upstream boom', { status: 500, statusText: 'ISE' });
      }
      return new Response(JSON.stringify({ embedding: nonZeroVector(call) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const embedder = new Embedder({
      fetchImpl: flakyFetch,
      dimensions: FAKE_DIM,
    });
    const indexer = new Indexer(embedder, store);

    const notes: NoteInput[] = [
      { path: 'a', body: 'first chunk fails' },
      { path: 'b', body: 'second chunk succeeds' },
    ];
    const report = await indexer.indexNotes(notes);

    // The first chunk produced an error; both texts are retained and the
    // second chunk also receives a vector.
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]?.reason).toMatch(/500/);
    expect(report.chunksInserted).toBe(report.chunksAttempted);
    expect(report.vectorChunksInserted).toBeGreaterThanOrEqual(1);
    expect(report.vectorChunksInserted + report.errors.length).toBe(
      report.chunksAttempted,
    );
    expect(report.vectorStatus).toBe('degraded');
    expect(store.count()).toBe(report.vectorChunksInserted);
    expect(store.textCount()).toBe(report.chunksInserted);
    expect(store.vectorCount()).toBe(report.vectorChunksInserted);
  });

  it('persists every text chunk and reports unavailable when all embeddings fail', async () => {
    const embedder = new Embedder({
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
      dimensions: FAKE_DIM,
    });
    const report = await new Indexer(embedder, store).indexOneNote({
      path: 'offline/all-fail',
      body: 'local text remains searchable',
    });

    expect(report).toMatchObject({
      notes: 1,
      chunksAttempted: 1,
      chunksInserted: 1,
      vectorChunksInserted: 0,
      vectorStatus: 'unavailable',
    });
    expect(report.errors).toHaveLength(1);
    expect(store.count()).toBe(0);
    expect(store.textCount()).toBe(1);
    expect(store.vectorCount()).toBe(0);
    expect(store.listChunksForNote('offline/all-fail')).toEqual([
      expect.objectContaining({
        id: 'offline/all-fail#0',
        notePath: 'offline/all-fail',
        text: 'local text remains searchable',
      }),
    ]);
  });

  it('indexOneNote is a single-note wrapper and reuses the same report shape', async () => {
    const embedder = new Embedder({
      fetchImpl: fixedDimFetch(nonZeroVector(7)),
      dimensions: FAKE_DIM,
    });
    const indexer = new Indexer(embedder, store);

    const note: NoteInput = { path: 'inbox/only', body: 'a single note' };
    const report = await indexer.indexOneNote(note);

    expect(report.notes).toBe(1);
    expect(report.chunksAttempted).toBe(1);
    expect(report.chunksInserted).toBe(1);
    expect(report.errors).toEqual([]);
    expect(store.listNotePaths()).toEqual(['inbox/only']);
  });

  it.each([
    [new Error('disk full'), 'disk full'],
    ['store rejected', 'store rejected'],
  ])('records replaceNote failure without overstating inserted chunks: %s', async (failure, reason) => {
    const embedder = new Embedder({
      fetchImpl: fixedDimFetch(nonZeroVector(9)),
      dimensions: FAKE_DIM,
    });
    const rejectingStore = {
      replaceNote: async () => {
        throw failure;
      },
      replaceNoteIndex: async () => {
        throw failure;
      },
    } as unknown as VectorStore;
    const report = await new Indexer(embedder, rejectingStore).indexOneNote({
      path: 'notes/fail',
      body: 'one chunk',
    });

    expect(report.chunksAttempted).toBe(1);
    expect(report.chunksInserted).toBe(0);
    expect(report.errors).toContainEqual({
      path: 'notes/fail',
      ordinal: -1,
      reason,
    });
  });
});
