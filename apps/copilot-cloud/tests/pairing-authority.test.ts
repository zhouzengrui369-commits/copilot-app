import {
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PairingAuthority,
  PairingAuthorityStore,
  pairingRequestDigest,
  pairingResponseSignatureBytes,
  pairingTokenAadBytes,
  parsePublicPairingRequest,
  stableJson,
  type AuthoritySignatureInput,
  type PairingAuthorityIssueInput,
  type PairingIssuerKeyProvider,
  type PublicPairingRequestV1,
} from '../src/remote/pairing-authority.js';
import { createProductionRemoteAuthority } from '../src/remote/production-authority.js';

const NOW = 1_725_000_000_000;
const TOKEN_INFO = Buffer.from('copilot-pairing-relay-token-v1', 'utf8');

class MemoryIssuerProvider implements PairingIssuerKeyProvider {
  constructor(private readonly privateKey: KeyObject, private readonly publicKey: KeyObject) {}
  async publicKeySpki(): Promise<Uint8Array> {
    return this.publicKey.export({ format: 'der', type: 'spki' });
  }
  async sign(bytes: Uint8Array): Promise<Uint8Array> {
    return sign(null, Buffer.from(bytes), this.privateKey);
  }
}

function fixture() {
  const issuer = generateKeyPairSync('ed25519');
  const targetEd = generateKeyPairSync('ed25519');
  const targetX = generateKeyPairSync('x25519');
  const controllerEd = generateKeyPairSync('ed25519');
  const controllerX = generateKeyPairSync('x25519');
  const token = randomBytes(32).toString('base64url');
  const base = {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    pairingId: randomUUID(),
    targetId: 'target_0123456789abcdef',
    keyEpoch: 1,
    targetEd25519PublicKey: targetEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    targetX25519PublicKey: targetX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    targetEd25519PublicKeySha256: createHash('sha256').update(targetEd.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'),
    targetX25519PublicKeySha256: createHash('sha256').update(targetX.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'),
    issuedAtMs: NOW,
    expiresAtMs: NOW + 15 * 60_000,
    nonce: randomBytes(16).toString('base64url'),
  };
  const request: PublicPairingRequestV1 = { ...base, requestDigest: pairingRequestDigest(base) };
  const input: PairingAuthorityIssueInput = {
    ownerId: 'owner_0123456789abcdef',
    controllerId: 'controller_0123456789abcdef',
    relayUrl: 'wss://relay.example.test/v1/remote/ws',
    controllerEd25519PublicKey: controllerEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    controllerX25519PublicKey: controllerX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    relayToken: token,
  };
  const store = new PairingAuthorityStore(10, () => NOW);
  const provider = new MemoryIssuerProvider(issuer.privateKey, issuer.publicKey);
  const authority = new PairingAuthority({
    issuerKeyProvider: provider,
    store,
    clock: () => NOW,
    randomUuid: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  return { issuer, targetEd, targetX, controllerEd, controllerX, token, request, input, store, authority, provider };
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

describe('production Cloud pairing request parser and authority', () => {
  it('parses only the exact request and recomputes digest, key types, hashes, nonce and lifetime', () => {
    const { request } = fixture();
    expect(parsePublicPairingRequest(JSON.stringify(request), NOW)).toEqual(request);
    expect(() => parsePublicPairingRequest({ ...request, extra: true }, NOW)).toThrow('INVALID_PAIRING_REQUEST');
    expect(() => parsePublicPairingRequest({ ...request, requestDigest: '0'.repeat(64) }, NOW)).toThrow('INVALID_PAIRING_REQUEST');
    for (const patch of [
      { requestId: 'not-a-uuid' },
      { pairingId: 'not-a-uuid' },
      { targetId: 'short' },
      { keyEpoch: 0 },
      { nonce: 'not+canonical' },
    ]) {
      const malformed = { ...request, ...patch };
      malformed.requestDigest = pairingRequestDigest(malformed);
      expect(() => parsePublicPairingRequest(malformed, NOW)).toThrow('INVALID_PAIRING_REQUEST');
    }
    expect(() => parsePublicPairingRequest({
      ...request,
      targetEd25519PublicKey: request.targetX25519PublicKey,
    }, NOW)).toThrow('INVALID_PAIRING_REQUEST');
    const nonCanonicalKey = Buffer.concat([
      Buffer.from(request.targetEd25519PublicKey, 'base64'),
      Buffer.from([0]),
    ]).toString('base64');
    const nonCanonical = {
      ...request,
      targetEd25519PublicKey: nonCanonicalKey,
      targetEd25519PublicKeySha256: createHash('sha256').update(Buffer.from(nonCanonicalKey, 'base64')).digest('hex'),
    };
    nonCanonical.requestDigest = pairingRequestDigest(nonCanonical);
    expect(() => parsePublicPairingRequest(nonCanonical, NOW)).toThrow('INVALID_PAIRING_REQUEST');
    const tooLong = { ...request, expiresAtMs: request.issuedAtMs + 15 * 60_000 + 1 };
    tooLong.requestDigest = pairingRequestDigest(tooLong);
    expect(() => parsePublicPairingRequest(tooLong, NOW)).toThrow('INVALID_PAIRING_REQUEST');
    const expired = { ...request, issuedAtMs: NOW - 10_000, expiresAtMs: NOW };
    expired.requestDigest = pairingRequestDigest(expired);
    expect(() => parsePublicPairingRequest(expired, NOW)).toThrow('PAIRING_REQUEST_EXPIRED');
  });

  it('issues exact canonical response v2, decryptable only by target X25519, and emits no plaintext secret', async () => {
    const { authority, issuer, targetX, token, request, input, store } = fixture();
    const response = await authority.issue(request, input);
    expect(Object.keys(response).sort()).toEqual([
      'controllerEd25519PublicKey', 'controllerId', 'controllerX25519PublicKey', 'expiresAtMs',
      'issuedAtMs', 'issuerEphemeralX25519PublicKey', 'issuerSignature', 'keyEpoch', 'nonce',
      'ownerId', 'pairingId', 'relayTokenCiphertext', 'relayTokenNonce', 'relayTokenSha256',
      'relayTokenTag', 'relayUrl', 'requestDigest', 'requestId', 'schemaVersion', 'sessionId',
      'targetEd25519PublicKeySha256', 'targetId', 'targetX25519PublicKeySha256',
    ].sort());
    expect(verify(
      null,
      pairingResponseSignatureBytes(response),
      issuer.publicKey,
      Buffer.from(response.issuerSignature, 'base64url'),
    )).toBe(true);

    const shared = diffieHellman({
      privateKey: targetX.privateKey,
      publicKey: createPublicKey({
        key: Buffer.from(response.issuerEphemeralX25519PublicKey, 'base64'),
        format: 'der',
        type: 'spki',
      }),
    });
    const key = Buffer.from(hkdfSync(
      'sha256', shared, Buffer.from(response.requestDigest, 'hex'), TOKEN_INFO, 32,
    ));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(response.relayTokenNonce, 'base64url'));
    decipher.setAAD(pairingTokenAadBytes(response));
    decipher.setAuthTag(Buffer.from(response.relayTokenTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(response.relayTokenCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    expect(plaintext).toBe(token);
    expect(JSON.stringify(response)).not.toContain(token);
    expect(JSON.stringify(store.redactedSnapshot())).not.toMatch(/token|publicKey|private|digest/i);
    shared.fill(0);
    key.fill(0);
  });

  it('rejects request replay and invalid high-entropy authority input', async () => {
    const { authority, request, input } = fixture();
    await expect(authority.issue(request, input)).resolves.toMatchObject({ schemaVersion: 2 });
    await expect(authority.issue(request, { ...input, relayToken: randomBytes(32).toString('base64url') }))
      .rejects.toMatchObject({ code: 'PAIRING_REQUEST_REPLAYED' });
    const fresh = fixture();
    await expect(fresh.authority.issue(fresh.request, { ...fresh.input, relayToken: 'short' }))
      .rejects.toMatchObject({ code: 'INVALID_AUTHORITY_INPUT' });
  });
});

describe('bounded authority store and production relay verifier composition', () => {
  it('rejects a second active session at the configured bounded capacity', async () => {
    const first = fixture();
    const second = fixture();
    const store = new PairingAuthorityStore(1, () => NOW);
    const authority = new PairingAuthority({
      issuerKeyProvider: first.provider,
      store,
      clock: () => NOW,
    });
    await expect(authority.issue(first.request, first.input)).resolves.toMatchObject({ schemaVersion: 2 });
    await expect(authority.issue(second.request, second.input))
      .rejects.toMatchObject({ code: 'AUTHORITY_CAPACITY_EXCEEDED' });
    expect(store.redactedSnapshot()).toHaveLength(1);
  });

  it('constant-time digest auth requires exact token plus full role/owner/principal/session binding', async () => {
    const { authority, request, input, token, store } = fixture();
    const response = await authority.issue(request, input);
    const target = {
      role: 'target' as const,
      ownerId: input.ownerId,
      principalId: request.targetId,
      sessionId: response.sessionId,
      authorization: `Bearer ${token}`,
    };
    expect(store.authenticate(target)).toBe(true);
    expect(store.authenticate({ ...target, authorization: `Bearer ${randomBytes(32).toString('base64url')}` })).toBe(false);
    expect(store.authenticate({ ...target, ownerId: 'owner_wrong_binding' })).toBe(false);
    expect(store.authenticate({ ...target, principalId: 'target_wrong_binding' })).toBe(false);
    expect(store.authenticate({ ...target, sessionId: randomUUID() })).toBe(false);
  });

  it('verifies exact canonical controller and target signatures against issued public-key binding', async () => {
    const { authority, request, input, store, controllerEd, targetEd } = fixture();
    const response = await authority.issue(request, input);
    const base = {
      schemaVersion: 1 as const,
      messageType: 'command' as const,
      requestId: randomUUID(),
      sessionId: response.sessionId,
      commandId: randomUUID(),
      ownerId: input.ownerId,
      controllerId: input.controllerId,
      targetId: request.targetId,
      nonce: randomBytes(16).toString('base64url'),
      issuedAtMs: NOW,
      expiresAtMs: NOW + 60_000,
      payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM' as const,
      payloadSha256: createHash('sha256').update('ciphertext').digest('hex'),
    };
    const controllerInput: AuthoritySignatureInput = {
      ...base,
      signerRole: 'controller',
      signerId: input.controllerId,
    };
    const controllerSignature = sign(null, envelopeSignatureBytes(controllerInput), controllerEd.privateKey).toString('base64url');
    expect(store.verifyEnvelopeSignature(controllerInput, controllerSignature)).toBe(true);
    expect(store.verifyEnvelopeSignature(
      { ...controllerInput, targetId: 'target_wrong_binding' },
      controllerSignature,
    )).toBe(false);
    expect(store.verifyEnvelopeSignature(controllerInput, randomBytes(64).toString('base64url'))).toBe(false);

    const targetInput: AuthoritySignatureInput = {
      ...base,
      messageType: 'ack',
      signerRole: 'target',
      signerId: request.targetId,
    };
    const targetSignature = sign(null, envelopeSignatureBytes(targetInput), targetEd.privateKey).toString('base64url');
    expect(store.verifyEnvelopeSignature(targetInput, targetSignature)).toBe(true);
  });

  it('expires session and request state and denies authentication/signatures after TTL', async () => {
    let now = NOW;
    const f = fixture();
    const store = new PairingAuthorityStore(2, () => now);
    const authority = new PairingAuthority({
      issuerKeyProvider: f.provider,
      store,
      clock: () => now,
      sessionTtlMs: 1_000,
    });
    const response = await authority.issue(f.request, f.input);
    expect(store.redactedSnapshot()).toHaveLength(1);
    now = response.expiresAtMs;
    expect(store.authenticate({
      role: 'target', ownerId: f.input.ownerId, principalId: f.request.targetId,
      sessionId: response.sessionId, authorization: `Bearer ${f.token}`,
    })).toBe(false);
    expect(store.redactedSnapshot()).toEqual([]);
  });

  it('composes deny-all for missing or invalid issuer provider without leaking provider detail', async () => {
    const missing = await createProductionRemoteAuthority({ config: null, clock: () => NOW });
    expect(missing.status).toBe('provider_missing');
    expect(await missing.relayOptions.authVerifier!({
      role: 'target', ownerId: 'owner_0123456789abcdef', principalId: 'target_0123456789abcdef',
      sessionId: randomUUID(), authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
    })).toBe(false);
    await expect(missing.authority.issue(fixture().request, fixture().input))
      .rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' });

    const invalidProvider: PairingIssuerKeyProvider = {
      publicKeySpki: async () => randomBytes(44),
      sign: async () => randomBytes(64),
    };
    const invalid = await createProductionRemoteAuthority({
      config: { issuerKeyPath: '', maxSessions: 10, maxUsedRequests: 10, sessionTtlMs: 60_000 },
      issuerKeyProvider: invalidProvider,
      clock: () => NOW,
    });
    expect(invalid.status).toBe('provider_invalid');
    const validFixture = fixture();
    const invalidConfiguration = await createProductionRemoteAuthority({
      config: { issuerKeyPath: '', maxSessions: 0, maxUsedRequests: 0, sessionTtlMs: 15 * 60_000 + 1 },
      issuerKeyProvider: new MemoryIssuerProvider(
        validFixture.issuer.privateKey,
        validFixture.issuer.publicKey,
      ),
      relayPath: '/wrong',
      clock: () => NOW,
    });
    expect(invalidConfiguration.status).toBe('provider_invalid');
    expect(await invalidConfiguration.relayOptions.authVerifier!({
      role: 'target', ownerId: 'owner_0123456789abcdef', principalId: 'target_0123456789abcdef',
      sessionId: randomUUID(), authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
    })).toBe(false);
    expect(JSON.stringify({ status: invalid.status, snapshot: invalid.store.redactedSnapshot() }))
      .not.toMatch(/private|issuerKeyPath|relayToken/i);
  });
});
