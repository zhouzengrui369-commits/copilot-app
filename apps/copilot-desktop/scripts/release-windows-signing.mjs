import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { publishSigningReportCrashSafe } from './release-macos-signing.mjs';

const SHA256 = /^[a-f0-9]{64}$/i;
const CERTIFICATE_SHA256 = /^[a-f0-9]{64}$/i;

export function resolveOsslSigncode({ pathValue = process.env.PATH ?? '', exists = existsSync } = {}) {
  const candidates = [
    ...String(pathValue).split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, 'osslsigncode')),
    '/opt/homebrew/bin/osslsigncode',
    '/usr/local/bin/osslsigncode',
  ];
  const found = [...new Set(candidates)].find((candidate) => exists(candidate));
  if (!found) {
    throw blocked(
      'BLOCKED_WINDOWS_SIGNING_VERIFIER_MISSING',
      'osslsigncode is required to verify distribution Windows artifacts',
    );
  }
  return found;
}

export function createOsslVerificationPlan({
  osslSigncode,
  filePath,
  signaturePath,
  certificatesPath,
  cmsContentPath,
}) {
  if (![osslSigncode, filePath, signaturePath, certificatesPath, cmsContentPath].every((value) => (
    typeof value === 'string' && path.isAbsolute(value)
  ))) {
    throw blocked('BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED', 'absolute verification paths are required');
  }
  return [
    { id: 'verify', command: osslSigncode, args: ['verify', '-verbose', '-in', filePath] },
    {
      id: 'extract-signature', command: osslSigncode,
      args: ['extract-signature', '-pem', '-in', filePath, '-out', signaturePath],
    },
    {
      id: 'extract-signer-certificate', command: '/usr/bin/openssl',
      args: [
        'cms', '-verify', '-noverify', '-nosigs', '-inform', 'PEM',
        '-in', signaturePath, '-signer', certificatesPath, '-out', cmsContentPath,
      ],
    },
    {
      id: 'inspect-leaf-certificate', command: '/usr/bin/openssl',
      args: ['x509', '-in', certificatesPath, '-noout', '-subject', '-issuer', '-dates', '-fingerprint', '-sha256'],
    },
  ];
}

export function parseOsslSigncodeVerification(output, { now = new Date() } = {}) {
  const text = String(output ?? '');
  const digest = text.match(/Message digest algorithm\s*:\s*(SHA\d+)/i)?.[1]?.toLowerCase();
  const leafText = markedSection(text, 'inspect-leaf-certificate');
  const subject = field(leafText, /^subject\s*=\s*([^\r\n]+)/im);
  const issuer = field(leafText, /^issuer\s*=\s*([^\r\n]+)/im);
  const fingerprintText = field(
    leafText,
    /^sha256 Fingerprint\s*=\s*([A-Fa-f0-9:]+)/im,
  );
  const certificateThumbprint = fingerprintText?.replaceAll(':', '').toUpperCase();
  const certificateSha256Fingerprint = certificateThumbprint;
  const notAfterText = field(leafText, /^notAfter\s*=\s*([^\r\n]+)/im);
  const notAfter = notAfterText ? new Date(notAfterText) : null;
  const timestampValue = field(text, /^(?:Timestamp|Timestamp time)\s*:\s*([^\r\n]+)/im);
  const success = /Signature verification\s*:\s*ok/i.test(text)
    && /Number of verified signatures\s*:\s*1(?:\s|$)/i.test(text)
    && /(?:^|\n)Succeeded(?:\r?$|\n)/i.test(text);
  const timestampVerified = /(?:Timestamp|Timestamp Server Signature) verification\s*:\s*ok/i.test(text);
  const selfSigned = Boolean(subject && issuer && normalizeDn(subject) === normalizeDn(issuer));
  const certificateExpired = !(notAfter instanceof Date)
    || Number.isNaN(notAfter.getTime())
    || notAfter.getTime() <= now.getTime();
  if (
    !success
    || digest !== 'sha256'
    || !subject
    || !issuer
    || !CERTIFICATE_SHA256.test(certificateSha256Fingerprint ?? '')
    || !timestampVerified
    || !timestampValue
    || certificateExpired
    || selfSigned
  ) {
    throw blocked(
      'BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED',
      'Authenticode must be valid, SHA256, timestamped, unexpired, and non-self-signed',
    );
  }
  return {
    cryptographicSignatureValid: true,
    digest,
    publisher: subject,
    certificateThumbprint,
    certificateSha256Fingerprint,
    certificateExpired: false,
    selfSigned: false,
    timestamp: { present: true, value: timestampValue },
  };
}

