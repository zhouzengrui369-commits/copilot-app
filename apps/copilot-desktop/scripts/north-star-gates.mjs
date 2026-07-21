#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateReplayBundle } from './private-replay-evidence.mjs';
import { queryKbKgSources, queryRagSource, validateAndCollectTelemetrySource } from './north-star-source-validation.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const fs = require('node:fs');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TELEMETRY_BYTES = 16 * 1024 * 1024;
const MAX_QUESTION_SET_BYTES = 1024 * 1024;
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_SQLITE_BYTES = 512 * 1024 * 1024;
const MAX_EMBEDDING_RESPONSE_BYTES = 1024 * 1024;
const MAX_METRIC_COUNT = 1_000_000;
const ALLOWED_OPERATIONS = new Set([
  'notes.list', 'notes.get', 'notes.create', 'notes.update', 'notes.remove', 'notes.backlinks',
  'kg.view', 'kg.reindex', 'rag.ask', 'rag.stream',
  'todos.list', 'todos.create', 'todos.update', 'todos.remove', 'todos.due', 'todos.reminder-fired',
]);
const FORBIDDEN_KEY = /body|content|transcript|prompt|authorization|question|secret|credential|api.?key|payload|provider|(?:^|_)path(?:$|_)/i;
const SECRET_TEXT = /\bsk-[a-z0-9_-]{8,}\b|\bBearer\s+[a-z0-9._~+/=-]{8,}|\/Users\/|[A-Z]:\\Users\\|(?:api.?key|token|secret|password)\s*[:=]/i;

export function validateReleaseIdentity(value) {
  const errors = [];
  if (!plainObject(value)) return ['release identity must be an object'];
  if (value.schemaVersion !== 1) errors.push('release identity schemaVersion must equal 1');
  if (typeof value.candidate !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.candidate)) {
    errors.push('release identity candidate is invalid');
  }
  if (typeof value.sourceHead !== 'string' || !GIT_HEAD.test(value.sourceHead)) {
    errors.push('release identity sourceHead is invalid');
  }
  if (typeof value.sourceSnapshotSha256 !== 'string' || !SHA256.test(value.sourceSnapshotSha256)) {
    errors.push('release identity sourceSnapshotSha256 is invalid');
  }
  if (Object.keys(value).some((key) => !['schemaVersion', 'candidate', 'sourceHead', 'sourceSnapshotSha256'].includes(key))) {
    errors.push('release identity contains unknown fields');
  }
  return errors;
}

export function validateQuestionSet(value) {
  const errors = [];
  if (!plainObject(value)) return ['question set must be an object'];
  if (value.schemaVersion !== 1 || value.frozen !== true) errors.push('question set must be schemaVersion 1 and frozen');
  if (value.labelsAreHuman !== true || value.labelledBy !== 'NJX') {
    errors.push('human labels from NJX are required');
  }
  if (!validIso(value.frozenAt)) errors.push('question set frozenAt must be an ISO timestamp');
  if (!Array.isArray(value.questions) || value.questions.length !== 20) {
    errors.push('question set must contain exactly 20 questions');
    return errors;
  }
  const ids = new Set();
  const texts = new Set();
  for (const item of value.questions) {
    if (!plainObject(item)) {
      errors.push('question must be an object');
      continue;
    }
    if (Object.keys(item).some((key) => !['id', 'question', 'relevantSourcePaths'].includes(key))) {
      errors.push('question contains unknown fields');
    }
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.id)) {
      errors.push('question id is invalid');
    } else if (ids.has(item.id)) errors.push('question id must be unique');
    else ids.add(item.id);
    const normalizedText = typeof item.question === 'string' ? item.question.trim().normalize('NFC') : '';
    if (!normalizedText || normalizedText.length > 1000) errors.push('question text is invalid');
    else if (texts.has(normalizedText)) errors.push('question text must be unique');
    else texts.add(normalizedText);
    if (!Array.isArray(item.relevantSourcePaths) || item.relevantSourcePaths.length < 1 || item.relevantSourcePaths.length > 50) {
      errors.push('relevant source paths must contain 1..50 paths');
      continue;
    }
    const sources = new Set();
    for (const sourcePath of item.relevantSourcePaths) {
      if (!safeSourcePath(sourcePath)) errors.push('relevant source path is unsafe');
      else {
        const key = canonicalPathKey(sourcePath);
        if (sources.has(key)) errors.push('relevant source paths must be unique');
        sources.add(key);
      }
    }
  }
  return errors;
}

export function validateOwnerAcceptance(value, questionSetSha256) {
  const errors = [];
  if (!plainObject(value)) return ['owner acceptance must be an object'];
  if (!exactKeys(value, ['schemaVersion', 'reportType', 'acceptedBy', 'acceptedAt', 'questionSetSha256'])) {
    errors.push('owner acceptance contains unknown fields');
  }
  if (value.schemaVersion !== 1 || value.reportType !== 'north-star-owner-acceptance') {
    errors.push('owner acceptance schema/reportType mismatch');
  }
  if (value.acceptedBy !== 'NJX') errors.push('owner acceptance must be accepted by NJX');
  if (!validIso(value.acceptedAt)) errors.push('owner acceptance acceptedAt is invalid');
  if (!SHA256.test(String(value.questionSetSha256 ?? ''))) errors.push('owner acceptance question-set SHA is invalid');
  if (value.questionSetSha256 !== questionSetSha256) errors.push('owner acceptance question-set SHA mismatch');
  return errors;
}

export async function collectNorthStarMetrics(input) {
  const identityErrors = validateReleaseIdentity(input?.releaseIdentity);
  if (identityErrors.length > 0) throw new Error(`invalid release identity: ${identityErrors.join('; ')}`);
  const window = validateWindow(input?.window);
  const questionErrors = validateQuestionSet(input?.questionSet);
  if (questionErrors.length > 0) {
    return blockedForMissingLabels(questionErrors);
  }
  if (typeof input?.retrieve !== 'function') throw new Error('source-only retrieval function is required');

  const ns1Collected = await collectNs1({
    telemetryPath: input.telemetryPath,
    identity: input.releaseIdentity,
    window,
  });
  const ns2Collected = await collectNs2({
    kbDbPath: input.kbDbPath,
    kgDbPath: input.kgDbPath,
    window,
  });
  const ragInputErrors = validateInputEvidence(input?.ragInput, 'RAG');
  if (ragInputErrors.length > 0) throw new Error(ragInputErrors.join('; '));
  const { input: telemetryInput, replay: telemetryReplay, ...ns1 } = ns1Collected;
  const { input: sqliteInputs, replay: ns2Replay, ...ns2 } = ns2Collected;
  const ns3 = await collectNs3(input.questionSet, input.retrieve);
  await input.captureReplay?.({
    telemetryEvents: telemetryReplay,
    ns2Rows: ns2Replay.rows,
    kgNodes: ns2Replay.nodes,
  });
  return {
    status: ns1.status === 'PASS' && ns2.status === 'PASS' && ns3.status === 'PASS'
      ? 'PASS'
      : 'BLOCKED',
    inputs: {
      telemetry: telemetryInput,
      kb: sqliteInputs.kb,
      kg: sqliteInputs.kg,
      rag: normalizeInputEvidence(input.ragInput),
    },
    ns1,
    ns2,
    ns3,
  };
}

