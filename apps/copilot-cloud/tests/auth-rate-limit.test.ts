import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import { buildTestConfig, AUTH_HEADER } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const fetchMock = vi.fn();

describe('auth + rate-limit integration', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    fetchMock.mockReset().mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, choices: [{ message: { content: 'pong' } }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    app = await buildApp({
      config: buildTestConfig({ rateLimitMax: 3, rateLimitWindowMs: 60_000 }),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it('auth accepts valid Bearer tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer test-token-2' },
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rate-limits after N requests', async () => {
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: AUTH_HEADER,
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });

    const r1 = await send();
    const r2 = await send();
    const r3 = await send();
    const r4 = await send();

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(200);
    expect(r4.statusCode).toBe(429);
    expect(r4.json()).toMatchObject({
      error: 'rate_limited',
      code: 'RATE_LIMIT_EXCEEDED',
      requestId: expect.any(String),
    });
  });

  it('health is not rate-limited or auth-gated', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }
  });
});
