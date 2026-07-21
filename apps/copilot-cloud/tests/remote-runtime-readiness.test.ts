import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const app = {
    setErrorHandler: vi.fn(),
    get: vi.fn(),
    listen: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    log: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
  };
  return {
    app,
    compositionStatus: 'provider_missing',
  };
});

vi.mock('fastify', () => ({ default: vi.fn(() => harness.app) }));
vi.mock('../src/middleware/rate-limit.js', () => ({ registerRateLimit: vi.fn(async () => undefined) }));
vi.mock('../src/middleware/cors.js', () => ({ registerCors: vi.fn(async () => undefined) }));
vi.mock('../src/middleware/auth.js', () => ({ registerAuth: vi.fn(async () => undefined) }));
vi.mock('../src/routes/health.js', () => ({ registerHealthRoute: vi.fn(async () => undefined) }));
vi.mock('../src/routes/v1-chat.js', () => ({ registerV1ChatRoute: vi.fn(async () => undefined) }));
vi.mock('../src/routes/v1-embeddings.js', () => ({ registerV1EmbeddingsRoute: vi.fn(async () => undefined) }));
vi.mock('../src/relay/cloudbase-handler.js', () => ({ registerCloudBaseRelay: vi.fn(async () => undefined) }));
vi.mock('../src/remote/remote-a-relay.js', () => ({ registerRemoteARelay: vi.fn(async () => undefined) }));
vi.mock('../src/backup/backup-a-route.js', () => ({ registerBackupAPresign: vi.fn(async () => undefined) }));
vi.mock('../src/remote/production-authority.js', () => ({
  createProductionRemoteAuthority: vi.fn(async () => ({
    status: harness.compositionStatus,
    relayOptions: {},
  })),
}));

import { loadConfig } from '../src/config.js';
import { remoteRuntimeReadinessReason, start } from '../src/index.js';

function removeNewSignalListeners(
  signal: 'SIGINT' | 'SIGTERM',
  before: readonly NodeJS.SignalsListener[],
): void {
  const retained = new Set(before);
  for (const listener of process.listeners(signal)) {
    if (!retained.has(listener)) process.removeListener(signal, listener);
  }
}

