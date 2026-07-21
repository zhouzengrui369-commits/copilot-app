import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../../src/index.js';
import { buildTestConfig } from '../helpers.js';

type JsonResponse = { status: number; body: unknown };

async function requestJson(
  port: number,
  method: string,
  requestPath: string,
  body?: unknown,
  authorized = true,
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: requestPath,
      headers: {
        ...(authorized ? { authorization: 'Bearer test-token-1' } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Phase 1 cloud stateless boundary integration', () => {
  it('boots on an ephemeral port, authenticates proxy calls, and exposes no KB/KG persistence API', async () => {
    const upstreamBodies: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      upstreamBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 'local-fixture', choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const app = await buildApp({ config: buildTestConfig(), logger: false });
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const port = (app.server.address() as AddressInfo).port;
      const health = await requestJson(port, 'GET', '/health', undefined, false);
      expect(health.status).toBe(200);

      const unauthorized = await requestJson(port, 'POST', '/v1/chat', {
        messages: [{ role: 'user', content: 'private prompt' }],
      }, false);
      expect(unauthorized.status).toBe(401);

      const proxied = await requestJson(port, 'POST', '/v1/chat', {
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'private prompt' }],
      });
      expect(proxied).toMatchObject({ status: 200, body: { id: 'local-fixture' } });
      expect(upstreamBodies).toHaveLength(1);

      for (const route of ['/v1/notes', '/v1/kb', '/v1/kg']) {
        const absent = await requestJson(port, 'GET', route);
        expect(absent.status).toBe(404);
        expect(JSON.stringify(absent.body)).not.toContain('private prompt');
      }
      const serviceInfo = await requestJson(port, 'GET', '/', undefined, false);
      expect(JSON.stringify(serviceInfo.body)).not.toContain('private prompt');
      expect(JSON.stringify(serviceInfo.body)).not.toContain('/v1/notes');
    } finally {
      await app.close();
    }
  });
});
