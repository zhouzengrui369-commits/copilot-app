import {
  createHash, createHmac, createPrivateKey, createPublicKey, randomBytes,
  sign as signEd25519, verify as verifyEd25519,
} from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { queryKbKgSources, queryRagSource, validateAndCollectTelemetrySource } from './north-star-source-validation.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SAFE_ID = /^[a-f0-9]{64}$/;
const REQUIRED_EXTRACTS = ['telemetry', 'ns2', 'kg', 'rag', 'questionSet', 'ownerAcceptance'];
const SALT_FILENAME = 'PRIVATE-REPLAY-SALT.bin';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_EXTRACT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_EVENTS = 250_000;
const MAX_ROWS = 1_000_000;
const MAX_DIMENSIONS = 4096;
const MAX_TREE_ENTRIES = 100_000;
const PRIVATE_FILENAMES = new Set([
  'PRIVATE-REPLAY-BUNDLE.json',
  SALT_FILENAME,
  'PM-REPLAY-ATTESTATION.json',
  'telemetry.safe.jsonl',
  'ns2.private.json',
  'kg.private.json',
  'rag.private.json',
  'question-set.private.json',
  'owner-acceptance.private.json',
]);
const COMMON_KEYS = [
  'schemaVersion', 'reportType', 'candidate', 'sourceHead', 'sourceSnapshotSha256',
  'window', 'runnerSha256', 'source', 'generatedAt',
];

export function canonicalizePrivateSourceId(value) {
  if (typeof value !== 'string') throw new Error('private source ID is unsafe');
  const normalized = value.trim().replaceAll('\\', '/').normalize('NFC').toLowerCase();
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error('private source ID is unsafe');
  }
  const parts = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' || /[\u0000-\u001f\u007f]/.test(part)) throw new Error('private source ID is unsafe');
    parts.push(part);
  }
  if (parts.length === 0) throw new Error('private source ID is unsafe');
  return parts.join('/');
}

export function hashPrivateId(salt, domain, value) {
  if (!Buffer.isBuffer(salt) || salt.length < 32) throw new Error('private replay salt is invalid');
  if (!['ns2-note-id', 'kg-node-id', 'rag-source-id', 'rag-question-id'].includes(domain)) {
    throw new Error('private replay hash domain is invalid');
  }
  return createHmac('sha256', salt)
    .update(domain)
    .update('\0')
    .update(canonicalizePrivateSourceId(value))
    .digest('hex');
}

export async function createPrivateReplayBundle(input) {
  validateIdentityWindow(input);
  if (!absolutePath(input?.bundleDir) || !absolutePath(input?.ownerRoot) || !absolutePath(input?.candidateRoot)) {
    throw new Error('private replay paths must be absolute');
  }
  const ownerRoot = await ensureOwnerRoot(input.ownerRoot);
  const requestedOwnerRoot = path.resolve(input.ownerRoot);
  const requestedBundleDir = path.resolve(input.bundleDir);
  const ownerRelative = path.relative(requestedOwnerRoot, requestedBundleDir);
  if (!ownerRelative || ownerRelative.startsWith('..') || path.isAbsolute(ownerRelative)) {
    throw new Error('private replay bundle must be inside Owner root');
  }
  const bundleDir = path.resolve(ownerRoot, ownerRelative);
  assertOutsideCandidateLexically(bundleDir, input.candidateRoot);
  const salt = randomBytes(32);

  const sourceInputs = {};
  for (const id of ['telemetry', 'kb', 'kg', 'rag']) {
    sourceInputs[id] = await verifySource(input.sourceInputs?.[id], id);
  }
  const questionSource = await stableRead(input.questionSetPath, MAX_EXTRACT_BYTES, 'question set');
  const ownerSource = await stableRead(input.ownerAcceptancePath, MAX_EXTRACT_BYTES, 'owner acceptance');
  const questionSet = parseJson(questionSource.bytes, 'question set');
  const ownerAcceptance = parseJson(ownerSource.bytes, 'owner acceptance');
  if (ownerAcceptance?.schemaVersion !== 1
      || ownerAcceptance?.reportType !== 'north-star-owner-acceptance'
      || ownerAcceptance?.acceptedBy !== 'NJX'
      || !validIso(ownerAcceptance?.acceptedAt)
      || ownerAcceptance?.questionSetSha256 !== questionSource.sha256) {
    throw new Error('owner acceptance does not bind the source question set');
  }
  if (!Array.isArray(questionSet?.questions) || questionSet.questions.length !== 20) {
    throw new Error('private replay question set must contain exactly 20 questions');
  }
  sourceInputs.questionSet = { sha256: questionSource.sha256, bytes: questionSource.bytes.length };
  sourceInputs.ownerAcceptance = { sha256: ownerSource.sha256, bytes: ownerSource.bytes.length };

  const common = commonFields(input);
  const pmRunner = validatePmRunnerAnchor(input.pmRunner);
  const telemetry = buildTelemetryExtract(common, sourceInputs.telemetry, input.telemetryEvents);
  const ns2 = buildNs2Extract(common, sourceInputs.kb, input.ns2Rows, salt);
  const kg = buildKgExtract(common, sourceInputs.kg, input.kgNodes, salt);
  const rag = buildRagExtract(common, sourceInputs.rag, input.rag, salt);
  const privateQuestions = buildPrivateQuestionSet(
    common, sourceInputs.questionSet, sourceInputs.ownerAcceptance.sha256, questionSet, salt,
  );

  let created = false;
  try {
    await mkdir(bundleDir, { recursive: false, mode: 0o700 });
    created = true;
    const saltPublished = await publishExclusive(path.join(bundleDir, SALT_FILENAME), salt);
    const refs = {};
    refs.telemetry = await publishExclusive(
      path.join(bundleDir, 'telemetry.safe.jsonl'),
      serializeExtract('telemetry', telemetry),
    );
    refs.ns2 = await publishJson(path.join(bundleDir, 'ns2.private.json'), ns2);
    refs.kg = await publishJson(path.join(bundleDir, 'kg.private.json'), kg);
    refs.rag = await publishJson(path.join(bundleDir, 'rag.private.json'), rag);
    refs.questionSet = await publishJson(path.join(bundleDir, 'question-set.private.json'), privateQuestions);
    const privateOwner = buildPrivateOwnerAcceptance(
      common,
      sourceInputs.ownerAcceptance,
      sourceInputs.questionSet.sha256,
      refs.questionSet.sha256,
      ownerAcceptance,
    );
    refs.ownerAcceptance = await publishJson(
      path.join(bundleDir, 'owner-acceptance.private.json'), privateOwner,
    );
    const extracts = Object.fromEntries(REQUIRED_EXTRACTS.map((id) => [id, {
      path: path.basename(refs[id].path), sha256: refs[id].sha256, bytes: refs[id].bytes,
    }]));
    const manifest = {
      schemaVersion: 1,
      reportType: 'north-star-private-replay-bundle',
      candidate: common.candidate,
      sourceHead: common.sourceHead,
      sourceSnapshotSha256: common.sourceSnapshotSha256,
      window: common.window,
      runnerSha256: common.runnerSha256,
      generatedAt: common.generatedAt,
      salt: {
        path: path.basename(saltPublished.path),
        sha256: saltPublished.sha256,
        bytes: saltPublished.bytes,
      },
      pmRunner,
      sourceInputs,
      extracts,
    };
    const published = await publishJson(path.join(bundleDir, 'PRIVATE-REPLAY-BUNDLE.json'), manifest);
    await syncDirectory(bundleDir);
    return { ...published, path: path.join(requestedBundleDir, 'PRIVATE-REPLAY-BUNDLE.json'), document: manifest };
  } catch (error) {
    if (created) await rm(bundleDir, { recursive: true, force: true });
    if (error?.code === 'EEXIST') throw new Error('private replay bundle exists; overwrite is forbidden');
    throw error;
  }
}

