import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import { buildTestConfig, AUTH_HEADER } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('health route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ config: buildTestConfig({ auth: { enabled: false, sharedTokens: [] } }) });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('copilot-cloud');
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.ts).toBeGreaterThan(0);
  });

  it('service info root endpoint works', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe('copilot-cloud');
    expect(body.routes).toContain('/health');
    expect(body.routes).toContain('/v1/chat');
  });
});