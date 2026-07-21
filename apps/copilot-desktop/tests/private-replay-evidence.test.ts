import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPrivateReplayAbsent,
  canonicalizePrivateSourceId,
  createPmReplayAttestation,
  createPrivateReplayBundle,
  hashPrivateId,
  readPmTrustAnchorFile,
  resolvePmTrustAnchorForFinalization,
  validatePmReplayAttestation,
  validatePrivateReplayEvidenceSet,
} from '../scripts/private-replay-evidence.mjs';

const roots: string[] = [];
const identity = {
  schemaVersion: 1,
  candidate: 'v6.2-phase1-candidate-r15',
  sourceHead: 'a'.repeat(40),
  sourceSnapshotSha256: 'b'.repeat(64),
};
const window = { start: '2026-07-01T00:00:00.000Z', end: '2026-07-08T00:00:00.000Z' };
const runnerSha256 = 'c'.repeat(64);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-private-replay-'));
  roots.push(root);
  const candidateRoot = path.join(root, 'candidate');
  const ownerRoot = path.join(root, 'owner-private');
  const sourcesRoot = path.join(root, 'stable-sources');
  await mkdir(candidateRoot, { mode: 0o700 });
  await mkdir(ownerRoot, { mode: 0o700 });
  await mkdir(sourcesRoot, { mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(ownerRoot, 'pm-runner-private-key.pem');
  await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const publicKeySpki = publicKey.export({ type: 'spki', format: 'der' });
  const pmRunner = {
    runnerId: 'njx-pm-runner-01',
    publicKeySpki: Buffer.from(publicKeySpki).toString('base64'),
    publicKeyFingerprintSha256: sha256(Buffer.from(publicKeySpki)),
  };
  const questionSet = {
    schemaVersion: 1, frozen: true, labelsAreHuman: true, labelledBy: 'NJX',
    frozenAt: '2026-07-08T00:00:00.000Z',
    questions: Array.from({ length: 20 }, (_, index) => ({
      id: `q${index + 1}`,
      question: `private question ${index + 1}`,
      relevantSourcePaths: [`Wiki/Éxample-${index + 1}.md`],
    })),
  };
  const questionSetPath = path.join(sourcesRoot, 'question-set.json');
  const questionBytes = jsonBytes(questionSet);
  await writeFile(questionSetPath, questionBytes, { mode: 0o600 });
  const ownerAcceptance = {
    schemaVersion: 1,
    reportType: 'north-star-owner-acceptance',
    acceptedBy: 'NJX',
    acceptedAt: '2026-07-08T01:00:00.000Z',
    questionSetSha256: sha256(questionBytes),
  };
  const ownerAcceptancePath = path.join(sourcesRoot, 'owner-acceptance.json');
  await writeFile(ownerAcceptancePath, jsonBytes(ownerAcceptance), { mode: 0o600 });
  const telemetryEvents = Array.from({ length: 10 }, (_, index) => ({
    schemaVersion: 2,
    timestamp: new Date(Date.parse(window.start) + (index + 1) * 1000).toISOString(),
    kind: 'startup', process: 'main',
    sessionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    release: identity,
    detail: {},
  }));
  telemetryEvents.push({
    schemaVersion: 2,
    timestamp: new Date(Date.parse(window.start) + 20_000).toISOString(),
    kind: 'operation', process: 'main',
    sessionId: '00000000-0000-4000-8000-000000000001',
    release: identity,
    operation: 'rag.ask',
  } as any);
  const ns2Rows = Array.from({ length: 30 }, (_, index) => ({
    noteId: `private/note-${index + 1}.md`,
    createdAt: Date.parse(window.start) + index + 1,
    isSystemTodo: false,
  }));
  const kgNodes = Array.from({ length: 50 }, (_, index) => ({ nodeId: `Private Node ${index + 1}` }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const rag = {
    model: 'bge-m3:latest',
    chunks: Array.from({ length: 20 }, (_, index) => ({
      sourceId: `wiki/e\u0301xample-${index + 1}.md`,
      embedding: [...new Float32Array([1, index / 100 + 0.01])],
    })),
    questions: Array.from({ length: 20 }, (_, index) => ({
      questionId: `q${index + 1}`,
      queryEmbedding: [...new Float32Array([1, index / 100 + 0.01])],
      relevantSourceIds: [`WIKI/ÉXAMPLE-${index + 1}.MD`],
    })),
  };
  const sourceInputs: Record<string, { path: string; sha256: string; bytes: number }> = {};
  const telemetryPath = path.join(sourcesRoot, 'telemetry.jsonl');
  await writeFile(telemetryPath, `${telemetryEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, { mode: 0o600 });

  const kbPath = path.join(sourcesRoot, 'kb.sqlite');
  const kb = new Database(kbPath);
  kb.exec('CREATE TABLE schema_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL); CREATE TABLE notes(path TEXT, type TEXT, tags TEXT, created_at INTEGER NOT NULL)');
  kb.prepare('INSERT INTO schema_meta VALUES(?,?)').run('version', '0');
  const insertNote = kb.prepare('INSERT INTO notes VALUES(?,?,?,?)');
  for (const row of ns2Rows) insertNote.run(row.noteId, 'note', row.isSystemTodo ? '["__copilot_todo__"]' : '[]', row.createdAt);
  kb.close();

  const kgPath = path.join(sourcesRoot, 'kg.sqlite');
  const kg = new Database(kgPath);
  kg.exec('CREATE TABLE kg_schema_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL); CREATE TABLE kg_nodes(entity_id TEXT PRIMARY KEY)');
  kg.prepare('INSERT INTO kg_schema_meta VALUES(?,?)').run('version', '0');
  const insertNode = kg.prepare('INSERT INTO kg_nodes VALUES(?)');
  for (const node of kgNodes) insertNode.run(node.nodeId);
  kg.close();

  const ragPath = path.join(sourcesRoot, 'rag.sqlite');
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
    sourceInputs[id] = { path: file, sha256: sha256(bytes), bytes: bytes.length };
  }
  const replaySourcePaths = {
    telemetry: sourceInputs.telemetry.path,
    kb: sourceInputs.kb.path,
    kg: sourceInputs.kg.path,
    rag: sourceInputs.rag.path,
    questionSet: questionSetPath,
    ownerAcceptance: ownerAcceptancePath,
  };
  return {
    root, candidateRoot, ownerRoot, sourceInputs, questionSetPath, ownerAcceptancePath,
    telemetryEvents, ns2Rows, kgNodes, rag, questionSet, replaySourcePaths,
    privateKeyPath, pmRunner,
  };
}

function embeddingFetch(input: Awaited<ReturnType<typeof fixture>>, mutate?: (vector: number[], prompt: string) => number[]) {
  const byQuestion = new Map(input.questionSet.questions.map((question: any, index: number) => [
    question.question,
    [...input.rag.questions[index].queryEmbedding],
  ]));
  return async (url: string, init: any) => {
    const request = JSON.parse(init.body);
    const original = byQuestion.get(request.prompt);
    if (!original) throw new Error('unexpected test question');
    const vector = mutate ? mutate(original, request.prompt) : original;
    return {
      ok: true,
      url,
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ embedding: vector })));
          controller.close();
        },
      }),
    };
  };
}

describe('private replay bundle', () => {
  it('publishes non-overwriting 0600 privacy-safe extracts outside candidate with relative hash refs', async () => {
    const input = await fixture();
    const bundleDir = path.join(input.ownerRoot, 'replay-r15');
    const bundle = await createPrivateReplayBundle({
      ...input, bundleDir, identity, window, runnerSha256,
      generatedAt: '2026-07-08T02:00:00.000Z',
    });
    expect(bundle.path).toBe(path.join(bundleDir, 'PRIVATE-REPLAY-BUNDLE.json'));
    expect((await stat(bundleDir)).mode & 0o777).toBe(0o700);
    const manifest = JSON.parse(await readFile(bundle.path, 'utf8'));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      reportType: 'north-star-private-replay-bundle',
      candidate: identity.candidate,
      sourceHead: identity.sourceHead,
      sourceSnapshotSha256: identity.sourceSnapshotSha256,
      window,
      runnerSha256,
      pmRunner: input.pmRunner,
      salt: {
        path: 'PRIVATE-REPLAY-SALT.bin',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: 32,
      },
    });
    expect(manifest).not.toHaveProperty('saltSha256');
    expect(manifest.pmRunner).toEqual(input.pmRunner);
    const saltPath = path.join(bundleDir, manifest.salt.path);
    expect((await stat(saltPath)).mode & 0o777).toBe(0o600);
    const saltBytes = await readFile(saltPath);
    expect({ sha256: sha256(saltBytes), bytes: saltBytes.length }).toEqual({
      sha256: manifest.salt.sha256, bytes: manifest.salt.bytes,
    });
    expect(Object.keys(manifest.extracts).sort()).toEqual(['kg', 'ns2', 'ownerAcceptance', 'questionSet', 'rag', 'telemetry']);
    for (const ref of Object.values(manifest.extracts) as any[]) {
      expect(path.isAbsolute(ref.path)).toBe(false);
      expect(ref.path).not.toMatch(/\.\.|\\/);
      expect((await stat(path.join(bundleDir, ref.path))).mode & 0o777).toBe(0o600);
      const bytes = await readFile(path.join(bundleDir, ref.path));
      expect({ sha256: sha256(bytes), bytes: bytes.length }).toEqual({ sha256: ref.sha256, bytes: ref.bytes });
    }
    const all = (await Promise.all(Object.values(manifest.extracts).map((ref: any) => readFile(path.join(bundleDir, ref.path), 'utf8')))).join('\n');
    expect(all).not.toMatch(/private question|private\/note|Wiki\/|notePath|"body"\s*:|"chunk"\s*:|"path"\s*:/i);
    await expect(createPrivateReplayBundle({
      ...input, bundleDir, identity, window, runnerSha256,
      generatedAt: '2026-07-08T02:00:00.000Z',
    })).rejects.toThrow(/overwrite|exists/i);
    await expect(assertPrivateReplayAbsent(input.candidateRoot)).resolves.toBeUndefined();
  });

  it('canonicalizes source IDs with NFC, case-fold and path rules while isolating hash domains', () => {
    expect(canonicalizePrivateSourceId(' Wiki\\E\u0301xample.md ')).toBe('wiki/éxample.md');
    expect(canonicalizePrivateSourceId('WIKI/ÉXAMPLE.md')).toBe('wiki/éxample.md');
    const salt = Buffer.alloc(32, 7);
    expect(hashPrivateId(salt, 'rag-source-id', ' Wiki\\E\u0301xample.md '))
      .toBe(hashPrivateId(salt, 'rag-source-id', 'WIKI/ÉXAMPLE.md'));
    expect(hashPrivateId(salt, 'rag-source-id', 'WIKI/ÉXAMPLE.md'))
      .not.toBe(hashPrivateId(salt, 'kg-node-id', 'WIKI/ÉXAMPLE.md'));
    expect(() => canonicalizePrivateSourceId('../escape.md')).toThrow(/unsafe/i);
  });
});

describe('PM replay attestation', () => {
  it('reads a stable external PEM trust anchor and rejects candidate-local or symlinked anchors', async () => {
    const input = await fixture();
    const publicKeyPem = createPublicKey({
      key: Buffer.from(input.pmRunner.publicKeySpki, 'base64'), type: 'spki', format: 'der',
    }).export({ type: 'spki', format: 'pem' }).toString();
    const anchor = {
      runnerId: input.pmRunner.runnerId,
      publicKeyPem,
      publicKeyFingerprintSha256: input.pmRunner.publicKeyFingerprintSha256,
    };
    const anchorPath = path.join(input.ownerRoot, 'pm-trust-anchor.json');
    await writeFile(anchorPath, `${JSON.stringify(anchor)}\n`, { mode: 0o600 });
    await expect(readPmTrustAnchorFile(anchorPath, input.candidateRoot)).resolves.toEqual(input.pmRunner);
    await expect(resolvePmTrustAnchorForFinalization({
      trustAnchorPath: anchorPath,
      candidateRoot: input.candidateRoot,
      manifestAnchor: input.pmRunner,
      distribution: true,
    })).resolves.toEqual(input.pmRunner);
    await expect(resolvePmTrustAnchorForFinalization({
      candidateRoot: input.candidateRoot,
      manifestAnchor: input.pmRunner,
      distribution: false,
    })).resolves.toBeNull();
    await expect(resolvePmTrustAnchorForFinalization({
      candidateRoot: input.candidateRoot,
      manifestAnchor: input.pmRunner,
      distribution: true,
    })).rejects.toThrow(/PM_TRUST_ANCHOR_REQUIRED/);
    await expect(resolvePmTrustAnchorForFinalization({
      trustAnchorPath: anchorPath,
      candidateRoot: input.candidateRoot,
      manifestAnchor: { ...input.pmRunner, runnerId: 'other-runner' },
      distribution: true,
    })).rejects.toThrow(/PM_TRUST_ANCHOR_MISMATCH/);

    const candidateAnchor = path.join(input.candidateRoot, 'pm-trust-anchor.json');
    await writeFile(candidateAnchor, `${JSON.stringify(anchor)}\n`, { mode: 0o600 });
    await expect(readPmTrustAnchorFile(candidateAnchor, input.candidateRoot)).rejects.toThrow(/outside candidate/i);
    const linked = path.join(input.ownerRoot, 'linked-anchor.json');
    await symlink(anchorPath, linked);
    await expect(readPmTrustAnchorFile(linked, input.candidateRoot)).rejects.toThrow(/stable|symbolic|unsafe/i);

    const candidateHardlink = path.join(input.candidateRoot, 'hardlinked-anchor.json');
    await link(anchorPath, candidateHardlink);
    await expect(readPmTrustAnchorFile(anchorPath, input.candidateRoot)).rejects.toThrow(/hard|stable|unsafe/i);

    await rm(candidateHardlink);
    const attacker = path.join(input.candidateRoot, 'attacker-anchor.json');
    await writeFile(attacker, `${JSON.stringify(anchor)}\n`, { mode: 0o600 });
    const backup = `${anchorPath}.backup`;
    await expect(readPmTrustAnchorFile(anchorPath, input.candidateRoot, {
      afterFirstRead: async () => {
        await rename(anchorPath, backup);
        await link(attacker, anchorPath);
      },
    })).rejects.toThrow(/changed|stable|unsafe/i);
  });

  it('exposes a fail-closed PM replay CLI for classified missing evidence', () => {
    const appRoot = existsSync(path.join(process.cwd(), 'apps/copilot-desktop'))
      ? path.join(process.cwd(), 'apps/copilot-desktop') : process.cwd();
    const result = spawnSync(process.execPath, [path.join(appRoot, 'scripts/pm-replay-attestation.mjs')], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'BLOCKED', blocker: 'BLOCKED_PRIVATE_REPLAY_EVIDENCE',
    });
  });

  it('rehashes every ref and recomputes deduped NS1/NS2/KG and cosine Top3 metrics non-overwriting', async () => {
    const input = await fixture();
    const bundleDir = path.join(input.ownerRoot, 'replay-r15');
    const bundle = await createPrivateReplayBundle({
      ...input, bundleDir, identity, window, runnerSha256,
      generatedAt: '2026-07-08T02:00:00.000Z',
    });
    const outputPath = path.join(bundleDir, 'PM-REPLAY-ATTESTATION.json');
    let embeddingRequests = 0;
    const controlledFetch = embeddingFetch(input);
    const attestation = await createPmReplayAttestation({
      bundleManifestPath: bundle.path,
      outputPath,
      replayedAt: '2026-07-08T03:00:00.000Z',
      sourcePaths: input.replaySourcePaths,
      embeddingBaseUrl: 'http://127.0.0.1:11434',
      embeddingModel: input.rag.model,
      fetchImpl: async (url: string, init: any) => {
        embeddingRequests += 1;
        expect(url).toBe('http://127.0.0.1:11434/api/embeddings');
        expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(JSON.parse(init.body).model).toBe(input.rag.model);
        return controlledFetch(url, init);
      },
      timeoutMs: 100,
      runnerId: input.pmRunner.runnerId,
      privateKeyPath: input.privateKeyPath,
      candidateRoot: input.candidateRoot,
    });
    expect(embeddingRequests).toBe(20);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(attestation.document).toMatchObject({
      schemaVersion: 1,
      reportType: 'north-star-pm-replay-attestation',
      status: 'PASS',
      runner: {
        runnerId: input.pmRunner.runnerId,
        publicKeyFingerprintSha256: input.pmRunner.publicKeyFingerprintSha256,
      },
      signature: {
        algorithm: 'Ed25519',
        payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        valueBase64: expect.any(String),
      },
      results: {
        ns1: { uniqueStartupSessions: 10, operationEvents: 1 },
        ns2: { publicNotesCreated: 30 },
        kg: { nodeCount: 50 },
        ns3: { questionCount: 20, macroRecallAt3: 1, hitAt3: 1, topK: 3 },
      },
    });
    expect(attestation.document.results.ns3.results).toHaveLength(20);
    expect(attestation.document.results.ns3.results[0]).toEqual(expect.objectContaining({
      questionIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      relevantSourceIdHashes: expect.any(Array),
      retrieved: expect.any(Array),
      recallAt3: 1,
      hitAt3: 1,
    }));
    expect(validatePmReplayAttestation(attestation.document, {
      manifest: bundle.document,
      bundleSha256: bundle.sha256,
      results: attestation.document.results,
    })).toEqual([]);
    const tamperedSigned = structuredClone(attestation.document);
    tamperedSigned.results.ns2.publicNotesCreated += 1;
    expect(validatePmReplayAttestation(tamperedSigned, {
      manifest: bundle.document,
      bundleSha256: bundle.sha256,
      results: tamperedSigned.results,
    }).join(' ')).toMatch(/signature|payload/i);
    await expect(createPmReplayAttestation({
      bundleManifestPath: bundle.path,
      outputPath,
      replayedAt: '2026-07-08T03:00:00.000Z',
      sourcePaths: input.replaySourcePaths,
      embeddingBaseUrl: 'http://127.0.0.1:11434',
      embeddingModel: input.rag.model,
      fetchImpl: embeddingFetch(input),
      timeoutMs: 100,
      runnerId: input.pmRunner.runnerId,
      privateKeyPath: input.privateKeyPath,
      candidateRoot: input.candidateRoot,
    })).rejects.toThrow(/overwrite|exists/i);
  });

  it('regenerates all extracts from real sources and blocks a different controlled embedding result', async () => {
    const input = await fixture();
    const bundleDir = path.join(input.ownerRoot, 'replay-r15');
    const bundle = await createPrivateReplayBundle({
      ...input, bundleDir, identity, window, runnerSha256,
      generatedAt: '2026-07-08T02:00:00.000Z',
    });
    await expect(createPmReplayAttestation({
      bundleManifestPath: bundle.path,
      outputPath: path.join(bundleDir, 'PM-REPLAY-ATTESTATION.json'),
      replayedAt: '2026-07-08T03:00:00.000Z',
      sourcePaths: input.replaySourcePaths,
      embeddingBaseUrl: 'http://127.0.0.1:11434',
      embeddingModel: input.rag.model,
      fetchImpl: embeddingFetch(input, (vector) => [vector[0], vector[1] + 0.5]),
      timeoutMs: 100,
      runnerId: input.pmRunner.runnerId,
      privateKeyPath: input.privateKeyPath,
      candidateRoot: input.candidateRoot,
    })).rejects.toThrow(/regenerated.*rag|extract.*mismatch/i);
  });

  it('rejects a PM signing key that does not match the manifest runner anchor', async () => {
    const input = await fixture();
    const bundleDir = path.join(input.ownerRoot, 'replay-r15');
    const bundle = await createPrivateReplayBundle({
      ...input, bundleDir, identity, window, runnerSha256,
      generatedAt: '2026-07-08T02:00:00.000Z',
    });
    const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    const otherPath = path.join(input.ownerRoot, 'wrong-private-key.pem');
    await writeFile(otherPath, other, { mode: 0o600 });
    await expect(createPmReplayAttestation({
      bundleManifestPath: bundle.path,
      outputPath: path.join(bundleDir, 'PM-REPLAY-ATTESTATION.json'),
      replayedAt: '2026-07-08T03:00:00.000Z',
      sourcePaths: input.replaySourcePaths,
      embeddingBaseUrl: 'http://127.0.0.1:11434', embeddingModel: input.rag.model,
      fetchImpl: embeddingFetch(input), timeoutMs: 100,
      runnerId: input.pmRunner.runnerId, privateKeyPath: otherPath, candidateRoot: input.candidateRoot,
    })).rejects.toThrow(/runner|public key|anchor|fingerprint/i);
  });

  it('fails closed on tamper, unknown fields, duplicate refs, absolute refs and private path/body fields', async () => {
    const input = await fixture();
    const bundleDir = path.join(input.ownerRoot, 'replay-r15');
    const bundle = await createPrivateReplayBundle({
      ...input, bundleDir, identity, window, runnerSha256,
      generatedAt: '2026-07-08T02:00:00.000Z',
    });
    const manifest = JSON.parse(await readFile(bundle.path, 'utf8'));
    const refs = await Promise.all(Object.values(manifest.extracts).map(async (ref: any) => ({
      ...ref,
      document: ref.path.endsWith('.jsonl')
        ? (await readFile(path.join(bundleDir, ref.path), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
        : JSON.parse(await readFile(path.join(bundleDir, ref.path), 'utf8')),
    })));
    const valid = validatePrivateReplayEvidenceSet({ manifest, refs });
    expect(valid.errors).toEqual([]);
    expect(validatePrivateReplayEvidenceSet({ manifest: { ...manifest, extra: true }, refs }).errors.length).toBeGreaterThan(0);
    expect(validatePrivateReplayEvidenceSet({ manifest, refs: [...refs, refs[0]] }).errors.length).toBeGreaterThan(0);
    const absolute = structuredClone(manifest);
    absolute.extracts.telemetry.path = '/tmp/events.jsonl';
    expect(validatePrivateReplayEvidenceSet({ manifest: absolute, refs }).errors.length).toBeGreaterThan(0);
    const privateFieldRefs = structuredClone(refs);
    privateFieldRefs.find((ref: any) => ref.path.includes('ns2')).document.rows[0].notePath = 'private/note.md';
    expect(validatePrivateReplayEvidenceSet({ manifest, refs: privateFieldRefs }).errors.length).toBeGreaterThan(0);
    await writeFile(input.replaySourcePaths.kg, 'changed-source');
    await expect(createPmReplayAttestation({
      bundleManifestPath: bundle.path,
      outputPath: path.join(bundleDir, 'PM-REPLAY-ATTESTATION.json'),
      replayedAt: '2026-07-08T03:00:00.000Z',
      sourcePaths: input.replaySourcePaths,
      embeddingBaseUrl: 'http://127.0.0.1:11434', embeddingModel: input.rag.model,
      fetchImpl: embeddingFetch(input), timeoutMs: 100,
      runnerId: input.pmRunner.runnerId, privateKeyPath: input.privateKeyPath, candidateRoot: input.candidateRoot,
    })).rejects.toThrow(/source SHA\/bytes mismatch/i);
    await writeFile(input.replaySourcePaths.kg, 'kg-source');
    await writeFile(path.join(bundleDir, manifest.extracts.kg.path), '{"tampered":true}\n');
    await expect(createPmReplayAttestation({
      bundleManifestPath: bundle.path,
      outputPath: path.join(bundleDir, 'PM-REPLAY-ATTESTATION.json'),
      replayedAt: '2026-07-08T03:00:00.000Z',
      sourcePaths: input.replaySourcePaths,
      embeddingBaseUrl: 'http://127.0.0.1:11434', embeddingModel: input.rag.model,
      fetchImpl: embeddingFetch(input), timeoutMs: 100,
      runnerId: input.pmRunner.runnerId, privateKeyPath: input.privateKeyPath, candidateRoot: input.candidateRoot,
    })).rejects.toThrow(/hash|bytes|invalid/i);
  });

  it('detects any private replay file copied into candidate or artifact trees', async () => {
    const input = await fixture();
    await writeFile(path.join(input.candidateRoot, 'PRIVATE-REPLAY-BUNDLE.json'), '{}');
    await expect(assertPrivateReplayAbsent(input.candidateRoot)).rejects.toThrow(/private replay/i);
    const appRoot = existsSync(path.join(process.cwd(), 'apps/copilot-desktop'))
      ? path.join(process.cwd(), 'apps/copilot-desktop') : process.cwd();
    const [builder, finalizer] = await Promise.all([
      readFile(path.join(appRoot, 'scripts/build-canonical-release.mjs'), 'utf8'),
      readFile(path.join(appRoot, 'scripts/finalize-canonical-release.mjs'), 'utf8'),
    ]);
    expect(builder).toContain('BLOCKED_PRIVATE_REPLAY_LEAK');
    expect(finalizer).toContain('BLOCKED_PRIVATE_REPLAY_LEAK');
  });
});
