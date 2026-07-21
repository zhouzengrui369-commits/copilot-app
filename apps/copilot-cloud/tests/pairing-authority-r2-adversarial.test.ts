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
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import {
  PairingAuthorityStore,
  pairingRequestDigest,
  parsePublicPairingRequest,
  type AuthoritySessionBinding,
  type AuthoritySignatureInput,
  type PairingIssuerKeyProvider,
  type PublicPairingRequestV1,
} from '../src/remote/pairing-authority.js';
import {
  FileEd25519IssuerKeyProvider,
  createProductionRemoteAuthority,
} from '../src/remote/production-authority.js';

const NOW = 1_725_000_000_000;
const REQUEST_RETENTION_MS = 15 * 60_000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

const bindingKeys = {
  controllerEd: generateKeyPairSync('ed25519'),
  controllerX: generateKeyPairSync('x25519'),
  targetEd: generateKeyPairSync('ed25519'),
  targetX: generateKeyPairSync('x25519'),
};

function spki(key: KeyObject): string {
  return key.export({ format: 'der', type: 'spki' }).toString('base64');
}

function binding(sequence: number, issuedAtMs: number, expiresAtMs: number): AuthoritySessionBinding {
  return {
    requestDigest: sha256(`request-${sequence}`),
    pairingId: uuid(sequence),
    keyEpoch: sequence,
    ownerId: `owner_${String(sequence).padStart(8, '0')}`,
    controllerId: `controller_${String(sequence).padStart(8, '0')}`,
    targetId: `target_${String(sequence).padStart(8, '0')}`,
    sessionId: uuid(10_000 + sequence),
    relayTokenSha256: sha256(`relay-token-${sequence}`),
    controllerEd25519PublicKey: spki(bindingKeys.controllerEd.publicKey),
    controllerX25519PublicKey: spki(bindingKeys.controllerX.publicKey),
    targetEd25519PublicKey: spki(bindingKeys.targetEd.publicKey),
    targetX25519PublicKey: spki(bindingKeys.targetX.publicKey),
    issuedAtMs,
    expiresAtMs,
  };
}

function requestFixture(
  issuedAtMs = NOW,
  expiresAtMs = NOW + 60_000,
): PublicPairingRequestV1 {
  const targetEd = generateKeyPairSync('ed25519');
  const targetX = generateKeyPairSync('x25519');
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
    targetEd25519PublicKeySha256: sha256(targetEdBytes),
    targetX25519PublicKeySha256: sha256(targetXBytes),
    issuedAtMs,
    expiresAtMs,
    nonce: randomBytes(16).toString('base64url'),
  };
  return { ...base, requestDigest: pairingRequestDigest(base) };
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-pairing-r2-'));
  roots.push(root);
  return root;
}

function writeFile(root: string, name: string, bytes: string | Uint8Array, mode = 0o600): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, bytes, { mode });
  fs.chmodSync(file, mode);
  return file;
}

function posixProvider(file: string, expectedUid = fs.statSync(file).uid): FileEd25519IssuerKeyProvider {
  return new FileEd25519IssuerKeyProvider(file, { expectedUid });
}

const deniedSignatureInput: AuthoritySignatureInput = {
  schemaVersion: 1,
  messageType: 'command',
  requestId: uuid(90_001),
  sessionId: uuid(90_002),
  commandId: uuid(90_003),
  ownerId: 'owner_0123456789abcdef',
  controllerId: 'controller_0123456789abcdef',
  targetId: 'target_0123456789abcdef',
  nonce: randomBytes(16).toString('base64url'),
  issuedAtMs: NOW,
  expiresAtMs: NOW + 60_000,
  payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
  payloadSha256: sha256('ciphertext'),
  signerRole: 'controller',
  signerId: 'controller_0123456789abcdef',
};

