import { createHash } from 'node:crypto';
import { link, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/i;
const TEAM_ID = /^[A-Z0-9]{10}$/;

const DISTRIBUTION_STEP_IDS = [
  'unsigned-app',
  'native-stage',
  'sign-app',
  'codesign-verify',
  'codesign-details',
  'codesign-entitlements',
  'certificate-extract',
  'certificate-verify',
  'certificate-details',
  'notary-zip-app',
  'notary-submit-app',
  'staple-app',
  'staple-validate-app',
  'final-codesign-verify',
  'final-codesign-details',
  'gatekeeper-app',
  'final-zip',
  'final-extracted-runtime',
  'final-extracted-codesign',
  'final-extracted-stapler',
  'artifact-hash',
  'write-report',
  'bind-report-sha',
];

const EXECUTABLE_APP_STEP_IDS = new Set([
  'sign-app',
  'codesign-verify',
  'codesign-details',
  'codesign-entitlements',
  'certificate-extract',
  'certificate-verify',
  'certificate-details',
  'notary-zip-app',
  'notary-submit-app',
  'staple-app',
  'staple-validate-app',
  'final-codesign-verify',
  'final-codesign-details',
  'gatekeeper-app',
]);

/**
 * Build a deterministic, inspectable command plan. It is data only: callers
 * must inject the command runner, so importing this module never touches the
 * Keychain, network, or platform signing tools.
 */
export function createMacDistributionPlan(input = {}) {
  if ((input.mode ?? 'unsigned') === 'unsigned') return { mode: 'unsigned', steps: [] };
  if (input.mode !== 'distribution') {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'unsupported macOS signing mode');
  }

  const required = [
    'arch', 'appPath', 'electronVersion', 'osxSignPath', 'identity', 'teamId',
    'notaryProfile', 'certificatePrefix', 'temporaryNotaryZip', 'finalZipPath',
  ];
  for (const field of required) {
    if (!nonempty(input[field])) {
      const code = field === 'notaryProfile'
        ? 'BLOCKED_MAC_NOTARY_CREDENTIALS_MISSING'
        : field === 'identity' || field === 'teamId'
          ? 'BLOCKED_MAC_UNTRUSTED_IDENTITY'
          : 'BLOCKED_MAC_SIGNING_FAILED';
      throw blocked(code, `macOS distribution input ${field} is required`);
    }
  }
  if (!String(input.identity).startsWith('Developer ID Application: ') || !TEAM_ID.test(input.teamId)) {
    throw blocked('BLOCKED_MAC_UNTRUSTED_IDENTITY', 'Developer ID Application and exact Team ID are required');
  }

  const appPath = input.appPath;
  const certificatePrefix = input.certificatePrefix;
  const certificatePath = `${certificatePrefix}0`;
  const profile = input.notaryProfile;
  const step = (id, kind, command, args = [], displayArgs = args) => ({
    id, kind, command, args, displayArgs,
  });
  const steps = [
    step('unsigned-app', 'assertion'),
    step('native-stage', 'assertion'),
    step('sign-app', 'command', process.execPath, [
      input.osxSignPath,
      appPath,
      '--platform=darwin',
      '--type=distribution',
      `--version=${input.electronVersion}`,
      `--identity=${input.identity}`,
    ]),
    step('codesign-verify', 'command', '/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]),
    step('codesign-details', 'command', '/usr/bin/codesign', ['-dvvv', '--verbose=4', appPath]),
    step('codesign-entitlements', 'command', '/usr/bin/codesign', ['-d', '--entitlements', ':-', appPath]),
    step('certificate-extract', 'command', '/usr/bin/codesign', [
      '-d', '--extract-certificates', certificatePrefix, appPath,
    ]),
    step('certificate-verify', 'command', '/usr/bin/security', ['verify-cert', '-c', certificatePath, '-p', 'codeSign']),
    step('certificate-details', 'command', '/usr/bin/openssl', [
      'x509', '-inform', 'DER', '-in', certificatePath, '-noout',
      '-sha256', '-fingerprint', '-subject', '-issuer', '-enddate',
    ]),
    step('notary-zip-app', 'command', '/usr/bin/ditto', [
      '-c', '-k', '--sequesterRsrc', '--keepParent', appPath, input.temporaryNotaryZip,
    ]),
    step('notary-submit-app', 'command', '/usr/bin/xcrun', [
      'notarytool', 'submit', input.temporaryNotaryZip,
      '--keychain-profile', profile,
      '--wait', '--output-format', 'json',
    ], [
      'notarytool', 'submit', input.temporaryNotaryZip,
      '--keychain-profile', '<redacted-keychain-profile>',
      '--wait', '--output-format', 'json',
    ]),
    step('staple-app', 'command', '/usr/bin/xcrun', ['stapler', 'staple', appPath]),
    step('staple-validate-app', 'command', '/usr/bin/xcrun', ['stapler', 'validate', appPath]),
    step('final-codesign-verify', 'command', '/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]),
    step('final-codesign-details', 'command', '/usr/bin/codesign', ['-dvvv', '--verbose=4', appPath]),
    step('gatekeeper-app', 'command', '/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]),
    step('final-zip', 'command', '/usr/bin/ditto', [
      '-c', '-k', '--sequesterRsrc', '--keepParent', appPath, input.finalZipPath,
    ]),
    step('final-extracted-runtime', 'verification'),
    step('final-extracted-codesign', 'verification'),
    step('final-extracted-stapler', 'verification'),
    step('artifact-hash', 'evidence'),
    step('write-report', 'evidence'),
    step('bind-report-sha', 'evidence'),
  ];
  const plan = {
    mode: 'distribution',
    arch: input.arch,
    expectedIdentity: input.identity,
    expectedTeamId: input.teamId,
    steps,
  };
  const errors = validateMacDistributionPlan(plan);
  if (errors.length) throw blockedFromMessage(errors[0]);
  return plan;
}

export function validateMacDistributionPlan(plan) {
  if (plan?.mode === 'unsigned') return plan.steps?.length === 0
    ? []
    : ['BLOCKED_MAC_SIGNING_FAILED: unsigned mode must not contain signing steps'];
  if (plan?.mode !== 'distribution' || !Array.isArray(plan.steps)) {
    return ['BLOCKED_MAC_SIGNING_FAILED: macOS distribution plan is invalid'];
  }
  const actual = plan.steps.map((step) => step?.id);
  const expected = DISTRIBUTION_STEP_IDS;
  if (actual.length > expected.length && actual.slice(0, expected.length).every((id, index) => id === expected[index])) {
    return ['BLOCKED_SIGNED_ARTIFACT_MUTATED: final artifacts may not change after report binding'];
  }
  if (actual.length !== expected.length || !actual.every((id, index) => id === expected[index])) {
    return ['BLOCKED_MAC_SIGNING_FAILED: macOS distribution step order is invalid'];
  }
  const signIndex = actual.indexOf('sign-app');
  if (signIndex <= actual.indexOf('native-stage')) {
    return ['BLOCKED_MAC_SIGNING_FAILED: signing cannot run before native staging'];
  }
  for (const step of plan.steps) {
    if (step.id === 'sign-app' && step.args?.includes('--deep')) {
      return ['BLOCKED_MAC_SIGNING_FAILED: codesign --deep may verify but may never sign'];
    }
    if (step.id === 'notary-submit-app') {
      if (step.displayArgs?.includes(step.args?.[step.args.indexOf('--keychain-profile') + 1])) {
        return ['BLOCKED_MAC_NOTARY_CREDENTIALS_MISSING: notary profile must be redacted from logs'];
      }
    }
  }
  return [];
}

export function createMacDmgDistributionPlan(input = {}) {
  if ((input.mode ?? 'unsigned') === 'unsigned') return { mode: 'unsigned', steps: [] };
  if (input.mode !== 'distribution') {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'unsupported macOS DMG signing mode');
  }
  for (const field of [
    'arch', 'appPath', 'dmgPath', 'volumeName', 'notaryProfile', 'identity', 'teamId', 'certificatePrefix',
  ]) {
    if (!nonempty(input[field])) {
      throw blocked(
        field === 'notaryProfile'
          ? 'BLOCKED_MAC_NOTARY_CREDENTIALS_MISSING'
          : 'BLOCKED_MAC_SIGNING_FAILED',
        `macOS DMG distribution input ${field} is required`,
      );
    }
  }
  if (!String(input.identity).startsWith('Developer ID Application: ') || !TEAM_ID.test(input.teamId)) {
    throw blocked('BLOCKED_MAC_UNTRUSTED_IDENTITY', 'DMG Developer ID Application and exact Team ID are required');
  }
  const step = (id, kind, command, args = [], displayArgs = args) => ({
    id, kind, command, args, displayArgs,
  });
  return {
    mode: 'distribution',
    arch: input.arch,
    expectedIdentity: input.identity,
    expectedTeamId: input.teamId,
    steps: [
      step('stapled-app-ready', 'assertion'),
      step('create-dmg', 'command', '/usr/bin/hdiutil', [
        'create', '-volname', input.volumeName, '-srcfolder', input.appPath,
        '-format', 'UDZO', input.dmgPath,
      ]),
      step('sign-dmg', 'command', '/usr/bin/codesign', [
        '--force', '--timestamp', '--sign', input.identity, input.dmgPath,
      ]),
      step('codesign-verify-dmg', 'command', '/usr/bin/codesign', [
        '--verify', '--strict', '--verbose=4', input.dmgPath,
      ]),
      step('codesign-details-dmg', 'command', '/usr/bin/codesign', ['-dvvv', '--verbose=4', input.dmgPath]),
      step('certificate-extract-dmg', 'command', '/usr/bin/codesign', [
        '-d', '--extract-certificates', input.certificatePrefix, input.dmgPath,
      ]),
      step('certificate-verify-dmg', 'command', '/usr/bin/security', [
        'verify-cert', '-c', `${input.certificatePrefix}0`, '-p', 'codeSign',
      ]),
      step('certificate-details-dmg', 'command', '/usr/bin/openssl', [
        'x509', '-inform', 'DER', '-in', `${input.certificatePrefix}0`, '-noout',
        '-sha256', '-fingerprint', '-subject', '-issuer', '-enddate',
      ]),
      step('notary-submit-dmg', 'command', '/usr/bin/xcrun', [
        'notarytool', 'submit', input.dmgPath,
        '--keychain-profile', input.notaryProfile,
        '--wait', '--output-format', 'json',
      ], [
        'notarytool', 'submit', input.dmgPath,
        '--keychain-profile', '<redacted-keychain-profile>',
        '--wait', '--output-format', 'json',
      ]),
      step('staple-dmg', 'command', '/usr/bin/xcrun', ['stapler', 'staple', input.dmgPath]),
      step('staple-validate-dmg', 'command', '/usr/bin/xcrun', ['stapler', 'validate', input.dmgPath]),
      step('gatekeeper-dmg', 'command', '/usr/sbin/spctl', [
        '--assess', '--type', 'open', '--context', 'context:primary-signature',
        '--verbose=4', input.dmgPath,
      ]),
      step('verify-dmg-contents', 'verification'),
      step('artifact-hash', 'evidence'),
      step('write-report', 'evidence'),
      step('bind-report-sha', 'evidence'),
    ],
  };
}

export async function executeMacDmgDistribution(
  { plan, stapledAppVerified },
  { runStep },
) {
  if (plan?.mode === 'unsigned') return { mode: 'unsigned' };
  const expected = [
    'stapled-app-ready', 'create-dmg', 'sign-dmg', 'codesign-verify-dmg', 'codesign-details-dmg',
    'certificate-extract-dmg', 'certificate-verify-dmg', 'certificate-details-dmg',
    'notary-submit-dmg', 'staple-dmg',
    'staple-validate-dmg', 'gatekeeper-dmg', 'verify-dmg-contents',
    'artifact-hash', 'write-report', 'bind-report-sha',
  ];
  const actual = Array.isArray(plan?.steps) ? plan.steps.map((step) => step?.id) : [];
  if (actual.length !== expected.length || !actual.every((id, index) => id === expected[index])) {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'macOS DMG distribution step order is invalid');
  }
  if (stapledAppVerified !== true || typeof runStep !== 'function') {
    throw blocked('BLOCKED_MAC_STAPLE_FAILED', 'a verified stapled app and bounded DMG runner are required');
  }
  const results = new Map();
  let notarization;
  let containerCodesign;
  let containerCertificate;
  for (const step of plan.steps.filter((entry) => entry.kind === 'command')) {
    let result;
    try {
      result = normalizeResult(await runStep(step));
    } catch (error) {
      throw dmgStepFailure(step, error instanceof Error ? error.message : String(error));
    }
    results.set(step.id, result);
    if (result.status !== 0) {
      throw dmgStepFailure(step, result.stderr || result.stdout || `exit ${result.status}`);
    }
    if (step.id === 'codesign-details-dmg') {
      containerCodesign = parseCodesignDetails(outputOf(result), {
        identity: plan.expectedIdentity,
        teamId: plan.expectedTeamId,
        requireHardenedRuntime: false,
      });
    }
    if (step.id === 'certificate-details-dmg') {
      containerCertificate = parseCertificateDetails(outputOf(result), {
        verifyStatus: results.get('certificate-verify-dmg').status,
      });
    }
    if (step.id === 'notary-submit-dmg') notarization = parseNotarytoolJson(result.stdout);
    if (step.id === 'staple-validate-dmg' && !/validate action worked/i.test(outputOf(result))) {
      throw blocked('BLOCKED_MAC_STAPLE_FAILED', 'DMG stapler validation did not confirm success');
    }
    if (step.id === 'gatekeeper-dmg') {
      const gatekeeper = outputOf(result);
      if (!/accepted/i.test(gatekeeper) || !/Notarized Developer ID/i.test(gatekeeper)) {
        throw blocked('BLOCKED_MAC_STAPLE_FAILED', 'Gatekeeper did not accept the notarized DMG');
      }
    }
  }
  if (!containerCodesign) throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'DMG outer codesign evidence is missing');
  if (!containerCertificate) throw blocked('BLOCKED_MAC_UNTRUSTED_IDENTITY', 'DMG outer certificate evidence is missing');
  if (!notarization) throw blocked('BLOCKED_MAC_NOTARIZATION_REJECTED', 'DMG notarization evidence is missing');
  return {
    identityType: 'Developer ID Application',
    teamId: containerCodesign.teamId,
    containerCodesignValid: true,
    containerCertificateSha256Fingerprint: containerCertificate.certificateSha256Fingerprint,
    trustedTimestamp: containerCodesign.trustedTimestamp,
    containerTrustedTimestamp: containerCodesign.trustedTimestamp,
    notarization,
    staplerValid: true,
    gatekeeperAccepted: true,
  };
}

