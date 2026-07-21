/**
 * Vector store round-trip + retrieval tests (Sprint 1.3 T-1.3.1).
 *
 * Uses an in-memory sql.js store, no Ollama. Embeddings are crafted
 * Float32Array vectors with known orientations so we can assert on
 * top-k order.
 */

import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createVectorStore,
  generateChunkId,
  type VectorStore,
} from '../src/vector-store.js';
import type { EmbeddedChunk } from '../src/types.js';

const tempDirs: string[] = [];

function makeEmbedding(values: number[]): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[i] ?? 0;
  return out;
}

function normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += (v[i] ?? 0) ** 2;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

function dummyChunk(id: string, notePath: string, ordinal: number, text: string): EmbeddedChunk {
  return {
    id,
    notePath,
    ordinal,
    text,
    tokenCount: 1,
    charRange: [0, text.length],
    embedding: new Float32Array(8), // unused
    model: 'test',
    embeddedAt: 0,
  };
}

describe('VectorStore', () => {
  let store: VectorStore;

  beforeEach(async () => {
    store = await createVectorStore({ dbPath: ':memory:', dimensions: 8 });
  });

  afterEach(async () => {
    await store.close();
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('inserts and counts chunks', async () => {
    const e = makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]);
    await store.insert({ ...dummyChunk('1', 'n/a', 0, 'a'), embedding: e });
    await store.insert({ ...dummyChunk('2', 'n/b', 0, 'b'), embedding: e });
    expect(store.count()).toBe(2);
  });

  it('returns top-k by cosine similarity', async () => {
    const c1 = { ...dummyChunk('1', 'n/a', 0, 'a'), embedding: normalize(makeEmbedding([1, 0.1, 0, 0, 0, 0, 0, 0])) };
    const c2 = { ...dummyChunk('2', 'n/b', 0, 'b'), embedding: normalize(makeEmbedding([0.9, 0.2, 0, 0, 0, 0, 0, 0])) };
    const c3 = { ...dummyChunk('3', 'n/c', 0, 'c'), embedding: normalize(makeEmbedding([0, 1, 0, 0, 0, 0, 0, 0])) };
    await store.insertMany([c1, c2, c3]);

    const query = normalize(makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]));
    const result = await store.search(query, { topK: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]?.chunk.id).toBe('1');
    expect(result.hits[1]?.chunk.id).toBe('2');
    // scores descending
    expect(result.hits[0]!.score).toBeGreaterThan(result.hits[1]!.score);
    // candidates considered = 3
    expect(result.candidates).toBe(3);
  });

  it('deduplicates note paths', async () => {
    const e = makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]);
    await store.insertMany([
      { ...dummyChunk('1', 'n/a', 0, 'a'), embedding: e },
      { ...dummyChunk('2', 'n/a', 1, 'a2'), embedding: e },
      { ...dummyChunk('3', 'n/b', 0, 'b'), embedding: e },
    ]);
    expect(store.listNotePaths().sort()).toEqual(['n/a', 'n/b']);
  });

  it('rejects dim mismatch', async () => {
    const e = makeEmbedding([1, 0, 0]);
    await expect(
      store.insert({ ...dummyChunk('1', 'n/a', 0, 'a'), embedding: e }),
    ).rejects.toThrow(/dim mismatch/);
  });

  it('applies minScore floor', async () => {
    const e1 = normalize(makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]));
    const e2 = normalize(makeEmbedding([0, 1, 0, 0, 0, 0, 0, 0]));
    await store.insertMany([
      { ...dummyChunk('1', 'n/a', 0, 'a'), embedding: e1 },
      { ...dummyChunk('2', 'n/b', 0, 'b'), embedding: e2 },
    ]);
    const q = e1;
    const result = await store.search(q, { topK: 5, minScore: 0.5 });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.chunk.id).toBe('1');
  });

  it('uses default dimensions and accepts an empty insert batch', async () => {
    await store.close();
    store = await createVectorStore({ dbPath: ':memory:' });
    await store.insertMany([]);
    await expect(store.insert({
      ...dummyChunk('default-dim', 'n/default', 0, 'default'),
      embedding: makeEmbedding([1, 0]),
    })).rejects.toThrow(/2 vs 1024/);
  });

  it('cleans the temporary file when atomic persistence cannot replace a directory', async () => {
    await store.close();
    const root = await mkdtemp(join(tmpdir(), 'copilot-rag-atomic-'));
    tempDirs.push(root);
    const dbPath = join(root, 'rag.db');
    await mkdir(dbPath);
    store = await createVectorStore({ dbPath, dimensions: 8 });

    await expect(store.insert({
      ...dummyChunk('atomic-failure', 'n/atomic', 0, 'atomic'),
      embedding: makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]),
    })).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith(`.${basename(dbPath)}.`))).toEqual([]);

    // Let the normal afterEach close persist successfully instead of replaying
    // the intentionally injected path collision.
    await rm(dbPath, { recursive: true });
  });

  it('validates replace input and rolls back an id collision with another note', async () => {
    const e = makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]);
    await expect(store.replaceNote('   ', [])).rejects.toThrow(/notePath is required/);
    await store.insertMany([
      { ...dummyChunk('shared', 'n/b', 0, 'other note'), embedding: e },
      { ...dummyChunk('original-a', 'n/a', 0, 'original note'), embedding: e },
    ]);

    await expect(store.replaceNote('n/a', [
      { ...dummyChunk('shared', 'n/a', 0, 'replacement'), embedding: e },
    ])).rejects.toThrow();
    expect(store.listChunksForNote('n/a').map((chunk) => chunk.id)).toEqual(['original-a']);
    expect(store.listChunksForNote('n/b').map((chunk) => chunk.id)).toEqual(['shared']);
  });

  it('validates query dimensions and zero norm and searches defaults with a zero vector', async () => {
    await store.insertMany([
      {
        ...dummyChunk('unit', 'n/unit', 0, 'unit'),
        embedding: makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]),
      },
      {
        ...dummyChunk('zero', 'n/zero', 0, 'zero'),
        embedding: makeEmbedding([0, 0, 0, 0, 0, 0, 0, 0]),
      },
    ]);
    await expect(store.search(makeEmbedding([1]))).rejects.toThrow(/query dim mismatch/);
    await expect(store.search(makeEmbedding([0, 0, 0, 0, 0, 0, 0, 0]))).rejects.toThrow(/zero norm/);

    const result = await store.search(makeEmbedding([1, 0, 0, 0, 0, 0, 0, 0]));
    expect(result.hits.map((entry) => [entry.chunk.id, entry.score])).toEqual([
      ['unit', 1],
      ['zero', 0],
    ]);
  });

  it('reports schema version and generates fixed-width hexadecimal chunk ids', () => {
    expect(store.schemaVersion()).toBe('1');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(generateChunkId()).toBe('0000000000000000');
    vi.mocked(Math.random).mockReturnValue(0.999999);
    expect(generateChunkId()).toBe('ffffffffffffffff');
  });
});
