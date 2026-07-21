/**
 * Rate limiter — `@fastify/rate-limit` 60 rpm / IP (configurable).
 *
 * Buckets by request IP. Health check is exempt (CloudBase probes otherwise hit limit).
 */
import type { FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { ServerConfig } from '../config.js';

export async function registerRateLimit(
  app: FastifyInstance,
  config: ServerConfig,
  store?: fastifyRateLimit.FastifyRateLimitStoreCtor,
): Promise<void> {
  await app.register(fastifyRateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (req) => req.ip,
    skipOnError: false,
    store,
    // Health check + service-info endpoints are exempt — CloudBase probes them
    // heavily, and they don't consume meaningful upstream bandwidth.
    allowList: (req) => req.url === '/health' || req.url === '/',
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    errorResponseBuilder: (request, context) => ({
      statusCode: 429,
      error: 'rate_limited',
      code: 'RATE_LIMIT_EXCEEDED',
      requestId: String(request.id),
      retryAfter: context.ttl,
    }),
  });
}