describe('G4 r2 bounded replay retention', () => {
  it('never evicts a live replay digest when short sessions churn through the active-session capacity', () => {
    let now = NOW;
    const requestExpiry = NOW + REQUEST_RETENTION_MS;
    const store = new PairingAuthorityStore(1, () => now, 2);

    const first = binding(1, now, now + 1);
    store.register(first, requestExpiry);
    expect(store.redactedCapacitySnapshot()).toEqual({
      sessions: 1,
      usedRequests: 1,
      maxSessions: 1,
      maxUsedRequests: 2,
    });

    now += 2;
    expect(store.redactedCapacitySnapshot()).toMatchObject({ sessions: 0, usedRequests: 1 });
    const second = binding(2, now, now + 1);
    store.register(second, requestExpiry);

    now += 2;
    expect(store.redactedCapacitySnapshot()).toMatchObject({ sessions: 0, usedRequests: 2 });
    expect(() => store.register(binding(3, now, now + 1), requestExpiry))
      .toThrowError(expect.objectContaining({ code: 'AUTHORITY_CAPACITY_EXCEEDED' }));

    const replay = {
      ...binding(4, now, now + 1),
      requestDigest: first.requestDigest,
    };
    expect(() => store.register(replay, requestExpiry))
      .toThrowError(expect.objectContaining({ code: 'PAIRING_REQUEST_REPLAYED' }));
    expect(store.redactedCapacitySnapshot()).toMatchObject({ sessions: 0, usedRequests: 2 });

    now = requestExpiry;
    expect(store.redactedCapacitySnapshot()).toMatchObject({ sessions: 0, usedRequests: 0 });
    store.register(binding(5, now, now + 1), now + REQUEST_RETENTION_MS);
    expect(store.redactedCapacitySnapshot()).toMatchObject({ sessions: 1, usedRequests: 1 });
  });

  it('parses an independent replay capacity and fails the whole authority config closed when it is invalid', () => {
    expect(loadConfig({
      REMOTE_PAIRING_ISSUER_KEY_PATH: '/private/authority/issuer.pkcs8',
      REMOTE_PAIRING_MAX_SESSIONS: '2',
      REMOTE_PAIRING_MAX_USED_REQUESTS: '7',
      REMOTE_PAIRING_SESSION_TTL_MS: '1',
    }).remote.authority).toMatchObject({
      providerState: 'valid',
      maxSessions: 2,
      maxUsedRequests: 7,
      sessionTtlMs: 1,
    });
    expect(loadConfig({
      REMOTE_PAIRING_ISSUER_KEY_PATH: '/private/authority/issuer.pkcs8',
      REMOTE_PAIRING_MAX_SESSIONS: '2',
      REMOTE_PAIRING_MAX_USED_REQUESTS: '0',
    }).remote.authority).toMatchObject({
      providerState: 'invalid',
      maxSessions: 1_000,
      maxUsedRequests: 1_000,
      sessionTtlMs: REQUEST_RETENTION_MS,
    });
  });
});