async function collectNs1({ telemetryPath, identity, window }) {
  const telemetrySnapshot = await readStableTelemetrySnapshot(telemetryPath);
  const bytes = telemetrySnapshot.bytes;
  const collected = validateAndCollectTelemetrySource({
    bytes,
    identity,
    window: { start: window.start, end: window.end },
  });
  return {
    status: collected.uniqueStartupSessions >= 10 && collected.operationEvents > 0 ? 'PASS' : 'BLOCKED',
    uniqueStartupSessions: collected.uniqueStartupSessions,
    operationEvents: collected.operationEvents,
    input: { sha256: telemetrySnapshot.sha256, bytes: bytes.length },
    replay: collected.events,
    thresholds: { uniqueStartupSessions: 10, operationEvents: 1 },
  };
}

function validateTelemetryEvent(event, identity, lineNumber) {
  if (!plainObject(event) || event.schemaVersion !== 2) {
    throw new Error(`telemetry line ${lineNumber} has an unsupported schema`);
  }
  if (!validIso(event.timestamp) || !UUID_V4.test(String(event.sessionId ?? ''))) {
    throw new Error(`telemetry line ${lineNumber} has an invalid timestamp or session`);
  }
  if (event.process !== 'main' && event.process !== 'renderer') {
    throw new Error(`telemetry line ${lineNumber} has an invalid process`);
  }
  if (validateReleaseIdentity(event.release).length > 0 || !sameIdentity(event.release, identity)) {
    throw new Error(`telemetry line ${lineNumber} release identity mismatch`);
  }
  assertNoForbiddenFields(event, `telemetry line ${lineNumber}`, new Set([
    'sourceHead', 'sourceSnapshotSha256', 'candidate', 'timestamp', 'sessionId', 'operation',
  ]));
  if (event.kind === 'operation') {
    const keys = Object.keys(event).sort();
    const expected = ['kind', 'operation', 'process', 'release', 'schemaVersion', 'sessionId', 'timestamp'];
    if (JSON.stringify(keys) !== JSON.stringify(expected) || !ALLOWED_OPERATIONS.has(event.operation)) {
      throw new Error(`telemetry line ${lineNumber} has an invalid operation event`);
    }
  } else {
    if (!['startup', 'crash', 'offline', 'renderer-gone', 'renderer-unresponsive'].includes(event.kind)) {
      throw new Error(`telemetry line ${lineNumber} has an invalid kind`);
    }
    const keys = Object.keys(event).sort();
    const expected = ['detail', 'kind', 'process', 'release', 'schemaVersion', 'sessionId', 'timestamp'];
    if (JSON.stringify(keys) !== JSON.stringify(expected) || !validTelemetryDetail(event.detail)) {
      throw new Error(`telemetry line ${lineNumber} has an invalid ${event.kind} event schema`);
    }
  }
}

function validTelemetryDetail(value) {
  if (!plainObject(value)) return false;
  return Object.entries(value).every(([key, child]) => (
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
    && (child === null
      || typeof child === 'boolean'
      || (typeof child === 'number' && Number.isFinite(child))
      || (typeof child === 'string' && child.length <= 500))
  ));
}

async function collectNs2({ kbDbPath, kgDbPath, window }) {
  let kbSnapshot;
  let kgSnapshot;
  try {
    kbSnapshot = await snapshotSqliteDatabase(kbDbPath, 'KB');
    kgSnapshot = await snapshotSqliteDatabase(kgDbPath, 'KG');
    const collected = await queryKbKgSources({
      kbBytes: await readFile(kbSnapshot.path),
      kgBytes: await readFile(kgSnapshot.path),
      window: { start: window.start, end: window.end },
    });
    const publicNotesCreated = collected.ns2Rows.filter((row) => !row.isSystemTodo).length;
    const kgNodeCount = collected.kgNodes.length;
    return {
      status: publicNotesCreated >= 30 && kgNodeCount >= 50 ? 'PASS' : 'BLOCKED',
      publicNotesCreated,
      kgNodeCount,
      thresholds: { publicNotesCreated: 30, kgNodeCount: 50 },
      input: {
        kb: { sha256: kbSnapshot.sha256, bytes: kbSnapshot.bytes },
        kg: { sha256: kgSnapshot.sha256, bytes: kgSnapshot.bytes },
      },
      replay: {
        rows: collected.ns2Rows,
        nodes: collected.kgNodes,
      },
    };
  } finally {
    await kgSnapshot?.cleanup().catch(() => {});
    await kbSnapshot?.cleanup().catch(() => {});
  }
}

export async function snapshotSqliteDatabase(dbPath, label, hooks = {}) {
  if (typeof dbPath !== 'string' || !path.isAbsolute(dbPath)) {
    throw new Error(`${label} SQLite path must be absolute`);
  }
  await assertNoSqliteSidecars(dbPath, label);
  probeSqliteQuiescent(dbPath, label);
  const symbolic = await lstat(dbPath, { bigint: true }).catch(() => null);
  if (!symbolic?.isFile() || symbolic.isSymbolicLink()) {
    throw new Error(`${label} SQLite is unavailable or unsafe`);
  }

  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  const privateRoot = await mkdtemp(path.join(os.tmpdir(), 'copilot-north-star-sqlite-'));
  await fs.promises.chmod(privateRoot, 0o700);
  const snapshotPath = path.join(privateRoot, `${label.toLowerCase()}.sqlite`);
  let source;
  let destination;
  try {
    source = await open(dbPath, fsConstants.O_RDONLY | noFollow);
    const initial = await source.stat({ bigint: true });
    if (!initial.isFile() || initial.size < 0n || initial.size > BigInt(MAX_SQLITE_BYTES)) {
      throw new Error(`${label} SQLite is unavailable or exceeds size limit`);
    }
    destination = await open(
      snapshotPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    const firstHash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < Number(initial.size)) {
      const bytesToRead = Math.min(buffer.length, Number(initial.size) - position);
      const { bytesRead } = await source.read(buffer, 0, bytesToRead, position);
      if (bytesRead === 0) throw new Error(`${label} SQLite changed while copying`);
      const chunk = buffer.subarray(0, bytesRead);
      firstHash.update(chunk);
      await writeFully(destination, chunk, position);
      position += bytesRead;
    }
    await destination.sync();
    await destination.close();
    destination = null;
    await fs.promises.chmod(snapshotPath, 0o400);

    await hooks.afterCopy?.();

    const finalHandle = await source.stat({ bigint: true });
    const finalPath = await lstat(dbPath, { bigint: true }).catch(() => null);
    if (!finalPath || finalPath.isSymbolicLink() || !sameStableFile(initial, finalHandle, finalPath)) {
      throw new Error(`${label} SQLite changed inode or metadata while copying`);
    }

    const secondHash = createHash('sha256');
    position = 0;
    while (position < Number(initial.size)) {
      const bytesToRead = Math.min(buffer.length, Number(initial.size) - position);
      const { bytesRead } = await source.read(buffer, 0, bytesToRead, position);
      if (bytesRead === 0) throw new Error(`${label} SQLite changed while rehashing`);
      secondHash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const firstSha256 = firstHash.digest('hex');
    const secondSha256 = secondHash.digest('hex');
    const afterHashHandle = await source.stat({ bigint: true });
    const afterHashPath = await lstat(dbPath, { bigint: true }).catch(() => null);
    if (!afterHashPath || afterHashPath.isSymbolicLink()
      || !sameStableFile(initial, afterHashHandle, afterHashPath)) {
      throw new Error(`${label} SQLite changed inode or metadata while rehashing`);
    }
    const snapshotBytes = await boundedRead(snapshotPath, MAX_SQLITE_BYTES, `${label} SQLite snapshot`);
    const snapshotSha256 = sha256(snapshotBytes);
    if (firstSha256 !== secondSha256 || firstSha256 !== snapshotSha256) {
      throw new Error(`${label} SQLite changed hash while copying`);
    }
    await assertNoSqliteSidecars(dbPath, label);
    probeSqliteQuiescent(dbPath, label);
    return {
      path: snapshotPath,
      bytes: Number(initial.size),
      sha256: snapshotSha256,
      cleanup: () => removePrivateSnapshot(privateRoot, snapshotPath),
    };
  } catch (error) {
    await destination?.close().catch(() => {});
    destination = null;
    await source?.close().catch(() => {});
    source = null;
    await removePrivateSnapshot(privateRoot, snapshotPath);
    throw error;
  } finally {
    await destination?.close().catch(() => {});
    await source?.close().catch(() => {});
  }
}

async function removePrivateSnapshot(root, snapshotPath) {
  await fs.promises.chmod(snapshotPath, 0o600).catch(() => {});
  await rm(root, { recursive: true, force: true });
}

async function writeFully(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (bytesWritten <= 0) throw new Error('SQLite snapshot write made no progress');
    offset += bytesWritten;
  }
}

