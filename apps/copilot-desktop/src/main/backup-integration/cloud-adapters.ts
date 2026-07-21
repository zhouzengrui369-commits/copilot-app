import { createHash } from 'node:crypto';

import {
  BACKUP_CONTENT_TYPE,
  DEFAULT_BACKUP_MAX_BYTES,
  BackupProtocolError,
  type DirectCiphertextAdapter,
  type PresignGrant,
  type PresignMetadata,
  type PresignTransport,
} from '../backup/index.js';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '[::1]']);
const COS_QUERY_KEYS = [
  'q-ak',
  'q-header-list',
  'q-key-time',
  'q-sign-algorithm',
  'q-sign-time',
  'q-signature',
  'q-url-param-list',
] as const;

function fail(code: 'PRESIGN_FORBIDDEN' | 'COS_UNAVAILABLE' | 'DOWNLOAD_INTEGRITY_FAILED'): never {
  throw new BackupProtocolError(code);
}

function grantKey(grant: Pick<PresignGrant, 'method' | 'url'>): string {
  return `${grant.method}\n${grant.url}`;
}

export class InMemoryPresignGrantRegistry {
  private readonly objectOrigin: string | undefined;
  private readonly values = new Map<string, Readonly<{
    metadata: PresignMetadata;
    grant: PresignGrant;
    headers: Readonly<Record<string, string>>;
  }>>();
  constructor(options: { objectOrigin?: string } = {}) {
    this.objectOrigin = options.objectOrigin === undefined
      ? undefined
      : validateObjectOrigin(options.objectOrigin);
  }
  get size(): number { return this.values.size; }
  remember(metadata: PresignMetadata, grant: PresignGrant, headers: Record<string, string>, nowMs: number = Date.now()): void {
    validateDirectGrant(metadata, grant, nowMs, this.objectOrigin);
    if (!validRequiredHeaders(headers, metadata)) fail('PRESIGN_FORBIDDEN');
    this.values.set(grantKey(grant), Object.freeze({
      metadata: Object.freeze({ ...metadata }),
      grant: Object.freeze({ ...grant }),
      headers: Object.freeze({ ...headers }),
    }));
  }
  headersFor(grant: Pick<PresignGrant, 'method' | 'url'>): Readonly<Record<string, string>> | null {
    return this.values.get(grantKey(grant))?.headers ?? null;
  }
  take(grant: PresignGrant, expectedMethod: PresignMetadata['method'], nowMs: number): Readonly<Record<string, string>> {
    const key = grantKey(grant);
    const value = this.values.get(key);
    if (!value || expectedMethod !== grant.method) fail('PRESIGN_FORBIDDEN');
    validateDirectGrant(value.metadata, grant, nowMs, this.objectOrigin);
    if (JSON.stringify(value.grant) !== JSON.stringify(grant)) fail('PRESIGN_FORBIDDEN');
    if (!validRequiredHeaders(value.headers, value.metadata)) fail('PRESIGN_FORBIDDEN');
    this.values.delete(key);
    return value.headers;
  }
  clear(): void { this.values.clear(); }
}

export class CloudBackupPresignTransport implements PresignTransport {
  constructor(private readonly options: {
    endpoint: string;
    token: string;
    fetcher?: Fetcher;
    registry: InMemoryPresignGrantRegistry;
    now?: () => number;
    signal?: () => AbortSignal | undefined;
  }) {
    let endpoint: URL;
    try { endpoint = new URL(options.endpoint); } catch { fail('PRESIGN_FORBIDDEN'); }
    const httpsEndpoint = endpoint.protocol === 'https:' && !endpoint.port;
    const loopbackHttpEndpoint = endpoint.protocol === 'http:'
      && LOOPBACK_HOSTNAMES.has(endpoint.hostname)
      && Boolean(endpoint.port)
      && options.endpoint === `${endpoint.origin}/v1/backup/presign`;
    if (
      (!httpsEndpoint && !loopbackHttpEndpoint)
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
      || options.endpoint.includes('?')
      || options.endpoint.includes('#')
      || endpoint.pathname !== '/v1/backup/presign'
      || !options.token
      || /[\s\u0000-\u001f\u007f]/.test(options.token)
    ) {
      fail('PRESIGN_FORBIDDEN');
    }
  }

