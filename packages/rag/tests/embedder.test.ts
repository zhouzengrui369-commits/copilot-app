/**
 * Embedder compatibility tests. The packaged default is covered separately by
 * embedded-local-provider.test.ts; this file pins the explicit Ollama adapter.
 */

import { describe, expect, it } from 'vitest';
import { Embedder } from '../src/embedder.js';

function makeFakeFetch(handlers: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const value = typeof url === 'string' ? url : url.toString();
    for (const key of Object.keys(handlers)) {
      if (value.endsWith(key)) return handlers[key]!();
    }
    throw new Error(`no handler for ${value}`);
  }) as unknown as typeof fetch;
}

describe('Embedder explicit Ollama compatibility', () => {
  it('rejects empty text', async () => {
    const embedder = new Embedder({ provider: 'ollama', fetchImpl: makeFakeFetch({}) });
    await expect(embedder.embed('')).rejects.toThrow(/non-empty string/u);
  });

  it('throws when explicit Ollama has no fetch implementation', () => {
    const globalWithFetch = globalThis as { fetch: unknown };
    const original = globalWithFetch.fetch;
    // @ts-expect-error — intentionally remove fetch for the constructor contract.
    globalWithFetch.fetch = undefined;
    try {
      expect(() => new Embedder({ provider: 'ollama' })).toThrow(/no fetch/u);
    } finally {
      globalWithFetch.fetch = original;
    }
  });

  it('embeds one text, validates dimensions and returns Float32Array', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () => new Response(
        JSON.stringify({ embedding: new Array(1024).fill(0.01) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    });
    const embedder = new Embedder({ fetchImpl: fakeFetch, model: 'bge-m3:latest' });
    expect(embedder.dim).toBe(1024);
    expect(embedder.modelId).toBe('bge-m3:latest');
    expect(embedder.providerId).toBe('ollama-local-service');
    const vector = await embedder.embed('hi');
    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(1024);
  });

  it('rejects dimension mismatch', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () => new Response(
        JSON.stringify({ embedding: new Array(768).fill(0.01) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    });
    const embedder = new Embedder({ fetchImpl: fakeFetch, model: 'wrong-dim' });
    await expect(embedder.embed('x')).rejects.toThrow(/dimension mismatch/u);
  });

  it('surfaces non-OK HTTP status', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () => new Response('model not found', { status: 404 }),
    });
    const embedder = new Embedder({ fetchImpl: fakeFetch, model: 'missing' });
    await expect(embedder.embed('x')).rejects.toThrow(/Ollama returned 404/u);
  });

  it('embeds multiple texts sequentially', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () => new Response(
        JSON.stringify({ embedding: new Array(1024).fill(0.05) }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    });
    const embedder = new Embedder({ fetchImpl: fakeFetch });
    const vectors = await embedder.embedAll(['a', 'b', 'c']);
    expect(vectors).toHaveLength(3);
    expect(vectors.every((vector) => vector.length === 1024)).toBe(true);
  });
});