function sameStableFile(initial, finalHandle, finalPath) {
  return initial.dev === finalHandle.dev
    && initial.ino === finalHandle.ino
    && initial.size === finalHandle.size
    && initial.mtimeNs === finalHandle.mtimeNs
    && initial.ctimeNs === finalHandle.ctimeNs
    && initial.dev === finalPath.dev
    && initial.ino === finalPath.ino
    && initial.size === finalPath.size
    && initial.mtimeNs === finalPath.mtimeNs
    && initial.ctimeNs === finalPath.ctimeNs;
}

async function assertNoSqliteSidecars(dbPath, label) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const info = await lstat(`${dbPath}${suffix}`).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (info) throw new Error(`${label} SQLite WAL/busy sidecar is present`);
  }
}

function probeSqliteQuiescent(dbPath, label) {
  let probe;
  try {
    probe = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 0 });
    probe.pragma('query_only = ON');
    probe.pragma('schema_version', { simple: true });
  } catch {
    throw new Error(`${label} SQLite is busy or unavailable`);
  } finally {
    try { probe?.close(); } catch {}
  }
}

function openReadOnlyDatabase(dbPath, label) {
  if (typeof dbPath !== 'string' || !path.isAbsolute(dbPath)) {
    throw new Error(`${label} SQLite path must be absolute`);
  }
  try {
    const info = fs.lstatSync(dbPath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('unsafe');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    return db;
  } catch {
    throw new Error(`${label} SQLite is unavailable in read-only mode`);
  }
}

function assertSqliteSchema(db, label, metaTable, dataTable, requiredColumns) {
  try {
    const meta = db.prepare(`SELECT v FROM ${metaTable} WHERE k='version'`).get();
    if (String(meta?.v) !== '0') throw new Error('version');
    const columns = new Set(db.prepare(`PRAGMA table_info(${dataTable})`).all().map((row) => row.name));
    if (requiredColumns.some((column) => !columns.has(column))) throw new Error('columns');
  } catch {
    throw new Error(`${label} SQLite schema/version mismatch`);
  }
}

async function collectNs3(questionSet, retrieve) {
  const results = [];
  let recallTotal = 0;
  let hitTotal = 0;
  for (const question of questionSet.questions) {
    const raw = await retrieve(question.question, question.id, 3);
    if (!Array.isArray(raw)) throw new Error('retrieval output must be an array');
    const seen = new Set();
    const retrieved = [];
    for (const sourcePath of raw) {
      if (!safeSourcePath(sourcePath)) throw new Error('retrieval output contains an unsafe source path');
      const key = canonicalPathKey(sourcePath);
      if (seen.has(key)) continue;
      seen.add(key);
      if (retrieved.length < 3) retrieved.push(sourcePath);
    }
    const relevant = new Set(question.relevantSourcePaths.map(canonicalPathKey));
    const matched = retrieved.filter((sourcePath) => relevant.has(canonicalPathKey(sourcePath))).length;
    const recall = matched / relevant.size;
    const hit = matched > 0 ? 1 : 0;
    recallTotal += recall;
    hitTotal += hit;
    results.push({
      id: question.id,
      relevantCount: relevant.size,
      retrievedCount: retrieved.length,
      matchedCount: matched,
      recallAt3: recall,
      hitAt3: hit,
    });
  }
  const macroRecallAt3 = recallTotal / 20;
  const hitAt3 = hitTotal / 20;
  return {
    status: macroRecallAt3 >= 0.8 ? 'PASS' : 'BLOCKED',
    questionCount: 20,
    macroRecallAt3,
    hitAt3,
    topK: 3,
    sourceOnly: true,
    generationLlmUsed: false,
    results,
    thresholds: { macroRecallAt3: 0.8 },
  };
}

function blockedForMissingLabels(errors) {
  return {
    status: 'BLOCKED',
    ns1: { status: 'BLOCKED', uniqueStartupSessions: 0, operationEvents: 0 },
    ns2: { status: 'BLOCKED', publicNotesCreated: 0, kgNodeCount: 0 },
    ns3: { status: 'BLOCKED', questionCount: 0, macroRecallAt3: null, hitAt3: null, errors },
  };
}

export function buildNorthStarReport(input) {
  const errors = validateReleaseIdentity(input?.releaseIdentity);
  if (errors.length > 0) throw new Error(`invalid north-star report identity: ${errors.join('; ')}`);
  const artifacts = normalizeArtifactMap(input?.artifacts);
  const window = validateWindow(input?.window);
  if (!SHA256.test(String(input?.questionSetSha256 ?? '')) || !SHA256.test(String(input?.runnerSha256 ?? ''))) {
    throw new Error('invalid north-star report question-set or runner SHA256');
  }
  if (!plainObject(input?.metrics) || !['PASS', 'BLOCKED'].includes(input.metrics.status)) {
    throw new Error('invalid north-star report metrics');
  }
  const metricErrors = validateMetrics(input.metrics);
  if (metricErrors.length > 0) throw new Error(`invalid north-star report metrics: ${metricErrors.join('; ')}`);
  const ownerErrors = validateOwnerAcceptanceReference(input?.ownerAcceptance, input.questionSetSha256);
  if (ownerErrors.length > 0) throw new Error(`invalid north-star owner acceptance: ${ownerErrors.join('; ')}`);
  assertNoForbiddenFields(input.metrics, 'north-star report metrics', new Set(['questionCount']));
  const report = {
    schemaVersion: 1,
    reportType: 'north-star',
    status: input.metrics.status,
    candidate: input.releaseIdentity.candidate,
    source: {
      head: input.releaseIdentity.sourceHead,
      snapshotSha256: input.releaseIdentity.sourceSnapshotSha256,
    },
    artifacts,
    window: { start: window.start, end: window.end },
    questionSetSha256: input.questionSetSha256.toLowerCase(),
    runnerSha256: input.runnerSha256.toLowerCase(),
    ownerAcceptance: normalizeOwnerAcceptanceReference(input.ownerAcceptance),
    metrics: input.metrics,
  };
  const bytes = Buffer.byteLength(`${canonicalJson(report)}\n`);
  if (bytes > MAX_REPORT_BYTES) throw new Error('invalid north-star report: report exceeds size limit');
  return report;
}

export function validateNorthStarEvidenceReport(report, binding) {
  const errors = [];
  if (!plainObject(report) || report.schemaVersion !== 1 || report.reportType !== 'north-star') {
    return ['north-star evidence schema/reportType mismatch'];
  }
  errors.push(...validateReportUnknownFields(report));
  const identityErrors = validateReleaseIdentity(binding?.releaseIdentity);
  if (identityErrors.length > 0) return identityErrors;
  if (report.candidate !== binding.releaseIdentity.candidate) errors.push('north-star candidate mismatch');
  if (report.source?.head !== binding.releaseIdentity.sourceHead) errors.push('north-star source HEAD mismatch');
  if (report.source?.snapshotSha256 !== binding.releaseIdentity.sourceSnapshotSha256) errors.push('north-star snapshot mismatch');
  let expectedArtifacts;
  let actualArtifacts;
  try {
    expectedArtifacts = normalizeArtifactMap(binding.artifacts);
    actualArtifacts = normalizeArtifactMap(report.artifacts);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'north-star artifact map invalid');
  }
  if (expectedArtifacts && actualArtifacts && canonicalJson(expectedArtifacts) !== canonicalJson(actualArtifacts)) {
    errors.push('north-star artifact map mismatch');
  }
  if (binding.questionSetSha256 && report.questionSetSha256 !== binding.questionSetSha256) {
    errors.push('north-star question-set SHA mismatch');
  }
  if (binding.runnerSha256 && report.runnerSha256 !== binding.runnerSha256) {
    errors.push('north-star runner SHA mismatch');
  }
  const ownerErrors = validateOwnerAcceptanceReference(report.ownerAcceptance, report.questionSetSha256);
  if (ownerErrors.length > 0
    || report.ownerAcceptance?.acceptedBy !== 'NJX'
    || (binding.ownerAcceptanceSha256
      && report.ownerAcceptance?.sha256 !== binding.ownerAcceptanceSha256)) {
    errors.push('north-star owner acceptance is invalid');
  }
  if (!SHA256.test(String(report.questionSetSha256 ?? '')) || !SHA256.test(String(report.runnerSha256 ?? ''))) {
    errors.push('north-star question-set/runner SHA is invalid');
  }
  try { validateWindow(report.window); } catch {
    errors.push('north-star report window must be exactly seven days');
  }
  if (report.status !== 'PASS' || report.metrics?.status !== 'PASS') errors.push('north-star status must equal PASS');
  errors.push(...validateMetrics(report.metrics));
  if (
    report.metrics?.ns1?.status !== 'PASS'
    || report.metrics.ns1.uniqueStartupSessions < 10
    || report.metrics.ns1.operationEvents < 1
  ) errors.push('north-star NS1 threshold is not proven');
  if (
    report.metrics?.ns2?.status !== 'PASS'
    || report.metrics.ns2.publicNotesCreated < 30
    || report.metrics.ns2.kgNodeCount < 50
  ) errors.push('north-star NS2 threshold is not proven');
  if (
    report.metrics?.ns3?.status !== 'PASS'
    || report.metrics.ns3.questionCount !== 20
    || report.metrics.ns3.macroRecallAt3 < 0.8
    || report.metrics.ns3.topK !== 3
    || report.metrics.ns3.sourceOnly !== true
    || report.metrics.ns3.generationLlmUsed !== false
  ) errors.push('north-star NS3 threshold is not proven');
  const results = report.metrics?.ns3?.results;
  if (!Array.isArray(results) || results.length !== 20) {
    errors.push('north-star NS3 must contain exactly 20 redacted result rows');
  } else {
    const ids = new Set();
    let recallTotal = 0;
    let hitTotal = 0;
    for (const result of results) {
      const valid = plainObject(result)
        && exactKeys(result, ['id', 'relevantCount', 'retrievedCount', 'matchedCount', 'recallAt3', 'hitAt3'])
        && typeof result.id === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(result.id)
        && !ids.has(result.id)
        && Number.isSafeInteger(result.relevantCount) && result.relevantCount > 0
        && Number.isSafeInteger(result.retrievedCount) && result.retrievedCount >= 0 && result.retrievedCount <= 3
        && Number.isSafeInteger(result.matchedCount) && result.matchedCount >= 0
        && result.matchedCount <= result.relevantCount && result.matchedCount <= result.retrievedCount
        && finiteUnit(result.recallAt3)
        && (result.hitAt3 === 0 || result.hitAt3 === 1)
        && closeEnough(result.recallAt3, result.matchedCount / result.relevantCount)
        && result.hitAt3 === (result.matchedCount > 0 ? 1 : 0);
      if (!valid) {
        errors.push('north-star NS3 result row is invalid or duplicated');
        break;
      }
      ids.add(result.id);
      recallTotal += result.recallAt3;
      hitTotal += result.hitAt3;
    }
    if (
      ids.size === 20
      && (!closeEnough(report.metrics.ns3.macroRecallAt3, recallTotal / 20)
        || !closeEnough(report.metrics.ns3.hitAt3, hitTotal / 20))
    ) errors.push('north-star NS3 aggregate metrics do not match result rows');
  }
  try { assertNoForbiddenFields(report, 'north-star evidence', new Set([
    'questionCount', 'questionSetSha256', 'sourceHead', 'sourceSnapshotSha256',
  ])); } catch (error) {
    errors.push(error instanceof Error ? error.message : 'north-star evidence privacy violation');
  }
  return errors;
}

