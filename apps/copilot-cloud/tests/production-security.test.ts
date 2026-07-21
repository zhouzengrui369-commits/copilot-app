import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import {
  ProductionConfigError,
  loadConfig,
  type ServerConfig,
} from '../src/config.js';
import { buildTestConfig } from './helpers.js';

const fetchMock = vi.fn<typeof fetch>();

function secureProductionConfig(
  overrides: Partial<ServerConfig> & Record<string, unknown> = {},
): ServerConfig {
  return {
    ...buildTestConfig(),
    port: 8788,
    nodeEnv: 'production',
    corsOrigins: ['https://desktop.example.test'],
    rateLimitMax: 10,
    rateLimitWindowMs: 60_000,
    auth: {
      enabled: true,
      sharedTokens: ['production-test-token'],
    },
    llm: {
      baseUrl: 'https://llm.example.test',
      apiKey: 'production-upstream-key',
      chatPath: '/v1/chat/completions',
      embeddingsPath: '/v1/embeddings',
      timeoutMs: 10_000,
    },
    trustProxy: ['10.0.0.0/8'],
    trustProxyContract: 'cidrs',
    ...overrides,
  } as ServerConfig;
}

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    PORT: '8788',
    AUTH_DISABLED: '0',
    COPILOT_CLOUD_TOKENS: 'production-test-token',
    LLM_API_KEY: 'production-upstream-key',
    LLM_BASE_URL: 'https://llm.example.test',
    CORS_ORIGINS: 'https://desktop.example.test',
    TRUST_PROXY_CIDRS: '10.0.0.0/8',
    RATE_LIMIT_MAX: '10',
    RATE_LIMIT_WINDOW_MS: '60000',
    LLM_TIMEOUT_MS: '10000',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('production startup security contract', () => {
  it.each(['prodution', 'Production', ' production ', '']) (
    'rejects unknown NODE_ENV value %j with a stable code',
    (nodeEnv) => {
      expect(() => loadConfig(productionEnv({ NODE_ENV: nodeEnv }))).toThrowError(
        expect.objectContaining({ code: 'NODE_ENV_INVALID' }),
      );
    },
  );

  it.each([
    ['auth disabled', { AUTH_DISABLED: '1' }, 'AUTH_DISABLED'],
    ['empty client tokens', { COPILOT_CLOUD_TOKENS: '' }, 'CLIENT_TOKENS_MISSING'],
    ['empty upstream key', { LLM_API_KEY: '' }, 'LLM_API_KEY_MISSING'],
    ['empty upstream base URL', { LLM_BASE_URL: '' }, 'LLM_BASE_URL_INVALID'],
    ['empty CORS origins', { CORS_ORIGINS: '' }, 'CORS_ORIGINS_MISSING'],
    ['wildcard CORS', { CORS_ORIGINS: '*' }, 'CORS_ORIGIN_WILDCARD'],
    ['missing trusted proxy contract', { TRUST_PROXY_CIDRS: undefined }, 'TRUST_PROXY_MISSING'],
    ['invalid trusted proxy contract', { TRUST_PROXY_CIDRS: 'not-a-cidr' }, 'TRUST_PROXY_INVALID'],
    ['invalid rate limit', { RATE_LIMIT_MAX: '0' }, 'RATE_LIMIT_MAX_INVALID'],
    ['invalid rate window', { RATE_LIMIT_WINDOW_MS: '-1' }, 'RATE_LIMIT_WINDOW_INVALID'],
    ['invalid upstream timeout', { LLM_TIMEOUT_MS: '0' }, 'LLM_TIMEOUT_INVALID'],
    ['zero port', { PORT: '0' }, 'PORT_INVALID'],
    ['out-of-range port', { PORT: '65536' }, 'PORT_INVALID'],
    ['fractional port', { PORT: '8788.5' }, 'PORT_INVALID'],
    ['non-numeric port', { PORT: 'not-a-port' }, 'PORT_INVALID'],
  ])('rejects %s before listening', (_name, overrides, code) => {
    try {
      loadConfig(productionEnv(overrides));
      throw new Error('expected production config to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionConfigError);
      expect(error).toMatchObject({ code });
      expect(String((error as Error).message)).toBe(code);
    }
  });

  it('exits non-zero with a stable code before binding a port', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ...productionEnv({ AUTH_DISABLED: '1' }),
      },
      timeout: 5_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"error":"startup_failed"');
    expect(result.stderr).toContain('"code":"AUTH_DISABLED"');
    expect(result.stderr).not.toContain('production-upstream-key');
  });

  it('entrypoint rejects an unknown NODE_ENV with a stable code', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ...productionEnv({ NODE_ENV: 'Production' }),
      },
      timeout: 5_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"error":"startup_failed"');
    expect(result.stderr).toContain('"code":"NODE_ENV_INVALID"');
    expect(result.stderr).not.toContain('production-upstream-key');
  });

  it.each([
    [{ nodeEnv: 'Production' as ServerConfig['nodeEnv'] }, 'NODE_ENV_INVALID'],
    [{ port: 0 }, 'PORT_INVALID'],
    [{ auth: { enabled: false, sharedTokens: [] } }, 'AUTH_DISABLED'],
    [{ auth: { enabled: true, sharedTokens: [] } }, 'CLIENT_TOKENS_MISSING'],
    [{ llm: { ...secureProductionConfig().llm, apiKey: '' } }, 'LLM_API_KEY_MISSING'],
    [{ llm: { ...secureProductionConfig().llm, baseUrl: 'http://127.0.0.1' } }, 'LLM_BASE_URL_INVALID'],
    [{ corsOrigins: [] }, 'CORS_ORIGINS_MISSING'],
    [{ trustProxy: false, trustProxyContract: 'none' }, 'TRUST_PROXY_MISSING'],
    [{ rateLimitMax: 0 }, 'RATE_LIMIT_MAX_INVALID'],
    [{ rateLimitWindowMs: 0 }, 'RATE_LIMIT_WINDOW_INVALID'],
    [{ llm: { ...secureProductionConfig().llm, timeoutMs: 0 } }, 'LLM_TIMEOUT_INVALID'],
  ])('revalidates unsafe injected production config %j', async (overrides, code) => {
    await expect(buildApp({
      config: secureProductionConfig(overrides as Partial<ServerConfig>),
      logger: false,
    })).rejects.toMatchObject({ code });
  });

  it.each([
    [{ trustProxy: 2, trustProxyContract: 'cidrs' }, 'TRUST_PROXY_INVALID'],
    [{ trustProxy: ['10.0.0.0/8'], trustProxyContract: 'hops' }, 'TRUST_PROXY_INVALID'],
    [{ trustProxy: false, trustProxyContract: 'cidrs' }, 'TRUST_PROXY_INVALID'],
  ])('rejects inconsistent injected trust-proxy config %j', async (overrides, code) => {
    await expect(buildApp({
      config: secureProductionConfig(overrides as Partial<ServerConfig>),
      logger: false,
    })).rejects.toMatchObject({ code });
  });
});

