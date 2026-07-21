/**
 * Copilot Cloud Server — Fastify boot.
 *
 * Routes:
 *   GET  /health             — liveness + readiness probe
 *   GET  /                   — service info
 *   POST /v1/chat            — LLM proxy (streaming + non-streaming) → minimax m3
 *   POST /v1/embeddings      — embeddings proxy → minimax m3
 *   POST /cloudbase-relay    — CloudBase container lifecycle relay (opt-in)
 *
 * Goal.md v6.2 cloud boundary: cloud never computes KG/KB/graph. This service
 * is a thin LLM proxy; remote management and optional backup are separate work.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import {
  ProductionConfigError,
  assertProductionConfig,
  loadConfig,
  type ReadinessReasonCode,
  type RemoteAuthorityConfig,
  type ServerConfig,
} from './config.js';
import { registerCors } from './middleware/cors.js';
import { registerRateLimit } from './middleware/rate-limit.js';
import { registerAuth } from './middleware/auth.js';
import { registerHealthRoute } from './routes/health.js';
import { registerV1ChatRoute } from './routes/v1-chat.js';
import { registerV1EmbeddingsRoute } from './routes/v1-embeddings.js';
import { registerCloudBaseRelay } from './relay/cloudbase-handler.js';
import {
  registerRemoteARelay,
  type RemoteRelayOptions,
} from './remote/remote-a-relay.js';
import { createProductionRemoteAuthority } from './remote/production-authority.js';
import {
  registerBackupAPresign,
  type BackupRouteOptions,
} from './backup/backup-a-route.js';
import type { BackupPresigner } from './backup/backup-a-presign.js';

export interface BuildAppOptions {
  config?: ServerConfig;
  logger?: boolean | object;
  rateLimitStore?: fastifyRateLimit.FastifyRateLimitStoreCtor;
  remoteRelay?: RemoteRelayOptions;
  backupPresigner?: BackupPresigner;
}

export function remoteRuntimeReadinessReason(
  enabled: boolean,
  providerState: RemoteAuthorityConfig['providerState'] | undefined,
  compositionStatus: string,
): ReadinessReasonCode | null {
  if (!enabled) return null;
  if (providerState === undefined || providerState === 'missing') {
    return 'REMOTE_ISSUER_PROVIDER_MISSING';
  }
  if (providerState === 'invalid') return 'REMOTE_ISSUER_PROVIDER_INVALID';
  return compositionStatus === 'ready' ? null : 'REMOTE_ISSUER_PROVIDER_NOT_READY';
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  assertProductionConfig(config);

  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    disableRequestLogging: false,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);
    const safeError = typeof error === 'object' && error !== null
      ? error as { code?: string; statusCode?: number }
      : {};
    let statusCode = 503;
    let errorName = 'request_rejected';
    let code = 'REQUEST_GUARD_FAILED';

    if (safeError.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      statusCode = 413;
      errorName = 'invalid_request';
      code = 'REQUEST_BODY_TOO_LARGE';
    } else if (safeError.statusCode === 429) {
      statusCode = 429;
      errorName = 'rate_limited';
      code = 'RATE_LIMIT_EXCEEDED';
    } else if (safeError.statusCode === 400) {
      statusCode = 400;
      errorName = 'invalid_request';
      code = 'INVALID_JSON';
    } else if (
      safeError.statusCode &&
      safeError.statusCode >= 400 &&
      safeError.statusCode < 500
    ) {
      statusCode = safeError.statusCode;
      errorName = 'invalid_request';
      code = 'REQUEST_REJECTED';
    }

    request.log.error({ code, requestId, statusCode }, 'request failed closed');
    return reply.code(statusCode).send({ error: errorName, code, requestId });
  });

  // Order: rate-limit → cors → auth → routes (auth checks Authorization)
  await registerRateLimit(app, config, options.rateLimitStore);
  await registerCors(app, config);
  await registerAuth(app, config);

  app.get('/', async () => ({
    service: 'copilot-cloud',
    version: config.version,
    nodeEnv: config.nodeEnv,
    routes: [
      '/health',
      '/ready',
      '/v1/chat',
      '/v1/embeddings',
      '/cloudbase-relay',
      config.backup.path,
    ],
  }));

  await registerHealthRoute(app, config);
  await registerV1ChatRoute(app, config);
  await registerV1EmbeddingsRoute(app, config);
  await registerCloudBaseRelay(app, config);
  await registerRemoteARelay(app, config, options.remoteRelay);
  const backupOptions: BackupRouteOptions = { presigner: options.backupPresigner };
  await registerBackupAPresign(app, config, backupOptions);

  return app;
}

export async function start(): Promise<FastifyInstance> {
  const config = loadConfig();
  const authorityConfig = config.remote.authority?.providerState === 'valid'
    ? {
      issuerKeyPath: config.remote.authority.issuerKeyPath,
      maxSessions: config.remote.authority.maxSessions,
      maxUsedRequests: config.remote.authority.maxUsedRequests,
      sessionTtlMs: config.remote.authority.sessionTtlMs,
    }
    : null;
  const remoteProduction = await createProductionRemoteAuthority({
    config: authorityConfig,
    relayPath: config.remote.path,
  });
  const app = await buildApp({ config, remoteRelay: remoteProduction.relayOptions });
  const remoteReason = remoteRuntimeReadinessReason(
    config.remote.enabled,
    config.remote.authority?.providerState,
    remoteProduction.status,
  );

  if (remoteReason) {
    app.log.warn(
      { code: 'REMOTE_AUTHORITY_DENY_ALL', reason: remoteReason },
      'remote authority unavailable; relay verification remains deny-all',
    );
    await app.close().catch(() => undefined);
    throw new ProductionConfigError(remoteReason);
  }

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      { port: config.port, host: config.host, env: config.nodeEnv },
      'copilot-cloud listening',
    );
  } catch (err) {
    app.log.error({ code: 'STARTUP_LISTEN_FAILED' }, 'failed to start');
    await app.close().catch(() => undefined);
    throw err;
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch {
      app.log.error({ code: 'SHUTDOWN_FAILED' }, 'shutdown error');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return app;
}

// Run if this file is invoked directly (not imported for testing).
const isEntry =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('index.ts') ||
  process.argv[1]?.endsWith('index.js');

if (isEntry) {
  void start().catch((error: unknown) => {
    const code = error instanceof ProductionConfigError ? error.code : 'STARTUP_FAILED';
    process.stderr.write(`${JSON.stringify({ error: 'startup_failed', code })}\n`);
    process.exitCode = 1;
  });
}
