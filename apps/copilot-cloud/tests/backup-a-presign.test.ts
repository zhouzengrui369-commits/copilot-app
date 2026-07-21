import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import {
  BACKUP_CONTENT_TYPE,
  CosV5BackupPresigner,
  deriveBackupObjectKey,
  type BackupPresignResult,
  type BackupPresigner,
} from '../src/backup/backup-a-presign.js';
import { loadConfig, ProductionConfigError } from '../src/config.js';
import { AUTH_HEADER, buildTestConfig } from './helpers.js';

const BACKUP_TOKEN = 'backup-only-test-token';
const OWNER_HASH = 'a'.repeat(64);
const TARGET_HASH = 'b'.repeat(64);
const SNAPSHOT_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW_MS = 1_750_000_000_000;
const COS_FIXTURE = {
  region: 'ap-guangzhou',
  bucket: 'copilot-backup-1250000000',
  secretId: 'AKID_TEST_ONLY_NOT_A_SECRET',
  secretKey: 'test-only-secret-key',
  securityToken: 'test-only-short-lived-security-token',
};

function backupConfig() {
  return buildTestConfig({
    backup: {
      enabled: true,
      path: '/v1/backup/presign',
      authBindings: [{ token: BACKUP_TOKEN, ownerHash: OWNER_HASH, targetHash: TARGET_HASH }],
      authBindingsState: 'valid',
      cos: COS_FIXTURE,
    },
  });
}

function validPutPayload() {
  return {
    schemaVersion: 1,
    method: 'PUT',
    snapshotId: SNAPSHOT_ID,
    ttlSeconds: 120,
    contentType: BACKUP_CONTENT_TYPE,
    ciphertextBytes: 4096,
    ciphertextSha256: 'c'.repeat(64),
  };
}

function authHeader(token = BACKUP_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function independentCosV5Check(input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  secretKey: string;
  nowMs: number;
}): boolean {
  const url = new URL(input.url);
  const signTime = url.searchParams.get('q-sign-time');
  const keyTime = url.searchParams.get('q-key-time');
  const secretId = url.searchParams.get('q-ak');
  const signature = url.searchParams.get('q-signature');
  const headerList = url.searchParams.get('q-header-list') ?? '';
  const paramList = url.searchParams.get('q-url-param-list') ?? '';
  if (!signTime || signTime !== keyTime || !secretId || !signature) return false;
  const [startRaw, endRaw] = signTime.split(';');
  const start = Number(startRaw);
  const end = Number(endRaw);
  const now = Math.floor(input.nowMs / 1000);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || now < start || now > end) {
    return false;
  }

  const normalizedHeaders = Object.fromEntries(
    Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const canonicalHeaders = headerList
    .split(';')
    .filter(Boolean)
    .map((key) => {
      const value = normalizedHeaders[key];
      if (value === undefined) throw new Error(`missing independently verified header: ${key}`);
      return `${rfc3986(key).toLowerCase()}=${rfc3986(value)}`;
    })
    .join('&');
  const canonicalQuery = paramList
    .split(';')
    .filter(Boolean)
    .map((key) => `${rfc3986(key).toLowerCase()}=${rfc3986(url.searchParams.get(key) ?? '')}`)
    .join('&');
  const httpString = `${input.method.toLowerCase()}\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n`;
  const stringToSign = `sha1\n${signTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`;
  const signKey = createHmac('sha1', input.secretKey).update(signTime).digest('hex');
  const expected = createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return expected === signature;
}

function actualPutHeaders(result: BackupPresignResult): Record<string, string> {
  return {
    host: new URL(result.url).host,
    ...result.requiredHeaders,
  };
}

