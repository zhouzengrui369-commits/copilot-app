/**
 * Embedder unit test — uses fetch stub so we don't depend on Ollama being
 * alive during CI. Validates the request shape, dim-match contract, and
 * error paths.
 */

import { describe, expect, it } from 'vitest';
import { Embedder } from '../src/embedder.js';

function makeFakeFetch(handlers: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const k of Object.keys(handlers)) {
      if (u.endsWith(k)) {
        return handlers[k]!();
      }
    }
    throw new Error('no handler for ' + u);
  }) as unknown as typeof fetch;
}

describe('Embedder', () => {
  it('rejects empty text', async () => {
    const e = new Embedder({ fetchImpl: makeFakeFetch({}) });
    await expect(e.embed('')).rejects.toThrow(/non-empty string/);
  });

  it('throws when no fetch is available', () => {
    const g = globalThis as { fetch: unknown };
    const original = g.fetch;
    // @ts-expect-error — temporarily nuke fetch
    g.fetch = undefined;
    try {
      expect(() => new Embedder()).toThrow(/no fetch/);
    } finally {
      g.fetch = original;
    }
  });

  it('embeds one text, validates dim, returns Float32Array', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () =>
        new Response(JSON.stringify({ embedding: new Array(1024).fill(0.01) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const e = new Embedder({ fetchImpl: fakeFetch, model: 'bge-m3:latest' });
    expect(e.dim).toBe(1024);
    expect(e.modelId).toBe('bge-m3:latest');
    const v = await e.embed('hi');
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(1024);
  });

  it('rejects dim mismatch', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () =>
        new Response(JSON.stringify({ embedding: new Array(768).fill(0.01) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const e = new Embedder({ fetchImpl: fakeFetch, model: 'wrong-dim' });
    await expect(e.embed('x')).rejects.toThrow(/dimension mismatch/);
  });

  it('surfaces non-OK HTTP status', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () => new Response('model not found', { status: 404 }),
    });
    const e = new Embedder({ fetchImpl: fakeFetch, model: 'missing' });
    await expect(e.embed('x')).rejects.toThrow(/Ollama returned 404/);
  });

  it('embeds multiple texts sequentially', async () => {
    const fakeFetch = makeFakeFetch({
      '/api/embeddings': () =>
        new Response(JSON.stringify({ embedding: new Array(1024).fill(0.05) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const e = new Embedder({ fetchImpl: fakeFetch });
    const vs = await e.embedAll(['a', 'b', 'c']);
    expect(vs).toHaveLength(3);
    expect(vs.every((v) => v.length === 1024)).toBe(true);
  });
});