export async function createPmReplayAttestation({
  bundleManifestPath,
  outputPath,
  replayedAt,
  sourcePaths,
  embeddingBaseUrl = 'http://127.0.0.1:11434',
  embeddingModel = 'bge-m3:latest',
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  runnerId,
  privateKeyPath,
  candidateRoot,
}) {
  if (!absolutePath(bundleManifestPath) || !absolutePath(outputPath) || !validIso(replayedAt)) {
    throw new Error('PM replay attestation arguments are invalid');
  }
  const manifestRead = await stableRead(bundleManifestPath, MAX_MANIFEST_BYTES, 'private replay manifest');
  const manifest = parseJson(manifestRead.bytes, 'private replay manifest');
  const runnerKey = await loadAndMatchPmRunnerKey({
    manifest, runnerId, privateKeyPath, candidateRoot, bundleRoot: path.dirname(bundleManifestPath),
  });
  if (!plainObject(sourcePaths) || !exactKeys(sourcePaths, ['telemetry', 'kb', 'kg', 'rag', 'questionSet', 'ownerAcceptance'])) {
    throw new Error('PM replay source paths are invalid');
  }
  const sourceReads = {};
  for (const id of ['telemetry', 'kb', 'kg', 'rag', 'questionSet', 'ownerAcceptance']) {
    if (!absolutePath(sourcePaths[id]) || !validSourceEvidence(manifest?.sourceInputs?.[id])) {
      throw new Error(`PM replay ${id} source binding is invalid`);
    }
    const verified = await stableRead(sourcePaths[id], MAX_SOURCE_BYTES, `PM replay ${id} source`);
    if (verified.sha256 !== manifest.sourceInputs[id].sha256 || verified.bytes.length !== manifest.sourceInputs[id].bytes) {
      throw new Error(`PM replay ${id} source SHA/bytes mismatch`);
    }
    sourceReads[id] = verified.bytes;
  }
  const base = path.dirname(bundleManifestPath);
  const salt = await readBoundSalt(base, manifest?.salt);
  const refs = [];
  const sealedBytes = {};
  for (const id of REQUIRED_EXTRACTS) {
    const ref = manifest?.extracts?.[id];
    if (!validRef(ref)) throw new Error(`private replay ${id} reference is invalid`);
    const absolute = path.resolve(base, ref.path);
    if (!inside(base, absolute)) throw new Error('private replay reference escapes bundle');
    const read = await stableRead(absolute, MAX_EXTRACT_BYTES, `private replay ${id}`);
    if (read.sha256 !== ref.sha256 || read.bytes.length !== ref.bytes) {
      throw new Error(`private replay ${id} hash/bytes mismatch`);
    }
    refs.push({
      path: ref.path,
      sha256: read.sha256,
      bytes: read.bytes.length,
      document: id === 'telemetry'
        ? parseJsonLines(read.bytes, 'private replay telemetry')
        : parseJson(read.bytes, `private replay ${id}`),
    });
    sealedBytes[id] = read.bytes;
  }
  const validation = validatePrivateReplayEvidenceSet({ manifest, refs });
  if (validation.errors.length > 0) throw new Error(`private replay evidence invalid: ${validation.errors.join('; ')}`);
  const regenerated = await regeneratePrivateExtracts({
    manifest,
    sourceReads,
    salt,
    embeddingBaseUrl,
    embeddingModel,
    fetchImpl,
    timeoutMs,
  });
  for (const id of REQUIRED_EXTRACTS) {
    const bytes = serializeExtract(id, regenerated[id]);
    if (!bytes.equals(sealedBytes[id])) {
      throw new Error(`private replay regenerated ${id} extract canonical bytes mismatch`);
    }
  }
  const results = recomputeReplay(regenerated);
  const status = results.ns1.uniqueStartupSessions >= 10
    && results.ns1.operationEvents >= 1
    && results.ns2.publicNotesCreated >= 30
    && results.kg.nodeCount >= 50
    && results.ns3.questionCount === 20
    && results.ns3.macroRecallAt3 >= 0.8 ? 'PASS' : 'BLOCKED';
  const document = {
    schemaVersion: 1,
    reportType: 'north-star-pm-replay-attestation',
    status,
    candidate: manifest.candidate,
    sourceHead: manifest.sourceHead,
    sourceSnapshotSha256: manifest.sourceSnapshotSha256,
    window: manifest.window,
    runnerSha256: manifest.runnerSha256,
    sourceInputs: manifest.sourceInputs,
    extracts: manifest.extracts,
    salt: manifest.salt,
    bundle: {
      path: path.basename(bundleManifestPath), sha256: manifestRead.sha256, bytes: manifestRead.bytes.length,
    },
    questionOwnerBinding: {
      questionSetSha256: manifest.extracts.questionSet.sha256,
      ownerAcceptanceSha256: manifest.extracts.ownerAcceptance.sha256,
    },
    results,
    replayedAt,
    runner: {
      runnerId: manifest.pmRunner.runnerId,
      publicKeyFingerprintSha256: manifest.pmRunner.publicKeyFingerprintSha256,
    },
  };
  const payload = pmAttestationCanonicalPayload(document);
  document.signature = {
    algorithm: 'Ed25519',
    payloadSha256: sha256(payload),
    valueBase64: signEd25519(null, payload, runnerKey).toString('base64'),
  };
  const published = await publishJson(outputPath, document);
  return { ...published, document };
}

export function validatePrivateReplayEvidenceSet({ manifest, refs }) {
  const errors = [];
  const manifestKeys = [
    'schemaVersion', 'reportType', 'candidate', 'sourceHead', 'sourceSnapshotSha256',
    'window', 'runnerSha256', 'generatedAt', 'salt', 'pmRunner', 'sourceInputs', 'extracts',
  ];
  if (!plainObject(manifest) || !exactKeys(manifest, manifestKeys)) return { errors: ['private replay manifest fields are invalid'] };
  if (manifest.schemaVersion !== 1 || manifest.reportType !== 'north-star-private-replay-bundle') errors.push('private replay manifest type/schema mismatch');
  errors.push(...validateCommon(manifest, false));
  if (!validSaltRef(manifest.salt)) errors.push('private replay salt reference is invalid');
  try { validatePmRunnerAnchor(manifest.pmRunner); }
  catch { errors.push('private replay PM runner anchor is invalid'); }
  if (!plainObject(manifest.sourceInputs) || !exactKeys(manifest.sourceInputs, ['telemetry', 'kb', 'kg', 'rag', 'questionSet', 'ownerAcceptance'])) {
    errors.push('private replay source inputs are invalid');
  } else {
    for (const source of Object.values(manifest.sourceInputs)) if (!validSourceEvidence(source)) errors.push('private replay source SHA/bytes are invalid');
  }
  if (!plainObject(manifest.extracts) || !exactKeys(manifest.extracts, REQUIRED_EXTRACTS)) errors.push('private replay extract inventory is invalid');
  if (!Array.isArray(refs) || refs.length !== REQUIRED_EXTRACTS.length) errors.push('private replay requires exactly six refs');
  const refMap = new Map();
  for (const ref of Array.isArray(refs) ? refs : []) {
    if (!validRef(ref) || refMap.has(ref.path)) errors.push('private replay ref is invalid or duplicated');
    else refMap.set(ref.path, ref);
  }
  const documents = {};
  for (const id of REQUIRED_EXTRACTS) {
    const expected = manifest.extracts?.[id];
    if (!validRef(expected)) { errors.push(`private replay ${id} manifest ref is invalid`); continue; }
    const ref = refMap.get(expected.path);
    if (!ref || ref.sha256 !== expected.sha256 || ref.bytes !== expected.bytes) {
      errors.push(`private replay ${id} ref hash/bytes mismatch`);
      continue;
    }
    documents[id] = ref.document;
  }
  if (Object.keys(documents).length === REQUIRED_EXTRACTS.length) {
    errors.push(...validateExtractDocuments(manifest, documents));
  }
  let results = null;
  if (errors.length === 0 && Object.keys(documents).length === REQUIRED_EXTRACTS.length) {
    results = recomputeReplay(documents);
  }
  return { errors, documents, results };
}

