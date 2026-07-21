import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  validateMacSigningReport,
  validateWindowsSigningReport,
} from './release-signing-evidence.mjs';
import {
  validateNorthStarEvidenceReport,
  validateOwnerAcceptance,
} from './north-star-gates.mjs';
import {
  hashPrivateId,
  validatePmReplayAttestation,
  validatePrivateReplayEvidenceSet,
} from './private-replay-evidence.mjs';

const REQUIRED_GATES = [
  ['packagedElectronE2e', 'BLOCKED_POST_PACKAGE_E2E'],
  ['performance', 'BLOCKED_POST_PACKAGE_PERFORMANCE'],
  ['screenshots', 'BLOCKED_POST_PACKAGE_SCREENSHOTS'],
  ['signingNotarization', 'BLOCKED_POST_PACKAGE_SIGNING_NOTARIZATION'],
  ['platformRuntime', 'BLOCKED_POST_PACKAGE_PLATFORM_RUNTIME'],
  ['northStar', 'BLOCKED_POST_PACKAGE_NORTH_STAR'],
];
const MAIN_EVIDENCE_MAX_BYTES = 1024 * 1024;
const REFERENCE_MAX_BYTES = 256 * 1024;
const PRIVATE_REPLAY_REFERENCE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCE_COUNT = 64;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const MAX_PRIVATE_REPLAY_JSON_NODES = 2_000_000;
const READ_CHUNK_BYTES = 64 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;
const RELEASE_MODES = new Set(['unsigned', 'distribution', 'macos-distribution']);

/**
 * Validate evidence gathered after packaging.  Self-asserted PASS values are
 * insufficient: the evidence document, every referenced evidence file, the
 * source snapshot and the complete artifact hash inventory must all bind.
 */