export function parseCodesignDetails(value, { identity, teamId, requireHardenedRuntime = true } = {}) {
  const text = String(value ?? '');
  const authorities = [...text.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim());
  const parsedTeamId = text.match(/^TeamIdentifier=([A-Z0-9]+)$/m)?.[1];
  const timestamp = text.match(/^Timestamp=(.+)$/m)?.[1]?.trim();
  const runtime = /^CodeDirectory .*flags=.*\(.*runtime.*\)/mi.test(text);
  const expectedIdentity = nonempty(identity);
  const expectedTeamId = nonempty(teamId);
  if (
    !expectedIdentity?.startsWith('Developer ID Application: ')
    || authorities[0] !== expectedIdentity
    || authorities[1] !== 'Developer ID Certification Authority'
    || authorities[2] !== 'Apple Root CA'
    || !TEAM_ID.test(expectedTeamId ?? '')
    || parsedTeamId !== expectedTeamId
    || (requireHardenedRuntime && !runtime)
    || !timestamp
    || /Signature=adhoc/i.test(text)
  ) {
    throw blocked(
      'BLOCKED_MAC_UNTRUSTED_IDENTITY',
      'codesign details do not prove Developer ID, exact team, hardened runtime, trusted timestamp, and Apple chain',
    );
  }
  return {
    identityType: 'Developer ID Application',
    teamId: parsedTeamId,
    codesignValid: true,
    hardenedRuntime: runtime,
    trustedTimestamp: true,
    authorityChain: authorities.slice(0, 3),
    timestamp,
  };
}

