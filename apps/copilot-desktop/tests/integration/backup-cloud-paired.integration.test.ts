import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { CosV5BackupPresigner } from '../../../copilot-cloud/src/backup/backup-a-presign.js';
import { registerBackupAPresign } from '../../../copilot-cloud/src/backup/backup-a-route.js';
import type { ServerConfig } from '../../../copilot-cloud/src/config.js';
import {
  BACKUP_CONTENT_TYPE,
  MetadataOnlyPresignClient,
  type PresignMetadata,
} from '../../src/main/backup/index.js';
import {
  CloudBackupPresignTransport,
  FetchDirectCiphertextAdapter,
  InMemoryPresignGrantRegistry,
} from '../../src/main/backup-integration/cloud-adapters.js';

const NOW = 1_725_000_000_000;
const TOKEN = 'paired-backup-token';
const OWNER = '1'.repeat(64);
const TARGET = '2'.repeat(64);
const REGION = 'ap-guangzhou';
const BUCKET = 'copilot-backup-1250000000';
const SNAPSHOT = '123e4567-e89b-42d3-a456-426614174000';
const KEY = `backup/v1/${OWNER}/${TARGET}/${SNAPSHOT}.cbackup`;

const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function metadata(method: PresignMetadata['method'], ciphertext?: Uint8Array): PresignMetadata {
  return {
    method,
    region: REGION,
    bucket: BUCKET,
    ownerHash: OWNER,
    targetHash: TARGET,
    snapshotId: SNAPSHOT,
    key: KEY,
    ttlSeconds: 60,
    contentType: BACKUP_CONTENT_TYPE,
    ...(method === 'PUT' && ciphertext ? {
      ciphertextBytes: ciphertext.byteLength,
      ciphertextSha256: createHash('sha256').update(ciphertext).digest('hex'),
    } : {}),
  };
}

describe('paired Desktop and Cloud Backup protocol integration', () => {
  it('presigns metadata in Cloud and performs one-use ciphertext PUT/HEAD/GET/DELETE in Desktop adapters', async () => {
    const config = {
      port: 0,
      host: '127.0.0.1',
      nodeEnv: 'test',
      version: '0.1.0-test',
      logLevel: 'error',
      corsOrigins: ['https://test-client.example'],
      trustProxy: false,
      trustProxyContract: 'none',
      rateLimitMax: 1_000,
      rateLimitWindowMs: 60_000,
      auth: { enabled: true, sharedTokens: ['test-token'] },
      llm: {
        baseUrl: 'http://fake-llm.test/v1',
        apiKey: 'sk-test-not-used',
        chatPath: '/chat/completions',
        embeddingsPath: '/embeddings',
        timeoutMs: 5_000,
      },
      cloudbase: { relayEnabled: false, relayPath: '/cloudbase-relay' },
      remote: { enabled: false, path: '/v1/remote/ws' },
      backup: {
        enabled: true,
        path: '/v1/backup/presign',
        authBindings: [{ token: TOKEN, ownerHash: OWNER, targetHash: TARGET }],
        authBindingsState: 'valid',
        cos: {
          region: REGION,
          bucket: BUCKET,
          secretId: 'paired-secret-id',
          secretKey: 'paired-secret-key',
          securityToken: '',
        },
      },
    } satisfies ServerConfig;
    const app = Fastify({ logger: false });
    await registerBackupAPresign(
      app,
      config,
      { presigner: new CosV5BackupPresigner(config.backup.cos, () => NOW) },
    );
    apps.push(app);

    const cloudFetch = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/backup/presign',
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        payload: String(init?.body ?? ''),
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': response.headers['content-type'] ?? 'application/json' },
      });
    };

    const objects = new Map<string, Uint8Array>();
    const objectFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = String(init?.method);
      const headers = new Headers(init?.headers);
      expect(url).toContain(`https://${BUCKET}.cos.${REGION}.myqcloud.com/${KEY}?`);
      expect(headers.get('content-type')).toBe(BACKUP_CONTENT_TYPE);
      if (method === 'PUT') {
        const value = new Uint8Array(init?.body as ArrayBuffer);
        expect(headers.get('content-length')).toBe(String(value.byteLength));
        expect(headers.get('x-cos-meta-ciphertext-sha256')).toBe(
          createHash('sha256').update(value).digest('hex'),
        );
        objects.set(KEY, Uint8Array.from(value));
        return new Response(null, { status: 200 });
      }
      const stored = objects.get(KEY);
      if (method === 'HEAD') {
        return stored
          ? new Response(null, { status: 200, headers: {
            'content-length': String(stored.byteLength),
            'x-cos-meta-ciphertext-sha256': createHash('sha256').update(stored).digest('hex'),
          } })
          : new Response(null, { status: 404 });
      }
      if (method === 'GET' && stored) {
        return new Response(Buffer.from(stored), {
          status: 200,
          headers: { 'content-length': String(stored.byteLength) },
        });
      }
      if (method === 'DELETE') {
        objects.delete(KEY);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    };

    const registry = new InMemoryPresignGrantRegistry();
    const transport = new CloudBackupPresignTransport({
      endpoint: 'https://cloud.example.test/v1/backup/presign',
      token: TOKEN,
      fetcher: cloudFetch,
      registry,
      now: () => NOW,
    });
    const client = new MetadataOnlyPresignClient(transport, () => NOW);
    const direct = new FetchDirectCiphertextAdapter(objectFetch, registry, () => undefined, () => NOW);
    const ciphertext = new TextEncoder().encode('ciphertext-only-paired-fixture');

    const put = await client.request(metadata('PUT', ciphertext));
    await expect(direct.put(put, ciphertext)).resolves.toEqual({
      bytes: ciphertext.byteLength,
      sha256: createHash('sha256').update(ciphertext).digest('hex'),
    });
    await expect(direct.put(put, ciphertext)).rejects.toMatchObject({ code: 'PRESIGN_FORBIDDEN' });

    const head = await client.request(metadata('HEAD'));
    await expect(direct.head(head)).resolves.toMatchObject({ exists: true, bytes: ciphertext.byteLength });
    const get = await client.request(metadata('GET'));
    const downloaded = await direct.get(get);
    expect(downloaded).toMatchObject({ contentLength: ciphertext.byteLength });
    expect(Buffer.from((downloaded as { ciphertext: Uint8Array }).ciphertext)).toEqual(Buffer.from(ciphertext));

    const remove = await client.request(metadata('DELETE'));
    await expect(direct.delete(remove)).resolves.toBeUndefined();
    const absent = await client.request(metadata('HEAD'));
    await expect(direct.head(absent)).resolves.toEqual({ exists: false });
    expect(objects.size).toBe(0);
  });
});