export async function evaluatePostPackageEvidence(context) {
  if (typeof context?.evidencePath !== 'string' || context.evidencePath.length === 0) {
    return missingEvidenceResult();
  }

  const evidencePath = path.resolve(context.evidencePath);
  let bytes;
  let document;
  try {
    ({ bytes, document } = await readJsonFileOnce(evidencePath, {
      maxBytes: MAIN_EVIDENCE_MAX_BYTES,
      label: 'evidence file',
    }));
  } catch (error) {
    return invalidEvidenceResult(evidencePath, publicEvidenceError(error, 'evidence file is unreadable or invalid JSON'));
  }

  const evidenceFile = {
    path: evidencePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const normalizedContext = normalizeContext(context);
  const bindingErrors = [...normalizedContext.errors, ...validateBindings(document, normalizedContext)];
  const totalReferenceCount = REQUIRED_GATES.reduce((total, [id]) => {
    const references = document?.gates?.[id]?.evidence;
    return total + (Array.isArray(references) ? references.length : 0);
  }, 0);
  if (totalReferenceCount > MAX_REFERENCE_COUNT) {
    bindingErrors.push(`total evidence reference count must not exceed ${MAX_REFERENCE_COUNT}`);
  }
  const gates = [];
  const blockers = [];
  for (const [id, blockerCode] of REQUIRED_GATES) {
    const supplied = document?.gates?.[id];
    const errors = [...bindingErrors, ...validateGate(id, supplied, normalizedContext)];
    const referenceDetails = await validateReferences(
      supplied?.evidence,
      path.dirname(evidencePath),
      errors,
      id === 'signingNotarization' || id === 'northStar',
    );
    const signingMetrics = id === 'signingNotarization'
      ? validateSigningReports(referenceDetails, normalizedContext, errors)
      : null;
    const northStarMetrics = id === 'northStar'
      ? validateNorthStarReports(referenceDetails, normalizedContext, supplied, errors)
      : null;
    const references = referenceDetails.map(({
      document: _document,
      privateBytes: _privateBytes,
      ...reference
    }) => reference);
    const status = errors.length === 0 ? 'PASS' : 'BLOCKED';
    gates.push({
      id,
      status,
      errors,
      evidence: references,
      metrics: gateMetrics(id, supplied, signingMetrics, northStarMetrics),
    });
    if (status !== 'PASS') {
      blockers.push({ code: blockerCode, message: errors.join('; ') || `${id} evidence is missing` });
    }
  }

  return {
    status: gates.every((gate) => gate.status === 'PASS') ? 'PASS' : 'BLOCKED',
    evidenceFile,
    binding: {
      releaseMode: normalizedContext.releaseMode,
      candidate: safeString(document?.candidate),
      sourceHead: safeString(document?.source?.head),
      sourceSnapshotSha256: safeString(document?.source?.snapshotSha256),
      artifactCount: objectEntries(document?.artifacts).length,
      passed: bindingErrors.length === 0,
      errors: bindingErrors,
    },
    gates,
    blockers,
  };
}

function missingEvidenceResult() {
  const gates = REQUIRED_GATES.map(([id, code]) => ({
    id,
    status: 'MISSING',
    errors: ['no --external-evidence file was supplied'],
    evidence: [],
    metrics: {},
    blockerCode: code,
  }));
  return {
    status: 'BLOCKED',
    evidenceFile: null,
    binding: { passed: false, errors: ['external evidence is absent'] },
    gates,
    blockers: gates.map((gate) => ({ code: gate.blockerCode, message: gate.errors[0] })),
  };
}

function invalidEvidenceResult(evidencePath, message) {
  const gates = REQUIRED_GATES.map(([id, code]) => ({
    id,
    status: 'INVALID',
    errors: [message],
    evidence: [],
    metrics: {},
    blockerCode: code,
  }));
  return {
    status: 'BLOCKED',
    evidenceFile: { path: evidencePath, sha256: null },
    binding: { passed: false, errors: [message] },
    gates,
    blockers: gates.map((gate) => ({ code: gate.blockerCode, message })),
  };
}

function normalizeContext(context) {
  const errors = [];
  const releaseMode = safeString(context?.releaseMode);
  if (!RELEASE_MODES.has(releaseMode)) errors.push('canonical releaseMode is missing or unsupported');
  const candidate = safeString(context?.candidate);
  const head = safeString(context?.source?.head);
  const snapshotSha256 = safeString(context?.source?.snapshot?.sha256);
  if (candidate === null) errors.push('canonical candidate must be a string');
  if (head === null) errors.push('canonical source HEAD must be a string');
  if (snapshotSha256 === null) errors.push('canonical source snapshot must be a string');

  const artifacts = [];
  const seen = new Set();
  if (!Array.isArray(context?.artifacts)) {
    errors.push('canonical artifacts must be an array');
  } else {
    for (const artifact of context.artifacts) {
      if (!artifact || typeof artifact !== 'object') {
        errors.push('canonical artifact must be an object');
        continue;
      }
      if (typeof artifact.relativePath !== 'string') {
        errors.push('canonical artifact path must be a string');
        continue;
      }
      if (!safeArtifactPath(artifact.relativePath)) {
        errors.push('unsafe artifact path in canonical context');
        continue;
      }
      if (releaseMode === 'macos-distribution' && artifact.platform !== 'darwin') {
        errors.push('macos-distribution canonical artifacts must be darwin-only');
      }
      const comparisonKey = canonicalArtifactKey(artifact.relativePath);
      if (seen.has(comparisonKey)) {
        errors.push('duplicate artifact path in canonical context');
        continue;
      }
      seen.add(comparisonKey);
      artifacts.push(artifact);
    }
  }
  return {
    releaseMode,
    candidate,
    source: { head, snapshot: { sha256: snapshotSha256 } },
    artifacts,
    northStar: {
      runnerSha256: safeString(context?.northStar?.runnerSha256),
      pmRunner: normalizePmRunnerAnchor(context?.northStar?.pmRunner),
    },
    errors,
  };
}

function validateBindings(document, context) {
  const errors = [];
  if (context.releaseMode === 'macos-distribution') {
    if (document?.schemaVersion !== 2) errors.push('schemaVersion must equal 2 for macos-distribution');
    if (document?.releaseMode !== 'macos-distribution') errors.push('releaseMode must equal macos-distribution');
  } else {
    if (document?.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
    if (document?.releaseMode !== undefined && document.releaseMode !== context.releaseMode) {
      errors.push('releaseMode mismatch');
    }
  }
  if (document?.candidate !== context.candidate) {
    errors.push('candidate mismatch');
  }
  if (document?.source?.head !== context.source.head) {
    errors.push('source HEAD mismatch');
  }
  if (document?.source?.snapshotSha256 !== context.source.snapshot.sha256) {
    errors.push('source snapshot mismatch');
  }

  const expected = new Map(context.artifacts.map((artifact) => [artifact.relativePath, artifact.sha256]));
  const actual = new Map(objectEntries(document?.artifacts));
  if (expected.size === 0) errors.push('candidate has no completed artifacts to bind');
  if (actual.size !== expected.size) {
    errors.push(`artifact binding count mismatch: expected ${expected.size}, got ${actual.size}`);
  }
  for (const [relativePath, sha256] of expected) {
    if (actual.get(relativePath) !== sha256) {
      errors.push(`artifact hash mismatch: ${relativePath}`);
    }
  }
  for (const relativePath of actual.keys()) {
    if (!expected.has(relativePath)) errors.push('unknown artifact binding');
  }
  return errors;
}

function validateGate(id, gate, context) {
  const errors = [];
  if (!gate || typeof gate !== 'object') return [`${id} evidence is missing`];
  if (gate.status !== 'PASS') errors.push(`${id}.status must equal PASS`);

  if (id === 'packagedElectronE2e') {
    if (!Number.isInteger(gate.passed) || gate.passed < 50) errors.push('packaged E2E passed must be >= 50');
    if (gate.failed !== 0) errors.push('packaged E2E failed must equal 0');
    requirePlatforms(gate.platforms, errors, context.releaseMode);
  } else if (id === 'performance') {
    if (gate.pass !== true) errors.push('performance.pass must equal true');
    if (!lessThan(gate.app?.launchMs, 2000)) errors.push('performance launchMs must be < 2000');
    if (!lessThan(gate.app?.residentSetMb, 500)) errors.push('performance residentSetMb must be < 500');
    if (!atLeast(gate.knowledgeGraph100?.fps, 30)) errors.push('performance KG FPS must be >= 30');
    if (!atLeast(gate.knowledgeGraph100?.nodeCount, 100)) errors.push('performance KG nodeCount must be >= 100');
  } else if (id === 'screenshots') {
    if (!atLeast(gate.macosCount, 9)) errors.push('macOS screenshot count must be >= 9');
    if (context.releaseMode !== 'macos-distribution' && !atLeast(gate.windowsCount, 9)) {
      errors.push('Windows screenshot count must be >= 9');
    }
    if (!atLeast(gate.verifyFixRounds, 3)) errors.push('verify-fix rounds must be >= 3');
  } else if (id === 'signingNotarization') {
    if (context.artifacts.some((artifact) => artifact.signing !== 'verified')) {
      errors.push('every canonical artifact must have a verified signature');
    }
    if (gate.macosNotarization !== 'accepted') errors.push('macOS notarization must be accepted');
    if (context.releaseMode !== 'macos-distribution' && gate.windowsSignature !== 'verified') {
      errors.push('Windows signature must be verified');
    }
  } else if (id === 'platformRuntime') {
    if (gate.pass !== true) errors.push('platformRuntime.pass must equal true');
    requirePlatforms(gate.platforms, errors, context.releaseMode);
  } else if (id === 'northStar') {
    if (!exactObjectKeys(gate, [
      'status', 'questionSetSha256', 'runnerSha256', 'ownerAcceptanceSha256',
      'privateReplayBundleSha256', 'pmReplayAttestationSha256', 'evidence',
    ])) errors.push('northStar gate contains unknown or missing fields');
    if (!SHA256.test(String(gate.questionSetSha256 ?? ''))) {
      errors.push('northStar.questionSetSha256 must be SHA256');
    }
    if (!SHA256.test(String(gate.runnerSha256 ?? ''))) {
      errors.push('northStar.runnerSha256 must be SHA256');
    }
    if (!SHA256.test(String(gate.ownerAcceptanceSha256 ?? ''))) {
      errors.push('northStar.ownerAcceptanceSha256 must be SHA256');
    }
    if (!SHA256.test(String(gate.privateReplayBundleSha256 ?? ''))) {
      errors.push('northStar.privateReplayBundleSha256 must be SHA256');
    }
    if (!SHA256.test(String(gate.pmReplayAttestationSha256 ?? ''))) {
      errors.push('northStar.pmReplayAttestationSha256 must be SHA256');
    }
    if (!SHA256.test(String(context.northStar?.runnerSha256 ?? ''))) {
      errors.push('canonical north-star runner SHA256 is missing');
    } else if (gate.runnerSha256 !== context.northStar.runnerSha256) {
      errors.push('northStar runner SHA mismatch');
    }
    if (context.northStar?.pmRunner === null) {
      errors.push('canonical north-star PM runner anchor is missing or invalid');
    }
  }
  return errors;
}

async function validateReferences(references, baseDir, errors, parseJson) {
  if (!Array.isArray(references) || references.length === 0) {
    errors.push('at least one hashed evidence reference is required');
    return [];
  }
  if (references.length > MAX_REFERENCE_COUNT) {
    errors.push(`evidence reference count must not exceed ${MAX_REFERENCE_COUNT}`);
    return [];
  }
  const validated = [];
  for (const reference of references) {
    if (
      typeof reference?.path !== 'string'
      || !/^[a-f0-9]{64}$/i.test(String(reference?.sha256 ?? ''))
    ) {
      errors.push('evidence reference must contain path and SHA256');
      continue;
    }
    try {
      const absolute = path.resolve(baseDir, reference.path);
      const privateReplay = isPrivateReplayReferencePath(reference.path);
      const { bytes } = await readFileOnce(absolute, {
        baseDir,
        maxBytes: privateReplay ? PRIVATE_REPLAY_REFERENCE_MAX_BYTES : REFERENCE_MAX_BYTES,
        label: 'evidence reference',
      });
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== reference.sha256.toLowerCase()) {
        errors.push('evidence hash mismatch');
        continue;
      }
      const document = parseJson
        ? reference.path.endsWith('PRIVATE-REPLAY-SALT.bin')
          ? null
          : reference.path.endsWith('.jsonl')
          ? parseJsonLinesBytes(bytes, 'evidence reference', privateReplay ? MAX_PRIVATE_REPLAY_JSON_NODES : MAX_JSON_NODES)
          : parseJsonBytes(bytes, 'evidence reference', privateReplay ? MAX_PRIVATE_REPLAY_JSON_NODES : MAX_JSON_NODES)
        : null;
      validated.push({
        path: reference.path,
        sha256: actual,
        bytes: bytes.length,
        document,
        privateBytes: reference.path.endsWith('PRIVATE-REPLAY-SALT.bin')
          ? Buffer.from(bytes)
          : null,
      });
    } catch (error) {
      errors.push(publicEvidenceError(error, 'evidence reference is unavailable or invalid JSON'));
    }
  }
  return validated;
}

async function readJsonFileOnce(filePath, options) {
  const result = await readFileOnce(filePath, options);
  return { ...result, document: parseJsonBytes(result.bytes, options.label) };
}

async function readFileOnce(filePath, { baseDir = null, maxBytes, label }) {
  const absolute = path.resolve(filePath);
  const parent = path.dirname(absolute);
  let canonicalBase = null;
  if (baseDir !== null) {
    const resolvedBase = path.resolve(baseDir);
    const relative = path.relative(resolvedBase, absolute);
    if (outside(relative)) throw new EvidenceValidationError('evidence reference is outside evidence base directory');
    canonicalBase = await realpath(resolvedBase);
    const parentRelative = path.relative(resolvedBase, parent);
    const canonicalParent = await realpath(parent);
    const expectedParent = path.resolve(canonicalBase, parentRelative);
    if (!samePath(canonicalParent, expectedParent)) {
      throw new EvidenceValidationError('evidence reference is outside evidence base directory or uses a parent symbolic link');
    }
    const initialTarget = await realpath(absolute);
    if (outside(path.relative(canonicalBase, initialTarget))) {
      throw new EvidenceValidationError('evidence reference is outside evidence base directory');
    }
  }

  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | noFollow);
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw new EvidenceValidationError(`${label} must be a regular file`);
    if (openedStat.size > maxBytes) throw new EvidenceValidationError(`${label} exceeds size limit`);

    const canonicalParent = await realpath(parent);
    const canonicalTarget = await realpath(absolute);
    if (!samePath(canonicalTarget, path.join(canonicalParent, path.basename(absolute)))) {
      throw new EvidenceValidationError(`${label} symbolic links are not allowed`);
    }
    if (canonicalBase !== null && outside(path.relative(canonicalBase, canonicalTarget))) {
      throw new EvidenceValidationError('evidence reference is outside evidence base directory');
    }
    const pathStat = await stat(absolute);
    if (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
      throw new EvidenceValidationError(`${label} changed while opening`);
    }

    const bounded = Buffer.allocUnsafe(maxBytes + 1);
    let length = 0;
    while (length < bounded.length) {
      const chunkBytes = Math.min(READ_CHUNK_BYTES, bounded.length - length);
      const { bytesRead } = await handle.read(bounded, length, chunkBytes, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new EvidenceValidationError(`${label} exceeds size limit`);
    const bytes = bounded.subarray(0, length);
    const finalStat = await handle.stat();
    if (
      finalStat.dev !== openedStat.dev
      || finalStat.ino !== openedStat.ino
      || finalStat.size !== openedStat.size
      || bytes.length !== finalStat.size
    ) {
      throw new EvidenceValidationError(`${label} changed while reading`);
    }
    return { bytes };
  } catch (error) {
    if (error instanceof EvidenceValidationError) throw error;
    throw new EvidenceValidationError(`${label} is unavailable or unsafe`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseJsonBytes(bytes, label, maximumNodes = MAX_JSON_NODES) {
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new EvidenceValidationError(`${label} contains invalid JSON`);
  }
  if (!withinJsonBudget(document, maximumNodes)) throw new EvidenceValidationError(`${label} exceeds JSON structure budget`);
  return document;
}

function parseJsonLinesBytes(bytes, label, maximumNodes = MAX_JSON_NODES) {
  let document;
  try {
    const text = bytes.toString('utf8');
    if (!text.endsWith('\n')) throw new Error('newline');
    document = text.trim().split('\n').map((line) => JSON.parse(line));
  } catch {
    throw new EvidenceValidationError(`${label} contains invalid JSONL`);
  }
  if (!withinJsonBudget(document, maximumNodes)) throw new EvidenceValidationError(`${label} exceeds JSON structure budget`);
  return document;
}

class EvidenceValidationError extends Error {}

function publicEvidenceError(error, fallback) {
  return error instanceof EvidenceValidationError ? error.message : fallback;
}

function withinJsonBudget(root, maximumNodes = MAX_JSON_NODES) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > maximumNodes || depth > MAX_JSON_DEPTH) return false;
    if (value && typeof value === 'object') {
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children) stack.push({ value: child, depth: depth + 1 });
    }
  }
  return true;
}