export function parseCertificateDetails(value, { verifyStatus, now = new Date() } = {}) {
  const text = String(value ?? '');
  const subject = text.match(/^subject=(.+)$/mi)?.[1]?.trim();
  const issuer = text.match(/^issuer=(.+)$/mi)?.[1]?.trim();
  const expiryText = text.match(/^(?:notAfter|notafter)=(.+)$/mi)?.[1]?.trim();
  const expiry = expiryText ? new Date(expiryText) : new Date(Number.NaN);
  const fingerprint = text.match(/^sha256 Fingerprint=([A-Fa-f0-9:]+)$/mi)?.[1]?.replaceAll(':', '').toLowerCase();
  const certificateTrusted = verifyStatus === 0;
  const certificateExpired = !Number.isFinite(expiry.getTime()) || expiry.getTime() <= now.getTime();
  const selfSigned = !subject || !issuer || normalizeDn(subject) === normalizeDn(issuer);
  if (!certificateTrusted || certificateExpired || selfSigned || !SHA256.test(fingerprint ?? '')) {
    throw blocked(
      'BLOCKED_MAC_UNTRUSTED_IDENTITY',
      'Developer ID certificate must be bound by SHA256 fingerprint, trusted, unexpired, and non-self-signed',
    );
  }
  return {
    certificateTrusted: true,
    certificateExpired: false,
    selfSigned: false,
    certificateSha256Fingerprint: fingerprint,
  };
}

