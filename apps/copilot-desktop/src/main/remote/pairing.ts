import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RemoteError, stableJson } from './protocol.js';

const MAX_PAIRING_BYTES = 16 * 1024;
const MAX_PAIRING_LIFETIME_MS = 15 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID = /^[\p{L}\p{N}._/-]{1,160}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const TOKEN_INFO = Buffer.from('copilot-pairing-relay-token-v1', 'utf8');

export const REMOTE_KEYRING_SERVICE = 'ai.njx.copilot.v6.remote';
export const REMOTE_CREDENTIAL_PURPOSES = [
  'relay-token',
  'identity-ed25519-pkcs8',
  'identity-x25519-pkcs8',
] as const;
export type RemoteCredentialPurpose = (typeof REMOTE_CREDENTIAL_PURPOSES)[number];

/** Public only. The corresponding issuer private key is not shipped in this repository. */
export const PRODUCTION_PAIRING_ROOT_ED25519_SPKI_BASE64 =
  'MCowBQYDK2VwAyEAkQsR0kcHyjZBKO0UKV4SE4lwNfmbsFIgA9ESEO8+CYw=';

export interface PairingRequestV1 {
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

/** Version 2 deliberately has no plaintext relayToken field. */
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

export interface RemoteCredentialSetRef {
  pairingId: string;
  keyEpoch: number;
}

export interface RemotePairingRecord extends RemoteCredentialSetRef {
  ownerId: string;
  controllerId: string;
  targetId: string;
  relayUrl: string;
  sessionId: string;
  controllerEd25519PublicKey: string;
  controllerX25519PublicKey: string;
  targetEd25519PublicKey: string;
  targetX25519PublicKey: string;
  controllerKeyFingerprint: string;
  targetKeyFingerprint: string;
  issuedAtMs: number;
  expiresAtMs: number;
  bundleDigest: string;
  nonceDigest: string;
  relayTokenSha256: string;
}

export interface RemotePairingRepositoryState {
  revision: number;
  active: RemotePairingRecord | null;
  pendingRequest: PairingRequestV1 | null;
  retiredCredentialSets: RemoteCredentialSetRef[];
  orphanedCredentialSets: RemoteCredentialSetRef[];
  usedBundleDigests: string[];
  usedNonceDigests: string[];
  usedRelayTokenDigests: string[];
  revoked: boolean;
  recoveryRequired: boolean;
}

export interface RemotePairingRepository {
  get(): RemotePairingRepositoryState | null;
  compareAndSet(expectedRevision: number, value: RemotePairingRepositoryState): boolean;
}

export interface RemoteCredentialVault {
  put(
    pairingId: string,
    keyEpoch: number,
    purpose: RemoteCredentialPurpose,
    value: Uint8Array,
  ): Promise<void>;
  get(
    pairingId: string,
    keyEpoch: number,
    purpose: RemoteCredentialPurpose,
  ): Promise<Uint8Array | null>;
  deleteSet(pairingId: string, keyEpoch: number): Promise<void>;
}

export interface RemotePairingStatus {
  configured: boolean;
  revoked: boolean;
  recoveryRequired: boolean;
  pendingRequest: boolean;
  keyEpoch: number | null;
  ownerFingerprint: string | null;
  controllerFingerprint: string | null;
  targetFingerprint: string | null;
  expiresAtMs: number | null;
}

interface PairingManagerOptions {
  rootPublicKeySpki: Uint8Array | string | null;
  repository: RemotePairingRepository;
  credentials: RemoteCredentialVault;
  targetId?: () => string;
  clock?: () => number;
  randomUuid?: () => string;
  randomNonce?: () => Uint8Array;
  generateIdentity?: () => GeneratedIdentity;
}

interface GeneratedIdentity {
  ed25519PrivatePkcs8: Buffer;
  ed25519PublicSpki: Buffer;
  x25519PrivatePkcs8: Buffer;
  x25519PublicSpki: Buffer;
}

export class PairingManager {
  private readonly clock: () => number;
  private readonly generateIdentity: () => GeneratedIdentity;
  private readonly makeUuid: () => string;
  private readonly makeNonce: () => Uint8Array;
  private volatileRecoveryRequired = false;