export async function publishNorthStarReport(target, report) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('north-star report output path must be absolute');
  const requestedTarget = target;
  const requestedParent = path.dirname(requestedTarget);
  await mkdir(requestedParent, { recursive: true, mode: 0o700 });
  const parent = await realpath(requestedParent);
  target = path.join(parent, path.basename(requestedTarget));
  const text = `${canonicalJson(report)}\n`;
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) throw new Error('north-star report exceeds size limit');
  const temporary = path.join(parent, `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await link(temporary, target);
    const directory = await open(parent, fsConstants.O_RDONLY);
    try { await directory.sync(); } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(String(error?.code ?? ''))) throw error;
    } finally { await directory.close(); }
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('north-star report exists; overwrite is forbidden');
    throw error;
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
  const bytes = await boundedRead(target, MAX_REPORT_BYTES, 'north-star report');
  return { path: requestedTarget, bytes: bytes.length, sha256: sha256(bytes) };
}

export async function createLocalSourceOnlyRetriever({
  ragSnapshot,
  embeddingBaseUrl = 'http://127.0.0.1:11434',
  model = 'bge-m3:latest',
  fetchImpl = globalThis.fetch,
}) {
  const snapshotErrors = validateInputEvidence(ragSnapshot, 'RAG');
  if (snapshotErrors.length > 0 || typeof ragSnapshot?.path !== 'string') {
    throw new Error(`RAG stable snapshot is invalid: ${snapshotErrors.join('; ')}`);
  }
  const bytes = await boundedRead(ragSnapshot.path, MAX_SQLITE_BYTES, 'RAG SQLite snapshot');
  if (bytes.length !== ragSnapshot.bytes || sha256(bytes) !== ragSnapshot.sha256) {
    throw new Error('RAG SQLite snapshot SHA/bytes mismatch');
  }
  const index = await queryRagSource({ ragBytes: bytes, embeddingModel: model });
  const chunks = index.chunks;
  const capturedQueries = new Map();
  const retrieve = async (question, questionId, topK) => {
    const query = await fetchLocalEmbedding({
      endpoint: embeddingBaseUrl,
      model,
      question,
      fetchImpl,
      timeoutMs: 15_000,
    });
    validateVector(query, index.dimensions, 'RAG query vector');
    if (capturedQueries.has(questionId)) throw new Error('RAG replay question was embedded more than once');
    capturedQueries.set(questionId, [...query]);
    const bestByNote = new Map();
    for (const chunk of chunks) {
      if (chunk.embedding.length !== query.length) throw new Error('RAG embedding dimension mismatch');
      const score = cosine(query, chunk.embedding);
      if (!bestByNote.has(chunk.notePath) || score > bestByNote.get(chunk.notePath)) bestByNote.set(chunk.notePath, score);
    }
    return [...bestByNote.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, topK)
      .map(([notePath]) => notePath);
  };
  retrieve.privateReplayData = (questionSet) => ({
    model,
    chunks: chunks.map((chunk) => ({ sourceId: chunk.notePath, embedding: [...chunk.embedding] })),
    questions: questionSet.questions.map((question) => {
      const queryEmbedding = capturedQueries.get(question.id);
      if (!queryEmbedding) throw new Error(`RAG replay query embedding is missing for ${question.id}`);
      return {
        questionId: question.id,
        queryEmbedding,
        relevantSourceIds: [...question.relevantSourcePaths],
      };
    }),
  });
  return retrieve;
}

export function validateRagIndexRows({ metaModel, queryModel, rows }) {
  if (typeof metaModel !== 'string' || !metaModel || metaModel !== queryModel) {
    throw new Error('RAG embedding model mismatch between metadata and query');
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('RAG index contains no chunks');
  let dimensions = null;
  for (const row of rows) {
    if (!plainObject(row) || row.model !== metaModel || !safeSourcePath(row.notePath)) {
      throw new Error('RAG chunk model or note path is invalid');
    }
    if (!(row.embedding instanceof Float32Array)) throw new Error('RAG chunk vector is invalid');
    dimensions ??= row.embedding.length;
    validateVector(row.embedding, dimensions, 'RAG chunk vector');
  }
  return { dimensions, model: metaModel };
}

export async function fetchLocalEmbedding({ endpoint, model, question, fetchImpl, timeoutMs }) {
  const base = validateEmbeddingEndpoint(endpoint);
  if (typeof model !== 'string' || !model || typeof question !== 'string' || !question) {
    throw new Error('embedding request is invalid');
  }
  if (typeof fetchImpl !== 'function') throw new Error('local embedding provider is unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('embedding timeout is invalid');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('embedding timeout')), timeoutMs);
  try {
    const response = await fetchImpl(new URL('/api/embeddings', base).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: question }),
      signal: controller.signal,
      redirect: 'error',
    });
    throwIfEmbeddingAborted(controller.signal);
    if (!response?.ok) throw new Error('local embedding provider is unavailable');
    let responseUrl;
    try { responseUrl = new URL(response.url); } catch { throw new Error('embedding response origin is invalid'); }
    if (responseUrl.origin !== base.origin) throw new Error('embedding response origin mismatch');
    const bytes = await readBoundedResponse(response, MAX_EMBEDDING_RESPONSE_BYTES, controller.signal);
    throwIfEmbeddingAborted(controller.signal);
    let json;
    try { json = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('embedding response contains invalid JSON'); }
    throwIfEmbeddingAborted(controller.signal);
    if (!plainObject(json) || !Array.isArray(json.embedding)) throw new Error('embedding response is invalid');
    const embedding = Float32Array.from(json.embedding);
    validateVector(embedding, null, 'RAG query vector');
    throwIfEmbeddingAborted(controller.signal);
    return embedding;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('embedding timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validateEmbeddingEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new Error('embedding endpoint is invalid'); }
  if (endpoint.protocol !== 'http:'
    || !['127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('embedding endpoint must be plain HTTP loopback without credentials/query/fragment');
  }
  return endpoint;
}

async function readBoundedResponse(response, maximum, signal) {
  const declared = response.headers?.get?.('content-length');
  if (declared !== null && declared !== undefined) {
    if (!/^\d+$/.test(declared) || Number(declared) > maximum) {
      throw new Error('embedding response size is too large');
    }
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new Error('embedding response body is unavailable');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readEmbeddingChunk(reader, signal);
      if (done) break;
      if (!isUint8Array(value)) throw new Error('embedding response chunk is invalid');
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      total += chunk.byteLength;
      if (total > maximum) throw new Error('embedding response size is too large');
      chunks.push(chunk);
    }
  } finally {
    try {
      Promise.resolve(reader.cancel()).catch(() => {});
    } catch {
      // Cancellation is best-effort after the abort has already failed the gate closed.
    }
  }
  return Buffer.concat(chunks, total);
}

function throwIfEmbeddingAborted(signal) {
  if (signal.aborted) throw new Error('embedding timeout');
}

async function readEmbeddingChunk(reader, signal) {
  throwIfEmbeddingAborted(signal);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error('embedding timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function isUint8Array(value) {
  return ArrayBuffer.isView(value)
    && value?.constructor?.BYTES_PER_ELEMENT === 1
    && typeof value.byteLength === 'number';
}

function validateVector(vector, expectedDimensions, label) {
  if (!(vector instanceof Float32Array) || vector.length === 0) throw new Error(`${label} is empty or invalid`);
  if (expectedDimensions !== null && vector.length !== expectedDimensions) throw new Error(`${label} dimension mismatch`);
  let norm = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error(`${label} contains non-finite values`);
    norm += value * value;
  }
  if (!Number.isFinite(norm) || norm <= 0) throw new Error(`${label} has zero or non-finite norm`);
  return norm;
}

async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(args);
    await executeNorthStar(options);
  } catch (error) {
    const classified = classifyNorthStarFailure(error);
    if (!classified) throw error;
    const output = options?.output ?? outputArgument(args);
    if (!output) throw error;
    const report = classifiedBlockedReport(classified, options);
    const published = await publishNorthStarReport(output, report);
    process.stdout.write(`${JSON.stringify({
      status: 'BLOCKED',
      blocker: classified.code,
      report: { bytes: published.bytes, sha256: published.sha256 },
    })}\n`);
    process.exitCode = 2;
  }
}

async function executeNorthStar(options) {
  const [manifestBytes, identityBytes, questionBytes, ownerBytes, pmRunnerBytes] = await Promise.all([
    boundedRead(options.manifest, MAX_REPORT_BYTES, 'canonical manifest'),
    boundedRead(options.releaseIdentity, 4096, 'release identity'),
    boundedRead(options.questionSet, MAX_QUESTION_SET_BYTES, 'question set'),
    boundedRead(options.ownerAcceptance, MAX_QUESTION_SET_BYTES, 'owner acceptance'),
    boundedRead(options.pmRunnerConfig, 64 * 1024, 'PM runner config'),
  ]);
  const manifest = parseJson(manifestBytes, 'canonical manifest');
  const releaseIdentity = parseJson(identityBytes, 'release identity');
  const questionSet = parseJson(questionBytes, 'question set');
  const ownerAcceptance = parseJson(ownerBytes, 'owner acceptance');
  const pmRunner = parseJson(pmRunnerBytes, 'PM runner config');
  const questionSetSha256 = sha256(questionBytes);
  const ownerErrors = validateOwnerAcceptance(ownerAcceptance, questionSetSha256);
  if (ownerErrors.length > 0) throw new Error(`owner acceptance evidence is invalid: ${ownerErrors.join('; ')}`);
  const expectedIdentity = {
    schemaVersion: 1,
    candidate: manifest.candidate,
    sourceHead: manifest.source?.head,
    sourceSnapshotSha256: manifest.source?.snapshot?.sha256,
  };
  if (!sameIdentity(releaseIdentity, expectedIdentity)) throw new Error('release identity does not bind canonical manifest');
  const artifacts = artifactMapFromManifest(manifest.artifacts);
  const questionErrors = validateQuestionSet(questionSet);
  const ragSnapshot = await snapshotSqliteDatabase(options.ragDb, 'RAG');
  let retrieverPromise;
  let replayCapture;
  try {
    const retrieve = questionErrors.length > 0
      ? async () => []
      : async (...args) => {
        retrieverPromise ??= createLocalSourceOnlyRetriever({
          ragSnapshot,
          embeddingBaseUrl: options.embeddingBaseUrl,
          model: options.embeddingModel,
        });
        const retriever = await retrieverPromise;
        return retriever(...args);
      };
    const metrics = await collectNorthStarMetrics({
      releaseIdentity,
      telemetryPath: options.telemetry,
      kbDbPath: options.kbDb,
      kgDbPath: options.kgDb,
      ragInput: { sha256: ragSnapshot.sha256, bytes: ragSnapshot.bytes },
      window: { start: options.windowStart, end: options.windowEnd },
      questionSet,
      retrieve,
      captureReplay: (value) => { replayCapture = value; },
    });
    const runnerSha256 = sha256(await readFile(SCRIPT_PATH));
    const replayRetriever = await retrieverPromise;
    if (!replayCapture || typeof replayRetriever?.privateReplayData !== 'function') {
      throw new Error('private replay evidence capture is unavailable');
    }
    const replayBundle = await createPrivateReplayBundle({
      bundleDir: options.privateReplayDir,
      ownerRoot: path.dirname(options.privateReplayDir),
      candidateRoot: path.dirname(options.manifest),
      identity: releaseIdentity,
      window: { start: options.windowStart, end: options.windowEnd },
      runnerSha256,
      generatedAt: new Date().toISOString(),
      pmRunner,
      sourceInputs: {
        telemetry: { path: options.telemetry, ...metrics.inputs.telemetry },
        kb: { path: options.kbDb, ...metrics.inputs.kb },
        kg: { path: options.kgDb, ...metrics.inputs.kg },
        rag: { path: options.ragDb, ...metrics.inputs.rag },
      },
      questionSetPath: options.questionSet,
      ownerAcceptancePath: options.ownerAcceptance,
      telemetryEvents: replayCapture.telemetryEvents,
      ns2Rows: replayCapture.ns2Rows,
      kgNodes: replayCapture.kgNodes,
      rag: replayRetriever.privateReplayData(questionSet),
    });
    const report = buildNorthStarReport({
      releaseIdentity,
      artifacts,
      window: { start: options.windowStart, end: options.windowEnd },
      questionSetSha256,
      runnerSha256,
      ownerAcceptance: {
        sha256: sha256(ownerBytes),
        bytes: ownerBytes.length,
        acceptedBy: 'NJX',
        questionSetSha256,
      },
      metrics,
    });
    const published = await publishNorthStarReport(options.output, report);
    process.stdout.write(`${JSON.stringify({
      status: report.status,
      report: { bytes: published.bytes, sha256: published.sha256 },
      privateReplayBundle: {
        path: replayBundle.path,
        bytes: replayBundle.bytes,
        sha256: replayBundle.sha256,
      },
    })}\n`);
    if (report.status !== 'PASS') process.exitCode = 2;
  } finally {
    await ragSnapshot.cleanup();
  }
}

export function classifyNorthStarFailure(error) {
  if (!(error instanceof Error)) return null;
  const message = error.message;
  if (/SQLite (?:WAL\/busy|is busy)|busy sidecar/i.test(message)) {
    return { code: 'BLOCKED_NORTH_STAR_BUSY' };
  }
  if (/SQLite (?:schema|chunks schema)|schema\/version mismatch/i.test(message)) {
    return { code: 'BLOCKED_NORTH_STAR_SCHEMA' };
  }
  if (/SQLite .*?(?:must be|node count is invalid|created_at)/i.test(message)) {
    return { code: 'BLOCKED_NORTH_STAR_SCHEMA' };
  }
  if (/release identity|candidate mismatch|source HEAD mismatch|snapshot mismatch/i.test(message)) {
    return { code: 'BLOCKED_NORTH_STAR_IDENTITY' };
  }
  if (/unavailable|missing required argument|no artifacts|exceeds size limit/i.test(message)) {
    return { code: 'BLOCKED_NORTH_STAR_INPUT_MISSING' };
  }
  if (/telemetry|question set|owner acceptance|retrieval|seven-day|invalid JSON|changed (?:while|inode|hash)|unsafe source path|artifact map|\bembedding\b|\bRAG\b|unknown argument/i.test(message)) {
    return { code: 'BLOCKED_NORTH_STAR_EVIDENCE' };
  }
  return null;
}

function classifiedBlockedReport(classified, options) {
  const safeWindow = options && validIso(options.windowStart) && validIso(options.windowEnd)
    ? { start: options.windowStart, end: options.windowEnd }
    : { start: null, end: null };
  return {
    schemaVersion: 1,
    reportType: 'north-star',
    status: 'BLOCKED',
    candidate: null,
    source: { head: null, snapshotSha256: null },
    artifacts: {},
    window: safeWindow,
    questionSetSha256: null,
    runnerSha256: sha256(fs.readFileSync(SCRIPT_PATH)),
    metrics: {
      status: 'BLOCKED',
      ns1: { status: 'BLOCKED', uniqueStartupSessions: 0, operationEvents: 0 },
      ns2: { status: 'BLOCKED', publicNotesCreated: 0, kgNodeCount: 0 },
      ns3: { status: 'BLOCKED', questionCount: 0, macroRecallAt3: null, hitAt3: null },
    },
    blockers: [{ code: classified.code }],
  };
}

function outputArgument(args) {
  const index = args.indexOf('--output');
  if (index < 0 || typeof args[index + 1] !== 'string' || args[index + 1].startsWith('--')) return null;
  return path.resolve(args[index + 1]);
}

function parseArgs(args) {
  const parsed = { embeddingBaseUrl: 'http://127.0.0.1:11434', embeddingModel: 'bge-m3:latest' };
  const names = new Map([
    ['--manifest', 'manifest'], ['--release-identity', 'releaseIdentity'], ['--telemetry', 'telemetry'],
    ['--kb-db', 'kbDb'], ['--kg-db', 'kgDb'], ['--rag-db', 'ragDb'], ['--question-set', 'questionSet'],
    ['--owner-acceptance', 'ownerAcceptance'],
    ['--window-start', 'windowStart'], ['--window-end', 'windowEnd'], ['--output', 'output'],
    ['--private-replay-dir', 'privateReplayDir'],
    ['--pm-runner-config', 'pmRunnerConfig'],
    ['--embedding-base-url', 'embeddingBaseUrl'], ['--embedding-model', 'embeddingModel'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = names.get(args[index]);
    if (!key) throw new Error(`unknown argument: ${args[index]}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`missing argument value: ${args[index - 1]}`);
    parsed[key] = value;
  }
  for (const key of ['manifest', 'releaseIdentity', 'telemetry', 'kbDb', 'kgDb', 'ragDb', 'questionSet', 'ownerAcceptance', 'windowStart', 'windowEnd', 'output', 'privateReplayDir', 'pmRunnerConfig']) {
    if (!parsed[key]) throw new Error(`missing required argument: ${key}`);
  }
  for (const key of ['manifest', 'releaseIdentity', 'telemetry', 'kbDb', 'kgDb', 'ragDb', 'questionSet', 'ownerAcceptance', 'output', 'privateReplayDir', 'pmRunnerConfig']) {
    parsed[key] = path.resolve(parsed[key]);
  }
  validateEmbeddingEndpoint(parsed.embeddingBaseUrl);
  return parsed;
}

