import { describe, expect, it, vi } from 'vitest';

import {
  CloudBackupPresignTransport,
  FetchDirectCiphertextAdapter,
  InMemoryPresignGrantRegistry,
} from '../../src/main/backup-integration/cloud-adapters.js';
import type { PresignGrant, PresignMetadata } from '../../src/main/backup/index.js';

const NOW = 1_725_000_000_000;
const CONTENT_TYPE = 'application/vnd.njx.copilot-backup';
const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111';
const TARGET = {
  region: 'ap-shanghai',
  bucket: 'copilot-123456',
  ownerHash: 'a'.repeat(64),
  targetHash: 'b'.repeat(64),
};

function metadata(): PresignMetadata {
  return {
    method: 'HEAD',
    ...TARGET,
    snapshotId: SNAPSHOT_ID,
    key: `backup/v1/${TARGET.ownerHash}/${TARGET.targetHash}/${SNAPSHOT_ID}.cbackup`,
    ttlSeconds: 60,
    contentType: CONTENT_TYPE,
  };
}

function grant(meta: PresignMetadata, origin: string, query = 'q-signature=one_use_capability'): PresignGrant {
  return {
    method: meta.method,
    key: meta.key,
    url: `${origin}/${meta.key}?${query}`,
    contentType: CONTENT_TYPE,
    expiresAtMs: NOW + 60_000,
  };
}

describe('G1 Backup exact loopback endpoint policy', () => {
  it.each([
    'http://127.0.0.1:43123/v1/backup/presign',
    'http://[::1]:43123/v1/backup/presign',
    'https://backup.example.test/v1/backup/presign',
  ])('accepts an exact allowed presign endpoint: %s', (endpoint) => {
    expect(() => new CloudBackupPresignTransport({
      endpoint,
      token: 'backup-only-token',
      registry: new InMemoryPresignGrantRegistry(),
    })).not.toThrow();
  });

  it.each([
    'http://localhost:43123/v1/backup/presign',
    'http://backup.example.test:43123/v1/backup/presign',
    'http://127.0.0.1/v1/backup/presign',
    'http://user@127.0.0.1:43123/v1/backup/presign',
    'http://127.0.0.1:43123/v1/backup/presign?extra=1',
    'http://127.0.0.1:43123/v1/backup/presign#fragment',
    'http://127.0.0.1:43123/other',
  ])('rejects a non-exact or non-loopback plaintext presign endpoint: %s', (endpoint) => {
    expect(() => new CloudBackupPresignTransport({
      endpoint,
      token: 'backup-only-token',
      registry: new InMemoryPresignGrantRegistry(),
    })).toThrowError(expect.objectContaining({ code: 'PRESIGN_FORBIDDEN' }));
  });

  it('accepts an exact loopback object origin and keeps one-use/no-redirect direct fetch behavior', async () => {
    const origin = 'http://127.0.0.1:43124';
    const meta = metadata();
    const signedGrant = grant(meta, origin);
    const registry = new InMemoryPresignGrantRegistry({ objectOrigin: origin });
    const presignFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 1,
      method: meta.method,
      snapshotId: meta.snapshotId,
      key: meta.key,
      expiresAtMs: signedGrant.expiresAtMs,
      url: signedGrant.url,
      requiredHeaders: { 'content-type': CONTENT_TYPE },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const transport = new CloudBackupPresignTransport({
      endpoint: 'http://127.0.0.1:43123/v1/backup/presign',
      token: 'backup-only-token',
      fetcher: presignFetch,
      registry,
      now: () => NOW,
    });
    const issued = await transport.request(meta);
    const objectFetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { 'content-length': '0' },
    }));
    const adapter = new FetchDirectCiphertextAdapter(objectFetch, registry, () => undefined, () => NOW);

    await expect(adapter.head(issued)).resolves.toMatchObject({ exists: true, bytes: 0 });
    expect(objectFetch).toHaveBeenCalledWith(signedGrant.url, expect.objectContaining({
      method: 'HEAD',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }));
    await expect(adapter.head(issued)).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });
    expect(objectFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wrong origin', 'http://127.0.0.1:43125', 'q-signature=capability'],
    ['wrong path', 'http://127.0.0.1:43124', 'q-signature=capability'],
    ['missing signed query', 'http://127.0.0.1:43124', ''],
    ['unexpected query field', 'http://127.0.0.1:43124', 'token=capability'],
    ['duplicate signed field', 'http://127.0.0.1:43124', 'q-signature=one&q-signature=two'],
  ])('rejects a loopback grant with %s before fetch', (_name, origin, query) => {
    const configuredOrigin = 'http://127.0.0.1:43124';
    const meta = metadata();
    const candidate = grant(meta, origin, query);
    if (_name === 'wrong path') candidate.url = candidate.url.replace(`${SNAPSHOT_ID}.cbackup`, 'other.cbackup');
    const registry = new InMemoryPresignGrantRegistry({ objectOrigin: configuredOrigin });
    expect(() => registry.remember(meta, candidate, { 'content-type': CONTENT_TYPE }, NOW))
      .toThrowError(expect.objectContaining({ code: 'PRESIGN_FORBIDDEN' }));
  });

  it.each([
    'http://localhost:43124',
    'http://object.example.test:43124',
    'http://127.0.0.1',
    'http://user@127.0.0.1:43124',
    'http://127.0.0.1:43124/path',
    'http://127.0.0.1:43124?query=1',
    'http://127.0.0.1:43124#fragment',
  ])('rejects an unsafe configured object origin: %s', (objectOrigin) => {
    expect(() => new InMemoryPresignGrantRegistry({ objectOrigin }))
      .toThrowError(expect.objectContaining({ code: 'PRESIGN_FORBIDDEN' }));
  });

  it('preserves the canonical Tencent COS HTTPS origin and COS V5 signed query fields by default', () => {
    const meta = metadata();
    const query = new URLSearchParams({
      'q-sign-algorithm': 'sha1',
      'q-ak': 'AKIDEXAMPLE',
      'q-sign-time': '1725000000;1725000060',
      'q-key-time': '1725000000;1725000060',
      'q-header-list': 'content-type;host',
      'q-url-param-list': '',
      'q-signature': 'c'.repeat(40),
    }).toString();
    const canonicalOrigin = `https://${TARGET.bucket}.cos.${TARGET.region}.myqcloud.com`;
    const registry = new InMemoryPresignGrantRegistry();
    expect(() => registry.remember(
      meta,
      grant(meta, canonicalOrigin, query),
      { 'content-type': CONTENT_TYPE },
      NOW,
    )).not.toThrow();
  });
});