export function parseEntitlementsEvidence(value) {
  const text = String(value ?? '');
  if (!/<plist\b[^>]*>[\s\S]*<\/plist>/i.test(text)) {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'codesign entitlements must contain a plist');
  }
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '');
  const getTaskAllow = /<key>\s*com\.apple\.security\.get-task-allow\s*<\/key>\s*<true\s*\/?>/i.test(withoutComments);
  if (getTaskAllow) {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'distribution entitlements must not enable get-task-allow');
  }
  return {
    entitlementsSha256: sha256Text(text),
    getTaskAllow: false,
  };
}

export function parseNotarytoolJson(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? '').trim());
  } catch {
    throw blocked('BLOCKED_MAC_NOTARIZATION_REJECTED', 'notarytool did not return valid JSON');
  }
  const submissionId = nonempty(parsed?.id);
  if (parsed?.status !== 'Accepted' || !submissionId) {
    throw blocked('BLOCKED_MAC_NOTARIZATION_REJECTED', 'notarytool did not return Accepted with a submission id');
  }
  return { status: 'Accepted', submissionId };
}

/**
 * Build a credential-safe command log while preserving the raw result for
 * the in-memory parser. Sensitive values are exactly those whose real spawn
 * arguments differ from their public display arguments.
 */
export function formatRedactedCommandLog({ command, args = [], displayArgs = args, result = {}, execution = {} }) {
  const redactions = deriveArgRedactions(args, displayArgs);
  return [
    `$ ${command} ${displayArgs.join(' ')}`,
    `exit=${result.status}`,
    `execution=${redactSensitiveText(JSON.stringify(execution), redactions)}`,
    redactSensitiveText(String(result.stdout ?? ''), redactions),
    redactSensitiveText(String(result.stderr ?? ''), redactions),
  ].join('\n');
}

