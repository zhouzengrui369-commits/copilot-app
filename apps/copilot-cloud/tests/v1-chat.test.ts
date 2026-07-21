import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import { buildTestConfig, AUTH_HEADER } from './helpers.js';
import type { FastifyInstance } from 'fastify';

// Mock global fetch — that's how v1-chat reaches minimax.
const fetchMock = vi.fn();

describe('v1/chat proxy', () => {
  let app: FastifyInstance;
  const config = buildTestConfig();

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    app = await buildApp({ config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('returns 401 with wrong token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer wrong-token' },
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when messages missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('returns 503 when LLM_API_KEY not set', async () => {
    const cfg = buildTestConfig({
      llm: { ...config.llm, apiKey: '' },
    });
    const a = await buildApp({ config: cfg });
    await a.ready();
    const res = await a.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('llm_not_configured');
    await a.close();
  });

  it('forwards non-streaming chat completion to upstream', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'cmpl-1',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: { model: 'm3', messages: [{ role: 'user', content: 'ping' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe('pong');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://fake-llm.test/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer sk-test-12345',
    });
  });

  it('forwards streaming chat completion as SSE', async () => {
    const sseBody = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseBody));
        controller.close();
      },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(stream as unknown as BodyInit, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: { model: 'm3', stream: true, messages: [{ role: 'user', content: 'ping' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('data: [DONE]');
  });

  it('returns 502 when upstream fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: 'llm_proxy_failed',
      code: 'UPSTREAM_UNREACHABLE',
      requestId: expect.any(String),
    });
  });

  it('returns upstream status on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('rate limited', { status: 429, headers: { 'content-type': 'text/plain' } }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: 'llm_proxy_failed',
      code: 'UPSTREAM_RATE_LIMITED',
      requestId: expect.any(String),
    });
  });
});
