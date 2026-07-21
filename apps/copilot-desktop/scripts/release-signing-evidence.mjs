import { createHash, createPublicKey, verify } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/i;
const CERTIFICATE_SHA256 = /^[a-f0-9]{64}$/i;
const DMG_VERIFICATION_SCOPE = Object.freeze({
  hardenedRuntime: 'payload-app',
  nestedSignaturesValid: 'payload-app',
  entitlementsSha256: 'payload-app',
  containerCodesignValid: 'dmg-container',
});

/** Validate a macOS signing/notarization report against trusted manifest binding. */
export function validateMacSigningReport(report, binding) {
  const errors = validateCommonBinding(report, binding, 'macos-signing');
  if (report?.verificationPlatform !== 'darwin') errors.push('verificationPlatform must equal darwin');
  if (report?.provenance !== 'canonical-macos-verifier') {
    errors.push('provenance must equal canonical-macos-verifier');
  }
  if (report?.identityType !== 'Developer ID Application') {
    errors.push('identityType must equal Developer ID Application');
  }
  if (!nonEmpty(binding?.teamId) || report?.teamId !== binding.teamId) {
    errors.push('teamId must match trusted artifact signature metadata');
  }
  validateTrustedCertificateMetadata(report, errors);
  validateTrustedCertificateMetadata(binding, errors);
  validateMacHashBinding(report, binding, errors);
  if (report?.codesignValid !== true) errors.push('codesignValid must equal true');
  if (report?.hardenedRuntime !== true) errors.push('hardenedRuntime must equal true');
  if (report?.nestedSignaturesValid !== true) errors.push('nestedSignaturesValid must equal true');
  if (report?.trustedTimestamp !== true) errors.push('trustedTimestamp must equal true');
  if (report?.notarization?.status !== 'Accepted') errors.push('notarization.status must equal Accepted');
  if (!nonEmpty(report?.notarization?.submissionId)) errors.push('notarization.submissionId is required');
  if (report?.staplerValid !== true) errors.push('staplerValid must equal true');
  if (isMacDmgBinding(binding)) validateDmgBinding(report, binding, errors);
  else if (hasDmgOnlyFields(report) || hasDmgOnlyFields(binding)) {
    errors.push('ZIP signing evidence must not contain DMG-only container or payload fields');
  }
  return errors;
}

/** Validate a Windows Authenticode report against trusted manifest binding. */
export function validateWindowsSigningReport(report, binding) {
  const errors = validateCommonBinding(report, binding, 'windows-signing');
  if (report?.verificationPlatform !== 'win32') errors.push('verificationPlatform must equal win32');
  if (report?.provenance !== 'authenticated-windows-trust-runner') {
    errors.push('provenance must equal authenticated-windows-trust-runner');
  }
  if (report?.certificateTrustPolicy !== 'windows-attested'
      || binding?.certificateTrustPolicy !== 'windows-attested') {
    errors.push('certificateTrustPolicy must equal trusted windows-attested');
  }
  if (binding?.provenance !== 'canonical-windows-cryptographic-verifier') {
    errors.push('trusted Windows provenance must equal canonical-windows-cryptographic-verifier');
  }
  validateWindowsAttestation(report, binding, errors);
  if (report?.signatureStatus !== 'Valid') errors.push('signatureStatus must equal Valid');
  if (report?.trustChainValid !== true) errors.push('trustChainValid must equal true');
  if (report?.digest !== 'sha256') errors.push('digest must equal sha256');
  if (report?.timestamp?.trusted !== true) errors.push('timestamp.trusted must equal true');
  if (!nonEmpty(report?.timestamp?.value)) errors.push('timestamp.value is required');
  validateWindowsTimestampBinding(
    report?.timestamp?.value,
    binding?.cryptographicTimestamp?.value,
    'timestamp',
    errors,
  );
  if (!nonEmpty(report?.publisher)) errors.push('publisher is required');
  if (!nonEmpty(binding?.publisher)) errors.push('trusted publisher is required');
  if (!isCertificateSha256(report?.certificateSha256Fingerprint)
      || report?.certificateThumbprint !== report?.certificateSha256Fingerprint) {
    errors.push('certificate identity must equal the signer leaf DER SHA256 fingerprint');
  }
  if (!isCertificateSha256(binding?.certificateSha256Fingerprint)
      || binding?.certificateThumbprint !== binding?.certificateSha256Fingerprint) {
    errors.push('trusted certificate identity must equal the signer leaf DER SHA256 fingerprint');
  }
  if (report?.certificateSha256Fingerprint !== binding?.certificateSha256Fingerprint) {
    errors.push('certificateSha256Fingerprint must match trusted artifact signature metadata');
  }
  validateTrustedCertificateMetadata(report, errors);
  validateWindowsCryptographicBinding(binding, errors);
  validateWindowsMainExecutable(
    report?.mainExecutable,
    binding?.mainExecutable,
    report,
    binding?.publisher,
    errors,
  );
  if (report?.mainExecutable?.status !== 'Valid') errors.push('mainExecutable.status must equal Valid');
  if (report?.mainExecutable?.containerPath !== binding?.artifactPath) {
    errors.push('mainExecutable.containerPath must match artifactPath');
  }
  if (report?.mainExecutable?.containerSha256 !== binding?.artifactSha256) {
    errors.push('mainExecutable.containerSha256 must match artifactSha256');
  }
  if (report?.mainExecutable?.containerBytes !== binding?.artifactBytes) {
    errors.push('mainExecutable.containerBytes must match artifactBytes');
  }
  return errors;
}

