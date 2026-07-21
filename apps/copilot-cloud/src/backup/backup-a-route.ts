/** Metadata-only Backup A route. No snapshot body, queue, DB, COS call or retry. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../config.js';
import {
  BACKUP_MAX_METADATA_BODY_BYTES,
  BackupContractError,
  CosV5BackupPresigner,
  parseBackupPresignRequest,
  verifyBackupBearer,
  type BackupPresigner,
} from './backup-a-presign.js';

export interface BackupRouteOptions {
  presigner?: BackupPresigner;
}

function sendBackupError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: string,
) {
  return reply.code(statusCode).send({
    error: 'backup_request_rejected',
    code,
    requestId: String(request.id),
  });
}

export async function registerBackupAPresign(
  app: FastifyInstance,
  config: ServerConfig,
  options: BackupRouteOptions = {},
): Promise<void> {
  const presigner = options.presigner ?? (
    config.backup.enabled ? new CosV5BackupPresigner(config.backup.cos) : null
  );

  app.post(config.backup.path, {
    bodyLimit: BACKUP_MAX_METADATA_BODY_BYTES,
  }, async (request, reply) => {
    if (!config.backup.enabled || !presigner) {
      return sendBackupError(reply, request, 403, 'BACKUP_DISABLED');
    }

    const authorization = typeof request.headers.authorization === 'string'
      ? request.headers.authorization
      : undefined;
    if (!authorization?.startsWith('Bearer ') || !authorization.slice('Bearer '.length).trim()) {
      return sendBackupError(reply, request, 401, 'BACKUP_AUTH_REQUIRED');
    }
    const identity = verifyBackupBearer(authorization, config.backup.authBindings);
    if (!identity) {
      return sendBackupError(reply, request, 401, 'BACKUP_AUTH_INVALID');
    }

    try {
      const metadata = parseBackupPresignRequest(request.body);
      const result = await presigner.presign({
        ownerHash: identity.ownerHash,
        targetHash: identity.targetHash,
        request: metadata,
      });
      // Do not log result: it contains a credential-bearing presigned URL.
      return reply.code(200).send(result);
    } catch (error) {
      const code = error instanceof BackupContractError
        ? error.code
        : 'BACKUP_PRESIGN_FAILED';
      const status = error instanceof BackupContractError ? 400 : 503;
      return sendBackupError(reply, request, status, code);
    }
  });
}
