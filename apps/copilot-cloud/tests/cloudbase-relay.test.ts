import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/index.js';
import { buildTestConfig, AUTH_HEADER } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('cloudbase relay', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ config: buildTestConfig({ auth: { enabled: false, sharedTokens: [] } }) });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET returns allowed events', async () => {
    const res = await app.inject({ method: 'GET', url: '/cloudbase-relay' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.relay).toBe('cloudbase');
    expect(body.allowedEvents).toContain('ping');
  });

  it('POST ping returns ok', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cloudbase-relay',
      headers: AUTH_HEADER,
      payload: { event: 'ping' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    expect(res.json().event).toBe('ping');
  });

  it('POST status returns service info', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cloudbase-relay',
      headers: AUTH_HEADER,
      payload: { event: 'status' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.1.0-test');
  });

  it('rejects unknown event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/cloudbase-relay',
      headers: AUTH_HEADER,
      payload: { event: 'rm-rf' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_event');
  });

  it('is disabled when config.cloudbase.relayEnabled=false', async () => {
    const a = await buildApp({
      config: buildTestConfig({
        cloudbase: { relayEnabled: false, relayPath: '/cloudbase-relay' },
        auth: { enabled: false, sharedTokens: [] },
      }),
    });
    await a.ready();
    const res = await a.inject({ method: 'GET', url: '/cloudbase-relay' });
    expect(res.statusCode).toBe(404);
    await a.close();
  });
});