/** Return an allowlisted, credential-safe projection suitable for gate output. */
export function redactSigningReport(report) {
  if (!report || typeof report !== 'object') return {};
  const common = {
    schemaVersion: safeNumber(report.schemaVersion),
    reportType: safeString(report.reportType),
    candidate: safeString(report.candidate),
    sourceHead: safeString(report.sourceHead),
    snapshotSha256: safeString(report.snapshotSha256),
    artifactPath: safeString(report.artifactPath),
    artifactSha256: safeString(report.artifactSha256),
    artifactBytes: safeNumber(report.artifactBytes),
    verificationPlatform: safeString(report.verificationPlatform),
  };
  if (report.reportType === 'macos-signing') {
    const dmgFields = hasDmgOnlyFields(report) ? {
      containerCodesignValid: safeBoolean(report.containerCodesignValid),
      containerTrustedTimestamp: safeBoolean(report.containerTrustedTimestamp),
      payloadVerification: {
        codesignValid: safeBoolean(report.payloadVerification?.codesignValid),
        hardenedRuntime: safeBoolean(report.payloadVerification?.hardenedRuntime),
        nestedSignaturesValid: safeBoolean(report.payloadVerification?.nestedSignaturesValid),
        trustedTimestamp: safeBoolean(report.payloadVerification?.trustedTimestamp),
        entitlementsSha256: safeString(report.payloadVerification?.entitlementsSha256),
        payloadCertificateSha256Fingerprint: safeString(
          report.payloadVerification?.payloadCertificateSha256Fingerprint,
        ),
      },
      verificationScope: {
        hardenedRuntime: safeString(report.verificationScope?.hardenedRuntime),
        nestedSignaturesValid: safeString(report.verificationScope?.nestedSignaturesValid),
        entitlementsSha256: safeString(report.verificationScope?.entitlementsSha256),
        containerCodesignValid: safeString(report.verificationScope?.containerCodesignValid),
      },
    } : {};
    return {
      ...common,
      provenance: safeString(report.provenance),
      identityType: safeString(report.identityType),
      teamId: safeString(report.teamId),
      certificateTrusted: safeBoolean(report.certificateTrusted),
      certificateExpired: safeBoolean(report.certificateExpired),
      selfSigned: safeBoolean(report.selfSigned),
      certificateSha256Fingerprint: safeString(report.certificateSha256Fingerprint),
      certificateThumbprint: safeString(report.certificateThumbprint),
      certificateSha256Fingerprint: safeString(report.certificateSha256Fingerprint),
      entitlementsSha256: safeString(report.entitlementsSha256),
      codesignValid: safeBoolean(report.codesignValid),
      hardenedRuntime: safeBoolean(report.hardenedRuntime),
      nestedSignaturesValid: safeBoolean(report.nestedSignaturesValid),
      trustedTimestamp: safeBoolean(report.trustedTimestamp),
      notarization: {
        status: safeString(report.notarization?.status),
        submissionId: safeString(report.notarization?.submissionId),
      },
      staplerValid: safeBoolean(report.staplerValid),
      ...dmgFields,
    };
  }
  if (report.reportType === 'windows-signing') {
    return {
      ...common,
      provenance: safeString(report.provenance),
      signatureStatus: safeString(report.signatureStatus),
      trustChainValid: safeBoolean(report.trustChainValid),
      digest: safeString(report.digest),
      timestamp: {
        trusted: safeBoolean(report.timestamp?.trusted),
        value: safeString(report.timestamp?.value),
      },
      publisher: safeString(report.publisher),
      certificateThumbprint: safeString(report.certificateThumbprint),
      certificateTrusted: safeBoolean(report.certificateTrusted),
      certificateExpired: safeBoolean(report.certificateExpired),
      selfSigned: safeBoolean(report.selfSigned),
      certificateTrustPolicy: safeString(report.certificateTrustPolicy),
      mainExecutable: {
        status: safeString(report.mainExecutable?.status),
        relativePath: safeString(report.mainExecutable?.relativePath),
        sha256: safeString(report.mainExecutable?.sha256),
        bytes: safeNumber(report.mainExecutable?.bytes),
        signatureStatus: safeString(report.mainExecutable?.signatureStatus),
        publisher: safeString(report.mainExecutable?.publisher),
        certificateThumbprint: safeString(report.mainExecutable?.certificateThumbprint),
        certificateSha256Fingerprint: safeString(report.mainExecutable?.certificateSha256Fingerprint),
        trustChainValid: safeBoolean(report.mainExecutable?.trustChainValid),
        digest: safeString(report.mainExecutable?.digest),
        timestamp: {
          trusted: safeBoolean(report.mainExecutable?.timestamp?.trusted),
          value: safeString(report.mainExecutable?.timestamp?.value),
        },
        containerPath: safeString(report.mainExecutable?.containerPath),
        containerSha256: safeString(report.mainExecutable?.containerSha256),
        containerBytes: safeNumber(report.mainExecutable?.containerBytes),
      },
    };
  }
  return common;
}