describe('G4 r2 exact external issuer file policy', () => {
  it.skipIf(process.platform === 'win32')('accepts exact-0600 Ed25519 DER and PEM files', async () => {
    const root = tempRoot();
    const issuer = generateKeyPairSync('ed25519');
    const expected = issuer.publicKey.export({ format: 'der', type: 'spki' });
    const der = writeFile(root, 'issuer.pkcs8', issuer.privateKey.export({ format: 'der', type: 'pkcs8' }));
    const pem = writeFile(root, 'issuer.pem', issuer.privateKey.export({ format: 'pem', type: 'pkcs8' }));

    await expect(posixProvider(der).publicKeySpki()).resolves.toEqual(expected);
    await expect(posixProvider(pem).publicKeySpki()).resolves.toEqual(expected);
  });

  it.skipIf(process.platform === 'win32')('rejects POSIX modes 0400, 0700 and 0640', async () => {
    for (const mode of [0o400, 0o700, 0o640]) {
      const root = tempRoot();
      const issuer = generateKeyPairSync('ed25519');
      const file = writeFile(
        root,
        `issuer-${mode.toString(8)}.pkcs8`,
        issuer.privateKey.export({ format: 'der', type: 'pkcs8' }),
        mode,
      );
      await expect(posixProvider(file).publicKeySpki()).rejects.toThrow('ISSUER_KEY_PROVIDER_INVALID');
    }
  });

  it.skipIf(process.platform === 'win32')('rejects symlinks, multiple-link files, directories and an injected wrong owner UID', async () => {
    const root = tempRoot();
    const issuer = generateKeyPairSync('ed25519');
    const file = writeFile(root, 'issuer.pkcs8', issuer.privateKey.export({ format: 'der', type: 'pkcs8' }));
    const symlink = path.join(root, 'issuer-symlink.pkcs8');
    fs.symlinkSync(file, symlink);
    const hardlink = path.join(root, 'issuer-hardlink.pkcs8');
    fs.linkSync(file, hardlink);
    const directory = path.join(root, 'issuer-directory');
    fs.mkdirSync(directory, { mode: 0o700 });

    await expect(posixProvider(symlink).publicKeySpki()).rejects.toThrow('ISSUER_KEY_PROVIDER_INVALID');
    await expect(posixProvider(hardlink).publicKeySpki()).rejects.toThrow('ISSUER_KEY_PROVIDER_INVALID');
    await expect(posixProvider(directory, fs.statSync(directory).uid).publicKeySpki())
      .rejects.toThrow('ISSUER_KEY_PROVIDER_INVALID');
    fs.unlinkSync(hardlink);
    await expect(posixProvider(file, fs.statSync(file).uid + 1).publicKeySpki())
      .rejects.toThrow('ISSUER_KEY_PROVIDER_INVALID');
  });

  it('rejects undersize, oversize, malformed and non-Ed25519 private-key files', async () => {
    const root = tempRoot();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2_048 });
    const files = [
      writeFile(root, 'undersize.pkcs8', Buffer.alloc(31)),
      writeFile(root, 'oversize.pkcs8', Buffer.alloc(16 * 1024 + 1)),
      writeFile(root, 'malformed.pkcs8', Buffer.alloc(64, 0xa5)),
      writeFile(root, 'rsa.pkcs8', rsa.privateKey.export({ format: 'der', type: 'pkcs8' })),
    ];

    for (const file of files) {
      await expect(new FileEd25519IssuerKeyProvider(file).publicKeySpki())
        .rejects.toThrow('ISSUER_KEY_PROVIDER_INVALID');
    }
  });

  it.skipIf(process.platform === 'win32')('returns only the stable provider error without path or private-key canaries', async () => {
    const root = tempRoot();
    const issuer = generateKeyPairSync('ed25519');
    const privateBytes = issuer.privateKey.export({ format: 'der', type: 'pkcs8' });
    const file = writeFile(root, 'issuer-path-secret-canary.pkcs8', privateBytes, 0o400);
    let serialized = '';
    try {
      await posixProvider(file).publicKeySpki();
    } catch (error) {
      serialized = String(error);
    }
    expect(serialized).toContain('ISSUER_KEY_PROVIDER_INVALID');
    expect(serialized).not.toContain(file);
    expect(serialized).not.toContain(privateBytes.toString('base64'));
  });
});

