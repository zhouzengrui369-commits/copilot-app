/**
 * Health and readiness routes. Liveness never asserts readiness.
 *
 * GET /health → 200 with {status, version, uptimeMs, ts}.
 */
import type { FastifyInstance } from 'fastify';
import { STARTED_AT, readinessReasons, type ServerConfig } from '../config.js';

export async function registerHealthRoute(app: FastifyInstance, config: ServerConfig): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'copilot-cloud',
    version: config.version,
    liveness: true,
    uptimeMs: Date.now() - STARTED_AT,
    startedAt: STARTED_AT,
    ts: Date.now(),
  }));

  app.get('/ready', async (_request, reply) => {
    const reasons = readinessReasons(config);
    const ready = reasons.length === 0;
    return reply.code(ready ? 200 : 503).send({ ready, reasons });
  });
}