function validateMacHashBinding(report, binding, errors) {
  if (!SHA256.test(String(report?.certificateSha256Fingerprint ?? ''))) {
    errors.push('certificateSha256Fingerprint must be SHA256');
  }
  if (!SHA256.test(String(binding?.certificateSha256Fingerprint ?? ''))) {
    errors.push('trusted certificateSha256Fingerprint must be SHA256');
  }
  if (report?.certificateSha256Fingerprint !== binding?.certificateSha256Fingerprint) {
    errors.push('certificateSha256Fingerprint must match trusted artifact signature metadata');
  }
  if (!SHA256.test(String(report?.certificateThumbprint ?? ''))
      || report?.certificateThumbprint !== report?.certificateSha256Fingerprint) {
    errors.push('certificateThumbprint must equal the SHA256 certificate fingerprint');
  }
  if (binding?.certificateThumbprint !== binding?.certificateSha256Fingerprint) {
    errors.push('trusted certificateThumbprint must equal the SHA256 certificate fingerprint');
  }
  if (!SHA256.test(String(report?.entitlementsSha256 ?? ''))) {
    errors.push('entitlementsSha256 must be SHA256');
  }
  if (!SHA256.test(String(binding?.entitlementsSha256 ?? ''))) {
    errors.push('trusted entitlementsSha256 must be SHA256');
  }
  if (report?.entitlementsSha256 !== binding?.entitlementsSha256) {
    errors.push('entitlementsSha256 must match trusted artifact signature metadata');
  }
}