  constructor(private readonly options: PairingManagerOptions) {
    this.clock = options.clock ?? Date.now;
    this.generateIdentity = options.generateIdentity ?? generateIdentity;
    this.makeUuid = options.randomUuid ?? randomUUID;
    this.makeNonce = options.randomNonce ?? (() => randomBytes(16));
  }

  status(): RemotePairingStatus {
    const state = this.state();
    return statusFor(state);
  }

  pendingRequestId(): string | null {
    return this.state().pendingRequest?.requestId ?? null;
  }

  active(): RemotePairingRecord | null {
    const state = this.state();
    if (state.recoveryRequired) {
      throw new RemoteError('AUTH_REQUIRED', 'remote pairing requires credential recovery');
    }
    return state.active;
  }

  async createPairingRequest(): Promise<PairingRequestV1> {
    const state = this.state();
    if (state.recoveryRequired) {
      throw new RemoteError('AUTH_REQUIRED', 'remote pairing requires credential recovery');
    }
    if (state.pendingRequest) {
      if (state.pendingRequest.expiresAtMs > this.clock()) return structuredClone(state.pendingRequest);
      await this.cleanupPending(state);
    }
    const current = this.state();
    const pairingId = current.active?.pairingId ?? this.makeUuid();
    const keyEpoch = (current.active?.keyEpoch ?? 0) + 1;
    const requestId = this.makeUuid();
    if (!UUID_V4.test(pairingId) || !UUID_V4.test(requestId)) invalid('pairing request identifier is invalid');
    const targetId = current.active?.targetId ?? this.options.targetId?.() ?? `desktop-${requestId}`;
    if (!OPAQUE_ID.test(targetId)) invalid('pairing request target is invalid');
    const identity = this.generateIdentity();
    const ref = { pairingId, keyEpoch };
    const requestBase = {
      schemaVersion: 1 as const,
      requestId,
      pairingId,
      targetId,
      keyEpoch,
      targetEd25519PublicKey: identity.ed25519PublicSpki.toString('base64'),
      targetX25519PublicKey: identity.x25519PublicSpki.toString('base64'),
      targetEd25519PublicKeySha256: digest(identity.ed25519PublicSpki),
      targetX25519PublicKeySha256: digest(identity.x25519PublicSpki),
      issuedAtMs: this.clock(),
      expiresAtMs: this.clock() + MAX_PAIRING_LIFETIME_MS,
      nonce: Buffer.from(this.makeNonce()).toString('base64url'),
    };
    const request: PairingRequestV1 = {
      ...requestBase,
      requestDigest: pairingRequestDigest(requestBase),
    };
    const staged: Array<[RemoteCredentialPurpose, Buffer]> = [
      ['identity-ed25519-pkcs8', identity.ed25519PrivatePkcs8],
      ['identity-x25519-pkcs8', identity.x25519PrivatePkcs8],
    ];
    try {
      for (const [purpose, secret] of staged) {
        await this.options.credentials.put(pairingId, keyEpoch, purpose, secret);
      }
      for (const [purpose, secret] of staged) {
        await this.verifyCredential(ref, purpose, secret);
      }
      const next: RemotePairingRepositoryState = {
        ...current,
        revision: current.revision + 1,
        pendingRequest: request,
        revoked: false,
      };
      if (!this.options.repository.compareAndSet(current.revision, next)) {
        throw new RemoteError('AUTH_REQUIRED', 'pairing metadata changed during request creation');
      }
      return structuredClone(request);
    } catch (error) {
      await this.cleanupOrQuarantine(ref, current);
      if (error instanceof RemoteError) throw error;
      throw new RemoteError('AUTH_REQUIRED', 'OS credential store rejected pairing request');
    } finally {
      for (const [, secret] of staged) secret.fill(0);
    }
  }