export function validatePmReplayAttestation(document, binding = {}) {
  const errors = [];
  const keys = [
    'schemaVersion', 'reportType', 'status', 'candidate', 'sourceHead', 'sourceSnapshotSha256',
    'window', 'runnerSha256', 'sourceInputs', 'extracts', 'salt', 'bundle', 'questionOwnerBinding',
    'results', 'replayedAt', 'runner', 'signature',
  ];
  if (!plainObject(document) || !exactKeys(document, keys)) return ['PM replay attestation fields are invalid'];
  if (document.schemaVersion !== 1 || document.reportType !== 'north-star-pm-replay-attestation' || document.status !== 'PASS') {
    errors.push('PM replay attestation schema/status mismatch');
  }
  if (typeof document.candidate !== 'string' || !document.candidate
      || !HEAD.test(String(document.sourceHead ?? ''))
      || !SHA256.test(String(document.sourceSnapshotSha256 ?? ''))
      || !SHA256.test(String(document.runnerSha256 ?? ''))
      || !plainObject(document.window) || !validIso(document.window.start) || !validIso(document.window.end)
      || Date.parse(document.window.end) - Date.parse(document.window.start) !== 7 * 24 * 60 * 60 * 1000) {
    errors.push('PM replay identity/window fields are invalid');
  }
  if (!validIso(document.replayedAt)) errors.push('PM replay time is invalid');
  if (!validSaltRef(document.salt)) errors.push('PM replay salt binding is invalid');
  if (!validEvidence(document.bundle) || !safeRelative(document.bundle?.path)) errors.push('PM replay bundle binding is invalid');
  if (!plainObject(document.questionOwnerBinding)
      || !exactKeys(document.questionOwnerBinding, ['questionSetSha256', 'ownerAcceptanceSha256'])
      || !SHA256.test(String(document.questionOwnerBinding.questionSetSha256 ?? ''))
      || !SHA256.test(String(document.questionOwnerBinding.ownerAcceptanceSha256 ?? ''))) {
    errors.push('PM replay question/owner binding is invalid');
  }
  if (binding.bundleSha256 && document.bundle.sha256 !== binding.bundleSha256) errors.push('PM replay bundle SHA mismatch');
  if (binding.questionSetSha256 && document.questionOwnerBinding.questionSetSha256 !== binding.questionSetSha256) errors.push('PM replay question-set SHA mismatch');
  if (binding.ownerAcceptanceSha256 && document.questionOwnerBinding.ownerAcceptanceSha256 !== binding.ownerAcceptanceSha256) errors.push('PM replay owner acceptance SHA mismatch');
  errors.push(...validateResults(document.results));
  if (binding.manifest) {
    for (const key of ['candidate', 'sourceHead', 'sourceSnapshotSha256', 'runnerSha256']) {
      if (document[key] !== binding.manifest[key]) errors.push(`PM replay ${key} mismatch`);
    }
    if (canonicalJson(document.window) !== canonicalJson(binding.manifest.window)
        || canonicalJson(document.sourceInputs) !== canonicalJson(binding.manifest.sourceInputs)
        || canonicalJson(document.extracts) !== canonicalJson(binding.manifest.extracts)
        || canonicalJson(document.salt) !== canonicalJson(binding.manifest.salt)) {
      errors.push('PM replay manifest bindings mismatch');
    }
    errors.push(...verifyPmAttestationSignature(document, binding.manifest));
  } else {
    errors.push('PM replay signature requires manifest runner anchor');
  }
  if (binding.results && canonicalJson(document.results) !== canonicalJson(binding.results)) {
    errors.push('PM replay results do not match recomputation');
  }
  return errors;
}

export function pmAttestationCanonicalPayload(document) {
  const keys = [
    'schemaVersion', 'reportType', 'status', 'candidate', 'sourceHead', 'sourceSnapshotSha256',
    'window', 'runnerSha256', 'sourceInputs', 'extracts', 'salt', 'bundle',
    'questionOwnerBinding', 'results', 'replayedAt', 'runner',
  ];
  if (!plainObject(document) || keys.some((key) => !(key in document))) {
    throw new Error('PM replay signing payload is incomplete');
  }
  return Buffer.from(canonicalJson(Object.fromEntries(keys.map((key) => [key, document[key]]))));
}

function verifyPmAttestationSignature(document, manifest) {
  const errors = [];
  let anchor;
  try { anchor = validatePmRunnerAnchor(manifest.pmRunner); }
  catch { return ['PM replay manifest runner anchor is invalid']; }
  if (!plainObject(document.runner)
      || !exactKeys(document.runner, ['runnerId', 'publicKeyFingerprintSha256'])
      || document.runner.runnerId !== anchor.runnerId
      || document.runner.publicKeyFingerprintSha256 !== anchor.publicKeyFingerprintSha256) {
    errors.push('PM replay runner binding mismatch');
  }
  if (!plainObject(document.signature)
      || !exactKeys(document.signature, ['algorithm', 'payloadSha256', 'valueBase64'])
      || document.signature.algorithm !== 'Ed25519'
      || !SHA256.test(String(document.signature.payloadSha256 ?? ''))
      || typeof document.signature.valueBase64 !== 'string') {
    return [...errors, 'PM replay signature fields are invalid'];
  }
  try {
    const payload = pmAttestationCanonicalPayload(document);
    if (sha256(payload) !== document.signature.payloadSha256) errors.push('PM replay signature payload SHA mismatch');
    const publicKey = createPublicKey({
      key: Buffer.from(anchor.publicKeySpki, 'base64'), type: 'spki', format: 'der',
    });
    const signature = Buffer.from(document.signature.valueBase64, 'base64');
    if (signature.length !== 64 || !verifyEd25519(null, payload, publicKey, signature)) {
      errors.push('PM replay Ed25519 signature verification failed');
    }
  } catch {
    errors.push('PM replay Ed25519 signature verification failed');
  }
  return errors;
}

export function validatePmRunnerAnchor(value) {
  if (!plainObject(value)
      || !exactKeys(value, ['runnerId', 'publicKeySpki', 'publicKeyFingerprintSha256'])
      || typeof value.runnerId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.runnerId)
      || typeof value.publicKeySpki !== 'string'
      || !SHA256.test(String(value.publicKeyFingerprintSha256 ?? ''))) {
    throw new Error('private replay PM runner anchor is invalid');
  }
  let spki;
  try {
    spki = Buffer.from(value.publicKeySpki, 'base64');
    const key = createPublicKey({ key: spki, type: 'spki', format: 'der' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('key type');
  } catch {
    throw new Error('private replay PM runner public key is invalid');
  }
  if (sha256(spki) !== value.publicKeyFingerprintSha256) {
    throw new Error('private replay PM runner fingerprint mismatch');
  }
  return { ...value };
}

export async function readPmTrustAnchorFile(filePath, candidateRoot, { afterFirstRead } = {}) {
  if (!absolutePath(filePath) || !absolutePath(candidateRoot)) {
    throw new Error('PM trust anchor path and candidate root must be absolute');
  }
  const [anchorReal, candidateReal] = await Promise.all([
    realpath(filePath).catch(() => null),
    realpath(candidateRoot).catch(() => null),
  ]);
  if (!anchorReal || !candidateReal || inside(candidateReal, anchorReal)) {
    throw new Error('PM trust anchor must be outside candidate');
  }
  const read = await stableReadSingleLink(
    filePath,
    64 * 1024,
    'PM trust anchor',
    { afterFirstRead },
  );
  const document = parseJson(read.bytes, 'PM trust anchor');
  if (!plainObject(document)
      || !exactKeys(document, ['runnerId', 'publicKeyPem', 'publicKeyFingerprintSha256'])
      || typeof document.runnerId !== 'string'
      || typeof document.publicKeyPem !== 'string'
      || !SHA256.test(String(document.publicKeyFingerprintSha256 ?? ''))) {
    throw new Error('PM trust anchor document is invalid');
  }
  let spki;
  try {
    const publicKey = createPublicKey(document.publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('key type');
    spki = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }));
  } catch {
    throw new Error('PM trust anchor public key PEM is invalid');
  }
  if (sha256(spki) !== document.publicKeyFingerprintSha256) {
    throw new Error('PM trust anchor fingerprint mismatch');
  }
  return validatePmRunnerAnchor({
    runnerId: document.runnerId,
    publicKeySpki: spki.toString('base64'),
    publicKeyFingerprintSha256: document.publicKeyFingerprintSha256,
  });
}