export function createWindowsBuilderConfig({ baseConfig, output, mode, timestampUrl, signHookPath }) {
  const config = structuredClone(baseConfig ?? {});
  config.directories = { ...(config.directories ?? {}), output };
  config.win = {
    ...(config.win ?? {}),
    certificateFile: null,
    certificatePassword: null,
    certificateSubjectName: null,
    signAndEditExecutable: mode === 'distribution',
  };
  if (mode === 'distribution') {
    if (!validHttps(timestampUrl)
        || typeof signHookPath !== 'string'
        || !path.isAbsolute(signHookPath)
        || !signHookPath.endsWith('.cjs')) {
      throw blocked('BLOCKED_WINDOWS_SIGNING_CREDENTIALS_MISSING', 'An HTTPS RFC3161 timestamp URL is required');
    }
    config.win.sign = signHookPath;
    config.win.signtoolOptions = {
      signingHashAlgorithms: ['sha256'],
    };
  } else {
    delete config.win.sign;
    delete config.win.signtoolOptions;
  }
  return config;
}

export function createWindowsDistributionPlan({ arch } = {}) {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw blocked('BLOCKED_WINDOWS_SIGNING_FAILED', 'Windows architecture must be x64 or arm64');
  }
  return [
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
  ].map((id) => ({ id, arch }));
}

export function assertWindowsMainExecutableIdentity(actual, expected) {
  const fields = ['relativePath', 'sha256', 'bytes', 'publisher', 'digest'];
  const exact = fields.every((fieldName) => actual?.[fieldName] === expected?.[fieldName])
    && actual?.certificateSha256Fingerprint === expected?.certificateSha256Fingerprint
    && actual?.certificateThumbprint === actual?.certificateSha256Fingerprint
    && expected?.certificateThumbprint === expected?.certificateSha256Fingerprint
    && actual?.cryptographicSignatureValid === true
    && expected?.cryptographicSignatureValid === true
    && actual?.certificateExpired === false
    && actual?.selfSigned === false
    && actual?.timestamp?.present === true
    && expected?.timestamp?.present === true
    && actual?.timestamp?.value === expected?.timestamp?.value;
  if (!exact) {
    throw blocked(
      'BLOCKED_WINDOWS_INNER_SIGNATURE_MISMATCH',
      'extracted main executable does not match canonical signed prepackaged identity',
    );
  }
  return true;
}