describe('request boundary security contract', () => {
  it('rejects provider-dangerous and unknown chat fields', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'unsafe pass-through' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp({ config: secureProductionConfig(), logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer production-test-token' },
      payload: {
        messages: [{ role: 'user', content: 'hello' }],
        tools: [{ type: 'function', function: { name: 'delete_all' } }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request' });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects mixed embedding arrays instead of forwarding them', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp({ config: secureProductionConfig(), logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { authorization: 'Bearer production-test-token' },
      payload: { input: ['safe', 42] },
    });

    expect(response.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('bounds message count and content length', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp({ config: secureProductionConfig(), logger: false });

    const tooMany = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer production-test-token' },
      payload: {
        messages: Array.from({ length: 65 }, () => ({ role: 'user', content: 'x' })),
      },
    });
    const tooLong = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer production-test-token' },
      payload: { messages: [{ role: 'user', content: 'x'.repeat(32_769) }] },
    });

    expect(tooMany.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('enforces a 1 MiB body limit', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp({ config: secureProductionConfig(), logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer production-test-token' },
      payload: {
        messages: [{ role: 'user', content: 'x'.repeat(1024 * 1024) }],
      },
    });

    expect(response.statusCode).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('ignores XFF from an untrusted peer under a CIDR contract', async () => {
    fetchMock.mockImplementation(async () => (
      new Response(JSON.stringify({ choices: [] }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const config = secureProductionConfig({ rateLimitMax: 1, rateLimitWindowMs: 60_000 });
    const app = await buildApp({ config, logger: false });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      remoteAddress: '203.0.113.50',
      headers: {
        authorization: 'Bearer production-test-token',
        'x-forwarded-for': '198.51.100.10',
      },
      payload: { messages: [{ role: 'user', content: 'one' }] },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      remoteAddress: '203.0.113.50',
      headers: {
        authorization: 'Bearer production-test-token',
        'x-forwarded-for': '198.51.100.11',
      },
      payload: { messages: [{ role: 'user', content: 'two' }] },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    await app.close();
  });

  it('uses the forwarded client identity from a trusted CIDR peer', async () => {
    fetchMock.mockImplementation(async () => (
      new Response(JSON.stringify({ choices: [] }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const config = secureProductionConfig({ rateLimitMax: 1, rateLimitWindowMs: 60_000 });
    const app = await buildApp({ config, logger: false });
    const send = (clientIp: string) => app.inject({
      method: 'POST',
      url: '/v1/chat',
      remoteAddress: '10.1.2.3',
      headers: {
        authorization: 'Bearer production-test-token',
        'x-forwarded-for': clientIp,
      },
      payload: { messages: [{ role: 'user', content: clientIp }] },
    });

    const firstClient = await send('198.51.100.10');
    const secondClient = await send('198.51.100.11');

    expect(firstClient.statusCode).toBe(200);
    expect(secondClient.statusCode).toBe(200);
    await app.close();
  });

  it('uses the nearest forwarded hop and ignores forged left entries for one trusted hop', async () => {
    fetchMock.mockImplementation(async () => (
      new Response(JSON.stringify({ choices: [] }), { status: 200 })
    ));
    vi.stubGlobal('fetch', fetchMock);
    const config = secureProductionConfig({
      rateLimitMax: 1,
      rateLimitWindowMs: 60_000,
      trustProxy: 1,
      trustProxyContract: 'hops',
    });
    const app = await buildApp({ config, logger: false });
    const send = (xff: string) => app.inject({
      method: 'POST',
      url: '/v1/chat',
      remoteAddress: '10.1.2.3',
      headers: {
        authorization: 'Bearer production-test-token',
        'x-forwarded-for': xff,
      },
      payload: { messages: [{ role: 'user', content: xff }] },
    });

    const first = await send('203.0.113.1, 198.51.100.10');
    const forgedLeftEntry = await send('203.0.113.2, 198.51.100.10');
    const differentNearestClient = await send('203.0.113.2, 198.51.100.11');

    expect(first.statusCode).toBe(200);
    expect(forgedLeftEntry.statusCode).toBe(429);
    expect(differentNearestClient.statusCode).toBe(200);
    await app.close();
  });

  it('forwards a legal string-array embeddings request unchanged', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ embedding: [0.1], index: 0 }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp({ config: secureProductionConfig(), logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/embeddings',
      headers: { authorization: 'Bearer production-test-token' },
      payload: { model: 'embed-model', input: ['first', 'second'] },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'embed-model',
      input: ['first', 'second'],
    });
    await app.close();
  });

  it('redacts upstream status bodies and exceptions', async () => {
    fetchMock.mockResolvedValueOnce(new Response('secret upstream body with sk-live-key', { status: 429 }));
    fetchMock.mockRejectedValueOnce(
      new Error('secret exception https://llm.example.test Authorization: Bearer sk-live-key'),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp({ config: secureProductionConfig(), logger: false });
    const request = {
      method: 'POST' as const,
      url: '/v1/chat',
      headers: { authorization: 'Bearer production-test-token' },
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    };

    const rejected = await app.inject(request);
    const failed = await app.inject(request);

    expect(rejected.statusCode).toBeGreaterThanOrEqual(500);
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    for (const response of [rejected, failed]) {
      expect(response.body).not.toContain('secret');
      expect(response.body).not.toContain('sk-live-key');
      expect(response.body).not.toContain('llm.example.test');
      expect(response.json()).toMatchObject({ requestId: expect.any(String) });
    }
    await app.close();
  });

  it('fails protected routes closed when the limiter store fails', async () => {
    class FailingStore {
      constructor(_options: unknown) {}
      incr(_key: string, callback: (error: Error | null) => void) {
        callback(new Error('limiter secret Authorization: Bearer should-never-log'));
      }
      child() {
        return this;
      }
    }

    const app = await buildApp({
      config: secureProductionConfig(),
      logger: false,
      rateLimitStore: FailingStore as never,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer production-test-token' },
      payload: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'request_rejected',
      code: 'REQUEST_GUARD_FAILED',
      requestId: expect.any(String),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not log request bodies, Authorization, upstream body, URL, key, or exception text', async () => {
    const logs: string[] = [];
    fetchMock.mockRejectedValue(
      new Error('private exception https://llm.example.test Authorization: Bearer sk-live-key'),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp({
      config: secureProductionConfig(),
      logger: {
        level: 'info',
        stream: { write: (chunk: string) => logs.push(String(chunk)) },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: { authorization: 'Bearer production-test-token' },
      payload: { messages: [{ role: 'user', content: 'private-business-body-canary' }] },
    });
    const output = logs.join('');

    expect(response.statusCode).toBe(502);
    expect(output).not.toContain('private-business-body-canary');
    expect(output).not.toContain('production-test-token');
    expect(output).not.toContain('private exception');
    expect(output).not.toContain('llm.example.test');
    expect(output).not.toContain('sk-live-key');
    await app.close();
  });
});

describe('health and readiness split', () => {
  it('keeps liveness public and readiness protected without exposing config values', async () => {
    const app = await buildApp({ config: secureProductionConfig(), logger: false });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const unauthorizedReady = await app.inject({ method: 'GET', url: '/ready' });
    const ready = await app.inject({
      method: 'GET',
      url: '/ready',
      headers: { authorization: 'Bearer production-test-token' },
    });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: 'ok',
      service: 'copilot-cloud',
      liveness: true,
    });
    expect(health.json()).not.toHaveProperty('readiness');
    expect(health.json()).not.toHaveProperty('reasons');
    expect(Object.keys(health.json())).toHaveLength(7);
    expect(health.body).not.toContain('production-test-token');
    expect(health.body).not.toContain('llm.example.test');
    expect(unauthorizedReady.statusCode).toBe(401);
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ ready: true, reasons: [] });
    expect(ready.body).not.toContain('production-test-token');
    expect(ready.body).not.toContain('llm.example.test');
    await app.close();
  });

  it('returns protected 503 readiness reason codes for an unsafe non-production fixture', async () => {
    const app = await buildApp({ config: buildTestConfig(), logger: false });
    const response = await app.inject({
      method: 'GET',
      url: '/ready',
      headers: { authorization: 'Bearer test-token-1' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ready: false,
      reasons: expect.arrayContaining(['PORT_INVALID', 'LLM_BASE_URL_INVALID', 'TRUST_PROXY_MISSING']),
    });
    expect(response.body).not.toContain('sk-test-12345');
    expect(response.body).not.toContain('fake-llm.test');
    await app.close();
  });
});
