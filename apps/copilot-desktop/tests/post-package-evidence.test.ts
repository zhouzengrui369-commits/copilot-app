// @vitest-environment node

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { evaluatePostPackageEvidence } from '../scripts/post-package-evidence.mjs';
import {
  createPmReplayAttestation,
  createPrivateReplayBundle,
} from '../scripts/private-replay-evidence.mjs';

function resolveAppRoot(cwd = process.cwd()): string {
  const workspaceAppRoot = path.join(cwd, 'apps/copilot-desktop');
  return existsSync(workspaceAppRoot) ? workspaceAppRoot : cwd;
}

const appRoot = resolveAppRoot();
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const windowsThumbprint = 'A'.repeat(64);
const runnerId = 'windows-release-runner-01';
const fixtureKeyPair = generateKeyPairSync('ed25519');
const publicKeyPem = fixtureKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const publicKeySha256 = createHash('sha256')
  .update(fixtureKeyPair.publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');
const windowsTrustAttestation = { publicKeyPem, publicKeySha256, runnerId };
const pmKeyPair = generateKeyPairSync('ed25519');
const pmPublicKeySpki = pmKeyPair.publicKey.export({ type: 'spki', format: 'der' });
const pmRunner = {
  runnerId: 'njx-pm-runner-01',
  publicKeySpki: Buffer.from(pmPublicKeySpki).toString('base64'),
  publicKeyFingerprintSha256: createHash('sha256').update(pmPublicKeySpki).digest('hex'),
};
const macFingerprint = '1'.repeat(64);
const macEntitlementsSha = 'E'.repeat(64);

const context = {
  releaseMode: 'distribution' as const,
  candidate: 'v6.2-r8',
  source: { head: 'd'.repeat(40), snapshot: { sha256: 'a'.repeat(64) } },
  northStar: { runnerSha256: 'e'.repeat(64), pmRunner },
  artifacts: [
    {
      relativePath: 'artifacts/mac.zip', kind: 'macOS ZIP', platform: 'darwin', bytes: 1234,
      sha256: 'b'.repeat(64), signing: 'verified',
      signature: {
        teamId: 'TEAM123456',
        certificateTrusted: true,
        certificateExpired: false,
        selfSigned: false,
        certificateSha256Fingerprint: macFingerprint,
        certificateThumbprint: macFingerprint,
        entitlementsSha256: macEntitlementsSha,
        signingReportSha256: '0'.repeat(64),
      },
    },
    {
      relativePath: 'artifacts/win.exe', platform: 'win32', bytes: 5678,
      sha256: 'c'.repeat(64), signing: 'verified',
      signature: {
        provenance: 'canonical-windows-cryptographic-verifier',
        publisher: 'CN=NJX Software',
        certificateThumbprint: windowsThumbprint,
        certificateSha256Fingerprint: windowsThumbprint,
        certificateExpired: false,
        selfSigned: false,
        certificateTrustPolicy: 'windows-attested',
        cryptographicSignatureValid: true,
        digest: 'sha256',
        cryptographicTimestamp: { present: true, value: '2026-07-11T12:00:00Z' },
        mainExecutable: {
          relativePath: 'njx-copilot-v6.exe',
          sha256: 'd'.repeat(64),
          bytes: 4321,
          publisher: 'CN=NJX Software',
          certificateThumbprint: windowsThumbprint,
          certificateSha256Fingerprint: windowsThumbprint,
          cryptographicSignatureValid: true,
          digest: 'sha256',
          cryptographicTimestamp: { present: true, value: '2026-07-11T12:00:00Z' },
        },
        windowsTrustAttestation,
      },
    },
  ],
};
type ContextArtifact = (typeof context.artifacts)[number];

const northStarQuestionSetSha256 = 'f'.repeat(64);
const northStarOwnerAcceptance = {
  schemaVersion: 1,
  reportType: 'north-star-owner-acceptance',
  acceptedBy: 'NJX',
  acceptedAt: '2026-07-08T01:00:00.000Z',
  questionSetSha256: northStarQuestionSetSha256,
};
const northStarOwnerAcceptanceBytes = Buffer.from(`${JSON.stringify(northStarOwnerAcceptance, null, 2)}\n`);
const northStarOwnerAcceptanceSha256 = createHash('sha256')
  .update(northStarOwnerAcceptanceBytes)
  .digest('hex');

function northStarReport(overrides: Record<string, unknown> = {}, releaseContext = context) {
  const results = Array.from({ length: 20 }, (_, index) => ({
    id: `q${String(index + 1).padStart(2, '0')}`,
    relevantCount: 1,
    retrievedCount: 3,
    matchedCount: 1,
    recallAt3: 1,
    hitAt3: 1,
  }));
  return {
    schemaVersion: 1,
    reportType: 'north-star',
    status: 'PASS',
    candidate: releaseContext.candidate,
    source: {
      head: releaseContext.source.head,
      snapshotSha256: releaseContext.source.snapshot.sha256,
    },
    artifacts: Object.fromEntries(releaseContext.artifacts.map((item) => [item.relativePath, item.sha256])),
    window: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-08T00:00:00.000Z' },
    questionSetSha256: northStarQuestionSetSha256,
    runnerSha256: releaseContext.northStar.runnerSha256,
    ownerAcceptance: {
      sha256: northStarOwnerAcceptanceSha256,
      bytes: northStarOwnerAcceptanceBytes.byteLength,
      acceptedBy: 'NJX',
      questionSetSha256: northStarQuestionSetSha256,
    },
    metrics: {
      status: 'PASS',
      inputs: {
        telemetry: { sha256: '1'.repeat(64), bytes: 1024 },
        kb: { sha256: '2'.repeat(64), bytes: 2048 },
        kg: { sha256: '3'.repeat(64), bytes: 4096 },
        rag: { sha256: '4'.repeat(64), bytes: 8192 },
      },
      ns1: {
        status: 'PASS', uniqueStartupSessions: 10, operationEvents: 1,
        thresholds: { uniqueStartupSessions: 10, operationEvents: 1 },
      },
      ns2: {
        status: 'PASS', publicNotesCreated: 30, kgNodeCount: 50,
        thresholds: { publicNotesCreated: 30, kgNodeCount: 50 },
      },
      ns3: {
        status: 'PASS', questionCount: 20, macroRecallAt3: 1, hitAt3: 1,
        topK: 3, sourceOnly: true, generationLlmUsed: false, results,
        thresholds: { macroRecallAt3: 0.8 },
      },
    },
    ...overrides,
  };
}

function signingReport(artifact: typeof context.artifacts[number], releaseContext = context) {
  const binding = {
    schemaVersion: artifact.platform === 'win32' ? 2 : 1,
    candidate: releaseContext.candidate,
    sourceHead: releaseContext.source.head,
    snapshotSha256: releaseContext.source.snapshot.sha256,
    artifactPath: artifact.relativePath,
    artifactSha256: artifact.sha256,
    artifactBytes: artifact.bytes,
  };
  if (artifact.platform === 'darwin') {
    return {
      ...binding,
      reportType: 'macos-signing',
      verificationPlatform: 'darwin',
      provenance: 'canonical-macos-verifier',
      identityType: 'Developer ID Application',
      teamId: artifact.signature.teamId,
      certificateTrusted: true,
      certificateExpired: false,
      selfSigned: false,
      certificateSha256Fingerprint: macFingerprint,
      certificateThumbprint: macFingerprint,
      entitlementsSha256: macEntitlementsSha,
      codesignValid: true,
      hardenedRuntime: true,
      nestedSignaturesValid: true,
      trustedTimestamp: true,
      notarization: { status: 'Accepted', submissionId: 'notary-123' },
      staplerValid: true,
    };
  }
  const report = {
    ...binding,
    reportType: 'windows-signing',
    verificationPlatform: 'win32',
    provenance: 'authenticated-windows-trust-runner',
    signatureStatus: 'Valid',
    trustChainValid: true,
    digest: 'sha256',
    timestamp: { trusted: true, value: '2026-07-11T12:00:00Z' },
    publisher: artifact.signature.publisher,
    certificateThumbprint: artifact.signature.certificateThumbprint,
    certificateSha256Fingerprint: artifact.signature.certificateSha256Fingerprint,
    certificateTrusted: true,
    certificateExpired: false,
    selfSigned: false,
    certificateTrustPolicy: 'windows-attested',
    mainExecutable: {
      status: 'Valid',
      ...artifact.signature.mainExecutable,
      signatureStatus: 'Valid',
      trustChainValid: true,
      timestamp: { trusted: true, value: '2026-07-11T12:00:00Z' },
      containerPath: artifact.relativePath,
      containerSha256: artifact.sha256,
      containerBytes: artifact.bytes,
    },
  };
  return attestWindowsReport(report);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function attestWindowsReport(report: Record<string, unknown>, privateKey = fixtureKeyPair.privateKey) {
  const { attestation: _attestation, ...payload } = report;
  return {
    ...payload,
    attestation: {
      algorithm: 'ed25519',
      runnerId,
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    },
  };
}

context.artifacts[0].signature.signingReportSha256 = createHash('sha256')
  .update(`${JSON.stringify(signingReport(context.artifacts[0]), null, 2)}\n`)
  .digest('hex');
context.artifacts[1].signature.signingReportSha256 = createHash('sha256')
  .update(`${JSON.stringify(signingReport(context.artifacts[1]), null, 2)}\n`)
  .digest('hex');

function macosDistributionContext() {
  const definitions = [
    ['arm64', 'macOS ZIP', 'zip'],
    ['arm64', 'macOS DMG', 'dmg'],
    ['x64', 'macOS ZIP', 'zip'],
    ['x64', 'macOS DMG', 'dmg'],
  ] as const;
  const releaseContext: any = {
    ...context,
    releaseMode: 'macos-distribution',
    artifacts: definitions.map(([arch, kind, extension], index) => ({
      ...structuredClone(context.artifacts[0]),
      relativePath: `artifacts/njx-copilot-v6-0.1.0-mac-${arch}.${extension}`,
      kind,
      arch,
      bytes: 2000 + index,
      sha256: String(index + 1).repeat(64),
      signature: { ...structuredClone(context.artifacts[0].signature), signingReportSha256: '0'.repeat(64) },
    })),
  };
  for (const artifact of releaseContext.artifacts) {
    artifact.signature.signingReportSha256 = createHash('sha256')
      .update(`${JSON.stringify(signingReport(artifact, releaseContext), null, 2)}\n`)
      .digest('hex');
  }
  return releaseContext;
}

async function writeProof(root: string, name: string, body: unknown) {
  const proofPath = path.join(root, name);
  await writeFile(proofPath, `${JSON.stringify(body, null, 2)}\n`);
  return {
    path: name,
    sha256: createHash('sha256').update(await readFile(proofPath)).digest('hex'),
  };
}

async function writeRawProof(root: string, name: string, body: string | Buffer) {
  const proofPath = path.join(root, name);
  await writeFile(proofPath, body);
  return {
    path: name,
    sha256: createHash('sha256').update(await readFile(proofPath)).digest('hex'),
  };
}

async function writePrivateReplayEvidence(root: string, releaseContext = context) {
  const candidateRoot = path.join(root, 'candidate-root');
  const sourceRoot = path.join(root, 'private-sources');
  const bundleDir = path.join(root, 'private-replay');
  const existingBundle = path.join(bundleDir, 'PRIVATE-REPLAY-BUNDLE.json');
  const existingAttestation = path.join(bundleDir, 'PM-REPLAY-ATTESTATION.json');
  if (existsSync(existingBundle) && existsSync(existingAttestation)) {
    const manifest = JSON.parse(await readFile(existingBundle, 'utf8'));
    const bundleBytes = await readFile(existingBundle);
    const attestationBytes = await readFile(existingAttestation);
    return {
      bundleSha256: createHash('sha256').update(bundleBytes).digest('hex'),
      attestationSha256: createHash('sha256').update(attestationBytes).digest('hex'),
      references: [
        { path: 'private-replay/PRIVATE-REPLAY-BUNDLE.json', sha256: createHash('sha256').update(bundleBytes).digest('hex') },
        { path: 'private-replay/PM-REPLAY-ATTESTATION.json', sha256: createHash('sha256').update(attestationBytes).digest('hex') },
        { path: `private-replay/${manifest.salt.path}`, sha256: manifest.salt.sha256 },
        ...Object.values(manifest.extracts).map((ref: any) => ({ path: `private-replay/${ref.path}`, sha256: ref.sha256 })),
      ],
    };
  }
  await mkdir(candidateRoot, { mode: 0o700 });
  await mkdir(sourceRoot, { mode: 0o700 });
  await writeFile(
    path.join(root, 'pm-private-key.pem'),
    pmKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  const sourceInputs: Record<string, { path: string; sha256: string; bytes: number }> = {};
  const questionSet = {
    schemaVersion: 1, frozen: true, labelsAreHuman: true, labelledBy: 'NJX',
    frozenAt: '2026-07-08T00:00:00.000Z',
    questions: Array.from({ length: 20 }, (_, index) => ({
      id: `q${String(index + 1).padStart(2, '0')}`, question: `private question ${index + 1}`,
      relevantSourcePaths: [`wiki/source-${index + 1}.md`],
    })),
  };
  const questionSetPath = path.join(sourceRoot, 'question-set.json');
  const questionBytes = Buffer.from(`${JSON.stringify(questionSet, null, 2)}\n`);
  await writeFile(questionSetPath, questionBytes, { mode: 0o600 });
  const ownerAcceptancePath = path.join(sourceRoot, 'owner-acceptance.json');
  await writeFile(ownerAcceptancePath, `${JSON.stringify({
    schemaVersion: 1,
    reportType: 'north-star-owner-acceptance',
    acceptedBy: 'NJX',
    acceptedAt: '2026-07-08T01:00:00.000Z',
    questionSetSha256: createHash('sha256').update(questionBytes).digest('hex'),
  }, null, 2)}\n`, { mode: 0o600 });
  const telemetryEvents: any[] = Array.from({ length: 10 }, (_, index) => ({
    schemaVersion: 2,
    timestamp: new Date(Date.parse('2026-07-01T00:00:00.000Z') + (index + 1) * 1000).toISOString(),
    kind: 'startup', process: 'main',
    sessionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    release: {
      schemaVersion: 1, candidate: releaseContext.candidate, sourceHead: releaseContext.source.head,
      sourceSnapshotSha256: releaseContext.source.snapshot.sha256,
    },
    detail: {},
  }));
  telemetryEvents.push({
    schemaVersion: 2, kind: 'operation', process: 'main', operation: 'rag.ask',
    timestamp: '2026-07-01T00:00:20.000Z',
    sessionId: telemetryEvents[0].sessionId,
    release: telemetryEvents[0].release,
  });
  const ns2Rows = Array.from({ length: 30 }, (_, index) => ({
    noteId: `note-${index}`,
    createdAt: Date.parse('2026-07-01T00:00:00.000Z') + index + 1,
    isSystemTodo: false,
  }));
  const kgNodes = Array.from({ length: 50 }, (_, index) => ({ nodeId: `node-${index}` }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const rag = {
    model: 'bge-m3:latest',
    chunks: Array.from({ length: 20 }, (_, index) => ({
      sourceId: `wiki/source-${index + 1}.md`, embedding: [...new Float32Array([1, index + 1])],
    })),
    questions: Array.from({ length: 20 }, (_, index) => ({
      questionId: `q${String(index + 1).padStart(2, '0')}`, queryEmbedding: [...new Float32Array([1, index + 1])],
      relevantSourceIds: [`wiki/source-${index + 1}.md`],
    })),
  };
  const telemetryPath = path.join(sourceRoot, 'telemetry.jsonl');
  await writeFile(telemetryPath, `${telemetryEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, { mode: 0o600 });
  const kbPath = path.join(sourceRoot, 'kb.sqlite');
  const kb = new Database(kbPath);
  kb.exec('CREATE TABLE schema_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL); CREATE TABLE notes(path TEXT, type TEXT, tags TEXT, created_at INTEGER NOT NULL)');
  kb.prepare('INSERT INTO schema_meta VALUES(?,?)').run('version', '0');
  const insertNote = kb.prepare('INSERT INTO notes VALUES(?,?,?,?)');
  for (const row of ns2Rows) insertNote.run(row.noteId, 'note', '[]', row.createdAt);
  kb.close();
  const kgPath = path.join(sourceRoot, 'kg.sqlite');
  const kg = new Database(kgPath);
  kg.exec('CREATE TABLE kg_schema_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL); CREATE TABLE kg_nodes(entity_id TEXT PRIMARY KEY)');
  kg.prepare('INSERT INTO kg_schema_meta VALUES(?,?)').run('version', '0');
  const insertNode = kg.prepare('INSERT INTO kg_nodes VALUES(?)');
  for (const node of kgNodes) insertNode.run(node.nodeId);
  kg.close();
  const ragPath = path.join(sourceRoot, 'rag.sqlite');
  const ragDb = new Database(ragPath);
  ragDb.exec('CREATE TABLE rag_index_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE chunks(note_path TEXT, embedding BLOB, model TEXT)');
  ragDb.prepare('INSERT INTO rag_index_meta VALUES(?,?)').run('schema_version', '1');
  ragDb.prepare('INSERT INTO rag_index_meta VALUES(?,?)').run('embedding_model', rag.model);
  const insertChunk = ragDb.prepare('INSERT INTO chunks VALUES(?,?,?)');
  for (const chunk of rag.chunks) {
    const vector = new Float32Array(chunk.embedding);
    insertChunk.run(chunk.sourceId, Buffer.from(vector.buffer), rag.model);
  }
  ragDb.close();
  for (const [id, file] of Object.entries({ telemetry: telemetryPath, kb: kbPath, kg: kgPath, rag: ragPath })) {
    const bytes = await readFile(file);
    sourceInputs[id] = { path: file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  const bundle = await createPrivateReplayBundle({
    bundleDir, ownerRoot: root, candidateRoot,
    identity: {
      schemaVersion: 1, candidate: releaseContext.candidate, sourceHead: releaseContext.source.head,
      sourceSnapshotSha256: releaseContext.source.snapshot.sha256,
    },
    window: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-08T00:00:00.000Z' },
    runnerSha256: releaseContext.northStar.runnerSha256,
    pmRunner: releaseContext.northStar.pmRunner,
    generatedAt: '2026-07-08T02:00:00.000Z',
    sourceInputs, questionSetPath, ownerAcceptancePath, telemetryEvents,
    ns2Rows, kgNodes, rag,
  });
  const attestation = await createPmReplayAttestation({
    bundleManifestPath: bundle.path,
    outputPath: path.join(bundleDir, 'PM-REPLAY-ATTESTATION.json'),
    replayedAt: '2026-07-08T03:00:00.000Z',
    sourcePaths: {
      telemetry: sourceInputs.telemetry.path,
      kb: sourceInputs.kb.path,
      kg: sourceInputs.kg.path,
      rag: sourceInputs.rag.path,
      questionSet: questionSetPath,
      ownerAcceptance: ownerAcceptancePath,
    },
    runnerId: pmRunner.runnerId,
    privateKeyPath: path.join(root, 'pm-private-key.pem'),
    candidateRoot,
    embeddingBaseUrl: 'http://127.0.0.1:11434',
    embeddingModel: rag.model,
    fetchImpl: async (url: string, init: any) => {
      const request = JSON.parse(init.body);
      const index = questionSet.questions.findIndex((question) => question.question === request.prompt);
      if (index < 0) throw new Error('unexpected replay prompt');
      return {
        ok: true,
        url,
        headers: new Headers(),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ embedding: rag.questions[index].queryEmbedding })));
            controller.close();
          },
        }),
      };
    },
  });
  const manifest = bundle.document as any;
  return {
    bundleSha256: bundle.sha256,
    attestationSha256: attestation.sha256,
    references: [
      { path: 'private-replay/PRIVATE-REPLAY-BUNDLE.json', sha256: bundle.sha256 },
      { path: 'private-replay/PM-REPLAY-ATTESTATION.json', sha256: attestation.sha256 },
      { path: `private-replay/${manifest.salt.path}`, sha256: manifest.salt.sha256 },
      ...Object.values(manifest.extracts).map((ref: any) => ({
        path: `private-replay/${ref.path}`, sha256: ref.sha256,
      })),
    ],
  };
}

async function writeAcceptanceEvidence(root: string, options: {
  releaseContext?: any;
  signingReferences?: Array<{ path: string; sha256: string }>;
  signingReports?: unknown[];
  northStarReports?: unknown[];
  northStarOwnerAcceptances?: unknown[];
  northStarReplayReferences?: Array<{ path: string; sha256: string }>;
} = {}) {
  const releaseContext = options.releaseContext ?? context;
  const genericReference = await writeProof(root, 'proof.json', { verified: true });
  const signingReferences = options.signingReferences ?? await Promise.all(
    (options.signingReports ?? releaseContext.artifacts.map((artifact: ContextArtifact) => signingReport(artifact, releaseContext))).map((report: unknown, index: number) => (
      writeProof(root, `signing-${index}.json`, report)
    )),
  );
  const northStarReferences = await Promise.all(
    (options.northStarReports ?? [northStarReport({}, releaseContext)]).map((report, index) => (
      writeProof(root, `north-star-${index}.json`, report)
    )),
  );
  const northStarOwnerAcceptanceReferences = await Promise.all(
    (options.northStarOwnerAcceptances ?? [northStarOwnerAcceptance]).map((acceptance, index) => (
      writeProof(root, `north-star-owner-acceptance-${index}.json`, acceptance)
    )),
  );
  const privateReplay = options.northStarReplayReferences
    ? { references: options.northStarReplayReferences, bundleSha256: '0'.repeat(64), attestationSha256: '0'.repeat(64) }
    : await writePrivateReplayEvidence(root, releaseContext);
  const evidencePath = path.join(root, 'evidence.json');
  await writeFile(evidencePath, `${JSON.stringify({
    schemaVersion: releaseContext.releaseMode === 'macos-distribution' ? 2 : 1,
    ...(releaseContext.releaseMode === 'macos-distribution' ? { releaseMode: 'macos-distribution' } : {}),
    candidate: releaseContext.candidate,
    source: { head: releaseContext.source.head, snapshotSha256: releaseContext.source.snapshot.sha256 },
    artifacts: Object.fromEntries(releaseContext.artifacts.map((item: ContextArtifact) => [item.relativePath, item.sha256])),
    gates: {
      packagedElectronE2e: { status: 'PASS', passed: 78, failed: 0, platforms: releaseContext.releaseMode === 'macos-distribution' ? ['darwin'] : ['darwin', 'win32'], evidence: [genericReference] },
      performance: {
        status: 'PASS', pass: true,
        app: { launchMs: 600, residentSetMb: 400 },
        knowledgeGraph100: { fps: 60, nodeCount: 100 },
        evidence: [genericReference],
      },
      screenshots: { status: 'PASS', macosCount: 9, ...(releaseContext.releaseMode === 'macos-distribution' ? {} : { windowsCount: 9 }), verifyFixRounds: 3, evidence: [genericReference] },
      signingNotarization: {
        status: 'PASS', macosNotarization: 'accepted', ...(releaseContext.releaseMode === 'macos-distribution' ? {} : { windowsSignature: 'verified' }), evidence: signingReferences,
      },
      platformRuntime: { status: 'PASS', pass: true, platforms: releaseContext.releaseMode === 'macos-distribution' ? ['darwin'] : ['darwin', 'win32'], evidence: [genericReference] },
      northStar: {
        status: 'PASS',
        questionSetSha256: northStarQuestionSetSha256,
        runnerSha256: releaseContext.northStar.runnerSha256,
        ownerAcceptanceSha256: northStarOwnerAcceptanceSha256,
        privateReplayBundleSha256: privateReplay.bundleSha256,
        pmReplayAttestationSha256: privateReplay.attestationSha256,
        evidence: [...northStarReferences, ...northStarOwnerAcceptanceReferences, ...privateReplay.references],
      },
    },
  }, null, 2)}\n`);
  return evidencePath;
}

describe('post-package external evidence gate', () => {
  it('keeps canonical coverage and post-package gates wired fail-closed', async () => {
    const script = await readFile(
      path.resolve(appRoot, 'scripts/build-canonical-release.mjs'),
      'utf8',
    );
    for (const label of [
      'cloud-coverage',
      'llm-coverage',
      'kb-release-coverage',
      'kb-critical-coverage',
      'kg-coverage',
      'rag-global-coverage',
      'rag-critical-coverage',
      'desktop-global-coverage',
      'desktop-critical-coverage',
    ]) {
      expect(script).toContain(`'${label}'`);
    }
    expect(script).toContain("'apps/copilot-cloud'");
    expect(script).toContain('COVERAGE_THRESHOLD_FAILED');
    expect(script).toContain('await runPostPackageGates()');
    expect(script).toContain("'packages/kb/src/api/todo.ts'");
    const finalizer = await readFile(
      path.resolve(appRoot, 'scripts/finalize-canonical-release.mjs'),
      'utf8',
    );
    expect(finalizer).toContain('ARTIFACT_INVENTORY_MISMATCH');
    expect(finalizer).toContain('ARTIFACT_SHA_MISMATCH');
    expect(finalizer).toContain('evaluatePostPackageEvidence');
    const evidenceValidator = await readFile(
      path.resolve(appRoot, 'scripts/post-package-evidence.mjs'),
      'utf8',
    );
    expect(evidenceValidator).not.toContain('handle.readFile()');
    expect(evidenceValidator).toContain('maxBytes + 1');
    expect(evidenceValidator).toContain('READ_CHUNK_BYTES');
  });

  it('blocks every required gate when evidence is absent', async () => {
    const result = await evaluatePostPackageEvidence(context);
    expect(result.status).toBe('BLOCKED');
    expect(result.gates).toHaveLength(6);
    expect(result.blockers.map((item) => item.code)).toEqual([
      'BLOCKED_POST_PACKAGE_E2E',
      'BLOCKED_POST_PACKAGE_PERFORMANCE',
      'BLOCKED_POST_PACKAGE_SCREENSHOTS',
      'BLOCKED_POST_PACKAGE_SIGNING_NOTARIZATION',
      'BLOCKED_POST_PACKAGE_PLATFORM_RUNTIME',
      'BLOCKED_POST_PACKAGE_NORTH_STAR',
    ]);
  });

  it('accepts only the complete schema-2 macos-distribution evidence contract', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'post-package-macos-distribution-'));
    roots.push(root);
    const releaseContext = macosDistributionContext();
    const evidencePath = await writeAcceptanceEvidence(root, { releaseContext });
    const result = await evaluatePostPackageEvidence({ ...releaseContext, evidencePath });
    expect(result).toMatchObject({
      status: 'PASS',
      binding: { releaseMode: 'macos-distribution', artifactCount: 4, passed: true },
    });
    expect(result.gates.find((gate) => gate.id === 'packagedElectronE2e')?.metrics)
      .toMatchObject({ passed: 78, failed: 0, platforms: ['darwin'] });
    expect(result.gates.find((gate) => gate.id === 'screenshots')?.metrics)
      .toMatchObject({ macosCount: 9, verifyFixRounds: 3 });
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.metrics)
      .toMatchObject({ macosNotarization: 'accepted', verifiedReports: 4, platforms: ['darwin'] });
    expect(result.gates.find((gate) => gate.id === 'platformRuntime')?.metrics)
      .toMatchObject({ pass: true, platforms: ['darwin'] });
  });

  it.each(['schema-downgrade', 'missing-mode', 'mode-mismatch', 'win32-substitution'] as const)(
    'fails closed for macos-distribution %s',
    async (failure) => {
      const root = await mkdtemp(path.join(os.tmpdir(), `post-package-macos-${failure}-`));
      roots.push(root);
      const releaseContext = macosDistributionContext();
      const evidencePath = await writeAcceptanceEvidence(root, { releaseContext });
      const document = JSON.parse(await readFile(evidencePath, 'utf8'));
      if (failure === 'schema-downgrade') document.schemaVersion = 1;
      if (failure === 'missing-mode') delete document.releaseMode;
      if (failure === 'mode-mismatch') document.releaseMode = 'distribution';
      if (failure === 'win32-substitution') {
        document.gates.packagedElectronE2e.platforms = ['win32'];
        document.gates.platformRuntime.platforms = ['win32'];
      }
      await writeFile(evidencePath, `${JSON.stringify(document, null, 2)}\n`);
      const result = await evaluatePostPackageEvidence({ ...releaseContext, evidencePath });
      expect(result.status).toBe('BLOCKED');
      if (failure === 'win32-substitution') {
        expect(result.gates.find((gate) => gate.id === 'platformRuntime')?.status).toBe('BLOCKED');
      } else {
        expect(result.binding.passed).toBe(false);
      }
    },
  );

  it.each(['unsigned-artifact', 'stale-artifact-sha'] as const)(
    'rejects macos-distribution %s without reinterpreting the candidate',
    async (failure) => {
      const root = await mkdtemp(path.join(os.tmpdir(), `post-package-macos-${failure}-`));
      roots.push(root);
      const releaseContext = macosDistributionContext();
      const evidencePath = await writeAcceptanceEvidence(root, { releaseContext });
      const artifacts = releaseContext.artifacts.map((artifact: any, index: number) => index !== 0
        ? artifact
        : failure === 'unsigned-artifact'
          ? { ...artifact, signing: 'unsigned' }
          : { ...artifact, sha256: 'f'.repeat(64) });
      const result = await evaluatePostPackageEvidence({ ...releaseContext, artifacts, evidencePath });
      expect(result.status).toBe('BLOCKED');
      expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');
    },
  );

  it('blocks north-star when the semantic report is missing, blocked, duplicated or misbound', async () => {
    const cases: unknown[][] = [
      [],
      [northStarReport({ status: 'BLOCKED' })],
      [northStarReport(), northStarReport()],
      [northStarReport({ candidate: 'other-candidate' })],
      [northStarReport({ runnerSha256: '1'.repeat(64) })],
      [northStarReport({ artifacts: { 'artifacts/mac.zip': 'b'.repeat(64) } })],
    ];
    for (const reports of cases) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-north-star-'));
      roots.push(root);
      const evidencePath = await writeAcceptanceEvidence(root, { northStarReports: reports });
      const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
      expect(result.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
      expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'BLOCKED_POST_PACKAGE_NORTH_STAR' }));
    }
  }, 15_000);

  it('requires exactly one NJX owner acceptance whose bytes and SHA bind the question set and report', async () => {
    const cases: Array<Parameters<typeof writeAcceptanceEvidence>[1]> = [
      { northStarOwnerAcceptances: [] },
      { northStarOwnerAcceptances: [northStarOwnerAcceptance, northStarOwnerAcceptance] },
      { northStarOwnerAcceptances: [{ ...northStarOwnerAcceptance, acceptedBy: 'other-owner' }] },
      { northStarOwnerAcceptances: [{ ...northStarOwnerAcceptance, questionSetSha256: '0'.repeat(64) }] },
    ];
    for (const options of cases) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-owner-'));
      roots.push(root);
      const evidencePath = await writeAcceptanceEvidence(root, options);
      const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
      expect(result.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
    }
  }, 15_000);

  it('blocks hostile numeric shapes and unknown north-star report fields at the post-package boundary', async () => {
    const invalidReports = [
      (() => {
        const report = northStarReport() as any;
        report.metrics.ns1.uniqueStartupSessions = '10';
        return report;
      })(),
      (() => {
        const report = northStarReport() as any;
        report.metrics.ns2.publicNotesCreated = Number.POSITIVE_INFINITY;
        return report;
      })(),
      (() => {
        const report = northStarReport() as any;
        report.metrics.ns3.topK = 3.0;
        report.metrics.ns3.unknown = true;
        return report;
      })(),
    ];
    for (const report of invalidReports) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-numeric-'));
      roots.push(root);
      const evidencePath = await writeAcceptanceEvidence(root, { northStarReports: [report] });
      const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
      expect(result.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
    }
  }, 15_000);

  it('blocks missing, duplicate, absolute and unknown-field private replay evidence at post-package', async () => {
    const mutations: Array<(root: string, evidence: any) => Promise<void> | void> = [
      (_root, evidence) => { evidence.gates.northStar.evidence.pop(); },
      (_root, evidence) => {
        evidence.gates.northStar.evidence = evidence.gates.northStar.evidence
          .filter((item: any) => !item.path.endsWith('PRIVATE-REPLAY-SALT.bin'));
      },
      (_root, evidence) => { evidence.gates.northStar.evidence.push({ ...evidence.gates.northStar.evidence.at(-1) }); },
      (_root, evidence) => { evidence.gates.northStar.evidence.at(-1).path = '/tmp/private-replay.json'; },
      async (root, evidence) => {
        const ref = evidence.gates.northStar.evidence.find((item: any) => item.path.endsWith('PRIVATE-REPLAY-BUNDLE.json'));
        const file = path.join(root, ref.path);
        const manifest = JSON.parse(await readFile(file, 'utf8'));
        manifest.unknown = true;
        const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
        await writeFile(file, bytes);
        ref.sha256 = createHash('sha256').update(bytes).digest('hex');
        evidence.gates.northStar.privateReplayBundleSha256 = ref.sha256;
      },
    ];
    for (const mutate of mutations) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-replay-negative-'));
      roots.push(root);
      const evidencePath = await writeAcceptanceEvidence(root);
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
      await mutate(root, evidence);
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
      expect(result.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
      expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'BLOCKED_POST_PACKAGE_NORTH_STAR' }));
    }
  }, 15_000);

  it('requires the canonical PM runner anchor and a valid Ed25519 replay signature', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-pm-signature-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);

    const missingAnchor = await evaluatePostPackageEvidence({
      ...context,
      northStar: { runnerSha256: context.northStar.runnerSha256 },
      evidencePath,
    });
    expect(missingAnchor.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
    expect(missingAnchor.gates.filter((gate) => gate.id !== 'northStar').every((gate) => gate.status === 'PASS')).toBe(true);

    const wrongAnchor = await evaluatePostPackageEvidence({
      ...context,
      northStar: {
        ...context.northStar,
        pmRunner: { ...context.northStar.pmRunner, publicKeyFingerprintSha256: '9'.repeat(64) },
      },
      evidencePath,
    });
    expect(wrongAnchor.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');

    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const reference = evidence.gates.northStar.evidence.find((item: any) => item.path.endsWith('PM-REPLAY-ATTESTATION.json'));
    const attestationPath = path.join(root, reference.path);
    const attestation = JSON.parse(await readFile(attestationPath, 'utf8'));
    attestation.signature.valueBase64 = Buffer.alloc(64, 7).toString('base64');
    const bytes = Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`);
    await writeFile(attestationPath, bytes);
    reference.sha256 = createHash('sha256').update(bytes).digest('hex');
    evidence.gates.northStar.pmReplayAttestationSha256 = reference.sha256;
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    const badSignature = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(badSignature.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
  }, 15_000);

  it('blocks public north-star metrics that differ from the signed PM replay results', async () => {
    const mutations = [
      (report: any) => { report.metrics.ns1.uniqueStartupSessions = 11; },
      (report: any) => { report.metrics.ns1.operationEvents = 2; },
      (report: any) => { report.metrics.ns2.publicNotesCreated = 31; },
      (report: any) => { report.metrics.ns2.kgNodeCount = 51; },
      (report: any) => {
        for (const item of report.metrics.ns3.results.slice(16)) {
          item.matchedCount = 0;
          item.recallAt3 = 0;
          item.hitAt3 = 0;
        }
        report.metrics.ns3.macroRecallAt3 = 0.8;
        report.metrics.ns3.hitAt3 = 0.8;
      },
    ];
    for (const mutate of mutations) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-signed-results-'));
      roots.push(root);
      const mismatched = northStarReport() as any;
      mutate(mismatched);
      const evidencePath = await writeAcceptanceEvidence(root, { northStarReports: [mismatched] });
      const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
      expect(result.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
      expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'BLOCKED_POST_PACKAGE_NORTH_STAR' }));
    }
  }, 15_000);

  it('rejects reordered public question rows even when aggregate metrics are unchanged', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-question-order-'));
    roots.push(root);
    const reordered = northStarReport() as any;
    reordered.metrics.ns3.results.reverse();
    const evidencePath = await writeAcceptanceEvidence(root, { northStarReports: [reordered] });
    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
  });

  it('rejects reassigned public question IDs even when row values and aggregates are unchanged', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-question-reassignment-'));
    roots.push(root);
    const reassigned = northStarReport() as any;
    const firstId = reassigned.metrics.ns3.results[0].id;
    reassigned.metrics.ns3.results[0].id = reassigned.metrics.ns3.results[1].id;
    reassigned.metrics.ns3.results[1].id = firstId;
    const evidencePath = await writeAcceptanceEvidence(root, { northStarReports: [reassigned] });
    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.gates.find((gate) => gate.id === 'northStar')?.status).toBe('BLOCKED');
  });

  it('accepts only hash-bound evidence for the exact candidate snapshot and artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-evidence-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);

    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.status, JSON.stringify(result, null, 2)).toBe('PASS');
    expect(result.gates.every((gate) => gate.status === 'PASS')).toBe(true);
    const signing = result.gates.find((gate) => gate.id === 'signingNotarization');
    expect(signing?.metrics).toEqual({
      macosNotarization: 'accepted',
      windowsSignature: 'verified',
      verifiedReports: 2,
      platforms: ['darwin', 'win32'],
    });
    expect(result.gates.find((gate) => gate.id === 'northStar')?.metrics).toEqual({
      verifiedReports: 1,
      uniqueStartupSessions: 10,
      operationEvents: 1,
      publicNotesCreated: 30,
      kgNodeCount: 50,
      questionCount: 20,
      macroRecallAt3: 1,
      hitAt3: 1,
    });
    expect(JSON.stringify(signing)).not.toMatch(/password|privateKey|token/i);
  });

  it('accepts bounded binary and text references for non-signing gates', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-raw-evidence-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);
    const pngReference = await writeRawProof(
      root,
      'screenshot.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x01]),
    );
    const logReference = await writeRawProof(root, 'electron-e2e.log', '82 passed, 0 failed\n');
    const document = JSON.parse(await readFile(evidencePath, 'utf8'));
    document.gates.screenshots.evidence = [pngReference];
    document.gates.packagedElectronE2e.evidence = [logReference];
    await writeFile(evidencePath, `${JSON.stringify(document)}\n`);

    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.status, JSON.stringify(result, null, 2)).toBe('PASS');
    expect(result.gates.find((gate) => gate.id === 'screenshots')?.status).toBe('PASS');
    expect(result.gates.find((gate) => gate.id === 'packagedElectronE2e')?.status).toBe('PASS');
  });

  it('blocks signing reports without canonical manifest provenance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-provenance-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);
    const mismatchedMac = {
      ...context,
      artifacts: context.artifacts.map((artifact) => artifact.platform === 'darwin'
        ? { ...artifact, signature: { ...artifact.signature, signingReportSha256: 'f'.repeat(64) } }
        : artifact),
      evidencePath,
    };
    const macResult = await evaluatePostPackageEvidence(mismatchedMac);
    expect(macResult.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');

    const forgedFingerprint = {
      ...context,
      artifacts: context.artifacts.map((artifact) => artifact.platform === 'darwin'
        ? {
          ...artifact,
          signature: { ...artifact.signature, certificateSha256Fingerprint: '3'.repeat(64) },
        }
        : artifact),
      evidencePath,
    };
    const fingerprintResult = await evaluatePostPackageEvidence(forgedFingerprint);
    expect(fingerprintResult.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');

    const unsignedWindows = { ...signingReport(context.artifacts[1]), attestation: undefined };
    const unsignedPath = await writeAcceptanceEvidence(root, {
      signingReports: [signingReport(context.artifacts[0]), unsignedWindows],
    });
    const winResult = await evaluatePostPackageEvidence({ ...context, evidencePath: unsignedPath });
    expect(winResult.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');
  });

  it.each([
    ['missing report', [signingReport(context.artifacts[0])]],
    ['duplicate report', [
      signingReport(context.artifacts[0]),
      signingReport(context.artifacts[0]),
      signingReport(context.artifacts[1]),
    ]],
    ['semantic invalid report', [
      { ...signingReport(context.artifacts[0]), identityType: 'Apple Development' },
      signingReport(context.artifacts[1]),
    ]],
    ['dummy proof', [{ verified: true }, signingReport(context.artifacts[1])]],
  ])('blocks signing when there is a %s', async (_label, reports) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-signing-invalid-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root, { signingReports: reports });
    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.status).toBe('BLOCKED');
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');
    expect(result.gates.filter((gate) => gate.id !== 'signingNotarization').every((gate) => gate.status === 'PASS')).toBe(true);
  });

  it('blocks a hash-mismatched signing report', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-signing-hash-'));
    roots.push(root);
    const references = await Promise.all(context.artifacts.map((artifact, index) => (
      writeProof(root, `signing-${index}.json`, signingReport(artifact))
    )));
    references[0].sha256 = 'f'.repeat(64);
    const evidencePath = await writeAcceptanceEvidence(root, { signingReferences: references });
    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('evidence hash mismatch')]),
    );
  });

  it('blocks evidence paths that escape the evidence base directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-traversal-'));
    roots.push(root);
    const outside = path.join(path.dirname(root), `outside-${path.basename(root)}.json`);
    await writeFile(outside, JSON.stringify(signingReport(context.artifacts[0])));
    const outsideSha = createHash('sha256').update(await readFile(outside)).digest('hex');
    const winReference = await writeProof(root, 'signing-win.json', signingReport(context.artifacts[1]));
    const evidencePath = await writeAcceptanceEvidence(root, {
      signingReferences: [{ path: `../${path.basename(outside)}`, sha256: outsideSha }, winReference],
    });
    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('outside evidence base directory')]),
    );
    await rm(outside, { force: true });
  });

  it('blocks an in-directory symlink that resolves outside the evidence base directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-symlink-'));
    roots.push(root);
    const outside = path.join(path.dirname(root), `outside-${path.basename(root)}.json`);
    await writeFile(outside, JSON.stringify(signingReport(context.artifacts[0])));
    await symlink(outside, path.join(root, 'linked-mac.json'));
    const linkedSha = createHash('sha256').update(await readFile(outside)).digest('hex');
    const winReference = await writeProof(root, 'signing-win.json', signingReport(context.artifacts[1]));
    const evidencePath = await writeAcceptanceEvidence(root, {
      signingReferences: [{ path: 'linked-mac.json', sha256: linkedSha }, winReference],
    });
    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('outside evidence base directory')]),
    );
    await rm(outside, { force: true });
  });

  it('blocks leaf and parent symlinks even when they resolve inside the evidence base', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-symlink-inside-'));
    roots.push(root);
    const macReference = await writeProof(root, 'real-mac.json', signingReport(context.artifacts[0]));
    await symlink(path.join(root, 'real-mac.json'), path.join(root, 'linked-mac.json'));
    const winReference = await writeProof(root, 'signing-win.json', signingReport(context.artifacts[1]));
    const leafEvidence = await writeAcceptanceEvidence(root, {
      signingReferences: [{ ...macReference, path: 'linked-mac.json' }, winReference],
    });
    const leafResult = await evaluatePostPackageEvidence({ ...context, evidencePath: leafEvidence });
    expect(leafResult.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');

    const realDir = path.join(root, 'real-dir');
    await mkdir(realDir);
    const nestedMac = await writeProof(realDir, 'mac.json', signingReport(context.artifacts[0]));
    await symlink(realDir, path.join(root, 'linked-dir'));
    const parentEvidence = await writeAcceptanceEvidence(root, {
      signingReferences: [{ ...nestedMac, path: 'linked-dir/mac.json' }, winReference],
    });
    const parentResult = await evaluatePostPackageEvidence({ ...context, evidencePath: parentEvidence });
    expect(parentResult.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');
  });

  it('enforces main/reference size, count and JSON structure budgets', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-budgets-'));
    roots.push(root);

    const oversizedMain = path.join(root, 'oversized-main.json');
    await writeFile(oversizedMain, JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }));
    const mainResult = await evaluatePostPackageEvidence({ ...context, evidencePath: oversizedMain });
    expect(mainResult.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('size limit')]));

    const oversizedReference = await writeProof(root, 'oversized-report.json', { padding: 'x'.repeat(256 * 1024) });
    const winReference = await writeProof(root, 'signing-win.json', signingReport(context.artifacts[1]));
    const referenceEvidence = await writeAcceptanceEvidence(root, {
      signingReferences: [oversizedReference, winReference],
    });
    const referenceResult = await evaluatePostPackageEvidence({ ...context, evidencePath: referenceEvidence });
    expect(referenceResult.gates.find((gate) => gate.id === 'signingNotarization')?.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('size limit')]),
    );

    const tooMany = Array.from({ length: 65 }, () => winReference);
    const countEvidence = await writeAcceptanceEvidence(root, { signingReferences: tooMany });
    const countResult = await evaluatePostPackageEvidence({ ...context, evidencePath: countEvidence });
    expect(countResult.gates.find((gate) => gate.id === 'signingNotarization')?.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('reference count')]),
    );

    let deep: unknown = { verified: true };
    for (let index = 0; index < 40; index += 1) deep = { child: deep };
    const deepReference = await writeProof(root, 'deep.json', deep);
    const depthEvidence = await writeAcceptanceEvidence(root);
    const document = JSON.parse(await readFile(depthEvidence, 'utf8'));
    document.gates.signingNotarization.evidence = [deepReference, winReference];
    await writeFile(depthEvidence, `${JSON.stringify(document)}\n`);
    const depthResult = await evaluatePostPackageEvidence({ ...context, evidencePath: depthEvidence });
    expect(depthResult.gates.find((gate) => gate.id === 'signingNotarization')?.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('JSON structure budget')]),
    );

    const nodeReference = await writeProof(root, 'many-nodes.json', Array.from({ length: 12_000 }, () => 0));
    document.gates.signingNotarization.evidence = [nodeReference, winReference];
    await writeFile(depthEvidence, `${JSON.stringify(document)}\n`);
    const nodeResult = await evaluatePostPackageEvidence({ ...context, evidencePath: depthEvidence });
    expect(nodeResult.gates.find((gate) => gate.id === 'signingNotarization')?.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('JSON structure budget')]),
    );

    const totalEvidence = await writeAcceptanceEvidence(root);
    const totalDocument = JSON.parse(await readFile(totalEvidence, 'utf8'));
    const genericReference = totalDocument.gates.packagedElectronE2e.evidence[0];
    for (const gate of Object.values(totalDocument.gates) as Array<Record<string, unknown>>) {
      gate.evidence = Array.from({ length: 13 }, () => genericReference);
    }
    await writeFile(totalEvidence, `${JSON.stringify(totalDocument)}\n`);
    const totalResult = await evaluatePostPackageEvidence({ ...context, evidencePath: totalEvidence });
    expect(totalResult.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('reference count')]));
  });

  it('returns BLOCKED for malformed, duplicate or unsafe canonical artifact context', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-context-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);
    // @ts-expect-error Intentionally malformed runtime input must fail closed rather than throw.
    await expect(evaluatePostPackageEvidence({ evidencePath })).resolves.toMatchObject({ status: 'BLOCKED' });

    const duplicate = {
      ...context,
      artifacts: [context.artifacts[0], { ...context.artifacts[0] }],
      evidencePath,
    };
    const duplicateResult = await evaluatePostPackageEvidence(duplicate);
    expect(duplicateResult.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('duplicate artifact path')]));

    const unsafe = {
      ...context,
      artifacts: [{ ...context.artifacts[0], relativePath: '../escape.zip' }],
      evidencePath,
    };
    const unsafeResult = await evaluatePostPackageEvidence(unsafe);
    expect(unsafeResult.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('unsafe artifact path')]));

    const unsafeWindowsName = {
      ...context,
      artifacts: [{ ...context.artifacts[0], relativePath: 'artifacts/bad:name.exe' }],
      evidencePath,
    };
    const unsafeWindowsNameResult = await evaluatePostPackageEvidence(unsafeWindowsName);
    expect(unsafeWindowsNameResult.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('unsafe artifact path')]));

    const nonString = {
      ...context,
      artifacts: [{ ...context.artifacts[0], relativePath: { secret: 'not-a-path' } }],
      evidencePath,
    };
    // @ts-expect-error Intentionally malformed artifact path exercises the runtime boundary.
    const nonStringResult = await evaluatePostPackageEvidence(nonString);
    expect(nonStringResult.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('artifact path must be a string')]));
  });

  it('rejects case-folded, Unicode-normalized and trailing-dot-space artifact collisions before binding maps', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-canonical-paths-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);

    for (const artifacts of [
      [
        { ...context.artifacts[1], relativePath: 'artifacts/app.exe' },
        { ...context.artifacts[1], relativePath: 'artifacts/APP.EXE' },
      ],
      [
        { ...context.artifacts[1], relativePath: 'artifacts/caf\u00e9.exe' },
        { ...context.artifacts[1], relativePath: 'artifacts/cafe\u0301.exe' },
      ],
    ]) {
      const result = await evaluatePostPackageEvidence({ ...context, artifacts, evidencePath });
      expect(result.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('duplicate artifact path')]));
    }

    for (const relativePath of ['artifacts/app.exe.', 'artifacts/app.exe ']) {
      const result = await evaluatePostPackageEvidence({
        ...context,
        artifacts: [{ ...context.artifacts[1], relativePath }],
        evidencePath,
      });
      expect(result.binding.errors).toEqual(expect.arrayContaining([expect.stringContaining('unsafe artifact path')]));
    }
  });

  it('uses stable parse errors without persisting parser input', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-parse-error-'));
    roots.push(root);
    const evidencePath = path.join(root, 'invalid.json');
    const secret = 'FIXTURE_PARSE_SECRET';
    await writeFile(evidencePath, `{"${secret}":`);
    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.status).toBe('BLOCKED');
  });

  it('projects binding and every gate metric without external object or array injection', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-output-injection-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);
    const document = JSON.parse(await readFile(evidencePath, 'utf8'));
    const secret = 'FIXTURE_GATE_SECRET';
    document.candidate = { secret };
    document.source.head = [secret];
    document.source.snapshotSha256 = { secret };
    document.gates.packagedElectronE2e.passed = { secret };
    document.gates.packagedElectronE2e.failed = [secret];
    document.gates.packagedElectronE2e.platforms = ['darwin', { secret }];
    document.gates.performance.pass = { secret };
    document.gates.performance.app = { launchMs: { secret }, residentSetMb: [secret] };
    document.gates.performance.knowledgeGraph100 = { fps: { secret }, nodeCount: [secret] };
    document.gates.screenshots.macosCount = { secret };
    document.gates.screenshots.windowsCount = [secret];
    document.gates.screenshots.verifyFixRounds = { secret };
    document.gates.signingNotarization.macosNotarization = { secret };
    document.gates.signingNotarization.windowsSignature = [secret];
    document.gates.platformRuntime.pass = { secret };
    document.gates.platformRuntime.platforms = [{ secret }, 'win32'];
    await writeFile(evidencePath, `${JSON.stringify(document)}\n`);

    const result = await evaluatePostPackageEvidence({ ...context, evidencePath });
    expect(JSON.stringify({ binding: result.binding, metrics: result.gates.map((gate) => gate.metrics) })).not.toContain(secret);
  });

  it('does not allow artifact.signature metadata to override canonical source bindings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-binding-pollution-'));
    roots.push(root);
    const forgedMac = { ...signingReport(context.artifacts[0]), candidate: 'forged-candidate' };
    const evidencePath = await writeAcceptanceEvidence(root, {
      signingReports: [forgedMac, signingReport(context.artifacts[1])],
    });
    const pollutedContext = {
      ...context,
      artifacts: context.artifacts.map((artifact, index) => index === 0
        ? { ...artifact, signature: { ...artifact.signature, candidate: 'forged-candidate' } }
        : artifact),
      evidencePath,
    };
    const result = await evaluatePostPackageEvidence(pollutedContext);
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');
  });

  it('blocks Windows signing when trusted inner executable metadata is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-inner-missing-'));
    roots.push(root);
    const evidencePath = await writeAcceptanceEvidence(root);
    const missingInnerContext = {
      ...context,
      artifacts: context.artifacts.map((artifact) => artifact.platform === 'win32'
        ? { ...artifact, signature: { ...artifact.signature, mainExecutable: undefined } }
        : artifact),
      evidencePath,
    };
    const result = await evaluatePostPackageEvidence(missingInnerContext);
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');
  });

  it('fails closed on snapshot mismatch or unsigned artifacts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-post-package-invalid-'));
    roots.push(root);
    const evidencePath = path.join(root, 'evidence.json');
    await writeFile(evidencePath, JSON.stringify({ schemaVersion: 1, gates: {} }));
    const result = await evaluatePostPackageEvidence({
      ...context,
      evidencePath,
      artifacts: context.artifacts.map((item, index) => index === 0 ? { ...item, signing: 'unsigned' } : item),
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.gates.find((gate) => gate.id === 'signingNotarization')?.status).toBe('BLOCKED');
  });
});