/** Publish an immutable report without exposing a partially written final path. */
export async function publishSigningReportCrashSafe({ target, contents }) {
  if (!nonempty(target) || typeof contents !== 'string') {
    throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'signing report target and contents are required');
  }
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, target);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'EEXIST') {
        throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'signing report already exists and will not be overwritten');
      }
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

/** Re-stat/re-hash every artifact and every referenced signing report. */
export async function verifyCanonicalCompletionIntegrity({ artifacts, inspectPath }) {
  if (!Array.isArray(artifacts) || typeof inspectPath !== 'function') {
    throw blocked('BLOCKED_ARTIFACT_MUTATED', 'canonical completion integrity input is invalid');
  }
  let signingReportCount = 0;
  for (const artifact of artifacts) {
    let actual;
    try {
      actual = await inspectPath(artifact?.relativePath, 'artifact');
    } catch {
      actual = null;
    }
    const artifactMatches = Number.isSafeInteger(actual?.bytes)
      && actual.bytes === artifact?.bytes
      && SHA256.test(String(actual?.sha256 ?? ''))
      && actual.sha256.toLowerCase() === String(artifact?.sha256 ?? '').toLowerCase();
    if (!artifactMatches) {
      throw blocked(
        artifact?.signing === 'verified'
          ? 'BLOCKED_SIGNED_ARTIFACT_MUTATED'
          : 'BLOCKED_ARTIFACT_MUTATED',
        `canonical artifact changed after packaging: ${String(artifact?.relativePath ?? '<missing>')}`,
      );
    }

    const signature = artifact?.signature;
    const reportReference = signature?.signingReport;
    if (artifact?.signing === 'verified') {
      if (
        !signature
        || typeof signature !== 'object'
        || Array.isArray(signature)
        || !nonempty(signature.provenance)
        || !reportReference
        || typeof reportReference !== 'object'
        || Array.isArray(reportReference)
        || !SHA256.test(String(signature.signingReportSha256 ?? ''))
      ) {
        throw blocked(
          'BLOCKED_SIGNING_EVIDENCE_BINDING',
          'every verified artifact must have exactly one provenance-bound signing report',
        );
      }
    }
    if (!reportReference) continue;
    if (typeof reportReference !== 'object' || Array.isArray(reportReference)) {
      throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'signing report reference must be one object');
    }
    signingReportCount += 1;
    const reportPath = nonempty(reportReference.relativePath ?? reportReference.path);
    const referenceSha = String(reportReference.sha256 ?? '').toLowerCase();
    const signatureSha = String(artifact?.signature?.signingReportSha256 ?? '').toLowerCase();
    if (!reportPath || !SHA256.test(referenceSha) || !SHA256.test(signatureSha) || referenceSha !== signatureSha) {
      throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'signing report reference and artifact signature SHA disagree');
    }
    let actualReport;
    try {
      actualReport = await inspectPath(reportPath, 'signing-report');
    } catch {
      actualReport = null;
    }
    if (!SHA256.test(String(actualReport?.sha256 ?? ''))
        || actualReport.sha256.toLowerCase() !== referenceSha) {
      throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', `signing report changed after binding: ${reportPath}`);
    }
  }
  return { artifactCount: artifacts.length, signingReportCount };
}

