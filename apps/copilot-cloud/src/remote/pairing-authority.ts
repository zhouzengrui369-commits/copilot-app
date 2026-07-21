import {
  createCipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';

const MAX_PAIRING_BYTES = 16 * 1024;
const MAX_PAIRING_LIFETIME_MS = 15 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const TOKEN_INFO = Buffer.from('copilot-pairing-relay-token-v1', 'utf8');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELAY_ID = /^[A-Za-z0-9_-]{8,128}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const REQUEST_FIELDS = [
  'schemaVersion', 'requestId', 'requestDigest', 'pairingId', 'targetId', 'keyEpoch',
  'targetEd25519PublicKey', 'targetX25519PublicKey', 'targetEd25519PublicKeySha256',
  'targetX25519PublicKeySha256', 'issuedAtMs', 'expiresAtMs', 'nonce',
] as const;
const ISSUE_FIELDS = [
  'ownerId', 'controllerId', 'relayUrl', 'controllerEd25519PublicKey',
  'controllerX25519PublicKey', 'relayToken',
] as const;

export type PairingAuthorityErrorCode =
  | 'AUTHORITY_UNAVAILABLE'
  | 'AUTHORITY_PROVIDER_INVALID'
  | 'INVALID_PAIRING_REQUEST'
  | 'INVALID_AUTHORITY_INPUT'
  | 'PAIRING_REQUEST_EXPIRED'
  | 'PAIRING_REQUEST_REPLAYED'
  | 'AUTHORITY_CAPACITY_EXCEEDED';

export class PairingAuthorityError extends Error {
  constructor(readonly code: PairingAuthorityErrorCode) {
    super(code);
    this.name = 'PairingAuthorityError';
  }
}

export interface PublicPairingRequestV1 {
  schemaVersion: 1;
  requestId: string;
  requestDigest: string;
  pairingId: string;
  targetId: string;
  keyEpoch: number;
  targetEd25519PublicKey: string;
  targetX25519PublicKey: string;
  targetEd25519PublicKeySha256: string;
  targetX25519PublicKeySha256: string;
  issuedAtMs: number;
  expiresAtMs: number;
  nonce: string;
}

export interface PairingAuthorityIssueInput {
  ownerId: string;
  controllerId: string;
  relayUrl: string;
  controllerEd25519PublicKey: string;
  controllerX25519PublicKey: string;
  relayToken: string;
}

export interface PairingResponseV2 {
  schemaVersion: 2;
  pairingId: string;
  requestId: string;
  requestDigest: string;
  ownerId: string;
  controllerId: string;
  targetId: string;
  relayUrl: string;
  sessionId: string;
  controllerEd25519PublicKey: string;
  controllerX25519PublicKey: string;
  targetEd25519PublicKeySha256: string;
  targetX25519PublicKeySha256: string;
  issuerEphemeralX25519PublicKey: string;
  relayTokenNonce: string;
  relayTokenCiphertext: string;
  relayTokenTag: string;
  relayTokenSha256: string;
  keyEpoch: number;
  issuedAtMs: number;
  expiresAtMs: number;
  nonce: string;
  issuerSignature: string;
}

export interface PairingIssuerKeyProvider {
  publicKeySpki(): Promise<Uint8Array>;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface AuthoritySessionBinding {
  requestDigest: string;
  pairingId: string;
  keyEpoch: number;
  ownerId: string;
  controllerId: string;
  targetId: string;
  sessionId: string;
  relayTokenSha256: string;
  controllerEd25519PublicKey: string;
  controllerX25519PublicKey: string;
  targetEd25519PublicKey: string;
  targetX25519PublicKey: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export interface AuthorityAuthInput {
  role: 'controller' | 'target';
  ownerId: string;
  principalId: string;
  sessionId: string;
  authorization: string;
}

export interface AuthoritySignatureInput {
  schemaVersion: 1;
  messageType: 'command' | 'ack' | 'status_query' | 'status_reply';
  requestId: string;
  sessionId: string;
  commandId: string;
  ownerId: string;
  controllerId: string;
  targetId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM';
  payloadSha256: string;
  signerRole: 'controller' | 'target';
  signerId: string;
}

export interface PairingAuthorityOptions {
  issuerKeyProvider: PairingIssuerKeyProvider | null;
  store: PairingAuthorityStore;
  relayPath?: string;
  sessionTtlMs?: number;
  clock?: () => number;
  randomUuid?: () => string;
  randomBytes?: (size: number) => Uint8Array;
  generateEphemeralX25519?: () => { publicKey: KeyObject; privateKey: KeyObject };
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function exactRecord(value: unknown, fields: readonly string[], code: PairingAuthorityErrorCode): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PairingAuthorityError(code);
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new PairingAuthorityError(code);
  }
  return value as Record<string, unknown>;
}

function canonicalBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > 2_048 || !BASE64.test(value)) {
    throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  }
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64') !== value) throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  return bytes;
}