export async function resolvePmTrustAnchorForFinalization({
  trustAnchorPath, candidateRoot, manifestAnchor, distribution,
}) {
  if (!trustAnchorPath) {
    if (distribution) {
      throw new Error('PM_TRUST_ANCHOR_REQUIRED: distribution finalization requires --north-star-pm-trust-anchor');
    }
    return null;
  }
  const trusted = await readPmTrustAnchorFile(trustAnchorPath, candidateRoot);
  let canonicalManifestAnchor;
  try { canonicalManifestAnchor = validatePmRunnerAnchor(manifestAnchor); }
  catch { throw new Error('PM_TRUST_ANCHOR_MISMATCH: canonical manifest PM runner anchor is invalid'); }
  if (JSON.stringify(trusted) !== JSON.stringify(canonicalManifestAnchor)) {
    throw new Error('PM_TRUST_ANCHOR_MISMATCH: external PM trust anchor does not match canonical manifest');
  }
  return trusted;
}

async function loadAndMatchPmRunnerKey({ manifest, runnerId, privateKeyPath, candidateRoot, bundleRoot }) {
  const anchor = validatePmRunnerAnchor(manifest?.pmRunner);
  if (runnerId !== anchor.runnerId || !absolutePath(privateKeyPath) || !absolutePath(candidateRoot)) {
    throw new Error('PM replay runner/private key arguments do not match anchor');
  }
  const [keyReal, candidateReal, bundleReal] = await Promise.all([
    realpath(privateKeyPath).catch(() => null),
    realpath(candidateRoot).catch(() => null),
    realpath(bundleRoot).catch(() => null),
  ]);
  if (!keyReal || !candidateReal || !bundleReal || inside(candidateReal, keyReal) || inside(bundleReal, keyReal)) {
    throw new Error('PM replay private key must stay outside candidate and evidence bundle');
  }
  const info = await lstat(privateKeyPath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('PM replay private key must be an Owner 0600 file');
  }
  const read = await stableRead(privateKeyPath, 64 * 1024, 'PM replay private key');
  let privateKey;
  try {
    privateKey = createPrivateKey(read.bytes);
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('key type');
  } catch {
    throw new Error('PM replay private key is invalid');
  }
  const publicSpki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (Buffer.from(publicSpki).toString('base64') !== anchor.publicKeySpki
      || sha256(publicSpki) !== anchor.publicKeyFingerprintSha256) {
    throw new Error('PM replay private key does not match manifest runner anchor');
  }
  return privateKey;
}

export async function assertPrivateReplayAbsent(candidateRoot) {
  if (!absolutePath(candidateRoot)) throw new Error('candidate root must be absolute');
  const root = path.resolve(candidateRoot);
  const stack = [root];
  let count = 0;
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      count += 1;
      if (count > MAX_TREE_ENTRIES) throw new Error('candidate tree exceeds private replay scan budget');
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (PRIVATE_FILENAMES.has(entry.name)) throw new Error('candidate contains private replay evidence');
    }
  }
}

async function readBoundSalt(bundleRoot, ref) {
  if (!validSaltRef(ref)) throw new Error('private replay salt reference is invalid');
  const target = path.resolve(bundleRoot, ref.path);
  if (!inside(bundleRoot, target)) throw new Error('private replay salt reference escapes bundle');
  const info = await lstat(target).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('private replay salt file is unavailable or not Owner 0600');
  }
  const read = await stableRead(target, 32, 'private replay salt');
  if (read.bytes.length !== 32 || read.sha256 !== ref.sha256 || ref.bytes !== 32) {
    throw new Error('private replay salt SHA/bytes mismatch');
  }
  return read.bytes;
}

async function regeneratePrivateExtracts({
  manifest, sourceReads, salt, embeddingBaseUrl, embeddingModel, fetchImpl, timeoutMs,
}) {
  const questionSet = parseJson(sourceReads.questionSet, 'PM replay source question set');
  const ownerAcceptance = parseJson(sourceReads.ownerAcceptance, 'PM replay source owner acceptance');
  if (!Array.isArray(questionSet?.questions) || questionSet.questions.length !== 20) {
    throw new Error('private replay regenerated question set must contain exactly 20 questions');
  }
  if (ownerAcceptance?.schemaVersion !== 1
      || ownerAcceptance?.reportType !== 'north-star-owner-acceptance'
      || ownerAcceptance?.acceptedBy !== 'NJX'
      || !validIso(ownerAcceptance?.acceptedAt)
      || ownerAcceptance?.questionSetSha256 !== manifest.sourceInputs.questionSet.sha256) {
    throw new Error('private replay regenerated owner acceptance binding mismatch');
  }
  const common = commonFromManifest(manifest);
  const telemetryEvents = validateAndCollectTelemetrySource({
    bytes: sourceReads.telemetry,
    identity: {
      schemaVersion: 1,
      candidate: manifest.candidate,
      sourceHead: manifest.sourceHead,
      sourceSnapshotSha256: manifest.sourceSnapshotSha256,
    },
    window: manifest.window,
  }).events;
  const { ns2Rows, kgNodes, ragChunks, ragModel } = await queryReplayDatabases(
    sourceReads, manifest.window, embeddingModel,
  );
  if (ragModel !== embeddingModel) throw new Error('private replay embedding model mismatch');
  const questions = [];
  for (const question of questionSet.questions) {
    if (!plainObject(question) || typeof question.id !== 'string' || typeof question.question !== 'string'
        || !Array.isArray(question.relevantSourcePaths) || question.relevantSourcePaths.length === 0) {
      throw new Error('private replay regenerated question is invalid');
    }
    const queryEmbedding = await fetchControlledEmbedding({
      endpoint: embeddingBaseUrl,
      model: embeddingModel,
      question: question.question,
      fetchImpl,
      timeoutMs,
    });
    questions.push({
      questionId: question.id,
      queryEmbedding,
      relevantSourceIds: [...question.relevantSourcePaths],
    });
  }
  const regenerated = {
    telemetry: buildTelemetryExtract(common, manifest.sourceInputs.telemetry, telemetryEvents),
    ns2: buildNs2Extract(common, manifest.sourceInputs.kb, ns2Rows, salt),
    kg: buildKgExtract(common, manifest.sourceInputs.kg, kgNodes, salt),
    rag: buildRagExtract(common, manifest.sourceInputs.rag, {
      model: ragModel, chunks: ragChunks, questions,
    }, salt),
  };
  regenerated.questionSet = buildPrivateQuestionSet(
    common,
    manifest.sourceInputs.questionSet,
    manifest.sourceInputs.ownerAcceptance.sha256,
    questionSet,
    salt,
  );
  const privateQuestionSetSha256 = sha256(serializeExtract('questionSet', regenerated.questionSet));
  regenerated.ownerAcceptance = buildPrivateOwnerAcceptance(
    common,
    manifest.sourceInputs.ownerAcceptance,
    manifest.sourceInputs.questionSet.sha256,
    privateQuestionSetSha256,
    ownerAcceptance,
  );
  return regenerated;
}