describe('Backup A COS V5 production presigner', () => {
  it('derives the exact fixed key from authenticated hashes and a UUIDv4', () => {
    expect(deriveBackupObjectKey(OWNER_HASH, TARGET_HASH, SNAPSHOT_ID)).toBe(
      `backup/v1/${OWNER_HASH}/${TARGET_HASH}/${SNAPSHOT_ID}.cbackup`,
    );
    expect(() => deriveBackupObjectKey('../owner', TARGET_HASH, SNAPSHOT_ID)).toThrowError(
      'BACKUP_IDENTITY_INVALID',
    );
    expect(() => deriveBackupObjectKey(OWNER_HASH, TARGET_HASH, 'not-a-uuid')).toThrowError(
      'SNAPSHOT_ID_INVALID',
    );
  });

  it('matches an independent implementation of the official COS V5 algorithm', async () => {
    const presigner = new CosV5BackupPresigner(COS_FIXTURE, () => NOW_MS);
    const result = await presigner.presign({
      ownerHash: OWNER_HASH,
      targetHash: TARGET_HASH,
      request: validPutPayload(),
    });

    expect(result.method).toBe('PUT');
    expect(result.key).toBe(`backup/v1/${OWNER_HASH}/${TARGET_HASH}/${SNAPSHOT_ID}.cbackup`);
    expect(result.expiresAtMs).toBe(NOW_MS + 120_000);
    expect(result.requiredHeaders).toEqual({
      'content-length': '4096',
      'content-type': BACKUP_CONTENT_TYPE,
      'x-cos-meta-ciphertext-sha256': 'c'.repeat(64),
    });
    expect(independentCosV5Check({
      url: result.url,
      method: 'PUT',
      headers: actualPutHeaders(result),
      secretKey: COS_FIXTURE.secretKey,
      nowMs: NOW_MS,
    })).toBe(true);
  });

  it.each(['PUT', 'GET', 'HEAD', 'DELETE'] as const)(
    'generates a method-bound %s URL with signed host and exact content type',
    async (method) => {
      const presigner = new CosV5BackupPresigner(COS_FIXTURE, () => NOW_MS);
      const request = method === 'PUT'
        ? validPutPayload()
        : {
            schemaVersion: 1 as const,
            method,
            snapshotId: SNAPSHOT_ID,
            ttlSeconds: 60,
            contentType: BACKUP_CONTENT_TYPE,
          };
      const result = await presigner.presign({ ownerHash: OWNER_HASH, targetHash: TARGET_HASH, request });
      const url = new URL(result.url);

      expect(url.protocol).toBe('https:');
      expect(url.host).toBe(`${COS_FIXTURE.bucket}.cos.${COS_FIXTURE.region}.myqcloud.com`);
      expect(url.searchParams.get('q-header-list')).toContain('host');
      expect(url.searchParams.get('q-header-list')).toContain('content-type');
      expect(independentCosV5Check({
        url: result.url,
        method,
        headers: { host: url.host, ...result.requiredHeaders },
        secretKey: COS_FIXTURE.secretKey,
        nowMs: NOW_MS,
      })).toBe(true);
    },
  );

  it('fails independent verification after method, key, size, hash, or expiry mutation', async () => {
    const presigner = new CosV5BackupPresigner(COS_FIXTURE, () => NOW_MS);
    const result = await presigner.presign({
      ownerHash: OWNER_HASH,
      targetHash: TARGET_HASH,
      request: validPutPayload(),
    });
    const headers = actualPutHeaders(result);
    const mutatedKeyUrl = new URL(result.url);
    mutatedKeyUrl.pathname = `${mutatedKeyUrl.pathname}.other`;
    const check = (overrides: Partial<Parameters<typeof independentCosV5Check>[0]>) =>
      independentCosV5Check({
        url: result.url,
        method: 'PUT',
        headers,
        secretKey: COS_FIXTURE.secretKey,
        nowMs: NOW_MS,
        ...overrides,
      });

    expect(check({ method: 'DELETE' })).toBe(false);
    expect(check({ url: mutatedKeyUrl.toString() })).toBe(false);
    expect(check({ headers: { ...headers, 'content-length': '4097' } })).toBe(false);
    expect(check({ headers: { ...headers, 'x-cos-meta-ciphertext-sha256': 'd'.repeat(64) } })).toBe(false);
    expect(check({ nowMs: NOW_MS + 121_000 })).toBe(false);
  });

  it('uses the injected clock and rejects unsafe signing configuration', async () => {
    expect(() => new CosV5BackupPresigner({ ...COS_FIXTURE, bucket: '../bucket' }, () => NOW_MS))
      .toThrowError('BACKUP_COS_CONFIG_INVALID');
    expect(() => new CosV5BackupPresigner({ ...COS_FIXTURE, secretKey: '' }, () => NOW_MS))
      .toThrowError('BACKUP_COS_CONFIG_INVALID');
  });
});

