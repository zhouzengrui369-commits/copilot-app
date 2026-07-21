import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The production release helper is intentionally shipped as plain Node ESM.
import { redactSigningReport, validateMacSigningReport, validateWindowsSigningReport } from '../scripts/release-signing-evidence.mjs';

const macFingerprint = '1'.repeat(64);
const macEntitlementsSha = 'E'.repeat(64);
const dmgFingerprint = '2'.repeat(64);

const sharedBinding = {
  candidate: 'v6.2-r13',
  sourceHead: 'abc123',
  snapshotSha256: 'a'.repeat(64),
  artifactPath: 'artifacts/copilot.zip',
  artifactSha256: 'b'.repeat(64),
  artifactBytes: 1234,
  certificateTrusted: true,
  certificateExpired: false,
  selfSigned: false,
  artifactKind: 'macOS ZIP',
  artifactPlatform: 'darwin',
  certificateSha256Fingerprint: macFingerprint,
  certificateThumbprint: macFingerprint,
  entitlementsSha256: macEntitlementsSha,
  provenance: 'canonical-windows-cryptographic-verifier',
  cryptographicSignatureValid: true,
  digest: 'sha256',
  cryptographicTimestamp: { present: true, value: '2026-07-11T12:00:00Z' },
  certificateTrustPolicy: 'windows-attested',
};

const windowsThumbprint = 'A'.repeat(64);
const runnerId = 'windows-release-runner-01';
const fixtureKeyPair = generateKeyPairSync('ed25519');
const publicKeyPem = fixtureKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const publicKeySha256 = createHash('sha256')
  .update(fixtureKeyPair.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');
const windowsTrustAttestation = { publicKeyPem, publicKeySha256, runnerId };

const windowsExecutableBinding = {
  relativePath: 'njx-copilot-v6.exe',
  sha256: 'd'.repeat(64),
  bytes: 4321,
  signatureStatus: 'Valid',
  publisher: 'CN=NJX Software',
  certificateThumbprint: windowsThumbprint,
  certificateSha256Fingerprint: windowsThumbprint,
  trustChainValid: true,
  digest: 'sha256',
  timestamp: { trusted: true, value: '2026-07-11T12:00:00Z' },
  cryptographicSignatureValid: true,
  cryptographicTimestamp: { present: true, value: '2026-07-11T12:00:00Z' },
};

function macReport(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    reportType: 'macos-signing',
    ...sharedBinding,
    verificationPlatform: 'darwin',
    provenance: 'canonical-macos-verifier',
    identityType: 'Developer ID Application',
    teamId: 'TEAM123456',
    certificateSha256Fingerprint: macFingerprint,
    certificateThumbprint: macFingerprint,
    entitlementsSha256: macEntitlementsSha,
    codesignValid: true,
    hardenedRuntime: true,
    nestedSignaturesValid: true,
    trustedTimestamp: true,
    notarization: { status: 'Accepted', submissionId: 'notary-123' },
    staplerValid: true,
    ...overrides,
  };
}

const dmgScope = {
  hardenedRuntime: 'payload-app',
  nestedSignaturesValid: 'payload-app',
  entitlementsSha256: 'payload-app',
  containerCodesignValid: 'dmg-container',
};

function dmgMacReport(overrides: Record<string, unknown> = {}): Record<string, any> {
  return macReport({
    artifactPath: 'artifacts/copilot.dmg',
    certificateSha256Fingerprint: dmgFingerprint,
    certificateThumbprint: dmgFingerprint,
    containerCodesignValid: true,
    containerTrustedTimestamp: true,
    payloadVerification: {
      codesignValid: true,
      hardenedRuntime: true,
      nestedSignaturesValid: true,
      trustedTimestamp: true,
      entitlementsSha256: macEntitlementsSha,
      payloadCertificateSha256Fingerprint: macFingerprint,
    },
    verificationScope: dmgScope,
    ...overrides,
  });
}

const dmgBinding = {
  ...sharedBinding,
  artifactPath: 'artifacts/copilot.dmg',
  artifactKind: 'macOS DMG',
  artifactPlatform: 'darwin',
  certificateSha256Fingerprint: dmgFingerprint,
  certificateThumbprint: dmgFingerprint,
  entitlementsSha256: macEntitlementsSha,
  teamId: 'TEAM123456',
  containerCodesignValid: true,
  containerTrustedTimestamp: true,
  payloadCertificateSha256Fingerprint: macFingerprint,
  payloadEntitlementsSha256: macEntitlementsSha,
  verificationScope: dmgScope,
};

