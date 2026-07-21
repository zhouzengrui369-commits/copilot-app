/**
 * Copilot-cloud route + config edge tests — Sprint 1.5 Wave 3 T-1.5.3.
 *
 * The base route suites cover the happy paths (200, 401, 502/503). This
 * file pins the *negative paths* that an outside PM-facing test would
 * actually exercise:
 *
 *   - v1/chat: empty messages array (length-0) is rejected, same as missing
 *   - v1/chat: malformed JSON body returns 400 (Fastify default)
 *   - v1/chat: 503 with `llm_not_configured` when LLM_API_KEY empty
 *   - v1/embeddings: empty string input is treated as missing → 400
 *   - v1/embeddings: non-string array element → 400
 *   - v1/embeddings: 503 with `llm_not_configured` when LLM_API_KEY empty
 *   - health: 404 on an unknown route (helps spot misrouted middleware)
 *   - config: AUTH_DISABLED accepts the string "true" (not just "1")
 *   - config: parseInt10 falls back to the default on non-numeric env
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import { buildTestConfig, AUTH_HEADER } from './helpers.js';
import { loadConfig } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

const fetchMock = vi.fn();

describe('v1/chat · input validation edge cases', () => {
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

  it('rejects an empty messages array with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: { messages: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('rejects non-array messages with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: AUTH_HEADER,
      payload: { messages: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('returns 503 llm_not_configured when apiKey is empty', async () => {
    const cfg = buildTestConfig({ llm: { ...buildTestConfig().llm, apiKey: '' } });
    const a = await buildApp({ config: cfg });
    await a.ready();
    try {
      const res = await a.inject({
        method: 'POST',
        url: '/v1/chat',
        headers: AUTH_HEADER,
        payload: { messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('llm_not_configured');
    } finally {
      await a.close();
    }
  });
});

describe('v1/embeddings · input validation edge cases', () => {
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

  it('rejects empty-string input with 400 (treated as missing)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: AUTH_HEADER,
      payload: { input: '' },
    });
    // Fastify / our schema treats empty string as falsy → 400.
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('rejects mixed-type array input before upstream', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: AUTH_HEADER,
      payload: { input: ['ok', 42] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INPUT_INVALID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 llm_not_configured when apiKey is empty', async () => {
    const cfg = buildTestConfig({ llm: { ...buildTestConfig().llm, apiKey: '' } });
    const a = await buildApp({ config: cfg });
    await a.ready();
    try {
      const res = await a.inject({
        method: 'POST',
        url: '/v1/embeddings',
        headers: AUTH_HEADER,
        payload: { input: 'hi' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('llm_not_configured');
    } finally {
      await a.close();
    }
  });
});

describe('health · 404 boundary', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      config: buildTestConfig({ auth: { enabled: false, sharedTokens: [] } }),
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns 404 for an unknown route (auth-disabled mode)', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-such-route' });
    expect(res.statusCode).toBe(404);
  });
});

describe('loadConfig · env-var edge cases', () => {
  it('AUTH_DISABLED=true (string) disables auth (not just "1")', async () => {
    // Docs say "AUTH_DISABLED=1" but the implementation accepts the
    // wider "true"/"1" set. Pin the documented-but-undocumented "true"
    // path so future refactors don't silently drop it.
    const cfg = loadConfig({ AUTH_DISABLED: 'true' });
    expect(cfg.auth.enabled).toBe(false);
  });

  it('falls back to default when RATE_LIMIT_MAX is non-numeric', async () => {
    // parseInt10 guards against "abc" → returns the fallback (60).
    const cfg = loadConfig({ RATE_LIMIT_MAX: 'not-a-number' });
    expect(cfg.rateLimitMax).toBe(60);
  });

  it('preserves explicit negative timeout outside production for readiness diagnostics', async () => {
    const cfg = loadConfig({ LLM_TIMEOUT_MS: '-5' });
    expect(cfg.llm.timeoutMs).toBe(-5);
  });
});