/** Execute only app signing/notarization; final archive creation and hashing remain caller-owned. */
export async function executeMacAppDistributionSigning(
  { plan, nativeStageVerified },
  { runStep, now = new Date() },
) {
  if (plan?.mode === 'unsigned') return { mode: 'unsigned' };
  const planErrors = validateMacDistributionPlan(plan);
  if (planErrors.length) throw blockedFromMessage(planErrors[0]);
  if (nativeStageVerified !== true) {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'native stage must pass before distribution signing');
  }
  if (typeof runStep !== 'function') {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'a bounded command runner is required');
  }

  const results = new Map();
  let firstCodesign;
  let finalCodesign;
  let certificate;
  let entitlements;
  let notarization;
  for (const step of plan.steps.filter((entry) => EXECUTABLE_APP_STEP_IDS.has(entry.id))) {
    let result;
    try {
      result = normalizeResult(await runStep(step));
    } catch (error) {
      throw stepFailure(step, error instanceof Error ? error.message : String(error));
    }
    results.set(step.id, result);
    if (result.status !== 0) throw stepFailure(step, result.stderr || result.stdout || `exit ${result.status}`);
    if (step.id === 'codesign-details') {
      firstCodesign = parseCodesignDetails(outputOf(result), {
        identity: plan.expectedIdentity,
        teamId: plan.expectedTeamId,
      });
    }
    if (step.id === 'codesign-entitlements') entitlements = parseEntitlementsEvidence(result.stdout);
    if (step.id === 'certificate-details') {
      certificate = parseCertificateDetails(outputOf(result), {
        verifyStatus: results.get('certificate-verify').status,
        now,
      });
    }
    if (step.id === 'notary-submit-app') notarization = parseNotarytoolJson(result.stdout);
    if (step.id === 'staple-validate-app' && !/validate action worked/i.test(outputOf(result))) {
      throw blocked('BLOCKED_MAC_STAPLE_FAILED', 'stapler validation did not confirm success');
    }
    if (step.id === 'final-codesign-details') {
      finalCodesign = parseCodesignDetails(outputOf(result), {
        identity: plan.expectedIdentity,
        teamId: plan.expectedTeamId,
      });
    }
    if (step.id === 'gatekeeper-app') {
      if (!/accepted/i.test(outputOf(result)) || !/Notarized Developer ID/i.test(outputOf(result))) {
        throw blocked('BLOCKED_MAC_STAPLE_FAILED', 'Gatekeeper did not accept the notarized Developer ID app');
      }
    }
  }
  if (!firstCodesign || !finalCodesign || !certificate || !entitlements || !notarization) {
    throw blocked('BLOCKED_MAC_SIGNING_FAILED', 'macOS distribution verification sequence is incomplete');
  }
  return {
    identityType: 'Developer ID Application',
    teamId: finalCodesign.teamId,
    ...certificate,
    entitlementsSha256: entitlements.entitlementsSha256,
    codesignValid: true,
    hardenedRuntime: finalCodesign.hardenedRuntime,
    nestedSignaturesValid: true,
    trustedTimestamp: finalCodesign.trustedTimestamp,
    notarization,
    staplerValid: true,
    gatekeeperAccepted: true,
  };
}