type WindowsReportFixture = Record<string, unknown> & {
  mainExecutable: Record<string, unknown>;
  attestation?: Record<string, unknown>;
};

function windowsReport(overrides: Record<string, unknown> = {}): WindowsReportFixture {
  const report = {
    schemaVersion: 2,
    reportType: 'windows-signing',
    ...sharedBinding,
    verificationPlatform: 'win32',
    provenance: 'authenticated-windows-trust-runner',
    signatureStatus: 'Valid',
    trustChainValid: true,
    digest: 'sha256',
    timestamp: { trusted: true, value: '2026-07-11T12:00:00Z' },
    publisher: 'CN=NJX Software',
    certificateThumbprint: windowsThumbprint,
    certificateSha256Fingerprint: windowsThumbprint,
    certificateTrustPolicy: 'windows-attested',
    mainExecutable: {
      status: 'Valid',
      ...windowsExecutableBinding,
      certificateSha256Fingerprint: windowsThumbprint,
      containerPath: sharedBinding.artifactPath,
      containerSha256: sharedBinding.artifactSha256,
      containerBytes: sharedBinding.artifactBytes,
    },
    ...overrides,
  };
  if (Object.prototype.hasOwnProperty.call(overrides, 'attestation')) return report as WindowsReportFixture;
  return attestWindowsReport(report) as WindowsReportFixture;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function attestWindowsReport<T extends Record<string, unknown>>(
  report: T,
  privateKey = fixtureKeyPair.privateKey,
  attestationRunnerId = runnerId,
) {
  const { attestation: _attestation, ...payload } = report;
  return {
    ...payload,
    attestation: {
      algorithm: 'ed25519',
      runnerId: attestationRunnerId,
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    },
  };
}

const windowsBinding = {
  ...sharedBinding,
  publisher: 'CN=NJX Software',
  certificateThumbprint: windowsThumbprint,
  certificateSha256Fingerprint: windowsThumbprint,
  mainExecutable: windowsExecutableBinding,
  windowsTrustAttestation,
};

describe('semantic release signing evidence', () => {
  it('accepts a fully bound Developer ID report with notarization and staple', () => {
    expect(validateMacSigningReport(macReport(), { ...sharedBinding, teamId: 'TEAM123456' })).toEqual([]);
  });

  it('accepts a DMG only with distinct outer and payload certificate bindings', () => {
    expect(validateMacSigningReport(dmgMacReport(), dmgBinding)).toEqual([]);
  });

  it.each([
    ['missing outer fingerprint', { certificateSha256Fingerprint: undefined }],
    ['mutated outer fingerprint', { certificateSha256Fingerprint: '3'.repeat(64), certificateThumbprint: '3'.repeat(64) }],
    ['mutated payload fingerprint', {
      payloadVerification: {
        ...dmgMacReport().payloadVerification as Record<string, unknown>,
        payloadCertificateSha256Fingerprint: '3'.repeat(64),
      },
    }],
    ['mutated payload entitlements', {
      payloadVerification: {
        ...dmgMacReport().payloadVerification as Record<string, unknown>,
        entitlementsSha256: '3'.repeat(64),
      },
    }],
    ['invalid scope', { verificationScope: { ...dmgScope, hardenedRuntime: 'dmg-container' } }],
    ['missing container codesign', { containerCodesignValid: false }],
    ['missing container timestamp', { containerTrustedTimestamp: false }],
  ])('rejects DMG evidence with %s', (_label, overrides) => {
    expect(validateMacSigningReport(dmgMacReport(overrides), dmgBinding)).not.toEqual([]);
  });

  it('rejects a ZIP that forges DMG-only container and payload fields', () => {
    expect(validateMacSigningReport(macReport({
      containerCodesignValid: true,
      containerTrustedTimestamp: true,
      payloadVerification: dmgMacReport().payloadVerification,
      verificationScope: dmgScope,
    }), { ...sharedBinding, teamId: 'TEAM123456' })).not.toEqual([]);
  });

  it.each([
    ['fingerprint', { certificateSha256Fingerprint: '3'.repeat(64) }],
    ['entitlements', { entitlementsSha256: '3'.repeat(64) }],
  ])('rejects macOS evidence with a trusted %s mismatch', (_label, bindingOverride) => {
    expect(validateMacSigningReport(macReport(), {
      ...sharedBinding,
      teamId: 'TEAM123456',
      ...bindingOverride,
    })).not.toEqual([]);
  });

  it.each(['certificateTrusted', 'certificateExpired', 'selfSigned'])('rejects macOS evidence with missing report field %s', (field) => {
    expect(validateMacSigningReport(macReport({ [field]: undefined }), {
      ...sharedBinding,
      teamId: 'TEAM123456',
    })).not.toEqual([]);
  });

  it.each(['certificateTrusted', 'certificateExpired', 'selfSigned'])('rejects macOS evidence with missing trusted binding field %s', (field) => {
    const binding: Record<string, unknown> = { ...sharedBinding, teamId: 'TEAM123456' };
    delete binding[field];
    expect(validateMacSigningReport(macReport(), binding)).not.toEqual([]);
  });

  it.each([
    ['wrong platform', { verificationPlatform: 'linux' }],
    ['wrong provenance', { provenance: 'self-authored' }],
    ['Apple Development', { identityType: 'Apple Development' }],
    ['ad-hoc identity', { identityType: 'ad-hoc' }],
    ['self-signed certificate', { selfSigned: true }],
    ['expired certificate', { certificateExpired: true }],
    ['untrusted certificate', { certificateTrusted: false }],
    ['wrong trusted team', { teamId: 'ATTACKER' }],
    ['invalid codesign', { codesignValid: false }],
    ['missing hardened runtime', { hardenedRuntime: false }],
    ['invalid nested signatures', { nestedSignaturesValid: false }],
    ['missing trusted timestamp', { trustedTimestamp: false }],
    ['rejected notarization', { notarization: { status: 'Rejected', submissionId: 'notary-123' } }],
    ['missing notarization submission', { notarization: { status: 'Accepted', submissionId: '' } }],
    ['missing staple', { staplerValid: false }],
    ['candidate mismatch', { candidate: 'v6.2-other' }],
    ['source mismatch', { sourceHead: 'other' }],
    ['snapshot mismatch', { snapshotSha256: 'c'.repeat(64) }],
    ['artifact path mismatch', { artifactPath: 'artifacts/other.zip' }],
    ['artifact hash mismatch', { artifactSha256: 'd'.repeat(64) }],
    ['artifact bytes mismatch', { artifactBytes: 999 }],
  ])('rejects macOS evidence with %s', (_label, overrides) => {
    expect(validateMacSigningReport(macReport(overrides), { ...sharedBinding, teamId: 'TEAM123456' })).not.toEqual([]);
  });

  it('accepts a trusted Windows Authenticode report bound to its container', () => {
    expect(validateWindowsSigningReport(windowsReport(), {
      ...sharedBinding,
      publisher: 'CN=NJX Software',
      certificateThumbprint: windowsThumbprint,
      certificateSha256Fingerprint: windowsThumbprint,
      mainExecutable: windowsExecutableBinding,
      windowsTrustAttestation,
    })).toEqual([]);
  });

  it('binds cross-platform signer identity by leaf DER SHA256 without equating OpenSSL and .NET publisher text', () => {
    const report = windowsReport({
      publisher: 'CN=NJX Software, O=NJX',
      mainExecutable: {
        ...windowsReport().mainExecutable,
        publisher: 'CN=NJX Software, O=NJX',
      },
    });
    const binding = {
      ...windowsBinding,
      publisher: '/CN=NJX Software/O=NJX',
      mainExecutable: {
        ...windowsExecutableBinding,
        publisher: '/CN=NJX Software/O=NJX',
      },
    };
    expect(validateWindowsSigningReport(report, binding)).toEqual([]);
  });

  it('still rejects publisher disagreement within either platform evidence', () => {
    const reportMismatch = windowsReport({
      mainExecutable: { ...windowsReport().mainExecutable, publisher: 'CN=Other Runtime Name' },
    });
    expect(validateWindowsSigningReport(reportMismatch, windowsBinding)).not.toEqual([]);
    expect(validateWindowsSigningReport(windowsReport(), {
      ...windowsBinding,
      mainExecutable: { ...windowsExecutableBinding, publisher: '/CN=Other Canonical Name' },
    })).not.toEqual([]);
  });

  it.each([
    ['missing report leaf SHA256', { report: { certificateSha256Fingerprint: undefined }, binding: {} }],
    ['missing trusted leaf SHA256', { report: {}, binding: { certificateSha256Fingerprint: undefined } }],
    ['mismatched report leaf SHA256', { report: { certificateSha256Fingerprint: 'B'.repeat(64) }, binding: {} }],
    ['SHA1-only outer identity', {
      report: { certificateThumbprint: 'C'.repeat(40), certificateSha256Fingerprint: 'C'.repeat(40) },
      binding: { certificateThumbprint: 'C'.repeat(40), certificateSha256Fingerprint: 'C'.repeat(40) },
    }],
  ])('rejects Windows evidence with %s', (_label, overrides) => {
    expect(validateWindowsSigningReport(windowsReport(overrides.report), {
      ...windowsBinding,
      ...overrides.binding,
    })).not.toEqual([]);
  });

  it.each([
    ['missing report main leaf SHA256', { report: { certificateSha256Fingerprint: undefined }, binding: {} }],
    ['missing trusted main leaf SHA256', { report: {}, binding: { certificateSha256Fingerprint: undefined } }],
    ['mismatched report main leaf SHA256', { report: { certificateSha256Fingerprint: 'B'.repeat(64) }, binding: {} }],
    ['SHA1-only main identity', {
      report: { certificateThumbprint: 'C'.repeat(40), certificateSha256Fingerprint: 'C'.repeat(40) },
      binding: { certificateThumbprint: 'C'.repeat(40), certificateSha256Fingerprint: 'C'.repeat(40) },
    }],
  ])('rejects Windows main evidence with %s', (_label, overrides) => {
    const report = windowsReport({
      mainExecutable: { ...windowsReport().mainExecutable, ...overrides.report },
    });
    expect(validateWindowsSigningReport(report, {
      ...windowsBinding,
      mainExecutable: { ...windowsExecutableBinding, ...overrides.binding },
    })).not.toEqual([]);
  });

  it('binds independently parsed UTC instants outer-to-outer and main-to-main', () => {
    const report = windowsReport({
      timestamp: { trusted: true, value: '2026-07-11T12:00:00.000Z' },
      mainExecutable: {
        ...windowsReport().mainExecutable,
        timestamp: { trusted: true, value: '2026-07-11T13:00:00.000Z' },
      },
    });
    const binding = {
      ...windowsBinding,
      cryptographicTimestamp: { present: true, value: 'Jul 11 12:00:00 2026 GMT' },
      mainExecutable: {
        ...windowsExecutableBinding,
        cryptographicTimestamp: { present: true, value: 'Jul 11 13:00:00 2026 GMT' },
      },
    };
    expect(validateWindowsSigningReport(report, binding)).toEqual([]);
  });

  it.each([
    ['mismatched outer time',
      { outer: '2026-07-11T12:00:01Z', main: '2026-07-11T13:00:00Z' },
      { outer: 'Jul 11 12:00:00 2026 GMT', main: 'Jul 11 13:00:00 2026 GMT' }],
    ['mismatched main time',
      { outer: '2026-07-11T12:00:00Z', main: '2026-07-11T13:00:01Z' },
      { outer: 'Jul 11 12:00:00 2026 GMT', main: 'Jul 11 13:00:00 2026 GMT' }],
    ['cross-bound outer and main times',
      { outer: '2026-07-11T13:00:00Z', main: '2026-07-11T12:00:00Z' },
      { outer: 'Jul 11 12:00:00 2026 GMT', main: 'Jul 11 13:00:00 2026 GMT' }],
    ['unparseable report outer time',
      { outer: 'not-a-time', main: '2026-07-11T13:00:00Z' },
      { outer: 'Jul 11 12:00:00 2026 GMT', main: 'Jul 11 13:00:00 2026 GMT' }],
    ['unparseable trusted outer time',
      { outer: '2026-07-11T12:00:00Z', main: '2026-07-11T13:00:00Z' },
      { outer: 'not-a-time', main: 'Jul 11 13:00:00 2026 GMT' }],
    ['unparseable report main time',
      { outer: '2026-07-11T12:00:00Z', main: 'not-a-time' },
      { outer: 'Jul 11 12:00:00 2026 GMT', main: 'Jul 11 13:00:00 2026 GMT' }],
    ['unparseable trusted main time',
      { outer: '2026-07-11T12:00:00Z', main: '2026-07-11T13:00:00Z' },
      { outer: 'Jul 11 12:00:00 2026 GMT', main: 'not-a-time' }],
  ])('rejects Windows evidence with %s', (_label, reportTimes, trustedTimes) => {
    const report = windowsReport({
      timestamp: { trusted: true, value: reportTimes.outer },
      mainExecutable: {
        ...windowsReport().mainExecutable,
        timestamp: { trusted: true, value: reportTimes.main },
      },
    });
    const binding = {
      ...windowsBinding,
      cryptographicTimestamp: { present: true, value: trustedTimes.outer },
      mainExecutable: {
        ...windowsExecutableBinding,
        cryptographicTimestamp: { present: true, value: trustedTimes.main },
      },
    };
    expect(validateWindowsSigningReport(report, binding)).toEqual(
      expect.arrayContaining([expect.stringContaining('timestamp')]),
    );
  });

  it.each(['certificateTrusted', 'certificateExpired', 'selfSigned'])('rejects Windows evidence with missing report field %s', (field) => {
    expect(validateWindowsSigningReport(windowsReport({ [field]: undefined }), {
      ...sharedBinding,
      publisher: 'CN=NJX Software',
      certificateThumbprint: windowsThumbprint,
      mainExecutable: windowsExecutableBinding,
      windowsTrustAttestation,
    })).not.toEqual([]);
  });

  it.each(['certificateExpired', 'selfSigned'])('rejects Windows evidence with missing trusted binding field %s', (field) => {
    const binding: Record<string, unknown> = {
      ...sharedBinding,
      publisher: 'CN=NJX Software',
      certificateThumbprint: windowsThumbprint,
      mainExecutable: windowsExecutableBinding,
      windowsTrustAttestation,
    };
    delete binding[field];
    expect(validateWindowsSigningReport(windowsReport(), binding)).not.toEqual([]);
  });

  it.each([
    ['wrong platform', { verificationPlatform: 'darwin' }],
    ['invalid signature', { signatureStatus: 'NotSigned' }],
    ['untrusted chain', { trustChainValid: false }],
    ['weak digest', { digest: 'sha1' }],
    ['untrusted timestamp', { timestamp: { trusted: false, value: '2026-07-11T12:00:00Z' } }],
    ['missing timestamp', { timestamp: { trusted: true, value: '' } }],
    ['wrong publisher', { publisher: 'CN=Attacker' }],
    ['wrong certificate', { certificateThumbprint: 'B'.repeat(40) }],
    ['short certificate thumbprint', { certificateThumbprint: 'A'.repeat(39) }],
    ['self-signed certificate', { selfSigned: true }],
    ['expired certificate', { certificateExpired: true }],
    ['untrusted certificate', { certificateTrusted: false }],
    ['invalid main executable', { mainExecutable: { ...windowsReport().mainExecutable, status: 'Invalid' } }],
    ['wrong executable container', { mainExecutable: { ...windowsReport().mainExecutable, containerPath: 'artifacts/other.exe' } }],
    ['wrong executable container hash', { mainExecutable: { ...windowsReport().mainExecutable, containerSha256: 'e'.repeat(64) } }],
    ['wrong executable container size', { mainExecutable: { ...windowsReport().mainExecutable, containerBytes: 1 } }],
    ['candidate mismatch', { candidate: 'v6.2-other' }],
    ['source mismatch', { sourceHead: 'other' }],
    ['snapshot mismatch', { snapshotSha256: 'c'.repeat(64) }],
    ['artifact path mismatch', { artifactPath: 'artifacts/other.exe' }],
    ['artifact hash mismatch', { artifactSha256: 'd'.repeat(64) }],
    ['artifact bytes mismatch', { artifactBytes: 999 }],
  ])('rejects Windows evidence with %s', (_label, overrides) => {
    expect(validateWindowsSigningReport(windowsReport(overrides), {
      ...sharedBinding,
      publisher: 'CN=NJX Software',
      certificateThumbprint: windowsThumbprint,
      mainExecutable: windowsExecutableBinding,
      windowsTrustAttestation,
    })).not.toEqual([]);
  });

  it.each([
    ['missing relative path', { relativePath: '' }],
    ['invalid SHA256', { sha256: 'not-a-sha' }],
    ['invalid bytes', { bytes: 0 }],
    ['invalid signature', { signatureStatus: 'NotSigned' }],
    ['wrong publisher', { publisher: 'CN=Attacker' }],
    ['wrong certificate', { certificateThumbprint: 'B'.repeat(40) }],
    ['short certificate thumbprint', { certificateThumbprint: 'A'.repeat(39) }],
    ['absolute path', { relativePath: '/njx-copilot-v6.exe' }],
    ['drive path', { relativePath: 'C:/njx-copilot-v6.exe' }],
    ['UNC path', { relativePath: '\\\\server\\share\\app.exe' }],
    ['dot segment', { relativePath: './app.exe' }],
    ['empty segment', { relativePath: 'bin//app.exe' }],
    ['parent segment', { relativePath: 'bin/../app.exe' }],
    ['control character', { relativePath: 'bin/evil\u0000.exe' }],
    ['non-executable path', { relativePath: 'bin/app.txt' }],
    ['untrusted chain', { trustChainValid: false }],
    ['weak digest', { digest: 'sha1' }],
    ['untrusted timestamp', { timestamp: { trusted: false, value: '2026-07-11T12:00:00Z' } }],
    ['missing timestamp', { timestamp: { trusted: true, value: '' } }],
  ])('rejects Windows main executable with %s', (_label, executableOverrides) => {
    const report = windowsReport({
      mainExecutable: {
        ...windowsReport().mainExecutable,
        ...executableOverrides,
      },
    });
    expect(validateWindowsSigningReport(report, {
      ...sharedBinding,
      publisher: 'CN=NJX Software',
      certificateThumbprint: windowsThumbprint,
      mainExecutable: windowsExecutableBinding,
      windowsTrustAttestation,
    })).not.toEqual([]);
  });

  it('rejects Windows evidence when trusted inner executable metadata is missing', () => {
    expect(validateWindowsSigningReport(windowsReport(), {
      ...sharedBinding,
      publisher: 'CN=NJX Software',
      certificateThumbprint: windowsThumbprint,
      windowsTrustAttestation,
    })).not.toEqual([]);
  });

  it('rejects self-signed or expired trusted metadata', () => {
    expect(validateWindowsSigningReport(windowsReport(), {
      ...sharedBinding,
      publisher: 'CN=NJX Software',
      certificateThumbprint: windowsThumbprint,
      certificateTrusted: false,
      certificateExpired: true,
      selfSigned: true,
      mainExecutable: windowsExecutableBinding,
      windowsTrustAttestation,
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('trusted'),
      expect.stringContaining('expired'),
      expect.stringContaining('self-signed'),
    ]));
  });

  it('rejects missing or self-authored Windows attestations', () => {
    const unsigned = windowsReport({ attestation: undefined });
    expect(validateWindowsSigningReport(unsigned, windowsBinding)).not.toEqual([]);

    const attacker = generateKeyPairSync('ed25519');
    const wrongKey = attestWindowsReport(windowsReport(), attacker.privateKey);
    expect(validateWindowsSigningReport(wrongKey, windowsBinding)).not.toEqual([]);
  });

  it('rejects a signed Windows report after mutation or forged verificationPlatform', () => {
    const mutated = { ...windowsReport(), unauthenticatedExtraField: 'mutated-after-signing' };
    expect(validateWindowsSigningReport(mutated, windowsBinding)).not.toEqual([]);

    const forgedPlatform = { ...windowsReport(), verificationPlatform: 'darwin' };
    expect(validateWindowsSigningReport(forgedPlatform, windowsBinding)).not.toEqual([]);
  });

  it('rejects mismatched runner and public-key fingerprint provenance', () => {
    expect(validateWindowsSigningReport(windowsReport(), {
      ...windowsBinding,
      windowsTrustAttestation: { ...windowsTrustAttestation, runnerId: 'other-runner' },
    })).not.toEqual([]);
    expect(validateWindowsSigningReport(windowsReport(), {
      ...windowsBinding,
      windowsTrustAttestation: { ...windowsTrustAttestation, publicKeySha256: 'f'.repeat(64) },
    })).not.toEqual([]);
  });

  it('rejects malformed outer and inner trusted certificate thumbprints', () => {
    expect(validateWindowsSigningReport(windowsReport(), {
      ...windowsBinding,
      certificateThumbprint: 'A'.repeat(39),
    })).not.toEqual([]);
    expect(validateWindowsSigningReport(windowsReport(), {
      ...windowsBinding,
      mainExecutable: { ...windowsExecutableBinding, certificateThumbprint: 'A'.repeat(65) },
    })).not.toEqual([]);
  });

  it('rejects malformed thumbprints even when report and trusted metadata match', () => {
    const short = 'A'.repeat(39);
    const report = windowsReport({
      certificateThumbprint: short,
      mainExecutable: { ...windowsReport().mainExecutable, certificateThumbprint: short },
    });
    expect(validateWindowsSigningReport(report, {
      ...windowsBinding,
      certificateThumbprint: short,
      mainExecutable: { ...windowsExecutableBinding, certificateThumbprint: short },
    })).not.toEqual([]);
  });

  it.each([
    './app.exe',
    'bin//app.exe',
    'bin/evil\u0000.exe',
    'bin/app:stream.exe',
    'CON.exe',
    'bin/app.txt',
  ])('rejects a matching but non-normalized trusted Windows inner path %s', (relativePath) => {
    const report = windowsReport({
      mainExecutable: { ...windowsReport().mainExecutable, relativePath },
    });
    expect(validateWindowsSigningReport(report, {
      ...windowsBinding,
      mainExecutable: { ...windowsExecutableBinding, relativePath },
    })).not.toEqual([]);
  });

  it('returns only a credential-safe report projection', () => {
    const redacted = redactSigningReport({
      ...windowsReport(),
      password: 'secret',
      token: 'secret-token',
      privateKey: 'private-material',
      commandOutput: 'may contain credentials',
    });
    expect(redacted).toEqual(expect.objectContaining({
      schemaVersion: 2,
      reportType: 'windows-signing',
      artifactPath: sharedBinding.artifactPath,
      signatureStatus: 'Valid',
    }));
    expect(JSON.stringify(redacted)).not.toMatch(/secret|private-material|commandOutput/i);
  });

  it('does not copy object or array injections into a redacted macOS report', () => {
    const secret = 'FIXTURE_MAC_SECRET';
    const redacted = redactSigningReport({
      ...macReport(),
      candidate: { secret },
      sourceHead: [secret],
      snapshotSha256: { secret },
      artifactPath: [secret],
      artifactSha256: { secret },
      artifactBytes: { secret },
      verificationPlatform: { secret },
      identityType: [secret],
      teamId: { secret },
      notarization: { status: { secret }, submissionId: [secret] },
    });
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(redacted).toEqual(expect.objectContaining({ candidate: null, teamId: null }));
    expect(redacted.notarization).toEqual({ status: null, submissionId: null });
  });

  it('returns only type-safe DMG container/payload fields in the redacted projection', () => {
    const redacted = redactSigningReport(dmgMacReport());
    expect(redacted).toMatchObject({
      certificateSha256Fingerprint: dmgFingerprint,
      entitlementsSha256: macEntitlementsSha,
      containerCodesignValid: true,
      containerTrustedTimestamp: true,
      payloadVerification: {
        codesignValid: true,
        hardenedRuntime: true,
        nestedSignaturesValid: true,
        trustedTimestamp: true,
        entitlementsSha256: macEntitlementsSha,
        payloadCertificateSha256Fingerprint: macFingerprint,
      },
      verificationScope: dmgScope,
    });
    const secret = 'FIXTURE_DMG_SECRET';
    const injected = redactSigningReport(dmgMacReport({
      payloadVerification: { payloadCertificateSha256Fingerprint: { secret } },
      verificationScope: { hardenedRuntime: { secret } },
    }));
    expect(JSON.stringify(injected)).not.toContain(secret);
  });

  it('does not copy object or array injections into a redacted Windows report', () => {
    const secret = 'FIXTURE_WINDOWS_SECRET';
    const redacted = redactSigningReport({
      ...windowsReport(),
      candidate: { secret },
      sourceHead: [secret],
      artifactBytes: [secret],
      publisher: { secret },
      certificateThumbprint: [secret],
      timestamp: { trusted: { secret }, value: [secret] },
      mainExecutable: {
        relativePath: { secret },
        sha256: [secret],
        bytes: { secret },
        signatureStatus: [secret],
        publisher: { secret },
        certificateThumbprint: [secret],
        trustChainValid: { secret },
        digest: [secret],
        timestamp: { trusted: { secret }, value: [secret] },
        containerPath: { secret },
        containerSha256: [secret],
        containerBytes: { secret },
      },
    });
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(redacted).toEqual(expect.objectContaining({ candidate: null, publisher: null }));
    expect(redacted.mainExecutable).toEqual(expect.objectContaining({ relativePath: null, publisher: null }));
  });
});
