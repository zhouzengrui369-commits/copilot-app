import { afterEach, describe, expect, it, vi } from 'vitest';
import { Embedder } from '../src/embedder.js';

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

describe('embedded-local default embedding provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the self-contained, no-egress production default', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('default embedded provider must not call fetch'),
    );
    const embedder = new Embedder();

    expect(embedder.providerId).toBe('embedded-local-hash-v1');
    expect(embedder.modelId).toBe('embedded-local-hash-v1:1024');
    expect(embedder.modelRevision).toBe('char-word-ngram-v1');
    expect(embedder.privacyClass).toBe('embedded-local');
    expect(embedder.dim).toBe(1024);
    await expect(embedder.health()).resolves.toEqual({
      status: 'ok',
      providerId: 'embedded-local-hash-v1',
      dimensions: 1024,
      modelRevision: 'char-word-ngram-v1',
      privacyClass: 'embedded-local',
    });

    const first = await embedder.embed('航材 AOG 保障流程与备件调配');
    const repeated = await embedder.embed('航材 AOG 保障流程与备件调配');
    expect(first).toEqual(repeated);
    expect(first).toBeInstanceOf(Float32Array);
    expect(first).toHaveLength(1024);
    expect(Math.hypot(...first)).toBeCloseTo(1, 5);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('gives related Chinese text a stronger signal than unrelated text', async () => {
    const embedder = new Embedder({ provider: 'embedded-local', dimensions: 256 });
    const query = await embedder.embed('AOG 航材保障与备件调配');
    const related = await embedder.embed('航材 AOG 保障流程和备件调度方案');
    const unrelated = await embedder.embed('家庭烘焙蛋糕配方与烤箱温度');

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
    expect(embedder.modelId).toBe('embedded-local-hash-v1:256');
  });

  it('keeps Ollama as an explicit local-service compatibility provider', async () => {
    const fetchImpl: typeof fetch = (async () => new Response(
      JSON.stringify({ embedding: [0.1, 0.2, 0.3, 0.4] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;
    const embedder = new Embedder({
      provider: 'ollama',
      fetchImpl,
      model: 'test-model',
      dimensions: 4,
    });

    expect(embedder.providerId).toBe('ollama-local-service');
    expect(embedder.privacyClass).toBe('local-service');
    expect(embedder.modelId).toBe('ollama:test-model:4');
    await expect(embedder.embed('test')).resolves.toEqual(
      Float32Array.from([0.1, 0.2, 0.3, 0.4]),
    );
  });

  it('fails closed on empty input and caller cancellation', async () => {
    const embedder = new Embedder();
    await expect(embedder.embed('')).rejects.toThrow(/non-empty string/u);
    const controller = new AbortController();
    controller.abort(new Error('owner cancelled'));
    await expect(embedder.embed('cancelled input', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
