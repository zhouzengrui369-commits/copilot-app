/**
 * CORS middleware — allowlisted origins from config.
 *
 * In production, default is no wildcard (corsOrigins must be set explicitly).
 * In dev/test, defaults to "*" for ease of local curl/playwright.
 */
import type { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import type { ServerConfig } from '../config.js';

export async function registerCors(app: FastifyInstance, config: ServerConfig): Promise<void> {
  const origins = config.corsOrigins;
  const allowAny = origins.length === 1 && origins[0] === '*';

  await app.register(fastifyCors, {
    origin: origins.length === 0 ? false : allowAny ? true : origins,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: false,
    maxAge: 600,
  });
}