function artifactMapFromManifest(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error('canonical manifest has no artifacts');
  const map = {};
  for (const artifact of artifacts) map[artifact.relativePath] = artifact.sha256;
  return normalizeArtifactMap(map);
}

function normalizeArtifactMap(value) {
  if (!plainObject(value) || Object.keys(value).length === 0) throw new Error('invalid north-star report artifact map');
  const normalized = {};
  const seen = new Set();
  for (const key of Object.keys(value).sort()) {
    if (!safeArtifactPath(key) || !SHA256.test(String(value[key] ?? ''))) throw new Error('invalid north-star report artifact map');
    const comparison = canonicalPathKey(key);
    if (seen.has(comparison)) throw new Error('invalid north-star report duplicate artifact path');
    seen.add(comparison);
    normalized[key] = String(value[key]).toLowerCase();
  }
  return normalized;
}

function validateWindow(window) {
  if (!plainObject(window) || !validIso(window.start) || !validIso(window.end)) {
    throw new Error('north-star requires an exact seven-day window');
  }
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  if (endMs - startMs !== SEVEN_DAYS_MS) throw new Error('north-star requires an exact seven-day window');
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), startMs, endMs };
}

async function boundedRead(filePath, maxBytes, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error(`${label} path must be absolute`);
  const symbolic = await lstat(filePath).catch(() => null);
  if (!symbolic?.isFile() || symbolic.isSymbolicLink()) throw new Error(`${label} is unavailable or unsafe`);
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const initial = await handle.stat();
    if (!initial.isFile()) throw new Error(`${label} is unavailable or unsafe`);
    if (initial.size > maxBytes) throw new Error(`${label} exceeds size limit`);
    const buffer = Buffer.allocUnsafe(initial.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const final = await handle.stat();
    const pathInfo = await stat(filePath);
    if (
      length !== initial.size
      || final.size !== initial.size
      || final.dev !== initial.dev
      || final.ino !== initial.ino
      || pathInfo.dev !== initial.dev
      || pathInfo.ino !== initial.ino
    ) throw new Error(`${label} changed while reading`);
    return buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error(`${label} is unavailable or unsafe`);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readStableTelemetrySnapshot(filePath, hooks = {}) {
  const label = 'telemetry';
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('telemetry path must be absolute');
  }
  const noFollow = Number.isInteger(fsConstants.O_NOFOLLOW) ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    const pathBefore = await lstat(filePath, { bigint: true }).catch(() => null);
    if (!pathBefore?.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n) {
      throw new Error('telemetry is unavailable or unsafe');
    }
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameStableFileStat(pathBefore, opened)) {
      throw new Error('telemetry changed while opening');
    }
    if (opened.size > BigInt(MAX_TELEMETRY_BYTES)) throw new Error('telemetry exceeds size limit');
    const size = Number(opened.size);
    const first = await readHandleExactly(handle, size, label);
    const firstSha256 = sha256(first);
    await hooks.afterFirstRead?.({ filePath, handle });
    const second = await readHandleExactly(handle, size, label);
    const secondSha256 = sha256(second);
    const final = await handle.stat({ bigint: true });
    const pathAfter = await lstat(filePath, { bigint: true }).catch(() => null);
    if (!pathAfter?.isFile()
      || pathAfter.isSymbolicLink()
      || pathAfter.nlink !== 1n
      || !sameStableFileStat(opened, final)
      || !sameStableFileStat(opened, pathAfter)
      || firstSha256 !== secondSha256
      || !first.equals(second)) {
      throw new Error('telemetry changed while reading or hash verification failed');
    }
    return { bytes: first, sha256: firstSha256 };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error;
    throw new Error('telemetry is unavailable or unsafe');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function sameStableFileStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function readHandleExactly(handle, size, label) {
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (bytesRead <= 0) throw new Error(`${label} changed while reading`);
    offset += bytesRead;
  }
  const tail = Buffer.allocUnsafe(1);
  const { bytesRead: trailingBytes } = await handle.read(tail, 0, 1, size);
  if (trailingBytes !== 0) throw new Error(`${label} changed while reading`);
  return buffer;
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`${label} contains invalid JSON`); }
}