function commonFromManifest(manifest) {
  return {
    schemaVersion: 1,
    reportType: 'placeholder',
    candidate: manifest.candidate,
    sourceHead: manifest.sourceHead,
    sourceSnapshotSha256: manifest.sourceSnapshotSha256,
    window: { start: manifest.window.start, end: manifest.window.end },
    runnerSha256: manifest.runnerSha256,
    source: { sha256: '0'.repeat(64), bytes: 0 },
    generatedAt: manifest.generatedAt,
  };
}

async function queryReplayDatabases(sourceReads, window, embeddingModel) {
  try {
    const kbKg = await queryKbKgSources({ kbBytes: sourceReads.kb, kgBytes: sourceReads.kg, window });
    const rag = await queryRagSource({ ragBytes: sourceReads.rag, embeddingModel });
    return {
      ns2Rows: kbKg.ns2Rows,
      kgNodes: kbKg.kgNodes,
      ragChunks: rag.chunks.map((chunk) => ({ sourceId: chunk.notePath, embedding: [...chunk.embedding] })),
      ragModel: rag.model,
    };
  } catch (error) {
    if (error instanceof Error) throw new Error(`private replay ${error.message}`);
    throw new Error('private replay SQLite schema/query failed');
  }
}

async function fetchControlledEmbedding({ endpoint, model, question, fetchImpl, timeoutMs }) {
  let base;
  try { base = new URL(endpoint); } catch { throw new Error('private replay embedding endpoint is invalid'); }
  if (base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname)
      || base.username || base.password || base.search || base.hash) {
    throw new Error('private replay embedding endpoint must be controlled HTTP loopback');
  }
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('private replay embedding transport is invalid');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL('/api/embeddings', base).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: question }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response?.ok || new URL(response.url).origin !== base.origin) {
      throw new Error('private replay embedding response is unavailable or cross-origin');
    }
    const bytes = await readEmbeddingBytes(response, controller.signal);
    let document;
    try { document = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('private replay embedding response JSON is invalid'); }
    validateVector(document?.embedding, document?.embedding?.length);
    const embedding = [...Float32Array.from(document.embedding)];
    validateVector(embedding, embedding.length);
    if (controller.signal.aborted) throw new Error('private replay embedding timeout');
    return embedding;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('private replay embedding timeout');
    if (error instanceof Error && /private replay/.test(error.message)) throw error;
    throw new Error('private replay embedding request failed');
  } finally {
    clearTimeout(timer);
  }
}

async function readEmbeddingBytes(response, signal) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('private replay embedding response body is unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('private replay embedding timeout');
      const row = await Promise.race([
        reader.read(),
        new Promise((_, reject) => signal.addEventListener(
          'abort', () => reject(new Error('private replay embedding timeout')), { once: true },
        )),
      ]);
      if (row.done) break;
      if (!ArrayBuffer.isView(row.value)
          || row.value?.constructor?.BYTES_PER_ELEMENT !== 1
          || typeof row.value.byteLength !== 'number') {
        throw new Error('private replay embedding chunk is invalid');
      }
      total += row.value.byteLength;
      if (total > 1024 * 1024) throw new Error('private replay embedding response exceeds size limit');
      chunks.push(Buffer.from(row.value));
    }
  } finally {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
  }
  return Buffer.concat(chunks, total);
}

function serializeExtract(id, document) {
  return id === 'telemetry'
    ? Buffer.from(`${document.map((row) => JSON.stringify(row)).join('\n')}\n`)
    : Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
}

function buildTelemetryExtract(common, source, events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new Error('private telemetry events are invalid');
  const header = { ...common, schemaVersion: 1, reportType: 'north-star-private-telemetry', source };
  const safe = events.map((event) => {
    if (!plainObject(event) || event.schemaVersion !== 2 || !validIso(event.timestamp)
        || typeof event.sessionId !== 'string' || !plainObject(event.release)) {
      throw new Error('private telemetry event is invalid');
    }
    const base = {
      schemaVersion: 2, timestamp: event.timestamp, kind: event.kind,
      process: event.process, sessionId: event.sessionId, release: event.release,
    };
    if (event.kind === 'operation') {
      if (typeof event.operation !== 'string') throw new Error('private telemetry operation is invalid');
      return { ...base, operation: event.operation };
    }
    if (!['startup', 'crash', 'offline', 'renderer-gone', 'renderer-unresponsive'].includes(event.kind)) {
      throw new Error('private telemetry kind is invalid');
    }
    return base;
  });
  return [header, ...safe];
}

function buildNs2Extract(common, source, rows, salt) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error('private NS2 rows are invalid');
  return {
    ...common, schemaVersion: 1, reportType: 'north-star-private-ns2', source,
    rows: rows.map((row) => {
      if (!plainObject(row) || typeof row.noteId !== 'string' || !Number.isSafeInteger(row.createdAt)
          || typeof row.isSystemTodo !== 'boolean') throw new Error('private NS2 row is invalid');
      return {
        noteIdHash: hashPrivateId(salt, 'ns2-note-id', row.noteId),
        createdAt: row.createdAt,
        isSystemTodo: row.isSystemTodo,
      };
    }),
  };
}

function buildKgExtract(common, source, nodes, salt) {
  if (!Array.isArray(nodes) || nodes.length > MAX_ROWS) throw new Error('private KG nodes are invalid');
  return {
    ...common, schemaVersion: 1, reportType: 'north-star-private-kg', source,
    nodes: nodes.map((node) => {
      if (!plainObject(node) || typeof node.nodeId !== 'string') throw new Error('private KG node is invalid');
      return { nodeIdHash: hashPrivateId(salt, 'kg-node-id', node.nodeId) };
    }),
  };
}

function buildRagExtract(common, source, rag, salt) {
  if (!plainObject(rag) || typeof rag.model !== 'string' || !rag.model
      || !Array.isArray(rag.chunks) || !Array.isArray(rag.questions) || rag.questions.length !== 20) {
    throw new Error('private RAG replay input is invalid');
  }
  let dimensions = null;
  const chunks = rag.chunks.map((chunk) => {
    if (!plainObject(chunk) || typeof chunk.sourceId !== 'string') throw new Error('private RAG source is invalid');
    dimensions ??= chunk.embedding?.length;
    validateVector(chunk.embedding, dimensions);
    return {
      sourceIdHash: hashPrivateId(salt, 'rag-source-id', chunk.sourceId),
      embedding: [...chunk.embedding],
    };
  });
  if (!Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) throw new Error('private RAG dimension is invalid');
  const questions = rag.questions.map((question) => {
    if (!plainObject(question) || typeof question.questionId !== 'string'
        || !Array.isArray(question.relevantSourceIds) || question.relevantSourceIds.length === 0) {
      throw new Error('private RAG question is invalid');
    }
    validateVector(question.queryEmbedding, dimensions);
    return {
      questionIdHash: hashPrivateId(salt, 'rag-question-id', question.questionId),
      queryEmbedding: [...question.queryEmbedding],
      relevantSourceIdHashes: question.relevantSourceIds.map((sourceId) => (
        hashPrivateId(salt, 'rag-source-id', sourceId)
      )),
    };
  });
  const rankings = computeRankings(chunks, questions);
  return {
    ...common, schemaVersion: 1, reportType: 'north-star-private-rag', source,
    model: rag.model, dimensions, chunks, questions, rankings,
  };
}

function buildPrivateQuestionSet(common, source, ownerSourceSha256, questionSet, salt) {
  return {
    ...common, schemaVersion: 1, reportType: 'north-star-private-question-set', source,
    ownerAcceptanceSourceSha256: ownerSourceSha256,
    questions: questionSet.questions.map((question) => ({
      questionIdHash: hashPrivateId(salt, 'rag-question-id', question.id),
      relevantSourceIdHashes: question.relevantSourcePaths.map((sourceId) => (
        hashPrivateId(salt, 'rag-source-id', sourceId)
      )),
    })),
  };
}