  async importBytes(bytes: Uint8Array): Promise<RemotePairingStatus> {
    if (bytes.byteLength === 0) invalid('pairing response is empty');
    if (bytes.byteLength > MAX_PAIRING_BYTES) {
      throw new RemoteError('PAYLOAD_TOO_LARGE', 'pairing response exceeds 16 KiB');
    }
    const response = parsePairingResponse(Buffer.from(bytes).toString('utf8'));
    const root = requirePublicKey(this.options.rootPublicKeySpki, 'ed25519', 'AUTH_REQUIRED');
    const signature = decodeBase64Url(response.issuerSignature, 'issuer signature');
    if (!verify(null, pairingResponseSignatureBytes(response), root, signature)) {
      throw new RemoteError('SIGNATURE_INVALID', 'pairing issuer signature is invalid');
    }
    validateResponseSemantics(response, this.clock());
    const bundleDigest = digest(stableJson(response));
    const nonceDigest = digest(Buffer.from(response.nonce, 'base64url'));
    const state = this.state();
    if (state.active?.bundleDigest === bundleDigest) return statusFor(state);
    if (state.recoveryRequired) throw new RemoteError('AUTH_REQUIRED', 'remote pairing requires credential recovery');
    if (state.usedBundleDigests.includes(bundleDigest) || state.usedNonceDigests.includes(nonceDigest)) {
      throw new RemoteError('NONCE_REPLAYED', 'pairing response was already consumed');
    }
    if (state.usedRelayTokenDigests.includes(response.relayTokenSha256)) {
      throw new RemoteError('NONCE_REPLAYED', 'relay credential was already consumed');
    }
    const request = state.pendingRequest;
    if (!request || !responseMatchesRequest(response, request)) {
      throw new RemoteError('AUTH_INVALID', 'pairing response is not bound to the active request');
    }
    if (request.expiresAtMs <= this.clock()) throw new RemoteError('AUTH_INVALID', 'pairing request expired');
    if (state.active && response.keyEpoch <= state.active.keyEpoch) {
      throw new RemoteError('AUTH_INVALID', 'pairing key epoch must increase');
    }
    const ref = { pairingId: response.pairingId, keyEpoch: response.keyEpoch };
    let xPrivate: Uint8Array | null = null;
    let edPrivate: Uint8Array | null = null;
    let token: Buffer | null = null;
    let activationStarted = false;
    try {
      xPrivate = await this.requireStagedPrivate(ref, 'identity-x25519-pkcs8', request.targetX25519PublicKey, 'x25519');
      edPrivate = await this.requireStagedPrivate(ref, 'identity-ed25519-pkcs8', request.targetEd25519PublicKey, 'ed25519');
      token = decryptRelayToken(response, xPrivate);
      if (!/^[A-Za-z0-9_-]{43,512}$/.test(token.toString('utf8')) || digest(token.toString('utf8')) !== response.relayTokenSha256) {
        throw new RemoteError('AUTH_INVALID', 'relay credential digest mismatch');
      }
      activationStarted = true;
      await this.options.credentials.put(ref.pairingId, ref.keyEpoch, 'relay-token', token);
      await this.verifyCredential(ref, 'relay-token', token);
      const record: RemotePairingRecord = {
        pairingId: response.pairingId,
        keyEpoch: response.keyEpoch,
        ownerId: response.ownerId,
        controllerId: response.controllerId,
        targetId: response.targetId,
        relayUrl: response.relayUrl,
        sessionId: response.sessionId,
        controllerEd25519PublicKey: response.controllerEd25519PublicKey,
        controllerX25519PublicKey: response.controllerX25519PublicKey,
        targetEd25519PublicKey: request.targetEd25519PublicKey,
        targetX25519PublicKey: request.targetX25519PublicKey,
        controllerKeyFingerprint: digest(Buffer.from(response.controllerEd25519PublicKey, 'base64')),
        targetKeyFingerprint: request.targetEd25519PublicKeySha256,
        issuedAtMs: response.issuedAtMs,
        expiresAtMs: response.expiresAtMs,
        bundleDigest,
        nonceDigest,
        relayTokenSha256: response.relayTokenSha256,
      };
      const next: RemotePairingRepositoryState = {
        ...state,
        revision: state.revision + 1,
        active: record,
        pendingRequest: null,
        retiredCredentialSets: dedupeRefs([
          ...state.retiredCredentialSets,
          ...(state.active ? [{ pairingId: state.active.pairingId, keyEpoch: state.active.keyEpoch }] : []),
        ]).slice(-32),
        usedBundleDigests: dedupe([...state.usedBundleDigests, bundleDigest]).slice(-128),
        usedNonceDigests: dedupe([...state.usedNonceDigests, nonceDigest]).slice(-128),
        usedRelayTokenDigests: dedupe([...state.usedRelayTokenDigests, response.relayTokenSha256]).slice(-128),
        revoked: false,
        recoveryRequired: false,
      };
      if (!this.options.repository.compareAndSet(state.revision, next)) {
        throw new RemoteError('AUTH_REQUIRED', 'pairing metadata changed during activation');
      }
      return statusFor(next);
    } catch (error) {
      if (activationStarted) await this.cleanupOrQuarantine(ref, state);
      if (error instanceof RemoteError) throw error;
      throw new RemoteError('AUTH_REQUIRED', 'OS credential store rejected pairing response');
    } finally {
      xPrivate?.fill(0);
      edPrivate?.fill(0);
      token?.fill(0);
    }
  }