describe('G4 r2 parser and deny-all composition adversarial cases', () => {
  it('rejects a canonical target key paired with a wrong hash even when the request digest is recomputed', () => {
    const request = requestFixture();
    const wrongHash = {
      ...request,
      targetEd25519PublicKeySha256: 'f'.repeat(64),
    };
    wrongHash.requestDigest = pairingRequestDigest(wrongHash);
    expect(() => parsePublicPairingRequest(wrongHash, NOW))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PAIRING_REQUEST' }));
  });

  it('accepts the exact future-skew boundary and rejects one millisecond beyond it', () => {
    const boundary = requestFixture(NOW + 30_000, NOW + 90_000);
    expect(parsePublicPairingRequest(boundary, NOW)).toEqual(boundary);
    const future = requestFixture(NOW + 30_001, NOW + 90_001);
    expect(() => parsePublicPairingRequest(future, NOW))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PAIRING_REQUEST' }));
  });

  it('makes both relay verifiers deny and authority issue unavailable for missing, invalid-provider and invalid-config composition', async () => {
    const issuer = generateKeyPairSync('ed25519');
    const wrongSigner = generateKeyPairSync('ed25519');
    const invalidProvider: PairingIssuerKeyProvider = {
      publicKeySpki: async () => issuer.publicKey.export({ format: 'der', type: 'spki' }),
      sign: async (bytes) => sign(null, Buffer.from(bytes), wrongSigner.privateKey),
    };
    const validProvider: PairingIssuerKeyProvider = {
      publicKeySpki: async () => issuer.publicKey.export({ format: 'der', type: 'spki' }),
      sign: async (bytes) => sign(null, Buffer.from(bytes), issuer.privateKey),
    };
    const compositions = [
      await createProductionRemoteAuthority({ config: null, clock: () => NOW }),
      await createProductionRemoteAuthority({
        config: { issuerKeyPath: '', maxSessions: 2, maxUsedRequests: 2, sessionTtlMs: 60_000 },
        issuerKeyProvider: invalidProvider,
        clock: () => NOW,
      }),
      await createProductionRemoteAuthority({
        config: { issuerKeyPath: '', maxSessions: 2, maxUsedRequests: 0, sessionTtlMs: 60_000 },
        issuerKeyProvider: validProvider,
        clock: () => NOW,
      }),
    ];

    expect(compositions.map(({ status }) => status)).toEqual([
      'provider_missing',
      'provider_invalid',
      'provider_invalid',
    ]);
    for (const composition of compositions) {
      expect(await composition.relayOptions.authVerifier!({
        role: 'target',
        ownerId: 'owner_0123456789abcdef',
        principalId: 'target_0123456789abcdef',
        sessionId: uuid(91_001),
        authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
      })).toBe(false);
      expect(await composition.relayOptions.signatureVerifier!(
        deniedSignatureInput,
        randomBytes(64).toString('base64url'),
      )).toBe(false);
      await expect(composition.authority.issue({}, {}))
        .rejects.toMatchObject({ code: 'AUTHORITY_UNAVAILABLE' });
    }
  });
});

describe('G4 r2 static secret and production composition guards', () => {
  it('does not stringify any issuer-file secret span before private-key parsing', () => {
    const source = fs.readFileSync(fileURLToPath(
      new URL('../src/remote/production-authority.ts', import.meta.url),
    ), 'utf8');
    const providerSource = source.slice(
      source.indexOf('export class FileEd25519IssuerKeyProvider'),
      source.indexOf('async function providerIsValid'),
    );
    expect(providerSource).toContain('.equals(FileEd25519IssuerKeyProvider.pemHeader)');
    expect(providerSource).not.toMatch(/\bbytes(?:\.subarray\([^)]*\))?\.toString\s*\(/u);
  });

  it('wires the production verifier pair into the relay and keeps authority logs free of path/secret fields', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');
    const logCalls = [...source.matchAll(/app\.log\.(?:warn|error|info)\(([\s\S]*?)\n\s*\);/gu)]
      .map((match) => match[1] ?? '')
      .join('\n');
    expect(source).toMatch(/buildApp\(\{\s*config,\s*remoteRelay:\s*remoteProduction\.relayOptions\s*\}\)/u);
    expect(source).toContain("code: 'REMOTE_AUTHORITY_DENY_ALL'");
    expect(logCalls).toContain('REMOTE_AUTHORITY_DENY_ALL');
    expect(logCalls).not.toMatch(/issuerKeyPath|relayToken|secret|privateKey|publicKey/u);
  });
});
