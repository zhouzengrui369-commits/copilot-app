/**
 * Bearer token auth — per-device shared token.
 *
 * Token comes from app config (synced from desktop). For dev/test, a default
 * dev-local-test-token is used so curl works without .env. In production,
 * COPILOT_CLOUD_TOKENS must be set (comma-separated).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerConfig } from '../config.js';

const BEARER_PREFIX = 'Bearer ';
const ALLOW_PATHS = new Set(['/health', '/']);

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export async function registerAuth(
  app: FastifyInstance,
  config: ServerConfig,
): Promise<void> {
  if (!config.auth.enabled) {
    app.log.warn('auth disabled (AUTH_DISABLED=1) — all requests accepted');
    return;
  }

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'OPTIONS') return;
    if (ALLOW_PATHS.has(req.url)) return;
    // Backup owns an independent bearer verifier. LLM/client tokens must not
    // authorize backup and backup tokens must not authorize proxy routes.
    if (req.url.split('?', 1)[0] === config.backup.path) return;

    const token = extractToken(req);
    if (!token) {
      return reply.code(401).send({
        error: 'unauthorized',
        code: 'AUTH_REQUIRED',
        requestId: String(req.id),
      });
    }

    if (!config.auth.sharedTokens.includes(token)) {
      return reply.code(401).send({
        error: 'unauthorized',
        code: 'AUTH_INVALID',
        requestId: String(req.id),
      });
    }
  });
}