function outside(relative) {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function isPrivateReplayReferencePath(value) {
  return typeof value === 'string' && (
    value.endsWith('PRIVATE-REPLAY-BUNDLE.json')
    || value.endsWith('PRIVATE-REPLAY-SALT.bin')
    || value.endsWith('PM-REPLAY-ATTESTATION.json')
    || value.endsWith('.private.json')
    || value.endsWith('.safe.jsonl')
  );
}

function samePath(left, right) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function normalizePmRunnerAnchor(value) {
  if (!exactObjectKeys(value, ['runnerId', 'publicKeySpki', 'publicKeyFingerprintSha256'])
      || typeof value.runnerId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.runnerId)
      || typeof value.publicKeySpki !== 'string'
      || value.publicKeySpki.length < 32
      || !SHA256.test(String(value.publicKeyFingerprintSha256 ?? ''))) return null;
  return {
    runnerId: value.runnerId,
    publicKeySpki: value.publicKeySpki,
    publicKeyFingerprintSha256: value.publicKeyFingerprintSha256.toLowerCase(),
  };
}

function gateMetrics(id, gate, signingMetrics = null, northStarMetrics = null) {
  if (!gate || typeof gate !== 'object') return {};
  if (id === 'packagedElectronE2e') {
    return {
      passed: safeNumber(gate.passed),
      failed: safeNumber(gate.failed),
      platforms: safePlatforms(gate.platforms),
    };
  }
  if (id === 'performance') {
    return {
      pass: safeBoolean(gate.pass),
      app: {
        launchMs: safeNumber(gate.app?.launchMs),
        residentSetMb: safeNumber(gate.app?.residentSetMb),
      },
      knowledgeGraph100: {
        fps: safeNumber(gate.knowledgeGraph100?.fps),
        nodeCount: safeNumber(gate.knowledgeGraph100?.nodeCount),
      },
    };
  }
  if (id === 'screenshots') {
    return {
      macosCount: safeNumber(gate.macosCount),
      windowsCount: safeNumber(gate.windowsCount),
      verifyFixRounds: safeNumber(gate.verifyFixRounds),
    };
  }
  if (id === 'signingNotarization') {
    return {
      macosNotarization: gate.macosNotarization === 'accepted' ? 'accepted' : null,
      windowsSignature: gate.windowsSignature === 'verified' ? 'verified' : null,
      verifiedReports: Number.isSafeInteger(signingMetrics?.verifiedReports) ? signingMetrics.verifiedReports : 0,
      platforms: safePlatforms(signingMetrics?.platforms),
    };
  }
  if (id === 'northStar') {
    return {
      verifiedReports: Number.isSafeInteger(northStarMetrics?.verifiedReports)
        ? northStarMetrics.verifiedReports
        : 0,
      uniqueStartupSessions: safeNumber(northStarMetrics?.uniqueStartupSessions),
      operationEvents: safeNumber(northStarMetrics?.operationEvents),
      publicNotesCreated: safeNumber(northStarMetrics?.publicNotesCreated),
      kgNodeCount: safeNumber(northStarMetrics?.kgNodeCount),
      questionCount: safeNumber(northStarMetrics?.questionCount),
      macroRecallAt3: safeNumber(northStarMetrics?.macroRecallAt3),
      hitAt3: safeNumber(northStarMetrics?.hitAt3),
    };
  }
  return { pass: safeBoolean(gate.pass), platforms: safePlatforms(gate.platforms) };
}