  async revoke(): Promise<RemotePairingStatus> {
    const state = this.state();
    const refs = dedupeRefs([
      ...state.retiredCredentialSets,
      ...state.orphanedCredentialSets,
      ...(state.pendingRequest ? [{ pairingId: state.pendingRequest.pairingId, keyEpoch: state.pendingRequest.keyEpoch }] : []),
      ...(state.active ? [{ pairingId: state.active.pairingId, keyEpoch: state.active.keyEpoch }] : []),
    ]);
    try {
      for (const ref of refs) await this.options.credentials.deleteSet(ref.pairingId, ref.keyEpoch);
    } catch {
      this.persistRecovery(state, refs);
      throw new RemoteError('AUTH_REQUIRED', 'pairing credential revocation was incomplete');
    }
    const current = this.state();
    const next: RemotePairingRepositoryState = {
      ...current,
      revision: current.revision + 1,
      active: null,
      pendingRequest: null,
      retiredCredentialSets: [],
      orphanedCredentialSets: [],
      revoked: true,
      recoveryRequired: false,
    };
    if (!this.options.repository.compareAndSet(current.revision, next)) {
      this.persistRecovery(current, refs);
      throw new RemoteError('AUTH_REQUIRED', 'pairing metadata changed during revocation');
    }
    return statusFor(next);
  }

  private async cleanupPending(state: RemotePairingRepositoryState): Promise<void> {
    const request = state.pendingRequest;
    if (!request) return;
    const ref = { pairingId: request.pairingId, keyEpoch: request.keyEpoch };
    try {
      await this.options.credentials.deleteSet(ref.pairingId, ref.keyEpoch);
    } catch {
      this.persistRecovery(state, [ref]);
      throw new RemoteError('AUTH_REQUIRED', 'expired pairing request cleanup is incomplete');
    }
    const next = { ...state, revision: state.revision + 1, pendingRequest: null };
    if (!this.options.repository.compareAndSet(state.revision, next)) {
      this.persistRecovery(this.state(), [ref]);
      throw new RemoteError('AUTH_REQUIRED', 'pairing request cleanup metadata changed');
    }
  }

  private async cleanupOrQuarantine(ref: RemoteCredentialSetRef, basis: RemotePairingRepositoryState): Promise<void> {
    try {
      await this.options.credentials.deleteSet(ref.pairingId, ref.keyEpoch);
      const current = this.state();
      if (current.pendingRequest?.pairingId === ref.pairingId && current.pendingRequest.keyEpoch === ref.keyEpoch) {
        const next = { ...current, revision: current.revision + 1, pendingRequest: null };
        if (!this.options.repository.compareAndSet(current.revision, next)) {
          this.persistRecovery(this.state(), [ref]);
        }
      }
    } catch {
      this.persistRecovery(this.stateOr(basis), [ref]);
    }
  }

  private persistRecovery(state: RemotePairingRepositoryState, refs: RemoteCredentialSetRef[]): void {
    const current = this.stateOr(state);
    const next: RemotePairingRepositoryState = {
      ...current,
      revision: current.revision + 1,
      orphanedCredentialSets: dedupeRefs([...current.orphanedCredentialSets, ...refs]).slice(-64),
      recoveryRequired: true,
      revoked: false,
    };
    if (!this.options.repository.compareAndSet(current.revision, next)) {
      this.volatileRecoveryRequired = true;
      throw new RemoteError('AUTH_REQUIRED', 'pairing recovery marker could not be persisted');
    }
  }