describe('Backup A metadata-only presign route', () => {
  it('defaults backup OFF and rejects presign without invoking a signer', async () => {
    const presigner: BackupPresigner = { presign: vi.fn() };
    const app = await buildApp({ config: buildTestConfig(), logger: false, backupPresigner: presigner });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/backup/presign',
      headers: authHeader(),
      payload: validPutPayload(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'BACKUP_DISABLED' });
    expect(presigner.presign).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires the independent backup credential and rejects the LLM credential', async () => {
    const presigner: BackupPresigner = { presign: vi.fn() };
    const app = await buildApp({ config: backupConfig(), logger: false, backupPresigner: presigner });
    const missing = await app.inject({
      method: 'POST', url: '/v1/backup/presign', payload: validPutPayload(),
    });
    const llmCredential = await app.inject({
      method: 'POST', url: '/v1/backup/presign', headers: AUTH_HEADER, payload: validPutPayload(),
    });

    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ code: 'BACKUP_AUTH_REQUIRED' });
    expect(llmCredential.statusCode).toBe(401);
    expect(llmCredential.json()).toMatchObject({ code: 'BACKUP_AUTH_INVALID' });
    expect(presigner.presign).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not let the backup credential authorize the LLM proxy', async () => {
    const app = await buildApp({ config: backupConfig(), logger: false });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat',
      headers: authHeader(),
      payload: { messages: [{ role: 'user', content: 'never forwarded' }] },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_INVALID' });
    await app.close();
  });

  it('derives owner, target, and key only from the authenticated binding', async () => {
    const presign = vi.fn<BackupPresigner['presign']>().mockResolvedValue({
      schemaVersion: 1,
      method: 'PUT',
      snapshotId: SNAPSHOT_ID,
      key: `backup/v1/${OWNER_HASH}/${TARGET_HASH}/${SNAPSHOT_ID}.cbackup`,
      expiresAtMs: NOW_MS + 60_000,
      url: 'https://redacted.invalid/?q-signature=secret',
      requiredHeaders: {},
    });
    const app = await buildApp({
      config: backupConfig(), logger: false, backupPresigner: { presign },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/backup/presign',
      headers: authHeader(),
      payload: validPutPayload(),
    });

    expect(response.statusCode).toBe(200);
    expect(presign).toHaveBeenCalledWith({
      ownerHash: OWNER_HASH,
      targetHash: TARGET_HASH,
      request: validPutPayload(),
    });
    await app.close();
  });

  it.each([
    ['unknown method', { ...validPutPayload(), method: 'POST' }, 'METHOD_NOT_ALLOWED'],
    ['caller key', { ...validPutPayload(), key: 'backup/v1/caller-key' }, 'INVALID_SCHEMA'],
    ['caller owner', { ...validPutPayload(), ownerHash: 'd'.repeat(64) }, 'INVALID_SCHEMA'],
    ['caller target', { ...validPutPayload(), targetHash: 'e'.repeat(64) }, 'INVALID_SCHEMA'],
    ['wrong content type', { ...validPutPayload(), contentType: 'application/octet-stream' }, 'CONTENT_TYPE_INVALID'],
    ['zero ttl', { ...validPutPayload(), ttlSeconds: 0 }, 'TTL_INVALID'],
    ['long ttl', { ...validPutPayload(), ttlSeconds: 301 }, 'TTL_INVALID'],
    ['oversize', { ...validPutPayload(), ciphertextBytes: 256 * 1024 * 1024 + 1 }, 'CIPHERTEXT_SIZE_INVALID'],
    ['bad hash', { ...validPutPayload(), ciphertextSha256: 'not-a-hash' }, 'CIPHERTEXT_SHA256_INVALID'],
    ['non uuid', { ...validPutPayload(), snapshotId: '../snapshot' }, 'SNAPSHOT_ID_INVALID'],
  ])('fails closed for %s', async (_name, payload, code) => {
    const presigner: BackupPresigner = { presign: vi.fn() };
    const app = await buildApp({ config: backupConfig(), logger: false, backupPresigner: presigner });
    const response = await app.inject({
      method: 'POST', url: '/v1/backup/presign', headers: authHeader(), payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code });
    expect(presigner.presign).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(['GET', 'HEAD', 'DELETE'] as const)(
    'rejects PUT-only size and hash fields for %s',
    async (method) => {
      const presigner: BackupPresigner = { presign: vi.fn() };
      const app = await buildApp({ config: backupConfig(), logger: false, backupPresigner: presigner });
      const response = await app.inject({
        method: 'POST',
        url: '/v1/backup/presign',
        headers: authHeader(),
        payload: { ...validPutPayload(), method },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'INVALID_SCHEMA' });
      expect(presigner.presign).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it('allows exact-object DELETE metadata and exposes no bulk or lifecycle operation', async () => {
    const presign = vi.fn<BackupPresigner['presign']>().mockResolvedValue({
      schemaVersion: 1,
      method: 'DELETE',
      snapshotId: SNAPSHOT_ID,
      key: `backup/v1/${OWNER_HASH}/${TARGET_HASH}/${SNAPSHOT_ID}.cbackup`,
      expiresAtMs: NOW_MS + 60_000,
      url: 'https://redacted.invalid/',
      requiredHeaders: { 'content-type': BACKUP_CONTENT_TYPE },
    });
    const app = await buildApp({ config: backupConfig(), logger: false, backupPresigner: { presign } });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/backup/presign',
      headers: authHeader(),
      payload: {
        schemaVersion: 1,
        method: 'DELETE',
        snapshotId: SNAPSHOT_ID,
        ttlSeconds: 60,
        contentType: BACKUP_CONTENT_TYPE,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(presign).toHaveBeenCalledOnce();
    await app.close();
  });

  it('enforces the route body limit before touching a signer', async () => {
    const presigner: BackupPresigner = { presign: vi.fn() };
    const app = await buildApp({ config: backupConfig(), logger: false, backupPresigner: presigner });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/backup/presign',
      headers: authHeader(),
      payload: { ...validPutPayload(), padding: 'x'.repeat(5000) },
    });
    expect(response.statusCode).toBe(413);
    expect(presigner.presign).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects snapshot content and keeps body, token, signed URL, and query out of logs/errors', async () => {
    const logs: string[] = [];
    const presigner: BackupPresigner = { presign: vi.fn() };
    const app = await buildApp({
      config: backupConfig(),
      backupPresigner: presigner,
      logger: { level: 'info', stream: { write: (chunk: string) => logs.push(String(chunk)) } },
    });
    const snapshotCanary = 'plaintext-or-ciphertext-snapshot-body-canary';
    const response = await app.inject({
      method: 'POST',
      url: '/v1/backup/presign',
      headers: authHeader(),
      payload: { ...validPutPayload(), snapshotBody: snapshotCanary },
    });
    const output = logs.join('');
    expect(response.statusCode).toBe(400);
    expect(presigner.presign).not.toHaveBeenCalled();
    expect(response.body).not.toContain(snapshotCanary);
    expect(output).not.toContain(snapshotCanary);
    expect(output).not.toContain(BACKUP_TOKEN);
    expect(output).not.toContain(COS_FIXTURE.securityToken);
    expect(output).not.toContain('q-signature');
    await app.close();
  });
});

describe('Backup A production config fail-closed boundary', () => {
  const productionBase = {
    NODE_ENV: 'production',
    PORT: '8788',
    AUTH_DISABLED: '0',
    COPILOT_CLOUD_TOKENS: 'llm-token',
    LLM_API_KEY: 'llm-key',
    LLM_BASE_URL: 'https://llm.example.test',
    CORS_ORIGINS: 'https://desktop.example.test',
    TRUST_PROXY_CIDRS: '10.0.0.0/8',
  };

  it('is exactly opt-in and defaults OFF', () => {
    const config = loadConfig(productionBase);
    expect(config.backup.enabled).toBe(false);
    expect(config.backup.authBindings).toEqual([]);
  });

  it.each(['true', 'TRUE', 'yes', '0'])('keeps backup OFF for non-exact opt-in %j', (value) => {
    const config = loadConfig({ ...productionBase, BACKUP_ENABLED: value });
    expect(config.backup.enabled).toBe(false);
  });

  it('revalidates an injected production binding instead of trusting its state flag', async () => {
    const config = backupConfig();
    config.nodeEnv = 'production';
    config.port = 8788;
    config.corsOrigins = ['https://desktop.example.test'];
    config.trustProxy = ['10.0.0.0/8'];
    config.trustProxyContract = 'cidrs';
    config.auth = { enabled: true, sharedTokens: ['production-llm-token'] };
    config.llm = {
      ...config.llm,
      baseUrl: 'https://llm.example.test',
      apiKey: 'production-llm-key',
    };
    config.backup.authBindings = [{
      token: 'too-short',
      ownerHash: OWNER_HASH,
      targetHash: TARGET_HASH,
    }];
    config.backup.authBindingsState = 'valid';

    await expect(buildApp({ config, logger: false })).rejects.toMatchObject({
      code: 'BACKUP_AUTH_BINDINGS_INVALID',
    });
  });

  it.each([
    ['bindings', { BACKUP_AUTH_BINDINGS: undefined }, 'BACKUP_AUTH_BINDINGS_MISSING'],
    ['region', { COPILOT_BACKUP_COS_REGION: undefined }, 'BACKUP_COS_REGION_MISSING'],
    ['bucket', { COPILOT_BACKUP_COS_BUCKET: undefined }, 'BACKUP_COS_BUCKET_MISSING'],
    ['secret id', { COPILOT_BACKUP_COS_SECRET_ID: undefined }, 'BACKUP_COS_SECRET_ID_MISSING'],
    ['secret key', { COPILOT_BACKUP_COS_SECRET_KEY: undefined }, 'BACKUP_COS_SECRET_KEY_MISSING'],
  ])('rejects enabled production when %s is missing', (_name, missing, code) => {
    const complete = {
      ...productionBase,
      BACKUP_ENABLED: '1',
      BACKUP_AUTH_BINDINGS: JSON.stringify([
        { token: BACKUP_TOKEN, ownerHash: OWNER_HASH, targetHash: TARGET_HASH },
      ]),
      COPILOT_BACKUP_COS_REGION: COS_FIXTURE.region,
      COPILOT_BACKUP_COS_BUCKET: COS_FIXTURE.bucket,
      COPILOT_BACKUP_COS_SECRET_ID: COS_FIXTURE.secretId,
      COPILOT_BACKUP_COS_SECRET_KEY: COS_FIXTURE.secretKey,
      ...missing,
    };
    try {
      loadConfig(complete);
      throw new Error('expected backup production config to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionConfigError);
      expect(error).toMatchObject({ code });
      expect(String((error as Error).message)).toBe(code);
      expect(String((error as Error).message)).not.toContain(BACKUP_TOKEN);
      expect(String((error as Error).message)).not.toContain(COS_FIXTURE.secretKey);
    }
  });
});