export function buildWindowsCryptographicSigningReport({
  candidate,
  sourceHead,
  snapshotSha256,
  artifact,
  verification,
  mainExecutable,
  windowsTrustAttestation,
}) {
  assertCryptographicEvidence(verification);
  assertCryptographicEvidence(mainExecutable);
  if (
    !artifact
    || artifact.platform !== 'win32'
    || !SHA256.test(String(artifact.sha256 ?? ''))
    || !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes < 1
    || !SHA256.test(String(snapshotSha256 ?? ''))
    || !safeTrust(windowsTrustAttestation)
  ) {
    throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'Windows report binding is incomplete');
  }
  if (
    verification.publisher !== mainExecutable.publisher
    || verification.certificateSha256Fingerprint !== mainExecutable.certificateSha256Fingerprint
  ) {
    throw blocked('BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED', 'inner and outer signer identities must match');
  }
  const executable = {
    relativePath: mainExecutable.relativePath,
    sha256: mainExecutable.sha256,
    bytes: mainExecutable.bytes,
    publisher: mainExecutable.publisher,
    certificateThumbprint: mainExecutable.certificateThumbprint,
    certificateSha256Fingerprint: mainExecutable.certificateSha256Fingerprint,
    digest: 'sha256',
    cryptographicSignatureValid: true,
    cryptographicTimestamp: { present: true, value: mainExecutable.timestamp.value },
  };
  const report = {
    schemaVersion: 2,
    reportType: 'windows-cryptographic-signing',
    candidate,
    sourceHead,
    snapshotSha256,
    artifactPath: artifact.relativePath,
    artifactSha256: artifact.sha256,
    artifactBytes: artifact.bytes,
    artifactKind: artifact.kind,
    artifactPlatform: artifact.platform,
    verificationPlatform: process.platform,
    provenance: 'canonical-windows-cryptographic-verifier',
    cryptographicSignatureValid: true,
    digest: 'sha256',
    timestamp: { present: true, value: verification.timestamp.value },
    publisher: verification.publisher,
    certificateThumbprint: verification.certificateThumbprint,
    certificateSha256Fingerprint: verification.certificateSha256Fingerprint,
    certificateExpired: false,
    selfSigned: false,
    certificateTrustPolicy: 'windows-attested',
    mainExecutable: executable,
    windowsTrustAttestation,
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const reportSha256 = createHash('sha256').update(reportText).digest('hex');
  return {
    report,
    reportText,
    reportSha256,
    signature: {
      provenance: 'canonical-windows-cryptographic-verifier',
      publisher: verification.publisher,
      certificateThumbprint: verification.certificateThumbprint,
      certificateSha256Fingerprint: verification.certificateSha256Fingerprint,
      certificateExpired: false,
      selfSigned: false,
      cryptographicSignatureValid: true,
      digest: 'sha256',
      cryptographicTimestamp: { present: true, value: verification.timestamp.value },
      certificateTrustPolicy: 'windows-attested',
      mainExecutable: executable,
      windowsTrustAttestation,
      signingReportSha256: reportSha256,
    },
  };
}

export async function publishWindowsSigningReportCrashSafe(input) {
  return publishSigningReportCrashSafe(input);
}

function assertCryptographicEvidence(value) {
  if (
    value?.cryptographicSignatureValid !== true
    || value?.digest !== 'sha256'
    || typeof value?.publisher !== 'string'
    || !value.publisher.trim()
    || !CERTIFICATE_SHA256.test(String(value?.certificateSha256Fingerprint ?? ''))
    || value?.certificateThumbprint !== value?.certificateSha256Fingerprint
    || value?.certificateExpired !== false
    || value?.selfSigned !== false
    || value?.timestamp?.present !== true
    || typeof value?.timestamp?.value !== 'string'
    || !value.timestamp.value.trim()
  ) {
    throw blocked('BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED', 'Windows cryptographic evidence is incomplete');
  }
  if ('relativePath' in value && (
    !safeExePath(value.relativePath)
    || !SHA256.test(String(value.sha256 ?? ''))
    || !Number.isSafeInteger(value.bytes)
    || value.bytes < 1
  )) {
    throw blocked('BLOCKED_WINDOWS_SIGNING_VERIFICATION_FAILED', 'Windows main executable identity is incomplete');
  }
}

function safeTrust(value) {
  return value
    && typeof value.publicKeyPem === 'string'
    && SHA256.test(String(value.publicKeySha256 ?? ''))
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value.runnerId ?? ''));
}

function safeExePath(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*\.exe$/i.test(value)
    && !value.includes('..')
    && !value.includes('//')
    && !value.startsWith('/');
}

function normalizeDn(value) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function field(text, expression) {
  return text.match(expression)?.[1]?.trim();
}

function markedSection(text, id) {
  const marker = `---${id}---`;
  const start = text.lastIndexOf(marker);
  return start >= 0 ? text.slice(start + marker.length) : '';
}

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
      && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function blocked(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