  private async verifyCredential(
    ref: RemoteCredentialSetRef,
    purpose: RemoteCredentialPurpose,
    expected: Uint8Array,
  ): Promise<void> {
    const stored = await this.options.credentials.get(ref.pairingId, ref.keyEpoch, purpose);
    try {
      if (!stored || !equalBytes(stored, expected)) {
        throw new RemoteError('AUTH_REQUIRED', 'pairing credential readback failed');
      }
    } finally {
      stored?.fill(0);
    }
  }

  private async requireStagedPrivate(
    ref: RemoteCredentialSetRef,
    purpose: 'identity-ed25519-pkcs8' | 'identity-x25519-pkcs8',
    expectedPublic: string,
    expectedType: 'ed25519' | 'x25519',
  ): Promise<Uint8Array> {
    const stored = await this.options.credentials.get(ref.pairingId, ref.keyEpoch, purpose);
    if (!stored) throw new RemoteError('AUTH_REQUIRED', 'staged target identity is unavailable');
    try {
      const privateKey = createPrivateKey({ key: Buffer.from(stored), format: 'der', type: 'pkcs8' });
      if (privateKey.asymmetricKeyType !== expectedType) throw new Error('wrong key type');
      const actual = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
      if (!equalBytes(actual, Buffer.from(expectedPublic, 'base64'))) throw new Error('public mismatch');
      return stored;
    } catch {
      stored.fill(0);
      throw new RemoteError('AUTH_REQUIRED', 'staged target identity is invalid');
    }
  }

  private state(): RemotePairingRepositoryState {
    const state = this.stateOr(emptyState());
    if (this.volatileRecoveryRequired) state.recoveryRequired = true;
    return state;
  }