function assertNoForbiddenFields(value, label, allowedKeys = new Set()) {
  const stack = [value];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > 20_000) throw new Error(`${label} exceeds structure budget`);
    if (typeof current === 'string') {
      if (SECRET_TEXT.test(current)) throw new Error(`${label} contains private or secret text`);
    } else if (current && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        if (FORBIDDEN_KEY.test(key) && !allowedKeys.has(key)) throw new Error(`${label} contains forbidden field`);
        stack.push(child);
      }
    }
  }
}

function float32FromBytes(value) {
  if (!(value instanceof Uint8Array) || value.byteLength % 4 !== 0) throw new Error('RAG SQLite embedding is invalid');
  return new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

function cosine(left, right) {
  const leftNormValidated = validateVector(left, right.length, 'RAG cosine left vector');
  const rightNormValidated = validateVector(right, left.length, 'RAG cosine right vector');
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  const score = dot / Math.sqrt(leftNormValidated * rightNormValidated);
  if (!Number.isFinite(score)) throw new Error('RAG cosine score is non-finite');
  return score;
}

function finiteUnit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function closeEnough(left, right) {
  return typeof left === 'number' && Number.isFinite(left) && Math.abs(left - right) <= 1e-12;
}

function validateMetrics(metrics) {
  const errors = [];
  if (!plainObject(metrics)) return ['north-star metrics must be an object'];
  if (!exactKeys(metrics, ['status', 'inputs', 'ns1', 'ns2', 'ns3'])) errors.push('north-star metrics contains unknown fields');
  if (metrics.status !== 'PASS' && metrics.status !== 'BLOCKED') errors.push('north-star metrics status is invalid');
  if (!plainObject(metrics.inputs)
    || !exactKeys(metrics.inputs, ['telemetry', 'kb', 'kg', 'rag'])) {
    errors.push('north-star input evidence fields are invalid');
  } else {
    for (const [id, evidence] of Object.entries(metrics.inputs)) {
      errors.push(...validateInputEvidence(evidence, id));
    }
  }
  if (!plainObject(metrics.ns1)
    || !exactKeys(metrics.ns1, ['status', 'uniqueStartupSessions', 'operationEvents', 'thresholds'])) {
    errors.push('north-star NS1 fields are invalid');
  } else {
    if (!validCount(metrics.ns1.uniqueStartupSessions) || !validCount(metrics.ns1.operationEvents)) errors.push('north-star NS1 counts are invalid');
    if (metrics.ns1.status !== 'PASS' && metrics.ns1.status !== 'BLOCKED') errors.push('north-star NS1 status is invalid');
    if (!plainObject(metrics.ns1.thresholds)
      || !exactKeys(metrics.ns1.thresholds, ['uniqueStartupSessions', 'operationEvents'])
      || metrics.ns1.thresholds.uniqueStartupSessions !== 10
      || metrics.ns1.thresholds.operationEvents !== 1) errors.push('north-star NS1 thresholds are invalid');
  }
  if (!plainObject(metrics.ns2)
    || !exactKeys(metrics.ns2, ['status', 'publicNotesCreated', 'kgNodeCount', 'thresholds'])) {
    errors.push('north-star NS2 fields are invalid');
  } else {
    if (!validCount(metrics.ns2.publicNotesCreated) || !validCount(metrics.ns2.kgNodeCount)) errors.push('north-star NS2 counts are invalid');
    if (metrics.ns2.status !== 'PASS' && metrics.ns2.status !== 'BLOCKED') errors.push('north-star NS2 status is invalid');
    if (!plainObject(metrics.ns2.thresholds)
      || !exactKeys(metrics.ns2.thresholds, ['publicNotesCreated', 'kgNodeCount'])
      || metrics.ns2.thresholds.publicNotesCreated !== 30
      || metrics.ns2.thresholds.kgNodeCount !== 50) errors.push('north-star NS2 thresholds are invalid');
  }
  if (!plainObject(metrics.ns3)
    || !exactKeys(metrics.ns3, [
      'status', 'questionCount', 'macroRecallAt3', 'hitAt3', 'topK', 'sourceOnly',
      'generationLlmUsed', 'results', 'thresholds',
    ])) {
    errors.push('north-star NS3 fields are invalid');
  } else {
    if (!validCount(metrics.ns3.questionCount)
      || !finiteUnit(metrics.ns3.macroRecallAt3)
      || !finiteUnit(metrics.ns3.hitAt3)
      || metrics.ns3.topK !== 3
      || !Number.isSafeInteger(metrics.ns3.topK)
      || metrics.ns3.sourceOnly !== true
      || metrics.ns3.generationLlmUsed !== false) {
      errors.push('north-star NS3 numeric/boolean fields are invalid');
    }
    if (metrics.ns3.status !== 'PASS' && metrics.ns3.status !== 'BLOCKED') errors.push('north-star NS3 status is invalid');
    if (!plainObject(metrics.ns3.thresholds)
      || !exactKeys(metrics.ns3.thresholds, ['macroRecallAt3'])
      || metrics.ns3.thresholds.macroRecallAt3 !== 0.8) errors.push('north-star NS3 thresholds are invalid');
  }
  return errors;
}

function validateInputEvidence(value, label) {
  const errors = [];
  if (!plainObject(value) || !exactKeys(value, ['sha256', 'bytes'])) {
    return [`${label} input evidence fields are invalid`];
  }
  if (!SHA256.test(String(value.sha256 ?? ''))) errors.push(`${label} input SHA256 is invalid`);
  if (!validByteCount(value.bytes, MAX_SQLITE_BYTES)) errors.push(`${label} input bytes are invalid`);
  return errors;
}

function normalizeInputEvidence(value) {
  return { sha256: String(value.sha256).toLowerCase(), bytes: value.bytes };
}

function validateOwnerAcceptanceReference(value, questionSetSha256) {
  const errors = [];
  if (!plainObject(value)
    || !exactKeys(value, ['sha256', 'bytes', 'acceptedBy', 'questionSetSha256'])) {
    return ['owner acceptance reference fields are invalid'];
  }
  if (!SHA256.test(String(value.sha256 ?? ''))) errors.push('owner acceptance reference SHA256 is invalid');
  if (!validByteCount(value.bytes, MAX_QUESTION_SET_BYTES)) errors.push('owner acceptance reference bytes are invalid');
  if (value.acceptedBy !== 'NJX') errors.push('owner acceptance reference must be accepted by NJX');
  if (value.questionSetSha256 !== questionSetSha256) errors.push('owner acceptance reference question-set SHA mismatch');
  return errors;
}

function normalizeOwnerAcceptanceReference(value) {
  return {
    sha256: value.sha256.toLowerCase(),
    bytes: value.bytes,
    acceptedBy: 'NJX',
    questionSetSha256: value.questionSetSha256.toLowerCase(),
  };
}

function validateReportUnknownFields(report) {
  const errors = [];
  if (!exactKeys(report, [
    'schemaVersion', 'reportType', 'status', 'candidate', 'source', 'artifacts', 'window',
    'questionSetSha256', 'runnerSha256', 'ownerAcceptance', 'metrics',
  ])) errors.push('north-star report contains unknown fields');
  if (!plainObject(report.source) || !exactKeys(report.source, ['head', 'snapshotSha256'])) errors.push('north-star source fields are invalid');
  if (!plainObject(report.window) || !exactKeys(report.window, ['start', 'end'])) errors.push('north-star window fields are invalid');
  return errors;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_METRIC_COUNT;
}

function validByteCount(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function safeSourcePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 500
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !/^[A-Za-z]:/.test(value)
    && !value.includes('\\')
    && !value.split('/').some((segment) => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/.test(segment));
}

function safeArtifactPath(value) {
  return safeSourcePath(value) && value.startsWith('artifacts/') && !/[<>:"|?*]/.test(value);
}

function canonicalPathKey(value) {
  return value.normalize('NFC').toLocaleLowerCase('en-US');
}

function sameIdentity(left, right) {
  return left?.schemaVersion === right?.schemaVersion
    && left?.candidate === right?.candidate
    && left?.sourceHead === right?.sourceHead
    && left?.sourceSnapshotSha256 === right?.sourceSnapshotSha256;
}

function validIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
