import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import { buildTestConfig, AUTH_HEADER } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const fetchMock = vi.fn();

describe('v1/embeddings proxy', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    app = await buildApp({ config: buildTestConfig() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it('requires auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      payload: { input: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('validates input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: AUTH_HEADER,
      payload: { input: 42 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forwards embeddings request', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2, 0.3], index: 0 }],
        model: 'm3-embed',
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: AUTH_HEADER,
      payload: { input: 'hello world' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('http://fake-llm.test/v1/embeddings');
  });

  it('returns 502 when upstream fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: AUTH_HEADER,
      payload: { input: 'hello' },
    });
    expect(res.statusCode).toBe(502);
  });
});