  private stateOr(fallback: RemotePairingRepositoryState): RemotePairingRepositoryState {
    const value = this.options.repository.get() ?? fallback;
    if (
      !Number.isSafeInteger(value.revision)
      || !Array.isArray(value.retiredCredentialSets)
      || !Array.isArray(value.orphanedCredentialSets)
      || !Array.isArray(value.usedBundleDigests)
      || !Array.isArray(value.usedNonceDigests)
      || !Array.isArray(value.usedRelayTokenDigests)
      || typeof value.recoveryRequired !== 'boolean'
    ) {
      throw new RemoteError('AUTH_REQUIRED', 'pairing metadata is corrupt');
    }
    return structuredClone(value);
  }
}

/** Main-process-only selected-file reader. Paths and raw bytes never cross IPC. */
export async function readSelectedPairingFile(filePath: string): Promise<Buffer> {
  if (path.extname(filePath) !== '.copilot-pairing') invalid('pairing file extension is invalid');
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('unsafe pairing file');
    if (stat.size > MAX_PAIRING_BYTES) throw new RemoteError('PAYLOAD_TOO_LARGE', 'pairing response exceeds 16 KiB');
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_PAIRING_BYTES) throw new RemoteError('PAYLOAD_TOO_LARGE', 'pairing response exceeds 16 KiB');
    return bytes;
  } catch (error) {
    if (error instanceof RemoteError) throw error;
    throw new RemoteError('INVALID_SCHEMA', 'pairing file could not be read safely');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function pairingRequestDigest(
  request: Omit<PairingRequestV1, 'requestDigest'> | PairingRequestV1,
): string {
  const { requestDigest: _digest, ...unsigned } = request as PairingRequestV1;
  return digest(stableJson(unsigned));
}

export function pairingResponseSignatureBytes(
  response: Omit<PairingResponseV2, 'issuerSignature'> | PairingResponseV2,
): Buffer {
  const { issuerSignature: _signature, ...unsigned } = response as PairingResponseV2;
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

/** Deprecated name retained only for source import compatibility; the accepted schema is response v2. */
export const pairingBundleSignatureBytes = pairingResponseSignatureBytes;
export type PairingBundleV1 = PairingResponseV2;

function parsePairingResponse(raw: string): PairingResponseV2 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid('pairing response must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('pairing response must be an object');
  const keys = [
    'schemaVersion', 'pairingId', 'requestId', 'requestDigest', 'ownerId', 'controllerId', 'targetId',
    'relayUrl', 'sessionId', 'controllerEd25519PublicKey', 'controllerX25519PublicKey',
    'targetEd25519PublicKeySha256', 'targetX25519PublicKeySha256', 'issuerEphemeralX25519PublicKey',
    'relayTokenNonce', 'relayTokenCiphertext', 'relayTokenTag', 'relayTokenSha256', 'keyEpoch',
    'issuedAtMs', 'expiresAtMs', 'nonce', 'issuerSignature',
  ];
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== keys.length || Object.keys(obj).some((key) => !keys.includes(key))) {
    return invalid('pairing response fields are invalid');
  }
  if (obj.schemaVersion !== 2) return invalid('pairing response schemaVersion must be 2');
  return obj as unknown as PairingResponseV2;
}

function validateResponseSemantics(response: PairingResponseV2, now: number): void {
  if (![response.pairingId, response.requestId, response.sessionId].every((id) => UUID_V4.test(id))) invalid();
  if (![response.ownerId, response.controllerId, response.targetId].every((id) => OPAQUE_ID.test(id))) invalid();
  if (![response.requestDigest, response.targetEd25519PublicKeySha256, response.targetX25519PublicKeySha256, response.relayTokenSha256].every((hex) => HEX_64.test(hex))) invalid();
  validateRelayUrl(response.relayUrl);
  requirePublicKey(Buffer.from(response.controllerEd25519PublicKey, 'base64'), 'ed25519', 'INVALID_SCHEMA');
  requirePublicKey(Buffer.from(response.controllerX25519PublicKey, 'base64'), 'x25519', 'INVALID_SCHEMA');
  requirePublicKey(Buffer.from(response.issuerEphemeralX25519PublicKey, 'base64'), 'x25519', 'INVALID_SCHEMA');
  if (!Number.isSafeInteger(response.keyEpoch) || response.keyEpoch < 1) invalid();
  if (!Number.isSafeInteger(response.issuedAtMs) || !Number.isSafeInteger(response.expiresAtMs)) invalid();
  const lifetime = response.expiresAtMs - response.issuedAtMs;
  if (lifetime < 1 || lifetime > MAX_PAIRING_LIFETIME_MS) invalid();
  if (response.issuedAtMs > now + MAX_CLOCK_SKEW_MS || response.expiresAtMs <= now) {
    throw new RemoteError('AUTH_INVALID', 'pairing response is expired or not yet valid');
  }
  if (!BASE64URL.test(response.nonce) || Buffer.from(response.nonce, 'base64url').byteLength < 16) invalid();
  if (!BASE64URL.test(response.relayTokenNonce) || Buffer.from(response.relayTokenNonce, 'base64url').byteLength !== 12) invalid();
  if (!BASE64URL.test(response.relayTokenCiphertext) || Buffer.from(response.relayTokenCiphertext, 'base64url').byteLength < 32) invalid();
  if (!BASE64URL.test(response.relayTokenTag) || Buffer.from(response.relayTokenTag, 'base64url').byteLength !== 16) invalid();
  if (!BASE64URL.test(response.issuerSignature) || Buffer.from(response.issuerSignature, 'base64url').byteLength !== 64) invalid();
}

function responseMatchesRequest(response: PairingResponseV2, request: PairingRequestV1): boolean {
  return response.pairingId === request.pairingId
    && response.requestId === request.requestId
    && response.requestDigest === request.requestDigest
    && response.targetId === request.targetId
    && response.keyEpoch === request.keyEpoch
    && response.targetEd25519PublicKeySha256 === request.targetEd25519PublicKeySha256
    && response.targetX25519PublicKeySha256 === request.targetX25519PublicKeySha256;
}

function decryptRelayToken(response: PairingResponseV2, targetPrivate: Uint8Array): Buffer {
  let shared: Buffer | null = null;
  let key: Buffer | null = null;
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(targetPrivate), format: 'der', type: 'pkcs8' });
    const publicKey = requirePublicKey(Buffer.from(response.issuerEphemeralX25519PublicKey, 'base64'), 'x25519', 'INVALID_SCHEMA');
    shared = diffieHellman({ privateKey, publicKey });
    key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(response.requestDigest, 'hex'), TOKEN_INFO, 32));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(response.relayTokenNonce, 'base64url'));
    decipher.setAAD(pairingTokenAadBytes(response));
    decipher.setAuthTag(Buffer.from(response.relayTokenTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(response.relayTokenCiphertext, 'base64url')),
      decipher.final(),
    ]);
  } catch (error) {
    if (error instanceof RemoteError) throw error;
    throw new RemoteError('DECRYPT_FAILED', 'pairing relay credential decryption failed');
  } finally {
    shared?.fill(0);
    key?.fill(0);
  }
}