function validateNorthStarReports(references, context, gate, errors) {
  const reports = references.filter(({ document }) => document?.reportType === 'north-star');
  const acceptances = references.filter(({ document }) => document?.reportType === 'north-star-owner-acceptance');
  const bundles = references.filter(({ document }) => document?.reportType === 'north-star-private-replay-bundle');
  const attestations = references.filter(({ document }) => document?.reportType === 'north-star-pm-replay-attestation');
  const salts = references.filter(({ path: referencePath, document }) => (
    document === null && referencePath.endsWith('/PRIVATE-REPLAY-SALT.bin')
  ));
  const replayExtracts = references.filter(({ document }) => (
    (Array.isArray(document) && document[0]?.reportType === 'north-star-private-telemetry')
    || /^north-star-private-(?:ns2|kg|rag|question-set|owner-acceptance)$/.test(String(document?.reportType ?? ''))
  ));
  const known = new Set([...reports, ...acceptances, ...bundles, ...attestations, ...salts, ...replayExtracts]);
  const unknown = references.filter((reference) => !known.has(reference));
  if (reports.length !== 1 || acceptances.length !== 1 || bundles.length !== 1
      || attestations.length !== 1 || salts.length !== 1 || replayExtracts.length !== 6 || unknown.length > 0) {
    errors.push(`north-star evidence inventory must be 1 report, 1 owner, 1 replay bundle, 1 PM attestation, 1 salt and 6 extracts; got ${reports.length}/${acceptances.length}/${bundles.length}/${attestations.length}/${salts.length}/${replayExtracts.length}/${unknown.length}`);
    return { verifiedReports: 0 };
  }
  if (!context.northStar?.pmRunner) {
    errors.push('north-star PM signature verification requires a verified external trust anchor');
    return { verifiedReports: 0 };
  }
  const reportReference = reports[0];
  const acceptanceReference = acceptances[0];
  const report = reportReference.document;
  const acceptanceErrors = validateOwnerAcceptance(
    acceptanceReference.document,
    gate?.questionSetSha256,
  );
  if (acceptanceReference.sha256 !== gate?.ownerAcceptanceSha256) {
    acceptanceErrors.push('north-star gate/owner acceptance SHA mismatch');
  }
  if (acceptanceReference.sha256 !== report?.ownerAcceptance?.sha256) {
    acceptanceErrors.push('north-star report/owner acceptance SHA mismatch');
  }
  if (acceptanceReference.bytes !== report?.ownerAcceptance?.bytes) {
    acceptanceErrors.push('north-star report/owner acceptance byte count mismatch');
  }
  if (acceptanceErrors.length > 0) {
    errors.push(...acceptanceErrors.map((message) => `invalid owner acceptance ${acceptanceReference.path}: ${message}`));
    return { verifiedReports: 0 };
  }
  const bundleReference = bundles[0];
  const attestationReference = attestations[0];
  const saltReference = salts[0];
  if (JSON.stringify(bundleReference.document?.pmRunner) !== JSON.stringify(context.northStar?.pmRunner)) {
    errors.push('north-star private replay PM runner anchor mismatch');
  }
  if (bundleReference.sha256 !== gate?.privateReplayBundleSha256) {
    errors.push('north-star gate/private replay bundle SHA mismatch');
  }
  if (attestationReference.sha256 !== gate?.pmReplayAttestationSha256) {
    errors.push('north-star gate/PM replay attestation SHA mismatch');
  }
  if (!bundleReference.document?.salt
      || !saltReference.path.endsWith(`/${bundleReference.document.salt.path}`)
      || saltReference.sha256 !== bundleReference.document.salt.sha256
      || saltReference.bytes !== bundleReference.document.salt.bytes) {
    errors.push('north-star private replay salt SHA/bytes/path mismatch');
  }
  const extractTypeToId = new Map([
    ['north-star-private-telemetry', 'telemetry'],
    ['north-star-private-ns2', 'ns2'],
    ['north-star-private-kg', 'kg'],
    ['north-star-private-rag', 'rag'],
    ['north-star-private-question-set', 'questionSet'],
    ['north-star-private-owner-acceptance', 'ownerAcceptance'],
  ]);
  const normalizedReplayRefs = [];
  for (const reference of replayExtracts) {
    const reportType = Array.isArray(reference.document)
      ? reference.document[0]?.reportType
      : reference.document?.reportType;
    const id = extractTypeToId.get(reportType);
    const expected = bundleReference.document?.extracts?.[id];
    if (!id || !expected || !reference.path.endsWith(`/${expected.path}`)) {
      errors.push('private replay extract path/type binding mismatch');
      continue;
    }
    normalizedReplayRefs.push({
      path: expected.path,
      sha256: reference.sha256,
      bytes: reference.bytes,
      document: reference.document,
    });
  }
  const replayValidation = validatePrivateReplayEvidenceSet({
    manifest: bundleReference.document,
    refs: normalizedReplayRefs,
  });
  if (replayValidation.errors.length > 0) {
    errors.push(...replayValidation.errors.map((message) => `invalid private replay: ${message}`));
  }
  const replayAttestationErrors = validatePmReplayAttestation(attestationReference.document, {
    bundleSha256: bundleReference.sha256,
    questionSetSha256: bundleReference.document?.extracts?.questionSet?.sha256,
    ownerAcceptanceSha256: bundleReference.document?.extracts?.ownerAcceptance?.sha256,
    manifest: bundleReference.document,
    results: replayValidation.results,
  });
  if (attestationReference.document?.bundle?.bytes !== bundleReference.bytes) {
    replayAttestationErrors.push('PM replay bundle byte count mismatch');
  }
  if (replayAttestationErrors.length > 0) {
    errors.push(...replayAttestationErrors.map((message) => `invalid PM replay attestation: ${message}`));
    return { verifiedReports: 0 };
  }
  const artifactMap = Object.fromEntries(
    context.artifacts.map((artifact) => [artifact.relativePath, artifact.sha256]),
  );
  const reportErrors = validateNorthStarEvidenceReport(report, {
    releaseIdentity: {
      schemaVersion: 1,
      candidate: context.candidate,
      sourceHead: context.source.head,
      sourceSnapshotSha256: context.source.snapshot.sha256,
    },
    artifacts: artifactMap,
    questionSetSha256: gate?.questionSetSha256,
    runnerSha256: context.northStar?.runnerSha256,
    ownerAcceptanceSha256: acceptanceReference.sha256,
  });
  if (report?.runnerSha256 !== gate?.runnerSha256) {
    reportErrors.push('north-star gate/report runner SHA mismatch');
  }
  if (reportErrors.length > 0) {
    errors.push(...reportErrors.map((message) => `invalid north-star report ${reportReference.path}: ${message}`));
    return { verifiedReports: 0 };
  }
  const signedResults = attestationReference.document.results;
  const normalizedPublicResults = {
    ns1: {
      uniqueStartupSessions: report.metrics.ns1.uniqueStartupSessions,
      operationEvents: report.metrics.ns1.operationEvents,
    },
    ns2: { publicNotesCreated: report.metrics.ns2.publicNotesCreated },
    kg: { nodeCount: report.metrics.ns2.kgNodeCount },
    ns3: {
      questionCount: report.metrics.ns3.questionCount,
      macroRecallAt3: report.metrics.ns3.macroRecallAt3,
      hitAt3: report.metrics.ns3.hitAt3,
      topK: report.metrics.ns3.topK,
    },
  };
  if (JSON.stringify(normalizedPublicResults) !== JSON.stringify(signedResults)) {
    const normalizedSignedResults = {
      ns1: signedResults.ns1,
      ns2: signedResults.ns2,
      kg: signedResults.kg,
      ns3: {
        questionCount: signedResults.ns3.questionCount,
        macroRecallAt3: signedResults.ns3.macroRecallAt3,
        hitAt3: signedResults.ns3.hitAt3,
        topK: signedResults.ns3.topK,
      },
    };
    if (JSON.stringify(normalizedPublicResults) !== JSON.stringify(normalizedSignedResults)) {
      errors.push('north-star public metrics do not match signed PM replay results');
      return { verifiedReports: 0 };
    }
  }
  const publicRows = report.metrics.ns3.results;
  const signedRows = signedResults.ns3.results;
  const saltBytes = saltReference.privateBytes;
  if (!Buffer.isBuffer(saltBytes) || saltBytes.length !== 32
      || !Array.isArray(publicRows) || !Array.isArray(signedRows)
      || publicRows.length !== 20 || signedRows.length !== 20) {
    errors.push('north-star signed per-question binding is incomplete');
    return { verifiedReports: 0 };
  }
  for (let index = 0; index < 20; index += 1) {
    const publicRow = publicRows[index];
    const signedRow = signedRows[index];
    const relevant = new Set(signedRow.relevantSourceIdHashes);
    const matchedCount = signedRow.retrieved.filter((sourceId) => relevant.has(sourceId)).length;
    const expected = {
      questionIdHash: hashPrivateId(saltBytes, 'rag-question-id', publicRow.id),
      relevantCount: signedRow.relevantSourceIdHashes.length,
      retrievedCount: signedRow.retrieved.length,
      matchedCount,
      recallAt3: signedRow.recallAt3,
      hitAt3: signedRow.hitAt3,
    };
    const actual = {
      questionIdHash: signedRow.questionIdHash,
      relevantCount: publicRow.relevantCount,
      retrievedCount: publicRow.retrievedCount,
      matchedCount: publicRow.matchedCount,
      recallAt3: publicRow.recallAt3,
      hitAt3: publicRow.hitAt3,
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`north-star public question row ${index + 1} does not match signed PM replay result`);
      return { verifiedReports: 0 };
    }
  }
  return {
    verifiedReports: 1,
    uniqueStartupSessions: signedResults.ns1.uniqueStartupSessions,
    operationEvents: signedResults.ns1.operationEvents,
    publicNotesCreated: signedResults.ns2.publicNotesCreated,
    kgNodeCount: signedResults.kg.nodeCount,
    questionCount: signedResults.ns3.questionCount,
    macroRecallAt3: signedResults.ns3.macroRecallAt3,
    hitAt3: signedResults.ns3.hitAt3,
  };
}