function validateDmgBinding(report, binding, errors) {
  if (report?.containerCodesignValid !== true || binding?.containerCodesignValid !== true) {
    errors.push('DMG containerCodesignValid must equal trusted true');
  }
  if (report?.containerTrustedTimestamp !== true || binding?.containerTrustedTimestamp !== true) {
    errors.push('DMG containerTrustedTimestamp must equal trusted true');
  }
  if (!matchesDmgScope(report?.verificationScope) || !matchesDmgScope(binding?.verificationScope)) {
    errors.push('DMG verificationScope must exactly distinguish payload-app from dmg-container');
  }
  const payload = report?.payloadVerification;
  if (
    payload?.codesignValid !== true
    || payload?.hardenedRuntime !== true
    || payload?.nestedSignaturesValid !== true
    || payload?.trustedTimestamp !== true
  ) {
    errors.push('DMG payloadVerification semantic booleans must equal true');
  }
  if (!SHA256.test(String(payload?.payloadCertificateSha256Fingerprint ?? ''))
      || !SHA256.test(String(binding?.payloadCertificateSha256Fingerprint ?? ''))
      || payload?.payloadCertificateSha256Fingerprint !== binding?.payloadCertificateSha256Fingerprint) {
    errors.push('DMG payload certificate fingerprint must match trusted signature metadata');
  }
  if (!SHA256.test(String(payload?.entitlementsSha256 ?? ''))
      || !SHA256.test(String(binding?.payloadEntitlementsSha256 ?? ''))
      || payload?.entitlementsSha256 !== binding?.payloadEntitlementsSha256
      || payload?.entitlementsSha256 !== report?.entitlementsSha256) {
    errors.push('DMG payload entitlements SHA must match report and trusted signature metadata');
  }
}

function isMacDmgBinding(binding) {
  return binding?.artifactPlatform === 'darwin'
    && (binding?.artifactKind === 'macOS DMG' || safeDmgArtifactPath(binding?.artifactPath));
}

function safeDmgArtifactPath(value) {
  return typeof value === 'string'
    && /^artifacts\/[A-Za-z0-9._ -]+\.dmg$/i.test(value)
    && !/[. ]\.dmg$/i.test(value);
}