  async request(metadata: PresignMetadata): Promise<PresignGrant> {
    const response = await (this.options.fetcher ?? fetch)(this.options.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.options.token}`, 'content-type': 'application/json' },
      // Cloud derives owner, target, region, bucket and key from its dedicated binding.
      body: JSON.stringify({
        schemaVersion: 1,
        method: metadata.method,
        snapshotId: metadata.snapshotId,
        ttlSeconds: metadata.ttlSeconds,
        contentType: metadata.contentType,
        ...(metadata.method === 'PUT' ? {
          ciphertextBytes: metadata.ciphertextBytes,
          ciphertextSha256: metadata.ciphertextSha256,
        } : {}),
      }),
      redirect: 'error',
      signal: this.options.signal?.(),
    }).catch(() => fail('COS_UNAVAILABLE'));
    if (!response.ok) fail('COS_UNAVAILABLE');
    const value = await response.json().catch(() => fail('PRESIGN_FORBIDDEN')) as Record<string, unknown>;
    const exact = ['schemaVersion', 'method', 'snapshotId', 'key', 'expiresAtMs', 'url', 'requiredHeaders'];
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join('|') !== exact.sort().join('|')) fail('PRESIGN_FORBIDDEN');
    if (value.schemaVersion !== 1 || value.method !== metadata.method || value.snapshotId !== metadata.snapshotId || value.key !== metadata.key) fail('PRESIGN_FORBIDDEN');
    if (typeof value.url !== 'string' || typeof value.expiresAtMs !== 'number' || value.expiresAtMs <= (this.options.now ?? Date.now)()) fail('PRESIGN_FORBIDDEN');
    if (!value.requiredHeaders || typeof value.requiredHeaders !== 'object' || Array.isArray(value.requiredHeaders)) fail('PRESIGN_FORBIDDEN');
    const headers = value.requiredHeaders as Record<string, unknown>;
    if (Object.values(headers).some((item) => typeof item !== 'string') || !validRequiredHeaders(headers, metadata)) fail('PRESIGN_FORBIDDEN');
    const grant: PresignGrant = {
      method: metadata.method,
      key: metadata.key,
      url: value.url,
      contentType: BACKUP_CONTENT_TYPE,
      expiresAtMs: value.expiresAtMs,
      ...(metadata.method === 'PUT' ? {
        ciphertextBytes: metadata.ciphertextBytes,
        ciphertextSha256: metadata.ciphertextSha256,
      } : {}),
    };
    this.options.registry.remember(metadata, grant, headers as Record<string, string>, (this.options.now ?? Date.now)());
    return grant;
  }
}

export class FetchDirectCiphertextAdapter implements DirectCiphertextAdapter {
  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly registry: InMemoryPresignGrantRegistry,
    private readonly signal: () => AbortSignal | undefined = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async put(grant: PresignGrant, ciphertext: Uint8Array) {
    // Copy into a standalone ArrayBuffer: Electron/Node's undici fetch accepts
    // it without retaining a possibly SharedArrayBuffer-backed caller view.
    const body = Uint8Array.from(ciphertext).buffer;
    const response = await this.one(grant, { method: 'PUT', body });
    if (!response.ok) fail('COS_UNAVAILABLE');
    return { bytes: ciphertext.byteLength, sha256: createHash('sha256').update(ciphertext).digest('hex') };
  }

  async get(grant: PresignGrant) {
    const response = await this.one(grant, { method: 'GET' });
    if (!response.ok) fail('COS_UNAVAILABLE');
    const contentLength = numericHeader(response, 'content-length');
    if (contentLength !== null && contentLength > DEFAULT_BACKUP_MAX_BYTES) fail('DOWNLOAD_INTEGRITY_FAILED');
    const ciphertext = new Uint8Array(await response.arrayBuffer());
    if (ciphertext.byteLength > DEFAULT_BACKUP_MAX_BYTES) fail('DOWNLOAD_INTEGRITY_FAILED');
    return { ciphertext, contentLength };
  }

  async head(grant: PresignGrant) {
    const response = await this.one(grant, { method: 'HEAD' });
    if (response.status === 404) return { exists: false };
    if (!response.ok) fail('COS_UNAVAILABLE');
    return {
      exists: true,
      bytes: numericHeader(response, 'content-length') ?? undefined,
      sha256: response.headers.get('x-cos-meta-ciphertext-sha256') ?? undefined,
    };
  }

  async delete(grant: PresignGrant): Promise<void> {
    const response = await this.one(grant, { method: 'DELETE' });
    if (!response.ok) fail('COS_UNAVAILABLE');
  }

  private async one(grant: PresignGrant, init: RequestInit): Promise<Response> {
    const method = init.method;
    if (method !== 'PUT' && method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') fail('PRESIGN_FORBIDDEN');
    const headers = this.registry.take(grant, method, this.now());
    return this.fetcher(grant.url, {
      ...init,
      headers: { ...headers },
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: this.signal(),
    }).catch(() => fail('COS_UNAVAILABLE'));
  }
}

function validRequiredHeaders(headers: Record<string, unknown>, metadata: PresignMetadata): boolean {
  const keys = Object.keys(headers).sort();
  const expected = (metadata.method === 'PUT'
    ? ['content-length', 'content-type', 'x-cos-meta-ciphertext-sha256']
    : ['content-type']).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return false;
  if (headers['content-type'] !== BACKUP_CONTENT_TYPE) return false;
  if (metadata.method !== 'PUT') return true;
  return headers['content-length'] === String(metadata.ciphertextBytes)
    && headers['x-cos-meta-ciphertext-sha256'] === metadata.ciphertextSha256;
}

function validateObjectOrigin(value: string): string {
  let origin: URL;
  try { origin = new URL(value); } catch { fail('PRESIGN_FORBIDDEN'); }
  const loopbackHttp = origin.protocol === 'http:'
    && LOOPBACK_HOSTNAMES.has(origin.hostname)
    && Boolean(origin.port);
  if (
    (origin.protocol !== 'https:' && !loopbackHttp)
    || origin.username
    || origin.password
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
    || value !== origin.origin
  ) fail('PRESIGN_FORBIDDEN');
  return value;
}

function validateSignedGrantQuery(url: URL, metadata: PresignMetadata): void {
  const entries = [...url.searchParams.entries()];
  const names = entries.map(([name]) => name);
  if (!url.search || entries.length === 0 || new Set(names).size !== names.length) fail('PRESIGN_FORBIDDEN');

  const sortedNames = [...names].sort();
  if (sortedNames.length === 1 && sortedNames[0] === 'q-signature') {
    const capability = url.searchParams.get('q-signature') ?? '';
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(capability)) fail('PRESIGN_FORBIDDEN');
    return;
  }

  const hasSecurityToken = names.includes('x-cos-security-token');
  const expectedNames = [...COS_QUERY_KEYS, ...(hasSecurityToken ? ['x-cos-security-token'] : [])].sort();
  if (
    sortedNames.length !== expectedNames.length
    || sortedNames.some((name, index) => name !== expectedNames[index])
  ) fail('PRESIGN_FORBIDDEN');

  const signTime = url.searchParams.get('q-sign-time') ?? '';
  const keyTime = url.searchParams.get('q-key-time') ?? '';
  const expectedHeaderList = metadata.method === 'PUT'
    ? 'content-length;content-type;host;x-cos-meta-ciphertext-sha256'
    : 'content-type;host';
  if (
    url.searchParams.get('q-sign-algorithm') !== 'sha1'
    || !/^[0-9]+;[0-9]+$/.test(signTime)
    || keyTime !== signTime
    || url.searchParams.get('q-header-list') !== expectedHeaderList
    || url.searchParams.get('q-url-param-list') !== (hasSecurityToken ? 'x-cos-security-token' : '')
    || !/^[A-Za-z0-9_-]{1,256}$/.test(url.searchParams.get('q-ak') ?? '')
    || !/^[a-f0-9]{40}$/.test(url.searchParams.get('q-signature') ?? '')
  ) fail('PRESIGN_FORBIDDEN');
  if (hasSecurityToken) {
    const token = url.searchParams.get('x-cos-security-token') ?? '';
    if (!token || token.length > 4_096 || /[\s\u0000-\u001f\u007f]/.test(token)) fail('PRESIGN_FORBIDDEN');
  }
}

function validateDirectGrant(
  metadata: PresignMetadata,
  grant: PresignGrant,
  nowMs: number,
  objectOrigin?: string,
): void {
  const common = ['method', 'key', 'url', 'contentType', 'expiresAtMs'];
  const expectedKeys = (metadata.method === 'PUT' ? [...common, 'ciphertextBytes', 'ciphertextSha256'] : common).sort();
  const actualKeys = Object.keys(grant).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) fail('PRESIGN_FORBIDDEN');
  if (
    grant.method !== metadata.method
    || grant.key !== metadata.key
    || grant.contentType !== BACKUP_CONTENT_TYPE
    || !Number.isSafeInteger(grant.expiresAtMs)
  ) fail('PRESIGN_FORBIDDEN');
  if (grant.expiresAtMs <= nowMs) throw new BackupProtocolError('PRESIGN_EXPIRED');
  if (grant.expiresAtMs > nowMs + metadata.ttlSeconds * 1_000) fail('PRESIGN_FORBIDDEN');
  let url: URL;
  try { url = new URL(grant.url); } catch { fail('PRESIGN_FORBIDDEN'); }
  const expectedOrigin = objectOrigin
    ?? `https://${metadata.bucket}.cos.${metadata.region}.myqcloud.com`;
  if (
    url.username
    || url.password
    || url.hash
    || grant.url.includes('#')
    || url.origin !== expectedOrigin
    || (objectOrigin !== undefined && !grant.url.startsWith(`${expectedOrigin}/`))
    || url.pathname !== `/${metadata.key}`
  ) fail('PRESIGN_FORBIDDEN');
  validateSignedGrantQuery(url, metadata);
  if (metadata.method === 'PUT' && (grant.ciphertextBytes !== metadata.ciphertextBytes || grant.ciphertextSha256 !== metadata.ciphertextSha256)) fail('PRESIGN_FORBIDDEN');
}

function numericHeader(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) fail('DOWNLOAD_INTEGRITY_FAILED');
  return value;
}