function validateSigningReports(references, context, errors) {
  const artifacts = Array.isArray(context.artifacts) ? context.artifacts : [];
  const byPath = new Map(artifacts.map((artifact) => [artifact.relativePath, artifact]));
  const counts = new Map(artifacts.map((artifact) => [artifact.relativePath, 0]));
  const platforms = new Set();
  let verifiedReports = 0;

  for (const reference of references) {
    const report = reference.document;
    if (!report || (report.reportType !== 'macos-signing' && report.reportType !== 'windows-signing')) {
      errors.push(`signing evidence is not a semantic signing report: ${reference.path}`);
      continue;
    }
    const artifact = byPath.get(report.artifactPath);
    if (!artifact) {
      errors.push(`signing report references unknown artifact: ${reference.path}`);
      continue;
    }
    counts.set(artifact.relativePath, (counts.get(artifact.relativePath) ?? 0) + 1);
    const binding = {
      ...(artifact.signature ?? {}),
      candidate: context.candidate,
      sourceHead: context.source?.head,
      snapshotSha256: context.source?.snapshot?.sha256,
      artifactPath: artifact.relativePath,
      artifactSha256: artifact.sha256,
      artifactBytes: artifact.bytes,
      artifactKind: artifact.kind,
      artifactPlatform: artifact.platform,
    };
    let reportErrors;
    if (artifact.platform === 'darwin' && report.reportType === 'macos-signing') {
      reportErrors = validateMacSigningReport(report, binding);
      if (
        !SHA256.test(String(artifact.signature?.signingReportSha256 ?? ''))
        || artifact.signature.signingReportSha256.toLowerCase() !== reference.sha256
      ) {
        reportErrors.push('macOS signing report hash does not match canonical artifact provenance');
      }
    } else if (artifact.platform === 'win32' && report.reportType === 'windows-signing') {
      reportErrors = validateWindowsSigningReport(report, binding);
    } else {
      reportErrors = ['reportType does not match canonical artifact platform'];
    }
    if (reportErrors.length > 0) {
      errors.push(...reportErrors.map((message) => `invalid signing report ${reference.path}: ${message}`));
      continue;
    }
    verifiedReports += 1;
    platforms.add(artifact.platform);
  }

  for (const [artifactPath, count] of counts) {
    if (count !== 1) errors.push(`exactly one signing report is required for ${artifactPath}; got ${count}`);
  }
  const expectedPlatforms = context.releaseMode === 'macos-distribution'
    ? ['darwin']
    : ['darwin', 'win32'];
  if (JSON.stringify([...platforms].sort()) !== JSON.stringify(expectedPlatforms)) {
    errors.push(`semantic signing report platforms must equal ${expectedPlatforms.join(',')}`);
  }
  return { verifiedReports, platforms: [...platforms].sort() };
}

function requirePlatforms(platforms, errors, releaseMode) {
  const expected = releaseMode === 'macos-distribution' ? ['darwin'] : ['darwin', 'win32'];
  const actual = Array.isArray(platforms)
    ? [...new Set(platforms)].sort()
    : [];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`evidence platforms must equal ${expected.join(',')}`);
  }
}

function objectEntries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

function lessThan(value, ceiling) {
  return typeof value === 'number' && Number.isFinite(value) && value < ceiling;
}

function atLeast(value, floor) {
  return typeof value === 'number' && Number.isFinite(value) && value >= floor;
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

function safePlatforms(value) {
  return Array.isArray(value) ? value.filter((platform) => platform === 'darwin' || platform === 'win32') : [];
}

function safeArtifactPath(value) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-z]:/i.test(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every((segment) => (
    segment !== ''
    && segment !== '.'
    && segment !== '..'
    && !/[. ]$/.test(segment)
    && !/[<>:"|?*]/.test(segment)
    && !reservedWindowsName(segment)
  ));
}

function canonicalArtifactKey(value) {
  return value
    .replace(/\\/g, '/')
    .normalize('NFC')
    .toLocaleLowerCase('en-US');
}

function reservedWindowsName(segment) {
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);
}
