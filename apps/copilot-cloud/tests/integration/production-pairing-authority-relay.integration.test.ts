import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pairingRequestDigest,
  stableJson,
  type AuthoritySignatureInput,
  type PairingAuthorityIssueInput,
  type PublicPairingRequestV1,
} from '../../src/remote/pairing-authority.js';
import { createProductionRemoteAuthority } from '../../src/remote/production-authority.js';
import {
  RemoteRelayMemoryState,
  parseRemoteRelayEnvelope,
  type RemoteEnvelope,
} from '../../src/remote/remote-a-relay.js';

const NOW = 1_725_000_000_000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function request(targetEd: { publicKey: KeyObject }, targetX: { publicKey: KeyObject }) {
  const targetEdBytes = targetEd.publicKey.export({ format: 'der', type: 'spki' });
  const targetXBytes = targetX.publicKey.export({ format: 'der', type: 'spki' });
  const base = {
    schemaVersion: 1 as const,
    requestId: randomUUID(),
    pairingId: randomUUID(),
    targetId: 'target_0123456789abcdef',
    keyEpoch: 1,
    targetEd25519PublicKey: targetEdBytes.toString('base64'),
    targetX25519PublicKey: targetXBytes.toString('base64'),
    targetEd25519PublicKeySha256: createHash('sha256').update(targetEdBytes).digest('hex'),
    targetX25519PublicKeySha256: createHash('sha256').update(targetXBytes).digest('hex'),
    issuedAtMs: NOW,
    expiresAtMs: NOW + 60_000,
    nonce: randomBytes(16).toString('base64url'),
  };
  return { ...base, requestDigest: pairingRequestDigest(base) } satisfies PublicPairingRequestV1;
}

function signatureBytes(input: AuthoritySignatureInput): Buffer {
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

class RelaySocket {
  readonly readyState = 1;
  readonly sent: string[] = [];
  send(data: string | Buffer): void { this.sent.push(String(data)); }
  close(): void {}
  terminate(): void {}
  on(): this { return this; }
}

describe('production Pairing authority and relay verifier integration', () => {
  it('shares one issued TTL binding across real file issuer, Bearer verifier, signature verifier, parser and router', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-pairing-authority-'));
    roots.push(root);
    const issuer = generateKeyPairSync('ed25519');
    const issuerPath = path.join(root, 'issuer.pkcs8');
    fs.writeFileSync(issuerPath, issuer.privateKey.export({ format: 'der', type: 'pkcs8' }), { mode: 0o600 });
    fs.chmodSync(issuerPath, 0o600);
    let now = NOW;
    const production = await createProductionRemoteAuthority({
      config: { issuerKeyPath: issuerPath, maxSessions: 10, maxUsedRequests: 10, sessionTtlMs: 60_000 },
      clock: () => now,
    });
    expect(production.status).toBe('ready');

    const targetEd = generateKeyPairSync('ed25519');
    const targetX = generateKeyPairSync('x25519');
    const controllerEd = generateKeyPairSync('ed25519');
    const controllerX = generateKeyPairSync('x25519');
    const publicRequest = request(targetEd, targetX);
    const relayToken = randomBytes(32).toString('base64url');
    const input: PairingAuthorityIssueInput = {
      ownerId: 'owner_0123456789abcdef',
      controllerId: 'controller_0123456789abcdef',
      relayUrl: 'wss://relay.example.test/v1/remote/ws',
      controllerEd25519PublicKey: controllerEd.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      controllerX25519PublicKey: controllerX.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      relayToken,
    };
    const response = await production.authority.issue(publicRequest, input);
    const controllerAuth = {
      role: 'controller' as const,
      ownerId: input.ownerId,
      principalId: input.controllerId,
      sessionId: response.sessionId,
      authorization: `Bearer ${relayToken}`,
    };
    const targetAuth = {
      role: 'target' as const,
      ownerId: input.ownerId,
      principalId: publicRequest.targetId,
      sessionId: response.sessionId,
      authorization: `Bearer ${relayToken}`,
    };
    expect(await production.relayOptions.authVerifier!(controllerAuth)).toBe(true);
    expect(await production.relayOptions.authVerifier!(targetAuth)).toBe(true);
    expect(await production.relayOptions.authVerifier!({
      ...controllerAuth,
      authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
    })).toBe(false);

    const ciphertext = randomBytes(48);
    const unsigned: Omit<RemoteEnvelope, 'controllerSignature'> = {
      schemaVersion: 1,
      messageType: 'command',
      requestId: randomUUID(),
      sessionId: response.sessionId,
      commandId: randomUUID(),
      ownerId: input.ownerId,
      controllerId: input.controllerId,
      targetId: publicRequest.targetId,
      nonce: randomBytes(16).toString('base64url'),
      issuedAtMs: NOW,
      expiresAtMs: NOW + 30_000,
      payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
      payloadCiphertext: ciphertext.toString('base64url'),
      payloadSha256: createHash('sha256').update(ciphertext).digest('hex'),
    };
    const signatureInput: AuthoritySignatureInput = {
      schemaVersion: unsigned.schemaVersion,
      messageType: unsigned.messageType,
      requestId: unsigned.requestId,
      sessionId: unsigned.sessionId,
      commandId: unsigned.commandId,
      ownerId: unsigned.ownerId,
      controllerId: unsigned.controllerId,
      targetId: unsigned.targetId,
      nonce: unsigned.nonce,
      issuedAtMs: unsigned.issuedAtMs,
      expiresAtMs: unsigned.expiresAtMs,
      payloadAlgorithm: unsigned.payloadAlgorithm,
      payloadSha256: unsigned.payloadSha256,
      signerRole: 'controller',
      signerId: input.controllerId,
    };
    const envelope: RemoteEnvelope = {
      ...unsigned,
      controllerSignature: sign(null, signatureBytes(signatureInput), controllerEd.privateKey).toString('base64url'),
    };
    const parsed = parseRemoteRelayEnvelope(Buffer.from(JSON.stringify(envelope)), now);
    expect(parsed).toMatchObject({ ok: true });
    expect(await production.relayOptions.signatureVerifier!(
      signatureInput,
      envelope.controllerSignature,
    )).toBe(true);
    expect(await production.relayOptions.signatureVerifier!(
      { ...signatureInput, targetId: 'target_wrong_binding' },
      envelope.controllerSignature,
    )).toBe(false);

    const state = new RemoteRelayMemoryState(() => now, 10);
    const targetSocket = new RelaySocket();
    state.attach(targetSocket as never, {
      role: 'target', ownerId: input.ownerId, principalId: publicRequest.targetId, sessionId: response.sessionId,
    });
    expect(state.target((parsed as { ok: true; envelope: RemoteEnvelope }).envelope)?.socket).toBe(targetSocket);
    expect(JSON.stringify(response)).not.toContain(relayToken);
    expect(JSON.stringify(production.store.redactedSnapshot())).not.toMatch(/token|private|publicKey|digest/i);

    now = response.expiresAtMs;
    expect(await production.relayOptions.authVerifier!(targetAuth)).toBe(false);
    expect(await production.relayOptions.signatureVerifier!(
      signatureInput,
      envelope.controllerSignature,
    )).toBe(false);
  });
});