describe('Tencent Remote runtime readiness startup gate', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('REMOTE_RELAY_ENABLED', '1');
    vi.stubEnv('REMOTE_PAIRING_ISSUER_KEY_PATH', '');
    harness.compositionStatus = 'provider_missing';
    harness.app.setErrorHandler.mockClear();
    harness.app.get.mockClear();
    harness.app.listen.mockReset().mockResolvedValue(undefined);
    harness.app.close.mockReset().mockResolvedValue(undefined);
    harness.app.log.warn.mockClear();
    harness.app.log.info.mockClear();
    harness.app.log.error.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['missing', 'invalid', 'valid'] as const)(
    'keeps Remote OFF non-blocking for %s static provider state',
    (providerState) => {
      expect(remoteRuntimeReadinessReason(false, providerState, 'provider_invalid')).toBeNull();
    },
  );

  it('maps missing, invalid, ready and unknown non-ready compositions to stable codes only', () => {
    expect(remoteRuntimeReadinessReason(true, undefined, 'provider_missing'))
      .toBe('REMOTE_ISSUER_PROVIDER_MISSING');
    expect(remoteRuntimeReadinessReason(true, 'missing', 'provider_invalid'))
      .toBe('REMOTE_ISSUER_PROVIDER_MISSING');
    expect(remoteRuntimeReadinessReason(true, 'invalid', 'ready'))
      .toBe('REMOTE_ISSUER_PROVIDER_INVALID');
    expect(remoteRuntimeReadinessReason(true, 'valid', 'ready')).toBeNull();
    expect(remoteRuntimeReadinessReason(true, 'valid', 'provider_invalid'))
      .toBe('REMOTE_ISSUER_PROVIDER_NOT_READY');
    expect(remoteRuntimeReadinessReason(true, 'valid', 'future_unknown_status'))
      .toBe('REMOTE_ISSUER_PROVIDER_NOT_READY');
  });

  it('classifies missing issuer settings without inventing a path', () => {
    const missing = loadConfig({ NODE_ENV: 'test', REMOTE_RELAY_ENABLED: '1' });
    expect(missing.remote.authority).toMatchObject({ providerState: 'missing', issuerKeyPath: '' });
  });

  it.each([
    ['relative path', { REMOTE_PAIRING_ISSUER_KEY_PATH: 'relative/private-canary' }],
    ['newline path', { REMOTE_PAIRING_ISSUER_KEY_PATH: '/synthetic/private-canary\nvalue' }],
    ['invalid session limit', {
      REMOTE_PAIRING_ISSUER_KEY_PATH: '/synthetic/private-canary',
      REMOTE_PAIRING_MAX_SESSIONS: '0',
    }],
  ])('classifies %s as invalid without retaining rejected path values', (_label, remoteEnv) => {
    const invalid = loadConfig({
      NODE_ENV: 'test',
      REMOTE_RELAY_ENABLED: '1',
      ...remoteEnv,
    });
    expect(invalid.remote.authority).toMatchObject({ providerState: 'invalid', issuerKeyPath: '' });
  });

  it('keeps close and the stable throw lexically before listen and preserves stable entry output', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    const guard = source.indexOf('if (remoteReason)');
    const close = source.indexOf('await app.close().catch(() => undefined);', guard);
    const stableThrow = source.indexOf('throw new ProductionConfigError(remoteReason);', guard);
    const listen = source.indexOf('await app.listen', guard);
    expect(guard).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(guard);
    expect(stableThrow).toBeGreaterThan(close);
    expect(listen).toBeGreaterThan(stableThrow);
    expect(source.slice(guard, listen)).not.toMatch(/issuerKeyPath|state:\s*remoteProduction|error\.message/);
    const entry = source.indexOf('if (isEntry)');
    expect(source.slice(entry)).toContain("error: 'startup_failed', code");
    expect(source.slice(entry)).toContain('process.exitCode = 1');
  });

  it('closes the unlistened instance and fails missing provider before listen', async () => {
    await expect(start()).rejects.toMatchObject({ code: 'REMOTE_ISSUER_PROVIDER_MISSING' });
    expect(harness.app.close).toHaveBeenCalledOnce();
    expect(harness.app.listen).not.toHaveBeenCalled();
    expect(harness.app.log.info).not.toHaveBeenCalled();
    expect(harness.app.log.warn).toHaveBeenCalledWith(
      {
        code: 'REMOTE_AUTHORITY_DENY_ALL',
        reason: 'REMOTE_ISSUER_PROVIDER_MISSING',
      },
      'remote authority unavailable; relay verification remains deny-all',
    );
  });

  it('fails malformed static provider with its stable reason and redacts rejected values', async () => {
    const canary = 'relative/private-canary\nvalue';
    vi.stubEnv('REMOTE_PAIRING_ISSUER_KEY_PATH', canary);
    harness.compositionStatus = 'provider_invalid';

    await expect(start()).rejects.toMatchObject({ code: 'REMOTE_ISSUER_PROVIDER_INVALID' });
    expect(harness.app.close).toHaveBeenCalledOnce();
    expect(harness.app.listen).not.toHaveBeenCalled();
    expect(harness.app.log.info).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.app.log.warn.mock.calls)).not.toContain(canary);
  });

  it('fails a valid static config whose asynchronous provider is not ready without path detail', async () => {
    const absentMount = '/synthetic-absent/remote-issuer-private-canary.pem';
    vi.stubEnv('REMOTE_PAIRING_ISSUER_KEY_PATH', absentMount);
    harness.compositionStatus = 'provider_invalid';

    await expect(start()).rejects.toMatchObject({ code: 'REMOTE_ISSUER_PROVIDER_NOT_READY' });
    expect(harness.app.close).toHaveBeenCalledOnce();
    expect(harness.app.listen).not.toHaveBeenCalled();
    expect(harness.app.log.info).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.app.log.warn.mock.calls)).not.toContain(absentMount);
  });

  it('does not let close failure mask the stable startup reason', async () => {
    harness.app.close.mockRejectedValueOnce(new Error('synthetic close failure detail'));
    await expect(start()).rejects.toMatchObject({ code: 'REMOTE_ISSUER_PROVIDER_MISSING' });
    expect(harness.app.listen).not.toHaveBeenCalled();
  });

  it.each([
    ['Remote OFF', '0', '', 'provider_missing'],
    ['ready provider', '1', '/synthetic-external/remote-issuer.pem', 'ready'],
  ] as const)('preserves the listen path for %s', async (_label, enabled, issuerPath, status) => {
    vi.stubEnv('REMOTE_RELAY_ENABLED', enabled);
    vi.stubEnv('REMOTE_PAIRING_ISSUER_KEY_PATH', issuerPath);
    harness.compositionStatus = status;
    const beforeSigint = process.listeners('SIGINT');
    const beforeSigterm = process.listeners('SIGTERM');
    try {
      await expect(start()).resolves.toBe(harness.app);
      expect(harness.app.listen).toHaveBeenCalledOnce();
      expect(harness.app.close).not.toHaveBeenCalled();
    } finally {
      removeNewSignalListeners('SIGINT', beforeSigint);
      removeNewSignalListeners('SIGTERM', beforeSigterm);
    }
  });
});