function canonicalBase64Url(value: unknown, minBytes: number, maxBytes: number, code: PairingAuthorityErrorCode): Buffer {
  if (typeof value !== 'string' || !BASE64URL.test(value)) throw new PairingAuthorityError(code);
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.byteLength < minBytes || bytes.byteLength > maxBytes || bytes.toString('base64url') !== value) {
    throw new PairingAuthorityError(code);
  }
  return bytes;
}

function publicKey(value: unknown, type: 'ed25519' | 'x25519', code: PairingAuthorityErrorCode): { bytes: Buffer; key: KeyObject } {
  let bytes: Buffer;
  try {
    bytes = canonicalBase64(value);
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== type) throw new Error('wrong key type');
    const canonicalDer = key.export({ format: 'der', type: 'spki' });
    if (canonicalDer.byteLength !== bytes.byteLength || !timingSafeEqual(canonicalDer, bytes)) {
      throw new Error('non-canonical public key');
    }
    return { bytes, key };
  } catch (error) {
    if (error instanceof PairingAuthorityError && error.code === code) throw error;
    throw new PairingAuthorityError(code);
  }
}

function requestValue(input: unknown): unknown {
  if (!Buffer.isBuffer(input) && typeof input !== 'string' && !(input instanceof Uint8Array)) return input;
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  if (!bytes.length || bytes.byteLength > MAX_PAIRING_BYTES) throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

export function pairingRequestDigest(
  request: Omit<PublicPairingRequestV1, 'requestDigest'> | PublicPairingRequestV1,
): string {
  const { requestDigest: _requestDigest, ...unsigned } = request as PublicPairingRequestV1;
  return sha256(stableJson(unsigned));
}

export function pairingResponseSignatureBytes(
  response: Omit<PairingResponseV2, 'issuerSignature'> | PairingResponseV2,
): Buffer {
  const { issuerSignature: _issuerSignature, ...unsigned } = response as PairingResponseV2;
  return Buffer.from(stableJson(unsigned), 'utf8');
}

export function pairingTokenAadBytes(response: Pick<
  PairingResponseV2,
  | 'schemaVersion' | 'pairingId' | 'requestId' | 'requestDigest' | 'targetId' | 'keyEpoch'
  | 'targetEd25519PublicKeySha256' | 'targetX25519PublicKeySha256' | 'relayTokenSha256'
>): Buffer {
  return Buffer.from(stableJson({
    schemaVersion: response.schemaVersion,
    pairingId: response.pairingId,
    requestId: response.requestId,
    requestDigest: response.requestDigest,
    targetId: response.targetId,
    keyEpoch: response.keyEpoch,
    targetEd25519PublicKeySha256: response.targetEd25519PublicKeySha256,
    targetX25519PublicKeySha256: response.targetX25519PublicKeySha256,
    relayTokenSha256: response.relayTokenSha256,
  }), 'utf8');
}

export function parsePublicPairingRequest(input: unknown, now = Date.now()): PublicPairingRequestV1 {
  const object = exactRecord(requestValue(input), REQUEST_FIELDS, 'INVALID_PAIRING_REQUEST');
  if (
    object.schemaVersion !== 1 ||
    typeof object.requestId !== 'string' || !UUID_V4.test(object.requestId) ||
    typeof object.pairingId !== 'string' || !UUID_V4.test(object.pairingId) ||
    typeof object.targetId !== 'string' || !RELAY_ID.test(object.targetId) ||
    !Number.isSafeInteger(object.keyEpoch) || Number(object.keyEpoch) < 1 ||
    typeof object.requestDigest !== 'string' || !HEX_64.test(object.requestDigest) ||
    typeof object.targetEd25519PublicKeySha256 !== 'string' || !HEX_64.test(object.targetEd25519PublicKeySha256) ||
    typeof object.targetX25519PublicKeySha256 !== 'string' || !HEX_64.test(object.targetX25519PublicKeySha256) ||
    !Number.isSafeInteger(object.issuedAtMs) || !Number.isSafeInteger(object.expiresAtMs)
  ) throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');

  const issuedAtMs = Number(object.issuedAtMs);
  const expiresAtMs = Number(object.expiresAtMs);
  const lifetime = expiresAtMs - issuedAtMs;
  if (lifetime < 1 || lifetime > MAX_PAIRING_LIFETIME_MS || issuedAtMs > now + MAX_CLOCK_SKEW_MS) {
    throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  }
  if (expiresAtMs <= now) throw new PairingAuthorityError('PAIRING_REQUEST_EXPIRED');
  canonicalBase64Url(object.nonce, 16, 64, 'INVALID_PAIRING_REQUEST');
  const ed = publicKey(object.targetEd25519PublicKey, 'ed25519', 'INVALID_PAIRING_REQUEST');
  const x = publicKey(object.targetX25519PublicKey, 'x25519', 'INVALID_PAIRING_REQUEST');
  const request = object as unknown as PublicPairingRequestV1;
  if (!safeHexEqual(sha256(ed.bytes), request.targetEd25519PublicKeySha256)) {
    throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  }
  if (!safeHexEqual(sha256(x.bytes), request.targetX25519PublicKeySha256)) {
    throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  }
  if (!safeHexEqual(pairingRequestDigest(request), request.requestDigest)) {
    throw new PairingAuthorityError('INVALID_PAIRING_REQUEST');
  }
  return structuredClone(request);
}

function parseIssueInput(value: unknown, relayPath: string): PairingAuthorityIssueInput {
  const object = exactRecord(value, ISSUE_FIELDS, 'INVALID_AUTHORITY_INPUT');
  if (
    typeof object.ownerId !== 'string' || !RELAY_ID.test(object.ownerId) ||
    typeof object.controllerId !== 'string' || !RELAY_ID.test(object.controllerId)
  ) throw new PairingAuthorityError('INVALID_AUTHORITY_INPUT');
  const ed = publicKey(object.controllerEd25519PublicKey, 'ed25519', 'INVALID_AUTHORITY_INPUT');
  const x = publicKey(object.controllerX25519PublicKey, 'x25519', 'INVALID_AUTHORITY_INPUT');
  void ed;
  void x;
  canonicalBase64Url(object.relayToken, 32, 384, 'INVALID_AUTHORITY_INPUT');
  if (typeof object.relayUrl !== 'string' || object.relayUrl.length > 2_048) {
    throw new PairingAuthorityError('INVALID_AUTHORITY_INPUT');
  }
  try {
    const url = new URL(object.relayUrl);
    if (
      url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash ||
      (url.port !== '' && url.port !== '443') || url.pathname !== relayPath
    ) throw new Error('invalid relay URL');
  } catch {
    throw new PairingAuthorityError('INVALID_AUTHORITY_INPUT');
  }
  return object as unknown as PairingAuthorityIssueInput;
}

function safeHexEqual(actual: string, expected: string): boolean {
  if (!HEX_64.test(actual) || !HEX_64.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function authorityBindingDigest(input: {
  role: 'controller' | 'target';
  ownerId: string;
  principalId: string;
  sessionId: string;
  tokenDigest: string;
}): Buffer {
  return createHash('sha256').update(stableJson(input)).digest();
}

function envelopeSignatureBytes(input: AuthoritySignatureInput): Buffer {
  return Buffer.from(stableJson({
    schemaVersion: input.schemaVersion,
    messageType: input.messageType,
    requestId: input.requestId,
    sessionId: input.sessionId,
    commandId: input.commandId,
    ownerId: input.ownerId,
    controllerId: input.controllerId,
    targetId: input.targetId,
    nonce: input.nonce,
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
    payloadAlgorithm: input.payloadAlgorithm,
    payloadSha256: input.payloadSha256,
  }), 'utf8');
}

export class PairingAuthorityStore {
  private readonly sessions = new Map<string, AuthoritySessionBinding>();
  private readonly usedRequests = new Map<string, number>();

  constructor(
    private readonly maxSessions = 1_000,
    private readonly clock: () => number = Date.now,
    private readonly maxUsedRequests = maxSessions,
  ) {
    if (
      !Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 10_000 ||
      !Number.isSafeInteger(maxUsedRequests) || maxUsedRequests < 1 || maxUsedRequests > 10_000
    ) {
      throw new PairingAuthorityError('AUTHORITY_CAPACITY_EXCEEDED');
    }
  }

  register(binding: AuthoritySessionBinding, requestExpiresAtMs: number): void {
    const now = this.clock();
    this.sweep(now);
    if (
      !HEX_64.test(binding.requestDigest) || !HEX_64.test(binding.relayTokenSha256) ||
      !UUID_V4.test(binding.pairingId) || !UUID_V4.test(binding.sessionId) ||
      !RELAY_ID.test(binding.ownerId) || !RELAY_ID.test(binding.controllerId) || !RELAY_ID.test(binding.targetId) ||
      !Number.isSafeInteger(binding.keyEpoch) || binding.keyEpoch < 1 ||
      !Number.isSafeInteger(binding.issuedAtMs) || !Number.isSafeInteger(binding.expiresAtMs) ||
      !Number.isSafeInteger(requestExpiresAtMs)
    ) throw new PairingAuthorityError('INVALID_AUTHORITY_INPUT');
    publicKey(binding.controllerEd25519PublicKey, 'ed25519', 'INVALID_AUTHORITY_INPUT');
    publicKey(binding.controllerX25519PublicKey, 'x25519', 'INVALID_AUTHORITY_INPUT');
    publicKey(binding.targetEd25519PublicKey, 'ed25519', 'INVALID_AUTHORITY_INPUT');
    publicKey(binding.targetX25519PublicKey, 'x25519', 'INVALID_AUTHORITY_INPUT');
    if (binding.expiresAtMs <= now || requestExpiresAtMs <= now) {
      throw new PairingAuthorityError('PAIRING_REQUEST_EXPIRED');
    }
    if (this.usedRequests.has(binding.requestDigest)) {
      throw new PairingAuthorityError('PAIRING_REQUEST_REPLAYED');
    }
    if (
      this.sessions.size >= this.maxSessions || this.sessions.has(binding.sessionId) ||
      this.usedRequests.size >= this.maxUsedRequests
    ) {
      throw new PairingAuthorityError('AUTHORITY_CAPACITY_EXCEEDED');
    }
    for (const session of this.sessions.values()) {
      if (safeHexEqual(session.relayTokenSha256, binding.relayTokenSha256)) {
        throw new PairingAuthorityError('PAIRING_REQUEST_REPLAYED');
      }
    }
    this.sessions.set(binding.sessionId, structuredClone(binding));
    this.usedRequests.set(binding.requestDigest, requestExpiresAtMs);
  }

  authenticate(input: AuthorityAuthInput): boolean {
    const now = this.clock();
    this.sweep(now);
    const match = /^Bearer ([A-Za-z0-9_-]{43,512})$/.exec(input.authorization);
    const tokenDigest = match ? sha256(match[1]!) : '0'.repeat(64);
    const actual = authorityBindingDigest({
      role: input.role,
      ownerId: input.ownerId,
      principalId: input.principalId,
      sessionId: input.sessionId,
      tokenDigest,
    });
    let found = 0;
    const records = this.sessions.size ? [...this.sessions.values()] : [null];
    for (const binding of records) {
      const expected = binding ? authorityBindingDigest({
        role: input.role,
        ownerId: binding.ownerId,
        principalId: input.role === 'controller' ? binding.controllerId : binding.targetId,
        sessionId: binding.sessionId,
        tokenDigest: binding.relayTokenSha256,
      }) : Buffer.alloc(32);
      found |= Number(timingSafeEqual(actual, expected));
    }
    return Boolean(match) && found === 1;
  }

  verifyEnvelopeSignature(input: AuthoritySignatureInput, signature: string): boolean {
    this.sweep(this.clock());
    const binding = this.sessions.get(input.sessionId);
    if (!binding || binding.expiresAtMs <= this.clock()) return false;
    if (
      input.ownerId !== binding.ownerId || input.controllerId !== binding.controllerId ||
      input.targetId !== binding.targetId ||
      input.signerId !== (input.signerRole === 'controller' ? binding.controllerId : binding.targetId)
    ) return false;
    let signatureBytes: Buffer;
    try {
      signatureBytes = canonicalBase64Url(signature, 64, 64, 'INVALID_AUTHORITY_INPUT');
      const encoded = input.signerRole === 'controller'
        ? binding.controllerEd25519PublicKey
        : binding.targetEd25519PublicKey;
      const key = publicKey(encoded, 'ed25519', 'INVALID_AUTHORITY_INPUT').key;
      return verify(null, envelopeSignatureBytes(input), key, signatureBytes);
    } catch {
      return false;
    }
  }

  private sweep(now: number): void {
    for (const [sessionId, binding] of this.sessions) {
      if (binding.expiresAtMs <= now) this.sessions.delete(sessionId);
    }
    for (const [requestDigest, expiresAtMs] of this.usedRequests) {
      if (expiresAtMs <= now) this.usedRequests.delete(requestDigest);
    }
  }

  redactedSnapshot(): ReadonlyArray<Pick<
    AuthoritySessionBinding,
    'pairingId' | 'keyEpoch' | 'ownerId' | 'controllerId' | 'targetId' | 'sessionId' | 'issuedAtMs' | 'expiresAtMs'
  >> {
    this.sweep(this.clock());
    return [...this.sessions.values()].map((binding) => ({
      pairingId: binding.pairingId,
      keyEpoch: binding.keyEpoch,
      ownerId: binding.ownerId,
      controllerId: binding.controllerId,
      targetId: binding.targetId,
      sessionId: binding.sessionId,
      issuedAtMs: binding.issuedAtMs,
      expiresAtMs: binding.expiresAtMs,
    }));
  }

  redactedCapacitySnapshot(): Readonly<{
    sessions: number;
    usedRequests: number;
    maxSessions: number;
    maxUsedRequests: number;
  }> {
    this.sweep(this.clock());
    return {
      sessions: this.sessions.size,
      usedRequests: this.usedRequests.size,
      maxSessions: this.maxSessions,
      maxUsedRequests: this.maxUsedRequests,
    };
  }
}

export class PairingAuthority {
  private readonly relayPath: string;
  private readonly sessionTtlMs: number;
  private readonly clock: () => number;
  private readonly makeUuid: () => string;
  private readonly makeBytes: (size: number) => Uint8Array;
  private readonly makeEphemeral: () => { publicKey: KeyObject; privateKey: KeyObject };

  constructor(private readonly options: PairingAuthorityOptions) {
    this.relayPath = options.relayPath ?? '/v1/remote/ws';
    this.sessionTtlMs = options.sessionTtlMs ?? MAX_PAIRING_LIFETIME_MS;
    this.clock = options.clock ?? Date.now;
    this.makeUuid = options.randomUuid ?? randomUUID;
    this.makeBytes = options.randomBytes ?? randomBytes;
    this.makeEphemeral = options.generateEphemeralX25519 ?? (() => generateKeyPairSync('x25519'));
    if (
      this.relayPath !== '/v1/remote/ws' ||
      !Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs < 1 ||
      this.sessionTtlMs > MAX_PAIRING_LIFETIME_MS
    ) throw new PairingAuthorityError('INVALID_AUTHORITY_INPUT');
  }

  async issue(requestInput: unknown, issueInput: unknown): Promise<PairingResponseV2> {
    const provider = this.options.issuerKeyProvider;
    if (!provider) throw new PairingAuthorityError('AUTHORITY_UNAVAILABLE');
    const now = this.clock();
    const request = parsePublicPairingRequest(requestInput, now);
    const input = parseIssueInput(issueInput, this.relayPath);
    const expiresAtMs = Math.min(request.expiresAtMs, now + this.sessionTtlMs);
    if (expiresAtMs <= now) throw new PairingAuthorityError('PAIRING_REQUEST_EXPIRED');
    const sessionId = this.makeUuid();
    if (!UUID_V4.test(sessionId)) throw new PairingAuthorityError('INVALID_AUTHORITY_INPUT');
    const targetX = publicKey(request.targetX25519PublicKey, 'x25519', 'INVALID_PAIRING_REQUEST');
    const targetEd = publicKey(request.targetEd25519PublicKey, 'ed25519', 'INVALID_PAIRING_REQUEST');
    const controllerEd = publicKey(input.controllerEd25519PublicKey, 'ed25519', 'INVALID_AUTHORITY_INPUT');
    const controllerX = publicKey(input.controllerX25519PublicKey, 'x25519', 'INVALID_AUTHORITY_INPUT');
    const token = Buffer.from(input.relayToken, 'utf8');
    const relayTokenSha256 = sha256(token);
    const ephemeral = this.makeEphemeral();
    if (ephemeral.publicKey.asymmetricKeyType !== 'x25519' || ephemeral.privateKey.asymmetricKeyType !== 'x25519') {
      token.fill(0);
      throw new PairingAuthorityError('AUTHORITY_PROVIDER_INVALID');
    }
    let shared: Buffer | null = null;
    let key: Buffer | null = null;
    try {
      shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: targetX.key });
      key = Buffer.from(hkdfSync(
        'sha256',
        shared,
        Buffer.from(request.requestDigest, 'hex'),
        TOKEN_INFO,
        32,
      ));
      const relayTokenNonce = Buffer.from(this.makeBytes(12));
      const responseNonce = Buffer.from(this.makeBytes(16));
      if (relayTokenNonce.byteLength !== 12 || responseNonce.byteLength !== 16) {
        throw new PairingAuthorityError('AUTHORITY_PROVIDER_INVALID');
      }
      const responseBase = {
        schemaVersion: 2 as const,
        pairingId: request.pairingId,
        requestId: request.requestId,
        requestDigest: request.requestDigest,
        ownerId: input.ownerId,
        controllerId: input.controllerId,
        targetId: request.targetId,
        relayUrl: input.relayUrl,
        sessionId,
        controllerEd25519PublicKey: controllerEd.bytes.toString('base64'),
        controllerX25519PublicKey: controllerX.bytes.toString('base64'),
        targetEd25519PublicKeySha256: request.targetEd25519PublicKeySha256,
        targetX25519PublicKeySha256: request.targetX25519PublicKeySha256,
        issuerEphemeralX25519PublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        relayTokenNonce: relayTokenNonce.toString('base64url'),
        relayTokenCiphertext: '',
        relayTokenTag: '',
        relayTokenSha256,
        keyEpoch: request.keyEpoch,
        issuedAtMs: now,
        expiresAtMs,
        nonce: responseNonce.toString('base64url'),
      };
      const cipher = createCipheriv('aes-256-gcm', key, relayTokenNonce);
      cipher.setAAD(pairingTokenAadBytes(responseBase));
      const encrypted = Buffer.concat([cipher.update(token), cipher.final()]);
      const unsigned = {
        ...responseBase,
        relayTokenCiphertext: encrypted.toString('base64url'),
        relayTokenTag: cipher.getAuthTag().toString('base64url'),
      };
      const signatureBytes = pairingResponseSignatureBytes(unsigned);
      const [issuerPublicBytes, issuerSignatureBytes] = await Promise.all([
        provider.publicKeySpki(),
        provider.sign(signatureBytes),
      ]);
      let issuerPublic: KeyObject;
      try {
        issuerPublic = createPublicKey({ key: Buffer.from(issuerPublicBytes), format: 'der', type: 'spki' });
        if (issuerPublic.asymmetricKeyType !== 'ed25519') throw new Error('wrong issuer type');
      } catch {
        throw new PairingAuthorityError('AUTHORITY_PROVIDER_INVALID');
      }
      const issuerSignature = Buffer.from(issuerSignatureBytes);
      if (issuerSignature.byteLength !== 64 || !verify(null, signatureBytes, issuerPublic, issuerSignature)) {
        throw new PairingAuthorityError('AUTHORITY_PROVIDER_INVALID');
      }
      const response: PairingResponseV2 = {
        ...unsigned,
        issuerSignature: issuerSignature.toString('base64url'),
      };
      this.options.store.register({
        requestDigest: request.requestDigest,
        pairingId: request.pairingId,
        keyEpoch: request.keyEpoch,
        ownerId: input.ownerId,
        controllerId: input.controllerId,
        targetId: request.targetId,
        sessionId,
        relayTokenSha256,
        controllerEd25519PublicKey: controllerEd.bytes.toString('base64'),
        controllerX25519PublicKey: controllerX.bytes.toString('base64'),
        targetEd25519PublicKey: targetEd.bytes.toString('base64'),
        targetX25519PublicKey: targetX.bytes.toString('base64'),
        issuedAtMs: now,
        expiresAtMs,
      }, request.expiresAtMs);
      return response;
    } finally {
      token.fill(0);
      shared?.fill(0);
      key?.fill(0);
    }
  }
}