/** Build the exact allowlisted report and public manifest signature metadata. */
export function buildMacSigningReport({ candidate, sourceHead, snapshotSha256, artifact, verification }) {
  if (
    !nonempty(candidate)
    || !nonempty(sourceHead)
    || !SHA256.test(String(snapshotSha256 ?? ''))
    || artifact?.platform !== 'darwin'
    || !nonempty(artifact?.relativePath)
    || !SHA256.test(String(artifact?.sha256 ?? ''))
    || !Number.isSafeInteger(artifact?.bytes)
    || artifact.bytes < 1
    || artifact.signing !== 'verified'
  ) {
    throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'canonical macOS artifact binding is incomplete');
  }
  assertVerification(verification);
  const isDmg = artifact.kind === 'macOS DMG' || artifact.relativePath.toLowerCase().endsWith('.dmg');
  if (isDmg && (verification.containerCodesignValid !== true || verification.containerTrustedTimestamp !== true)) {
    throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'DMG outer codesign and timestamp evidence are required');
  }
  const payloadCertificateSha256Fingerprint = verification.payloadCertificateSha256Fingerprint
    ?? verification.certificateSha256Fingerprint;
  const certificateSha256Fingerprint = isDmg
    ? verification.containerCertificateSha256Fingerprint
    : verification.certificateSha256Fingerprint;
  if (!SHA256.test(String(certificateSha256Fingerprint ?? ''))
      || !SHA256.test(String(payloadCertificateSha256Fingerprint ?? ''))) {
    throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'container and payload certificate fingerprints are required');
  }
  const report = {
    schemaVersion: 1,
    reportType: 'macos-signing',
    candidate,
    sourceHead,
    snapshotSha256,
    artifactPath: artifact.relativePath,
    artifactSha256: artifact.sha256,
    artifactBytes: artifact.bytes,
    verificationPlatform: 'darwin',
    provenance: 'canonical-macos-verifier',
    identityType: 'Developer ID Application',
    teamId: verification.teamId,
    certificateTrusted: true,
    certificateExpired: false,
    selfSigned: false,
    certificateSha256Fingerprint,
    certificateThumbprint: certificateSha256Fingerprint,
    codesignValid: true,
    hardenedRuntime: true,
    nestedSignaturesValid: true,
    trustedTimestamp: true,
    entitlementsSha256: verification.entitlementsSha256,
    notarization: {
      status: 'Accepted',
      submissionId: verification.notarization.submissionId,
    },
    staplerValid: true,
    ...(isDmg ? {
      containerCodesignValid: true,
      containerTrustedTimestamp: true,
      payloadVerification: {
        codesignValid: true,
        hardenedRuntime: true,
        nestedSignaturesValid: true,
        trustedTimestamp: true,
        entitlementsSha256: verification.entitlementsSha256,
        payloadCertificateSha256Fingerprint,
      },
      verificationScope: {
        hardenedRuntime: 'payload-app',
        nestedSignaturesValid: 'payload-app',
        entitlementsSha256: 'payload-app',
        containerCodesignValid: 'dmg-container',
      },
    } : {}),
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const signingReportSha256 = sha256Text(reportText);
  const signature = {
    provenance: 'canonical-macos-verifier',
    identityType: 'Developer ID Application',
    teamId: verification.teamId,
    certificateTrusted: true,
    certificateExpired: false,
    selfSigned: false,
    certificateSha256Fingerprint,
    certificateThumbprint: certificateSha256Fingerprint,
    entitlementsSha256: verification.entitlementsSha256,
    ...(isDmg ? {
      containerCodesignValid: true,
      containerTrustedTimestamp: true,
      payloadCertificateSha256Fingerprint,
      payloadEntitlementsSha256: verification.entitlementsSha256,
      verificationScope: report.verificationScope,
    } : {}),
    signingReportSha256,
  };
  return { report, reportText, reportSha256: signingReportSha256, signature };
}

