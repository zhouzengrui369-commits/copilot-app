import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Plain Node ESM release helper.
import { assertWindowsMainExecutableIdentity, buildWindowsCryptographicSigningReport, createOsslVerificationPlan, createWindowsBuilderConfig, createWindowsDistributionPlan, parseOsslSigncodeVerification, publishWindowsSigningReportCrashSafe, resolveOsslSigncode } from '../scripts/release-windows-signing.mjs';

const roots: string[] = [];
const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windowsSignHookPath = path.join(appRoot, 'scripts/electron-builder-windows-sign.cjs');
const invalidHookCases: Array<[
  string,
  Record<string, string>,
  Partial<{ hash: string }>?,
]> = [
  ['HTTP timestamp', { COPILOT_WINDOWS_TIMESTAMP_URL: 'http://timestamp.example.test/rfc3161' }],
  ['legacy digest', {}, { hash: 'sha1' }],
  ['missing osslsigncode', { COPILOT_WINDOWS_OSSLSIGNCODE: '' }],
];
const sha1Thumbprint = 'C'.repeat(40);
const thumbprint = 'A'.repeat(64);
const successFixture = `
Succeeded
Message digest algorithm  : SHA256
Current PE checksum   : 00000000
Calculated PE checksum: 00000000
Signature verification: ok
Number of verified signatures: 1
Signer certificate:
  Subject: /CN=NJX Software/O=NJX
  Issuer : /CN=Trusted Code Signing CA/O=Example Root
  Serial : 01
  SHA1 fingerprint: ${sha1Thumbprint.match(/../g)?.join(':')}
  Validity
    Not Before: Jan  1 00:00:00 2026 GMT
    Not After : Jan  1 00:00:00 2028 GMT
Timestamp verification: ok
Timestamp: Jul 11 12:00:00 2026 GMT
---inspect-leaf-certificate---
subject=/CN=NJX Software/O=NJX
issuer=/CN=Trusted Code Signing CA/O=Example Root
notAfter=Jan  1 00:00:00 2028 GMT
sha256 Fingerprint=${thumbprint.match(/../g)?.join(':')}
`;
const upstream213Fixture = `
Signature Index: 0  (Primary Signature)
Message digest algorithm  : SHA256
Timestamp Server Signature verification: ok
Signature verification: ok
Signer #0:
Subject: CN=NJX Software, O=NJX
Issuer : CN=Trusted Code Signing CA, O=Example Root
Certificate expiration date:
notBefore : Jan  1 00:00:00 2026 GMT
notAfter : Jan  1 00:00:00 2028 GMT
Timestamp time: Jul 11 12:00:00 2026 GMT
Number of verified signatures: 1
Succeeded
---inspect-leaf-certificate---
subject=CN=NJX Software, O=NJX
issuer=CN=Trusted Code Signing CA, O=Example Root
notAfter=Jan  1 00:00:00 2028 GMT
sha256 Fingerprint=${'B'.repeat(64).match(/../g)?.join(':')}
`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Windows canonical cryptographic signing', () => {
  it('anchors the custom hook to this app module from app, repo and snapshot-like cwd values', async () => {
    const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
    const moduleAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const repoRoot = path.resolve(moduleAppRoot, '../..');
    const snapshotLikeRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-release-snapshot-root-'));
    roots.push(snapshotLikeRoot);
    const originalCwd = process.cwd();
    try {
      for (const cwd of [moduleAppRoot, repoRoot, snapshotLikeRoot]) {
        process.chdir(cwd);
        expect(require(windowsSignHookPath)?.signWindowsFile).toBeTypeOf('function');
      }
    } finally {
      process.chdir(originalCwd);
    }
    expect(source).toContain("const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');");
    expect(source).toContain("const windowsSignHookPath = path.join(appRoot, 'scripts/electron-builder-windows-sign.cjs');");
    expect(source).not.toMatch(/^const windowsSignHookPath = path\.resolve\(process\.cwd\(\)/m);
  });

  it('resolves osslsigncode from PATH or portable Homebrew locations', () => {
    expect(resolveOsslSigncode({
      pathValue: '/fixture/bin:/usr/bin',
      exists: (candidate: string) => candidate === '/fixture/bin/osslsigncode',
    })).toBe('/fixture/bin/osslsigncode');
    expect(resolveOsslSigncode({
      pathValue: '',
      exists: (candidate: string) => candidate === '/usr/local/bin/osslsigncode',
    })).toBe('/usr/local/bin/osslsigncode');
    expect(() => resolveOsslSigncode({ pathValue: '', exists: () => false })).toThrow(
      expect.objectContaining({ code: 'BLOCKED_WINDOWS_SIGNING_VERIFIER_MISSING' }),
    );
  });

  it('plans verification plus signer-certificate extraction before semantic parsing', () => {
    expect(createOsslVerificationPlan({
      osslSigncode: '/opt/homebrew/bin/osslsigncode',
      filePath: '/fixture/app.exe',
      signaturePath: '/private/tmp/signature.pem',
      certificatesPath: '/private/tmp/certificates.pem',
      cmsContentPath: '/private/tmp/authenticode-content.der',
    })).toEqual([
      { id: 'verify', command: '/opt/homebrew/bin/osslsigncode', args: ['verify', '-verbose', '-in', '/fixture/app.exe'] },
      { id: 'extract-signature', command: '/opt/homebrew/bin/osslsigncode', args: ['extract-signature', '-pem', '-in', '/fixture/app.exe', '-out', '/private/tmp/signature.pem'] },
      {
        id: 'extract-signer-certificate', command: '/usr/bin/openssl',
        args: [
          'cms', '-verify', '-noverify', '-nosigs', '-inform', 'PEM',
          '-in', '/private/tmp/signature.pem', '-signer', '/private/tmp/certificates.pem',
          '-out', '/private/tmp/authenticode-content.der',
        ],
      },
      { id: 'inspect-leaf-certificate', command: '/usr/bin/openssl', args: ['x509', '-in', '/private/tmp/certificates.pem', '-noout', '-subject', '-issuer', '-dates', '-fingerprint', '-sha256'] },
    ]);
  });

  it('parses only SHA256, timestamped, unexpired, non-self-signed Authenticode', () => {
    expect(parseOsslSigncodeVerification(successFixture, { now: new Date('2026-07-11T12:00:00Z') }))
      .toMatchObject({
        cryptographicSignatureValid: true,
        digest: 'sha256',
        publisher: '/CN=NJX Software/O=NJX',
        certificateThumbprint: thumbprint,
        certificateSha256Fingerprint: thumbprint,
        certificateExpired: false,
        selfSigned: false,
        timestamp: { present: true },
      });
  });

  it('binds only the CMS-selected signer leaf DER SHA256 and never the independent SHA1 thumbprint', () => {
    const evidence = parseOsslSigncodeVerification(successFixture, { now: new Date('2026-07-11T12:00:00Z') });
    expect(evidence.certificateSha256Fingerprint).toBe(thumbprint);
    expect(evidence.certificateThumbprint).toBe(thumbprint);
    expect(evidence.certificateThumbprint).not.toBe(sha1Thumbprint);
  });

  it('parses the upstream osslsigncode 2.13 verbose field names plus extracted leaf fingerprint', () => {
    expect(parseOsslSigncodeVerification(upstream213Fixture, { now: new Date('2026-07-11T12:00:00Z') }))
      .toMatchObject({
        cryptographicSignatureValid: true,
        publisher: 'CN=NJX Software, O=NJX',
        certificateThumbprint: 'B'.repeat(64),
        timestamp: { present: true, value: 'Jul 11 12:00:00 2026 GMT' },
      });
  });

  it.each([
    ['SHA1 digest', successFixture.replace('SHA256', 'SHA1')],
    ['missing timestamp', successFixture.replace(/Timestamp verification:[\s\S]*$/, '')],
    ['failed verification', successFixture.replace('Signature verification: ok', 'Signature verification: failed')],
    ['self-signed', successFixture.replaceAll('/CN=Trusted Code Signing CA/O=Example Root', '/CN=NJX Software/O=NJX')],
    ['expired', successFixture.replaceAll('Jan  1 00:00:00 2028 GMT', 'Jan  1 00:00:00 2026 GMT')],
    ['bad thumbprint', successFixture.replace(thumbprint.match(/../g)!.join(':'), 'AA:BB')],
    ['multiple signer identifiers', successFixture.replace('Number of verified signatures: 1', 'Number of verified signatures: 2')],
  ])('fails closed for %s', (_label, fixture) => {
    expect(() => parseOsslSigncodeVerification(fixture, { now: new Date('2026-07-11T12:00:00Z') }))
      .toThrow(expect.objectContaining({ code: 'BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED' }));
  });

  it('creates distribution builder config without embedding certificate secrets', () => {
    const config = createWindowsBuilderConfig({
      baseConfig: { win: { target: ['nsis'] } },
      output: '/fixture/output',
      mode: 'distribution',
      timestampUrl: 'https://timestamp.example.test/rfc3161',
      signHookPath: '/fixture/electron-builder-windows-sign.cjs',
    });
    expect(config).toMatchObject({
      directories: { output: '/fixture/output' },
      win: {
        signAndEditExecutable: true,
        sign: '/fixture/electron-builder-windows-sign.cjs',
        certificateFile: null,
        certificatePassword: null,
        signtoolOptions: { signingHashAlgorithms: ['sha256'] },
      },
    });
    expect(config.win.signtoolOptions).toEqual({ signingHashAlgorithms: ['sha256'] });
    expect(JSON.stringify(config.win.signtoolOptions)).not.toMatch(/timestamp|rfc3161/i);
    expect(JSON.stringify(config)).not.toMatch(/fixture-pfx|fixture-password/);
  });

  it('models the electron-builder 25.1.8 custom-sign contract as one SHA256 task with no SHA1 first round', async () => {
    const config = createWindowsBuilderConfig({
      baseConfig: { win: { target: ['nsis'] } },
      output: '/fixture/output',
      mode: 'distribution',
      timestampUrl: 'https://timestamp.example.test/rfc3161',
      signHookPath: '/fixture/electron-builder-windows-sign.cjs',
    });
    const hashes = config.win.signtoolOptions.signingHashAlgorithms;
    expect(hashes).toEqual(['sha256']);
    expect(hashes).not.toContain('sha1');

    const hook = require(windowsSignHookPath);
    const root = await mkdtemp(path.join(os.tmpdir(), 'electron-builder-25-sign-contract-'));
    roots.push(root);
    const target = path.join(root, 'app.exe');
    const pfx = path.join(root, 'signing.pfx');
    await writeFile(target, 'unsigned-pe');
    await writeFile(pfx, 'fixture-pfx');
    const seenHashes: string[] = [];
    for (const hash of hashes) {
      hook.signWindowsFile({
        path: target,
        hash,
        isNest: false,
        options: { appId: 'com.njx.copilot', productName: 'NJX Copilot' },
      }, {
        env: {
          WIN_CSC_LINK: pfx,
          WIN_CSC_KEY_PASSWORD: 'fixture-password',
          COPILOT_WINDOWS_TIMESTAMP_URL: 'https://timestamp.example.test/rfc3161',
          COPILOT_WINDOWS_OSSLSIGNCODE: '/opt/homebrew/bin/osslsigncode',
        },
        spawn: (_command: string, args: string[]) => {
          seenHashes.push(hash);
          writeFileSync(args[args.indexOf('-out') + 1], 'signed-pe');
          return { status: 0, stdout: '', stderr: '' };
        },
      });
    }
    expect(seenHashes).toEqual(['sha256']);
  });

  it('uses a tested osslsigncode custom hook with HTTPS RFC3161 and SHA256 only', async () => {
    expect(existsSync(windowsSignHookPath)).toBe(true);
    const hook = existsSync(windowsSignHookPath) ? require(windowsSignHookPath) : undefined;
    expect(hook?.signWindowsFile).toBeTypeOf('function');

    const root = await mkdtemp(path.join(os.tmpdir(), 'windows-custom-sign-'));
    roots.push(root);
    const target = path.join(root, 'app.exe');
    const pfx = path.join(root, 'signing.pfx');
    await writeFile(target, 'unsigned-pe');
    await writeFile(pfx, 'fixture-pfx');
    const calls: Array<{ command: string; args: string[] }> = [];
    let readpassPath = '';
    hook.signWindowsFile({ path: target, hash: 'sha256' }, {
      env: {
        WIN_CSC_LINK: pfx,
        WIN_CSC_KEY_PASSWORD: 'fixture-password',
        COPILOT_WINDOWS_TIMESTAMP_URL: 'https://timestamp.example.test/rfc3161',
        COPILOT_WINDOWS_OSSLSIGNCODE: '/opt/homebrew/bin/osslsigncode',
      },
      spawn: (command: string, args: string[]) => {
        calls.push({ command, args });
        readpassPath = args[args.indexOf('-readpass') + 1];
        expect(statSync(readpassPath).mode & 0o777).toBe(0o600);
        const output = args[args.indexOf('-out') + 1];
        writeFileSync(output, 'signed-pe');
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    expect(await readFile(target, 'utf8')).toBe('signed-pe');
    expect(calls).toHaveLength(1);
    const [{ command, args }] = calls;
    expect(command).toBe('/opt/homebrew/bin/osslsigncode');
    expect(args).toEqual(expect.arrayContaining([
      'sign', '-pkcs12', pfx, '-readpass', expect.any(String),
      '-h', 'sha256', '-ts', 'https://timestamp.example.test/rfc3161',
      '-in', target, '-out', expect.any(String),
    ]));
    expect(args).not.toContain('-t');
    expect(args).not.toContain('-pass');
    expect(args).not.toContain('fixture-password');
    expect(existsSync(readpassPath)).toBe(false);
  });

  it('cleans readpass state and redacts child output when osslsigncode fails', async () => {
    const hook = require(windowsSignHookPath);
    const root = await mkdtemp(path.join(os.tmpdir(), 'windows-custom-sign-failure-'));
    roots.push(root);
    const target = path.join(root, 'app.exe');
    const pfx = path.join(root, 'signing.pfx');
    await writeFile(target, 'unsigned-pe');
    await writeFile(pfx, 'fixture-pfx');
    let readpassPath = '';
    let caught: unknown;
    try {
      hook.signWindowsFile({ path: target, hash: 'sha256' }, {
        env: {
          WIN_CSC_LINK: pfx,
          WIN_CSC_KEY_PASSWORD: 'fixture-password',
          COPILOT_WINDOWS_TIMESTAMP_URL: 'https://timestamp.example.test/rfc3161',
          COPILOT_WINDOWS_OSSLSIGNCODE: '/opt/homebrew/bin/osslsigncode',
        },
        spawn: (_command: string, args: string[]) => {
          readpassPath = args[args.indexOf('-readpass') + 1];
          expect(statSync(readpassPath).mode & 0o777).toBe(0o600);
          return {
            status: 1,
            stdout: 'fixture-password must never escape',
            stderr: 'private signing output must never escape',
          };
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'BLOCKED_WINDOWS_SIGNING_FAILED' });
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught as object));
    expect(serialized).not.toContain('fixture-password');
    expect(serialized).not.toContain('private signing output');
    expect(existsSync(readpassPath)).toBe(false);
    expect(await readFile(target, 'utf8')).toBe('unsigned-pe');
  });

  it.each(invalidHookCases)('fails the custom Windows sign hook closed for %s', async (_label, envOverride, configOverride = {}) => {
    expect(existsSync(windowsSignHookPath)).toBe(true);
    const hook = existsSync(windowsSignHookPath) ? require(windowsSignHookPath) : undefined;
    expect(hook?.signWindowsFile).toBeTypeOf('function');
    const root = await mkdtemp(path.join(os.tmpdir(), 'windows-custom-sign-invalid-'));
    roots.push(root);
    const target = path.join(root, 'app.exe');
    const pfx = path.join(root, 'signing.pfx');
    await writeFile(target, 'unsigned-pe');
    await writeFile(pfx, 'fixture-pfx');
    expect(() => hook.signWindowsFile({ path: target, hash: configOverride.hash ?? 'sha256' }, {
      env: {
        WIN_CSC_LINK: pfx,
        WIN_CSC_KEY_PASSWORD: 'fixture-password',
        COPILOT_WINDOWS_TIMESTAMP_URL: 'https://timestamp.example.test/rfc3161',
        COPILOT_WINDOWS_OSSLSIGNCODE: '/opt/homebrew/bin/osslsigncode',
        ...envOverride,
      },
      spawn: () => ({ status: 0, stdout: '', stderr: '' }),
    })).toThrow(expect.objectContaining({ code: 'BLOCKED_WINDOWS_SIGNING_FAILED' }));
  });

  it('preserves unsigned builder behavior with signing disabled', () => {
    expect(createWindowsBuilderConfig({
      baseConfig: { win: { target: ['portable'] } },
      output: '/fixture/output',
      mode: 'unsigned',
    }).win).toMatchObject({ signAndEditExecutable: false, certificateFile: null, certificatePassword: null });
  });

  it('enforces the native, inner signature, outer signature, hash and report order', () => {
    const plan = createWindowsDistributionPlan({ arch: 'x64' });
    expect(plan.map((step: { id: string }) => step.id)).toEqual([
      'acquire-native',
      'build-signed-unpacked',
      'patch-native',
      'verify-main-executable',
      'build-installers-from-signed-prepackaged',
      'verify-outer-artifacts',
      'hash-artifacts',
      'write-cryptographic-reports',
      'bind-report-metadata',
      'verify-completion-integrity',
    ]);
  });

  it('requires every extracted artifact to contain the exact signed main executable identity', () => {
    const expected = {
      relativePath: 'njx-copilot-v6.exe', sha256: 'd'.repeat(64), bytes: 4321,
      publisher: '/CN=NJX Software/O=NJX', certificateThumbprint: thumbprint,
      certificateSha256Fingerprint: thumbprint,
      digest: 'sha256', cryptographicSignatureValid: true,
      timestamp: { present: true, value: 'Jul 11 12:00:00 2026 GMT' },
      certificateExpired: false, selfSigned: false,
    };
    expect(assertWindowsMainExecutableIdentity({ ...expected }, expected)).toBe(true);
    expect(() => assertWindowsMainExecutableIdentity({ ...expected, sha256: 'e'.repeat(64) }, expected))
      .toThrow(expect.objectContaining({ code: 'BLOCKED_WINDOWS_INNER_SIGNATURE_MISMATCH' }));
    expect(() => assertWindowsMainExecutableIdentity({ ...expected, publisher: '/CN=Attacker' }, expected))
      .toThrow(expect.objectContaining({ code: 'BLOCKED_WINDOWS_INNER_SIGNATURE_MISMATCH' }));
  });

  it('builds a canonical report and provenance without secrets', () => {
    const artifact = {
      relativePath: 'artifacts/copilot-setup.exe', kind: 'Windows NSIS', platform: 'win32', arch: 'x64',
      sha256: 'b'.repeat(64), bytes: 1234,
    };
    const verification = {
      cryptographicSignatureValid: true, digest: 'sha256', publisher: '/CN=NJX Software/O=NJX',
      certificateThumbprint: thumbprint, certificateExpired: false, selfSigned: false,
      certificateSha256Fingerprint: thumbprint,
      timestamp: { present: true, value: 'Jul 11 12:00:00 2026 GMT' },
    };
    const mainExecutable = {
      relativePath: 'njx-copilot-v6.exe', sha256: 'd'.repeat(64), bytes: 4321,
      ...verification,
    };
    const trust = {
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nfixture-public\n-----END PUBLIC KEY-----\n',
      publicKeySha256: 'e'.repeat(64), runnerId: 'windows-release-runner-01',
    };
    const built = buildWindowsCryptographicSigningReport({
      candidate: 'v6.2-r13', sourceHead: 'head', snapshotSha256: 'a'.repeat(64),
      artifact, verification, mainExecutable, windowsTrustAttestation: trust,
    });
    expect(built.report).toMatchObject({
      schemaVersion: 2,
      reportType: 'windows-cryptographic-signing',
      provenance: 'canonical-windows-cryptographic-verifier',
      certificateTrustPolicy: 'windows-attested',
      mainExecutable: { relativePath: 'njx-copilot-v6.exe', sha256: 'd'.repeat(64) },
      windowsTrustAttestation: trust,
    });
    expect(built.signature).toMatchObject({
      provenance: 'canonical-windows-cryptographic-verifier',
      publisher: '/CN=NJX Software/O=NJX',
      certificateThumbprint: thumbprint,
      certificateSha256Fingerprint: thumbprint,
      certificateTrustPolicy: 'windows-attested',
      mainExecutable: { sha256: 'd'.repeat(64) },
      windowsTrustAttestation: trust,
      signingReportSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(built.reportSha256).toBe(createHash('sha256').update(built.reportText).digest('hex'));
    expect(JSON.stringify(built)).not.toMatch(/pfx|password|privateKey/i);
  });

  it('publishes reports crash-safe and never overwrites', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'windows-signing-report-'));
    roots.push(root);
    const target = path.join(root, 'report.json');
    await publishWindowsSigningReportCrashSafe({ target, contents: '{"ok":true}\n' });
    expect(await readFile(target, 'utf8')).toBe('{"ok":true}\n');
    await expect(publishWindowsSigningReportCrashSafe({ target, contents: '{"ok":false}\n' }))
      .rejects.toMatchObject({ code: 'BLOCKED_SIGNING_EVIDENCE_BINDING' });
    await writeFile(path.join(root, 'sentinel'), 'still-here');
  });
});