function buildPrivateOwnerAcceptance(common, source, sourceQuestionSetSha256, privateQuestionSetSha256, owner) {
  return {
    ...common, schemaVersion: 1, reportType: 'north-star-private-owner-acceptance', source,
    acceptedBy: 'NJX', acceptedAt: owner.acceptedAt,
    sourceQuestionSetSha256, privateQuestionSetSha256,
  };
}

function validateExtractDocuments(manifest, documents) {
  const errors = [];
  const specs = {
    ns2: ['rows'], kg: ['nodes'], rag: ['model', 'dimensions', 'chunks', 'questions', 'rankings'],
    questionSet: ['ownerAcceptanceSourceSha256', 'questions'],
    ownerAcceptance: ['acceptedBy', 'acceptedAt', 'sourceQuestionSetSha256', 'privateQuestionSetSha256'],
  };
  if (!Array.isArray(documents.telemetry) || documents.telemetry.length < 1 || documents.telemetry.length > MAX_EVENTS + 1) {
    errors.push('private telemetry JSONL is invalid');
  } else {
    const [header, ...events] = documents.telemetry;
    if (!plainObject(header) || !exactKeys(header, COMMON_KEYS)
        || header.reportType !== 'north-star-private-telemetry') errors.push('private telemetry header is invalid');
    else errors.push(...validateExtractCommon(manifest, header, 'telemetry'));
    const seen = new Set();
    for (const event of events) {
      const expected = event?.kind === 'operation'
        ? ['schemaVersion', 'timestamp', 'kind', 'process', 'sessionId', 'release', 'operation']
        : ['schemaVersion', 'timestamp', 'kind', 'process', 'sessionId', 'release'];
      if (!plainObject(event) || !exactKeys(event, expected)) errors.push('private telemetry event fields are invalid');
      const key = canonicalJson(event);
      if (seen.has(key)) errors.push('private telemetry event is duplicated');
      seen.add(key);
    }
  }
  for (const [id, extraKeys] of Object.entries(specs)) {
    const document = documents[id];
    if (!plainObject(document) || !exactKeys(document, [...COMMON_KEYS, ...extraKeys])) {
      errors.push(`private ${id} extract fields are invalid`);
      continue;
    }
    errors.push(...validateExtractCommon(manifest, document, id));
  }
  if (plainObject(documents.ns2)) errors.push(...validateUniqueRows(documents.ns2.rows, 'noteIdHash', ['noteIdHash', 'createdAt', 'isSystemTodo'], MAX_ROWS));
  if (plainObject(documents.kg)) errors.push(...validateUniqueRows(documents.kg.nodes, 'nodeIdHash', ['nodeIdHash'], MAX_ROWS));
  if (plainObject(documents.rag)) errors.push(...validateRagDocument(documents.rag));
  if (plainObject(documents.questionSet)) {
    if (!SHA256.test(String(documents.questionSet.ownerAcceptanceSourceSha256 ?? ''))
        || documents.questionSet.ownerAcceptanceSourceSha256 !== manifest.sourceInputs.ownerAcceptance.sha256) {
      errors.push('private question set owner source binding is invalid');
    }
    errors.push(...validatePrivateQuestions(documents.questionSet.questions));
  }
  if (plainObject(documents.rag) && plainObject(documents.questionSet)) {
    const ragQuestionBinding = (documents.rag.questions ?? []).map((row) => ({
      questionIdHash: row?.questionIdHash,
      relevantSourceIdHashes: row?.relevantSourceIdHashes,
    }));
    if (canonicalJson(ragQuestionBinding) !== canonicalJson(documents.questionSet.questions)) {
      errors.push('private RAG questions do not match the canonical hashed question-set order');
    }
  }
  if (plainObject(documents.ownerAcceptance)) {
    if (documents.ownerAcceptance.acceptedBy !== 'NJX' || !validIso(documents.ownerAcceptance.acceptedAt)
        || documents.ownerAcceptance.sourceQuestionSetSha256 !== manifest.sourceInputs.questionSet.sha256
        || documents.ownerAcceptance.privateQuestionSetSha256 !== manifest.extracts.questionSet.sha256) {
      errors.push('private owner acceptance binding is invalid');
    }
  }
  if (containsForbiddenPrivateField(documents)) errors.push('private replay contains body, content, question, notePath or path field');
  return errors;
}

function validateExtractCommon(manifest, document, id) {
  const errors = validateCommon(document, true);
  for (const key of ['candidate', 'sourceHead', 'sourceSnapshotSha256', 'runnerSha256', 'generatedAt']) {
    if (document[key] !== manifest[key]) errors.push(`private ${id} ${key} mismatch`);
  }
  if (canonicalJson(document.window) !== canonicalJson(manifest.window)) errors.push(`private ${id} window mismatch`);
  const sourceId = id === 'ns2' ? 'kb' : id === 'ownerAcceptance' ? 'ownerAcceptance' : id === 'questionSet' ? 'questionSet' : id;
  if (canonicalJson(document.source) !== canonicalJson(manifest.sourceInputs[sourceId])) errors.push(`private ${id} source binding mismatch`);
  return errors;
}

function validateRagDocument(document) {
  const errors = [];
  if (typeof document.model !== 'string' || !document.model
      || !Number.isSafeInteger(document.dimensions) || document.dimensions < 1 || document.dimensions > MAX_DIMENSIONS) {
    errors.push('private RAG model/dimension is invalid');
    return errors;
  }
  if (!Array.isArray(document.chunks) || document.chunks.length === 0 || document.chunks.length > MAX_ROWS) errors.push('private RAG chunks are invalid');
  if (!Array.isArray(document.questions) || document.questions.length !== 20) errors.push('private RAG questions are invalid');
  if (!Array.isArray(document.rankings) || document.rankings.length > 60) errors.push('private RAG rankings are invalid');
  const sources = new Set();
  for (const chunk of document.chunks ?? []) {
    if (!plainObject(chunk) || !exactKeys(chunk, ['sourceIdHash', 'embedding']) || !SAFE_ID.test(String(chunk.sourceIdHash ?? ''))) errors.push('private RAG chunk fields are invalid');
    try { validateVector(chunk.embedding, document.dimensions); } catch { errors.push('private RAG chunk vector is invalid'); }
    sources.add(chunk.sourceIdHash);
  }
  const questionIds = new Set();
  for (const question of document.questions ?? []) {
    if (!plainObject(question) || !exactKeys(question, ['questionIdHash', 'queryEmbedding', 'relevantSourceIdHashes'])
        || !SAFE_ID.test(String(question.questionIdHash ?? '')) || questionIds.has(question.questionIdHash)
        || !Array.isArray(question.relevantSourceIdHashes) || question.relevantSourceIdHashes.length === 0
        || question.relevantSourceIdHashes.some((id) => !SAFE_ID.test(String(id)))) errors.push('private RAG question fields are invalid');
    questionIds.add(question.questionIdHash);
    try { validateVector(question.queryEmbedding, document.dimensions); } catch { errors.push('private RAG query vector is invalid'); }
  }
  const expected = computeRankings(document.chunks ?? [], document.questions ?? []);
  if (canonicalJson(expected) !== canonicalJson(document.rankings)) errors.push('private RAG rankings do not match cosine replay');
  return errors;
}

function validatePrivateQuestions(questions) {
  const errors = [];
  if (!Array.isArray(questions) || questions.length !== 20) return ['private question set must contain 20 rows'];
  const ids = new Set();
  for (const row of questions) {
    if (!plainObject(row) || !exactKeys(row, ['questionIdHash', 'relevantSourceIdHashes'])
        || !SAFE_ID.test(String(row.questionIdHash ?? '')) || ids.has(row.questionIdHash)
        || !Array.isArray(row.relevantSourceIdHashes) || row.relevantSourceIdHashes.length === 0
        || row.relevantSourceIdHashes.some((id) => !SAFE_ID.test(String(id)))) errors.push('private question-set row is invalid');
    ids.add(row.questionIdHash);
  }
  return errors;
}

