/**
 * CloudBase relay — thin gateway for CloudBase container services.
 *
 * CloudBase container services sometimes need a relay endpoint to coordinate
 * deployment lifecycle hooks (warm-up ping, drain, status). This route exposes
 * a minimal JSON in/out. Real CloudBase integration is in Sprint 1.3.
 *
 * Goal: keep this dependency-light and stateless — no KB/KG ever lands here.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerConfig } from '../config.js';

interface RelayBody {
  event?: string;
  payload?: Record<string, unknown>;
}

const ALLOWED_EVENTS = new Set(['ping', 'drain', 'status', 'rotate']);

export async function registerCloudBaseRelay(
  app: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  if (!config.cloudbase.relayEnabled) return;

  app.post(config.cloudbase.relayPath, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as RelayBody;
    const event = body.event ?? 'ping';

    if (!ALLOWED_EVENTS.has(event)) {
      return reply.code(400).send({
        error: 'invalid_event',
        message: `Event '${event}' not allowed. Use one of: ${[...ALLOWED_EVENTS].join(', ')}.`,
      });
    }

    if (event === 'ping') {
      return reply.send({
        status: 'ok',
        event,
        relayedAt: Date.now(),
        service: 'copilot-cloud',
      });
    }

    if (event === 'status') {
      return reply.send({
        status: 'ok',
        event,
        uptimeMs: Date.now() - (app.hasPlugin('app') ? 0 : 0),
        version: config.version,
        nodeEnv: config.nodeEnv,
      });
    }

    if (event === 'drain' || event === 'rotate') {
      req.log.info({ event }, 'cloudbase relay received lifecycle event');
      return reply.send({ status: 'acknowledged', event });
    }

    return reply.code(500).send({ error: 'unhandled_event', event });
  });

  app.get(config.cloudbase.relayPath, async () => ({
    relay: 'cloudbase',
    enabled: true,
    version: config.version,
    allowedEvents: [...ALLOWED_EVENTS],
  }));
}