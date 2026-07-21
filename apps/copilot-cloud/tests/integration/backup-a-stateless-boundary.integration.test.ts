import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/index.js';
import { BACKUP_CONTENT_TYPE, type BackupPresigner } from '../../src/backup/backup-a-presign.js';
import { buildTestConfig } from '../helpers.js';

describe('Backup A metadata-only integration boundary', () => {
  it('passes only authenticated metadata to the signer and never accepts snapshot content', async () => {
    const ownerHash = '1'.repeat(64);
    const targetHash = '2'.repeat(64);
    const token = 'backup-integration-token';
    const presign = vi.fn<BackupPresigner['presign']>();
    const config = buildTestConfig({
      backup: {
        enabled: true,
        path: '/v1/backup/presign',
        authBindings: [{ token, ownerHash, targetHash }],
        authBindingsState: 'valid',
        cos: {
          region: 'ap-guangzhou',
          bucket: 'copilot-backup-1250000000',
          secretId: 'integration-id',
          secretKey: 'integration-key',
          securityToken: '',
        },
      },
    });
    const app = await buildApp({ config, logger: false, backupPresigner: { presign } });
    const response = await app.inject({
      method: 'POST',
      url: config.backup.path,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        schemaVersion: 1,
        method: 'PUT',
        snapshotId: '123e4567-e89b-42d3-a456-426614174000',
        ttlSeconds: 60,
        contentType: BACKUP_CONTENT_TYPE,
        ciphertextBytes: 32,
        ciphertextSha256: 'a'.repeat(64),
        snapshotContent: 'must-never-reach-signer-or-COS-from-cloud',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_SCHEMA' });
    expect(presign).not.toHaveBeenCalled();
    await app.close();
  });
});