function validateUniqueRows(rows, idKey, keys, maximum) {
  const errors = [];
  if (!Array.isArray(rows) || rows.length > maximum) return ['private replay row budget exceeded'];
  const ids = new Set();
  for (const row of rows) {
    if (!plainObject(row) || !exactKeys(row, keys) || !SAFE_ID.test(String(row[idKey] ?? '')) || ids.has(row[idKey])) errors.push('private replay row is invalid or duplicated');
    ids.add(row[idKey]);
    if ('createdAt' in row && (!Number.isSafeInteger(row.createdAt) || typeof row.isSystemTodo !== 'boolean')) errors.push('private NS2 row values are invalid');
  }
  return errors;
}

function recomputeReplay(documents) {
  const events = documents.telemetry.slice(1);
  const startups = new Map();
  const seenEvents = new Set();
  let operationEvents = 0;
  for (const event of events) {
    const key = canonicalJson(event);
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    if (event.kind === 'startup' && !startups.has(event.sessionId)) startups.set(event.sessionId, Date.parse(event.timestamp));
    if (event.kind === 'operation') {
      const startup = startups.get(event.sessionId);
      if (startup !== undefined && Date.parse(event.timestamp) > startup) operationEvents += 1;
    }
  }
  const notes = new Map();
  for (const row of documents.ns2.rows) if (!notes.has(row.noteIdHash)) notes.set(row.noteIdHash, row);
  const publicNotesCreated = [...notes.values()].filter((row) => !row.isSystemTodo).length;
  const nodeCount = new Set(documents.kg.nodes.map((row) => row.nodeIdHash)).size;
  const rankingByQuestion = new Map();
  for (const row of documents.rag.rankings) {
    if (!rankingByQuestion.has(row.questionIdHash)) rankingByQuestion.set(row.questionIdHash, []);
    rankingByQuestion.get(row.questionIdHash).push(row);
  }
  let recall = 0;
  let hit = 0;
  const results = [];
  for (const question of documents.rag.questions) {
    const relevant = new Set(question.relevantSourceIdHashes);
    const retrieved = (rankingByQuestion.get(question.questionIdHash) ?? []).sort((a, b) => a.rank - b.rank);
    const matched = retrieved.filter((row) => relevant.has(row.sourceIdHash)).length;
    const recallAt3 = matched / relevant.size;
    const hitAt3 = matched > 0 ? 1 : 0;
    recall += recallAt3;
    hit += hitAt3;
    results.push({
      questionIdHash: question.questionIdHash,
      relevantSourceIdHashes: [...question.relevantSourceIdHashes],
      retrieved: retrieved.map((row) => row.sourceIdHash),
      recallAt3,
      hitAt3,
    });
  }
  return {
    ns1: { uniqueStartupSessions: startups.size, operationEvents },
    ns2: { publicNotesCreated },
    kg: { nodeCount },
    ns3: {
      questionCount: documents.rag.questions.length,
      macroRecallAt3: recall / documents.rag.questions.length,
      hitAt3: hit / documents.rag.questions.length,
      topK: 3,
      results,
    },
  };
}