export function validateRelayUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid();
  }
  const loopbackWs = url.protocol === 'ws:'
    && (url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    && Boolean(url.port)
    && url.pathname === '/v1/remote/ws'
    && value === `${url.origin}/v1/remote/ws`;
  const productionWss = url.protocol === 'wss:'
    && (url.port === '' || url.port === '443');
  if (
    (!loopbackWs && !productionWss)
    || url.username
    || url.password
    || url.search
    || url.hash
    || value.includes('?')
    || value.includes('#')
  ) invalid();
}

function requirePublicKey(
  input: Uint8Array | string | null,
  expected: 'ed25519' | 'x25519',
  code: 'AUTH_REQUIRED' | 'INVALID_SCHEMA',
) {
  if (!input || (typeof input === 'string' && input.length === 0)) {
    throw new RemoteError(code, 'pairing trust root or public key is unavailable');
  }
  try {
    const bytes = typeof input === 'string' ? Buffer.from(input, 'base64') : Buffer.from(input);
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== expected) throw new Error('wrong key type');
    return key;
  } catch {
    throw new RemoteError(code, 'pairing public key is invalid');
  }
}

function generateIdentity(): GeneratedIdentity {
  const ed = generateKeyPairSync('ed25519');
  const x = generateKeyPairSync('x25519');
  const edPrivate = ed.privateKey.export({ format: 'der', type: 'pkcs8' });
  const xPrivate = x.privateKey.export({ format: 'der', type: 'pkcs8' });
  createPrivateKey({ key: edPrivate, format: 'der', type: 'pkcs8' });
  createPrivateKey({ key: xPrivate, format: 'der', type: 'pkcs8' });
  return {
    ed25519PrivatePkcs8: edPrivate,
    ed25519PublicSpki: ed.publicKey.export({ format: 'der', type: 'spki' }),
    x25519PrivatePkcs8: xPrivate,
    x25519PublicSpki: x.publicKey.export({ format: 'der', type: 'spki' }),
  };
}

function statusFor(state: RemotePairingRepositoryState): RemotePairingStatus {
  const record = state.active;
  return {
    configured: Boolean(record),
    revoked: state.revoked,
    recoveryRequired: state.recoveryRequired,
    pendingRequest: Boolean(state.pendingRequest),
    keyEpoch: record?.keyEpoch ?? null,
    ownerFingerprint: record ? digest(record.ownerId).slice(0, 12) : null,
    controllerFingerprint: record ? record.controllerKeyFingerprint.slice(0, 12) : null,
    targetFingerprint: record ? record.targetKeyFingerprint.slice(0, 12) : null,
    expiresAtMs: record?.expiresAtMs ?? null,
  };
}

function emptyState(): RemotePairingRepositoryState {
  return {
    revision: 0,
    active: null,
    pendingRequest: null,
    retiredCredentialSets: [],
    orphanedCredentialSets: [],
    usedBundleDigests: [],
    usedNonceDigests: [],
    usedRelayTokenDigests: [],
    revoked: false,
    recoveryRequired: false,
  };
}

function decodeBase64Url(value: string, label: string): Buffer {
  if (!BASE64URL.test(value)) throw new RemoteError('INVALID_SCHEMA', `${label} is invalid`);
  return Buffer.from(value, 'base64url');
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function dedupeRefs(values: readonly RemoteCredentialSetRef[]): RemoteCredentialSetRef[] {
  const map = new Map(values.map((value) => [`${value.pairingId}:${value.keyEpoch}`, value]));
  return [...map.values()];
}

function invalid(message = 'pairing response is invalid'): never {
  throw new RemoteError('INVALID_SCHEMA', message);
}