function hasDmgOnlyFields(value) {
  if (!value || typeof value !== 'object') return false;
  return [
    'containerCodesignValid',
    'containerTrustedTimestamp',
    'payloadVerification',
    'verificationScope',
    'payloadCertificateSha256Fingerprint',
    'payloadEntitlementsSha256',
  ].some((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function matchesDmgScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(DMG_VERIFICATION_SCOPE).sort();
  return JSON.stringify(keys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => value[key] === DMG_VERIFICATION_SCOPE[key]);
}

function validateCommonBinding(report, binding, reportType) {
  const errors = [];
  if (!report || typeof report !== 'object') return ['signing report must be an object'];
  const expectedSchemaVersion = reportType === 'windows-signing' ? 2 : 1;
  if (report.schemaVersion !== expectedSchemaVersion) {
    errors.push(`schemaVersion must equal ${expectedSchemaVersion}`);
  }
  if (report.reportType !== reportType) errors.push(`reportType must equal ${reportType}`);
  for (const field of ['candidate', 'sourceHead', 'snapshotSha256', 'artifactPath', 'artifactSha256', 'artifactBytes']) {
    if (report[field] !== binding?.[field]) errors.push(`${field} must match trusted artifact binding`);
  }
  if (!SHA256.test(String(report.snapshotSha256 ?? ''))) errors.push('snapshotSha256 must be SHA256');
  if (!SHA256.test(String(report.artifactSha256 ?? ''))) errors.push('artifactSha256 must be SHA256');
  if (!Number.isSafeInteger(report.artifactBytes) || report.artifactBytes < 1) {
    errors.push('artifactBytes must be a positive safe integer');
  }
  return errors;
}

function validateWindowsCryptographicBinding(binding, errors) {
  if (binding?.certificateExpired !== false) errors.push('trusted certificate metadata must explicitly be unexpired');
  if (binding?.selfSigned !== false) errors.push('trusted certificate metadata must explicitly be non-self-signed');
  if (binding?.cryptographicSignatureValid !== true) {
    errors.push('trusted cryptographicSignatureValid must equal true');
  }
  if (binding?.digest !== 'sha256') errors.push('trusted digest must equal sha256');
  if (binding?.cryptographicTimestamp?.present !== true
      || !nonEmpty(binding?.cryptographicTimestamp?.value)) {
    errors.push('trusted cryptographic timestamp is required');
  }
}

function validateTrustedCertificateMetadata(binding, errors) {
  if (binding?.certificateTrusted !== true) errors.push('trusted certificate metadata must explicitly be trusted');
  if (binding?.certificateExpired !== false) errors.push('trusted certificate metadata must explicitly be unexpired');
  if (binding?.selfSigned !== false) errors.push('trusted certificate metadata must explicitly be non-self-signed');
}

function validateWindowsMainExecutable(executable, trusted, outerReport, trustedOuterPublisher, errors) {
  if (!executable || typeof executable !== 'object') {
    errors.push('mainExecutable semantic evidence is required');
    return;
  }
  if (!trusted || typeof trusted !== 'object') {
    errors.push('trusted mainExecutable metadata is required');
    return;
  }
  if (!safeWindowsExecutablePath(executable.relativePath)) {
    errors.push('mainExecutable.relativePath must be a normalized safe Windows executable path');
  }
  if (!SHA256.test(String(executable.sha256 ?? ''))) errors.push('mainExecutable.sha256 must be SHA256');
  if (!Number.isSafeInteger(executable.bytes) || executable.bytes < 1) {
    errors.push('mainExecutable.bytes must be a positive safe integer');
  }
  if (executable.signatureStatus !== 'Valid') errors.push('mainExecutable.signatureStatus must equal Valid');
  if (!nonEmpty(executable.publisher)) errors.push('mainExecutable.publisher is required');
  if (!nonEmpty(trusted.publisher)) errors.push('trusted mainExecutable.publisher is required');
  if (!isCertificateSha256(executable.certificateSha256Fingerprint)
      || executable.certificateThumbprint !== executable.certificateSha256Fingerprint) {
    errors.push('mainExecutable certificate identity must equal the signer leaf DER SHA256 fingerprint');
  }
  if (!isCertificateSha256(trusted.certificateSha256Fingerprint)
      || trusted.certificateThumbprint !== trusted.certificateSha256Fingerprint) {
    errors.push('trusted mainExecutable certificate identity must equal the signer leaf DER SHA256 fingerprint');
  }
  if (executable.certificateSha256Fingerprint !== trusted.certificateSha256Fingerprint) {
    errors.push('mainExecutable.certificateSha256Fingerprint must match trusted metadata');
  }
  if (executable.trustChainValid !== true) errors.push('mainExecutable.trustChainValid must equal true');
  if (executable.digest !== 'sha256') errors.push('mainExecutable.digest must equal sha256');
  if (executable.timestamp?.trusted !== true) errors.push('mainExecutable.timestamp.trusted must equal true');
  if (!nonEmpty(executable.timestamp?.value)) errors.push('mainExecutable.timestamp.value is required');

  for (const field of ['relativePath', 'sha256', 'bytes']) {
    if (executable[field] !== trusted[field]) errors.push(`mainExecutable.${field} must match trusted metadata`);
  }
  if (trusted.cryptographicSignatureValid !== true) {
    errors.push('trusted mainExecutable cryptographicSignatureValid must equal true');
  }
  if (trusted.digest !== 'sha256' || executable.digest !== trusted.digest) {
    errors.push('mainExecutable.digest must match trusted metadata');
  }
  if (
    trusted.cryptographicTimestamp?.present !== true
    || !nonEmpty(trusted.cryptographicTimestamp?.value)
  ) {
    errors.push('trusted mainExecutable cryptographic timestamp is required');
  }
  validateWindowsTimestampBinding(
    executable.timestamp?.value,
    trusted.cryptographicTimestamp?.value,
    'mainExecutable.timestamp',
    errors,
  );
  if (executable.publisher !== outerReport?.publisher) {
    errors.push('mainExecutable.publisher must match outer artifact publisher');
  }
  if (trusted.publisher !== trustedOuterPublisher) {
    errors.push('trusted mainExecutable.publisher must match trusted outer artifact publisher');
  }
  if (executable.certificateSha256Fingerprint !== outerReport?.certificateSha256Fingerprint) {
    errors.push('mainExecutable.certificateSha256Fingerprint must match outer artifact certificate');
  }
}

function validateWindowsAttestation(report, binding, errors) {
  const trusted = binding?.windowsTrustAttestation;
  const attestation = report?.attestation;
  if (!trusted || typeof trusted !== 'object') {
    errors.push('trusted Windows attestation metadata is required');
    return;
  }
  if (!nonEmpty(trusted.publicKeyPem) || !SHA256.test(String(trusted.publicKeySha256 ?? '')) || !nonEmpty(trusted.runnerId)) {
    errors.push('trusted Windows attestation metadata is invalid');
    return;
  }
  if (
    !attestation
    || typeof attestation !== 'object'
    || attestation.algorithm !== 'ed25519'
    || attestation.runnerId !== trusted.runnerId
    || !validBase64(attestation.signature)
  ) {
    errors.push('Windows Ed25519 attestation is missing or invalid');
    return;
  }
  try {
    const publicKey = createPublicKey(trusted.publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      errors.push('trusted Windows attestation key must be Ed25519');
      return;
    }
    const fingerprint = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex');
    if (fingerprint !== trusted.publicKeySha256.toLowerCase()) {
      errors.push('trusted Windows attestation key fingerprint mismatch');
      return;
    }
    const { attestation: _attestation, ...payload } = report;
    const signature = Buffer.from(attestation.signature, 'base64');
    if (!verify(null, Buffer.from(canonicalJson(payload)), publicKey, signature)) {
      errors.push('Windows Ed25519 attestation signature is invalid');
    }
  } catch {
    errors.push('Windows Ed25519 attestation verification failed');
  }
}

function validateWindowsTimestampBinding(reportValue, trustedValue, label, errors) {
  const reportInstant = parseUtcTimestamp(reportValue);
  const trustedInstant = parseUtcTimestamp(trustedValue);
  if (reportInstant === null) errors.push(`${label}.value must be a valid UTC timestamp`);
  if (trustedInstant === null) errors.push(`trusted ${label} must be a valid UTC timestamp`);
  if (reportInstant !== null && trustedInstant !== null && reportInstant !== trustedInstant) {
    errors.push(`${label}.value must match trusted cryptographic timestamp`);
  }
}

function parseUtcTimestamp(value) {
  if (!nonEmpty(value)) return null;
  const input = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(input);
  if (iso) {
    const [, year, month, day, hour, minute, second, fraction = ''] = iso;
    return utcNanoseconds({ year, month, day, hour, minute, second, fraction });
  }
  const openssl = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+GMT$/.exec(input);
  if (!openssl) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, monthName, day, hour, minute, second, year] = openssl;
  return utcNanoseconds({
    year,
    month: String(months.indexOf(monthName) + 1),
    day,
    hour,
    minute,
    second,
    fraction: '',
  });
}

function utcNanoseconds({ year, month, day, hour, minute, second, fraction }) {
  const parts = [year, month, day, hour, minute, second].map(Number);
  if (parts.some((part) => !Number.isInteger(part))) return null;
  const [numericYear, numericMonth, numericDay, numericHour, numericMinute, numericSecond] = parts;
  if (numericYear < 1601 || numericYear > 9999
      || numericMonth < 1 || numericMonth > 12
      || numericDay < 1 || numericDay > 31
      || numericHour < 0 || numericHour > 23
      || numericMinute < 0 || numericMinute > 59
      || numericSecond < 0 || numericSecond > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(numericYear, numericMonth - 1, numericDay);
  date.setUTCHours(numericHour, numericMinute, numericSecond, 0);
  if (date.getUTCFullYear() !== numericYear
      || date.getUTCMonth() + 1 !== numericMonth
      || date.getUTCDate() !== numericDay
      || date.getUTCHours() !== numericHour
      || date.getUTCMinutes() !== numericMinute
      || date.getUTCSeconds() !== numericSecond) return null;
  const fractionNanoseconds = BigInt(String(fraction ?? '').padEnd(9, '0').slice(0, 9) || '0');
  return (BigInt(date.getTime()) * 1_000_000n) + fractionNanoseconds;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeWindowsExecutablePath(value) {
  if (!nonEmpty(value) || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-z]:/i.test(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  if (segments.some((segment) => (
    segment === ''
    || segment === '.'
    || segment === '..'
    || /[. ]$/.test(segment)
    || /[<>:"|?*]/.test(segment)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  ))) {
    return false;
  }
  return segments.at(-1)?.toLowerCase().endsWith('.exe') === true;
}

function isCertificateSha256(value) {
  return typeof value === 'string' && CERTIFICATE_SHA256.test(value);
}

function validBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[a-z0-9+/]+={0,2}$/i.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('unsupported canonical JSON value');
}

function safeString(value) {
  return typeof value === 'string' ? value : null;
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}