function computeRankings(chunks, questions) {
  const output = [];
  for (const question of questions) {
    const best = new Map();
    for (const chunk of chunks) {
      const score = cosine(question.queryEmbedding, chunk.embedding);
      if (!best.has(chunk.sourceIdHash) || score > best.get(chunk.sourceIdHash)) best.set(chunk.sourceIdHash, score);
    }
    [...best.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .forEach(([sourceIdHash, score], index) => output.push({
        questionIdHash: question.questionIdHash,
        sourceIdHash,
        rank: index + 1,
        score,
      }));
  }
  return output;
}

function validateResults(results) {
  if (!plainObject(results) || !exactKeys(results, ['ns1', 'ns2', 'kg', 'ns3'])) return ['PM replay results are invalid'];
  if (!plainObject(results.ns1) || !exactKeys(results.ns1, ['uniqueStartupSessions', 'operationEvents'])
      || !plainObject(results.ns2) || !exactKeys(results.ns2, ['publicNotesCreated'])
      || !plainObject(results.kg) || !exactKeys(results.kg, ['nodeCount'])
      || !plainObject(results.ns3)
      || !exactKeys(results.ns3, ['questionCount', 'macroRecallAt3', 'hitAt3', 'topK', 'results'])) {
    return ['PM replay result nested fields are invalid'];
  }
  const numbers = [
    results.ns1?.uniqueStartupSessions, results.ns1?.operationEvents,
    results.ns2?.publicNotesCreated, results.kg?.nodeCount, results.ns3?.questionCount,
  ];
  if (numbers.some((value) => !Number.isSafeInteger(value) || value < 0)
      || results.ns3?.topK !== 3 || !unit(results.ns3?.macroRecallAt3) || !unit(results.ns3?.hitAt3)) {
    return ['PM replay result numeric fields are invalid'];
  }
  if (results.ns3.questionCount !== 20 || !Array.isArray(results.ns3.results)
      || results.ns3.results.length !== 20) {
    return ['PM replay must contain exactly 20 signed question rows'];
  }
  const questionIds = new Set();
  let recall = 0;
  let hit = 0;
  for (const row of results.ns3.results) {
    const relevant = Array.isArray(row?.relevantSourceIdHashes)
      ? row.relevantSourceIdHashes : [];
    const retrieved = Array.isArray(row?.retrieved) ? row.retrieved : [];
    const relevantSet = new Set(relevant);
    const retrievedSet = new Set(retrieved);
    const matched = retrieved.filter((sourceId) => relevantSet.has(sourceId)).length;
    if (!plainObject(row)
        || !exactKeys(row, ['questionIdHash', 'relevantSourceIdHashes', 'retrieved', 'recallAt3', 'hitAt3'])
        || !SAFE_ID.test(String(row.questionIdHash ?? '')) || questionIds.has(row.questionIdHash)
        || relevant.length < 1 || relevant.length !== relevantSet.size
        || relevant.some((value) => !SAFE_ID.test(String(value)))
        || retrieved.length > 3 || retrieved.length !== retrievedSet.size
        || retrieved.some((value) => !SAFE_ID.test(String(value)))
        || !unit(row.recallAt3) || (row.hitAt3 !== 0 && row.hitAt3 !== 1)
        || Math.abs(row.recallAt3 - matched / relevant.length) > 1e-12
        || row.hitAt3 !== (matched > 0 ? 1 : 0)) {
      return ['PM replay signed question row is invalid'];
    }
    questionIds.add(row.questionIdHash);
    recall += row.recallAt3;
    hit += row.hitAt3;
  }
  if (Math.abs(results.ns3.macroRecallAt3 - recall / 20) > 1e-12
      || Math.abs(results.ns3.hitAt3 - hit / 20) > 1e-12) {
    return ['PM replay signed question rows do not match aggregate metrics'];
  }
  return [];
}

async function verifySource(value, label) {
  if (!plainObject(value) || !absolutePath(value.path) || !SHA256.test(String(value.sha256 ?? ''))
      || !Number.isSafeInteger(value.bytes) || value.bytes < 0) throw new Error(`${label} source binding is invalid`);
  const read = await stableHashFile(value.path, MAX_SOURCE_BYTES, `${label} stable source`);
  if (read.sha256 !== value.sha256 || read.bytes !== value.bytes) throw new Error(`${label} stable source SHA/bytes mismatch`);
  return { sha256: read.sha256, bytes: read.bytes };
}

async function stableHashFile(filePath, maximum, label) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    const beforePath = await lstat(filePath, { bigint: true });
    if (!beforePath.isFile() || beforePath.isSymbolicLink()) throw new Error('unsafe');
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    if (!sameStable(before, beforePath) || before.size < 0n || before.size > BigInt(maximum)) throw new Error('unsafe');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const hashes = [];
    for (let pass = 0; pass < 2; pass += 1) {
      const hash = createHash('sha256');
      let offset = 0;
      while (offset < Number(before.size)) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
        if (bytesRead === 0) throw new Error('changed');
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      hashes.push(hash.digest('hex'));
    }
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(filePath, { bigint: true });
    if (!sameStable(before, after) || !sameStable(before, afterPath) || hashes[0] !== hashes[1]) throw new Error('changed');
    return { bytes: Number(before.size), sha256: hashes[0] };
  } catch {
    throw new Error(`${label} is unavailable, unsafe, or changed while reading`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function stableRead(filePath, maximum, label) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    const beforePath = await lstat(filePath, { bigint: true });
    if (!beforePath.isFile() || beforePath.isSymbolicLink()) throw new Error('unsafe');
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    if (!sameStable(before, beforePath) || before.size < 0n || before.size > BigInt(maximum)) throw new Error('unsafe');
    const bytes = Buffer.alloc(Number(before.size));
    const first = createHash('sha256');
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error('changed');
      first.update(bytes.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
    const second = createHash('sha256');
    const scratch = Buffer.allocUnsafe(64 * 1024);
    offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(scratch, 0, Math.min(scratch.length, bytes.length - offset), offset);
      if (bytesRead === 0) throw new Error('changed');
      second.update(scratch.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(filePath, { bigint: true });
    const firstSha = first.digest('hex');
    if (!sameStable(before, after) || !sameStable(before, afterPath) || firstSha !== second.digest('hex')) throw new Error('changed');
    return { bytes, sha256: firstSha };
  } catch {
    throw new Error(`${label} is unavailable, unsafe, or changed while reading`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Read a public trust anchor through exactly one O_RDONLY|O_NOFOLLOW handle.
 * The handle identity is authoritative; the final path lstat only proves that
 * the pathname still names the same single-link inode after both SHA passes.
 */
async function stableReadSingleLink(filePath, maximum, label, { afterFirstRead } = {}) {
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 1n
        || before.size > BigInt(maximum) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('unsafe');
    }
    const bytes = Buffer.alloc(Number(before.size));
    const first = createHash('sha256');
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error('changed');
      first.update(bytes.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
    const firstSha256 = first.digest('hex');
    await afterFirstRead?.();
    const second = createHash('sha256');
    const scratch = Buffer.allocUnsafe(64 * 1024);
    offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        scratch,
        0,
        Math.min(scratch.length, bytes.length - offset),
        offset,
      );
      if (bytesRead === 0) throw new Error('changed');
      second.update(scratch.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(filePath, { bigint: true });
    if (!afterPath.isFile() || afterPath.isSymbolicLink() || after.nlink !== 1n
        || afterPath.nlink !== 1n || !sameStable(before, after)
        || !sameStable(before, afterPath) || firstSha256 !== second.digest('hex')) {
      throw new Error('changed');
    }
    return { bytes, sha256: firstSha256 };
  } catch {
    throw new Error(`${label} is unavailable, unsafe, or changed while reading`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function publishJson(target, value) {
  return publishExclusive(target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function publishExclusive(target, bytes) {
  let handle;
  try {
    handle = await open(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('private replay evidence exists; overwrite is forbidden');
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
  return { path: target, sha256: sha256(bytes), bytes: bytes.length };
}

async function ensureOwnerRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Owner private root is unsafe');
  const handle = await open(root, fsConstants.O_RDONLY);
  try { await handle.chmod(0o700); } finally { await handle.close(); }
  return realpath(root);
}

function commonFields(input) {
  return {
    schemaVersion: 1,
    reportType: 'placeholder',
    candidate: input.identity.candidate,
    sourceHead: input.identity.sourceHead,
    sourceSnapshotSha256: input.identity.sourceSnapshotSha256,
    window: { start: input.window.start, end: input.window.end },
    runnerSha256: input.runnerSha256,
    source: { sha256: '0'.repeat(64), bytes: 0 },
    generatedAt: input.generatedAt,
  };
}

function validateIdentityWindow(input) {
  if (!plainObject(input?.identity) || input.identity.schemaVersion !== 1
      || typeof input.identity.candidate !== 'string' || !input.identity.candidate
      || !HEAD.test(String(input.identity.sourceHead ?? ''))
      || !SHA256.test(String(input.identity.sourceSnapshotSha256 ?? ''))
      || !SHA256.test(String(input.runnerSha256 ?? '')) || !validIso(input.generatedAt)
      || !plainObject(input.window) || !validIso(input.window.start) || !validIso(input.window.end)
      || Date.parse(input.window.end) - Date.parse(input.window.start) !== 7 * 24 * 60 * 60 * 1000) {
    throw new Error('private replay identity/window is invalid');
  }
}

function validateCommon(value, requireSource) {
  const errors = [];
  if (typeof value.candidate !== 'string' || !value.candidate || !HEAD.test(String(value.sourceHead ?? ''))
      || !SHA256.test(String(value.sourceSnapshotSha256 ?? '')) || !SHA256.test(String(value.runnerSha256 ?? ''))
      || !validIso(value.generatedAt) || !plainObject(value.window) || !validIso(value.window.start)
      || !validIso(value.window.end) || Date.parse(value.window.end) - Date.parse(value.window.start) !== 7 * 24 * 60 * 60 * 1000) {
    errors.push('private replay identity/window fields are invalid');
  }
  if (requireSource && !validEvidence(value.source)) errors.push('private replay extract source binding is invalid');
  return errors;
}

function containsForbiddenPrivateField(root) {
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (!Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (['body', 'content', 'question', 'notePath', 'path', 'transcript', 'prompt'].includes(key)) return true;
        stack.push(child);
      }
    } else stack.push(...value);
  }
  return false;
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`${label} contains invalid JSON`); }
}

function parseJsonLines(bytes, label) {
  try { return bytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line)); }
  catch { throw new Error(`${label} contains invalid JSONL`); }
}

function validateVector(vector, dimensions) {
  if (!Array.isArray(vector) || vector.length !== dimensions || vector.length < 1 || vector.length > MAX_DIMENSIONS) throw new Error('vector dimension');
  let norm = 0;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('vector finite');
    norm += value * value;
  }
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('vector norm');
}

function cosine(left, right) {
  validateVector(left, right.length);
  validateVector(right, left.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  const score = dot / Math.sqrt(leftNorm * rightNorm);
  if (!Number.isFinite(score)) throw new Error('cosine score');
  return score;
}

function validRef(value) {
  return plainObject(value) && safeRelative(value.path) && SHA256.test(String(value.sha256 ?? ''))
    && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_EXTRACT_BYTES;
}

function validSaltRef(value) {
  return plainObject(value)
    && exactKeys(value, ['path', 'sha256', 'bytes'])
    && value.path === SALT_FILENAME
    && SHA256.test(String(value.sha256 ?? ''))
    && value.bytes === 32;
}

function validEvidence(value) {
  return plainObject(value) && SHA256.test(String(value.sha256 ?? ''))
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_EXTRACT_BYTES;
}

function validSourceEvidence(value) {
  return plainObject(value) && SHA256.test(String(value.sha256 ?? ''))
    && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_SOURCE_BYTES;
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !value.includes('\\')
    && value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[. ]$/.test(part));
}

function sameStable(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertOutsideCandidateLexically(bundleDir, candidateRoot) {
  const candidate = path.resolve(candidateRoot);
  if (inside(candidate, bundleDir)) throw new Error('private replay bundle must be outside candidate and artifacts');
}

function absolutePath(value) {
  return typeof value === 'string' && path.isAbsolute(value);
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function unit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return plainObject(value) && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function syncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(String(error?.code ?? ''))) throw error;
  } finally { await handle.close(); }
}