/** Fail closed if either the artifact or allowlisted report changed after hashing. */
export function assertMacSigningReportBinding({ artifact, report, reportText, signature }) {
  if (
    report?.artifactPath !== artifact?.relativePath
    || report?.artifactSha256 !== artifact?.sha256
    || report?.artifactBytes !== artifact?.bytes
  ) {
    throw blocked('BLOCKED_SIGNED_ARTIFACT_MUTATED', 'signed macOS artifact changed after evidence binding');
  }
  if (
    !SHA256.test(String(signature?.signingReportSha256 ?? ''))
    || sha256Text(reportText) !== signature.signingReportSha256
    || reportText !== `${JSON.stringify(report, null, 2)}\n`
  ) {
    throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'macOS signing report hash or canonical serialization is invalid');
  }
  return true;
}

function assertVerification(value) {
  if (
    value?.identityType !== 'Developer ID Application'
    || !TEAM_ID.test(String(value?.teamId ?? ''))
    || value?.certificateTrusted !== true
    || value?.certificateExpired !== false
    || value?.selfSigned !== false
    || !SHA256.test(String(value?.certificateSha256Fingerprint ?? ''))
    || value?.codesignValid !== true
    || value?.hardenedRuntime !== true
    || value?.nestedSignaturesValid !== true
    || value?.trustedTimestamp !== true
    || !SHA256.test(String(value?.entitlementsSha256 ?? ''))
    || value?.notarization?.status !== 'Accepted'
    || !nonempty(value?.notarization?.submissionId)
    || value?.staplerValid !== true
  ) {
    throw blocked('BLOCKED_SIGNING_EVIDENCE_BINDING', 'macOS verification evidence is incomplete');
  }
}

function stepFailure(step, detail) {
  const stepId = step.id;
  if (stepId.startsWith('notary-')) {
    return blocked('BLOCKED_MAC_NOTARIZATION_REJECTED', `macOS notarization failed at ${stepId}: ${safeDetail(detail, step)}`);
  }
  if (stepId.startsWith('staple-') || stepId === 'gatekeeper-app') {
    return blocked('BLOCKED_MAC_STAPLE_FAILED', `macOS staple/Gatekeeper failed at ${stepId}: ${safeDetail(detail, step)}`);
  }
  if (stepId.startsWith('certificate-')) {
    return blocked('BLOCKED_MAC_UNTRUSTED_IDENTITY', `Developer ID certificate validation failed at ${stepId}: ${safeDetail(detail, step)}`);
  }
  return blocked('BLOCKED_MAC_SIGNING_FAILED', `macOS signing failed at ${stepId}: ${safeDetail(detail, step)}`);
}

function dmgStepFailure(step, detail) {
  const stepId = step.id;
  if (stepId === 'notary-submit-dmg') {
    return blocked('BLOCKED_MAC_NOTARIZATION_REJECTED', `DMG notarization failed: ${safeDetail(detail, step)}`);
  }
  if (stepId.startsWith('staple-') || stepId === 'gatekeeper-dmg') {
    return blocked('BLOCKED_MAC_STAPLE_FAILED', `DMG staple/Gatekeeper failed at ${stepId}: ${safeDetail(detail, step)}`);
  }
  return blocked('BLOCKED_MAC_SIGNING_FAILED', `DMG creation failed at ${stepId}: ${safeDetail(detail, step)}`);
}

function normalizeResult(result) {
  return {
    status: Number.isInteger(result?.status) ? result.status : 1,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
  };
}

function outputOf(result) {
  return `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
}

function normalizeDn(value) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function nonempty(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeDetail(value, step) {
  const redactions = deriveArgRedactions(step?.args ?? [], step?.displayArgs ?? step?.args ?? []);
  return redactSensitiveText(String(value ?? ''), redactions).replace(/[\r\n]+/g, ' ').slice(0, 300);
}

function deriveArgRedactions(args, displayArgs) {
  const replacements = [];
  const length = Math.max(args.length, displayArgs.length);
  for (let index = 0; index < length; index += 1) {
    const actual = args[index];
    const displayed = displayArgs[index];
    if (typeof actual !== 'string' || !actual || actual === displayed) continue;
    replacements.push({ secret: actual, replacement: nonempty(displayed) ?? '<redacted>' });
  }
  return replacements.sort((left, right) => right.secret.length - left.secret.length);
}

function redactSensitiveText(value, redactions) {
  let output = String(value ?? '');
  for (const { secret, replacement } of redactions) {
    output = output.split(secret).join(replacement);
  }
  return output;
}

function blockedFromMessage(message) {
  const [code, ...rest] = String(message).split(':');
  return blocked(code, rest.join(':').trim());
}

function blocked(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
