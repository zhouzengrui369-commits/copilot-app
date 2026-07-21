import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error The production release helper is intentionally shipped as plain Node ESM.
import { buildNorthStarReport, classifyNorthStarFailure, collectNorthStarMetrics, fetchLocalEmbedding, publishNorthStarReport, readStableTelemetrySnapshot, snapshotSqliteDatabase, validateNorthStarEvidenceReport, validateOwnerAcceptance, validateQuestionSet, validateRagIndexRows, validateReleaseIdentity } from '../scripts/north-star-gates.mjs';

const tempDirs: string[] = [];
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const HEAD = 'c'.repeat(40);
const identity = {
  schemaVersion: 1,
  candidate: 'v6.2-phase1-candidate-r15',
  sourceHead: HEAD,
  sourceSnapshotSha256: SHA_A,
};
const RAG_INPUT = { sha256: '9'.repeat(64), bytes: 4096 };
const startMs = Date.parse('2026-07-01T00:00:00.000Z');
const endMs = startMs + 7 * 24 * 60 * 60 * 1000;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function questionSet(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    frozen: true,
    labelsAreHuman: true,
    labelledBy: 'NJX',
    frozenAt: '2026-07-08T00:00:00.000Z',
    questions: Array.from({ length: 20 }, (_, index) => ({
      id: `q${String(index + 1).padStart(2, '0')}`,
      question: `真实问题 ${index + 1}`,
      relevantSourcePaths: [`notes/source-${index + 1}`],
    })),
    ...overrides,
  };
}

function ownerAcceptance(questionSetSha256 = SHA_A) {
  return {
    schemaVersion: 1,
    reportType: 'north-star-owner-acceptance',
    acceptedBy: 'NJX',
    acceptedAt: '2026-07-08T01:00:00.000Z',
    questionSetSha256,
  };
}

async function fixture(options: {
  sessions?: number;
  operations?: number;
  publicNotes?: number;
  todoNotes?: number;
  kgNodes?: number;
  telemetryLines?: string[];
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-north-star-'));
  tempDirs.push(root);
  const telemetryPath = path.join(root, 'events.jsonl');
  const lines = options.telemetryLines ?? [];
  const sessions = options.sessions ?? 10;
  const operations = options.operations ?? 1;
  for (let index = 0; index < sessions; index += 1) {
    const sessionId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    lines.push(JSON.stringify({
      schemaVersion: 2,
      timestamp: new Date(startMs + 1000 + index).toISOString(),
      kind: 'startup',
      process: 'main',
      sessionId,
      release: identity,
      detail: { launchMs: 1 },
    }));
  }
  for (let index = 0; index < Math.min(operations, sessions); index += 1) {
    const sessionId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    lines.push(JSON.stringify({
      schemaVersion: 2,
      timestamp: new Date(startMs + 3000 + index).toISOString(),
      kind: 'operation',
      process: 'main',
      sessionId,
      release: identity,
      operation: 'notes.create',
    }));
  }
  await writeFile(telemetryPath, `${lines.join('\n')}\n`, { mode: 0o600 });

  const kbDbPath = path.join(root, 'kb.sqlite');
  const kb = new Database(kbDbPath);
  kb.exec(`
    CREATE TABLE schema_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
    INSERT INTO schema_meta VALUES('version','0');
    CREATE TABLE notes(path TEXT, type TEXT, tags TEXT, created_at INTEGER NOT NULL);
  `);
  for (let index = 0; index < (options.publicNotes ?? 30); index += 1) {
    kb.prepare('INSERT INTO notes VALUES(?,?,?,?)').run(
      `notes/public-${index}`,
      'note',
      '[]',
      startMs + 3000 + index,
    );
  }
  for (let index = 0; index < (options.todoNotes ?? 2); index += 1) {
    kb.prepare('INSERT INTO notes VALUES(?,?,?,?)').run(
      `system/todos/${index}`,
      'todo',
      '["__copilot_todo__"]',
      startMs + 4000 + index,
    );
  }
  kb.close();

  const kgDbPath = path.join(root, 'kg.sqlite');
  const kg = new Database(kgDbPath);
  kg.exec(`
    CREATE TABLE kg_schema_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
    INSERT INTO kg_schema_meta VALUES('version','0');
    CREATE TABLE kg_nodes(entity_id TEXT PRIMARY KEY);
  `);
  const insertNode = kg.prepare('INSERT INTO kg_nodes VALUES(?)');
  for (let index = 0; index < (options.kgNodes ?? 50); index += 1) insertNode.run(`entity:${index}`);
  kg.close();
  return { root, telemetryPath, kbDbPath, kgDbPath };
}

function collectorInput(files: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  return {
    releaseIdentity: identity,
    telemetryPath: files.telemetryPath,
    kbDbPath: files.kbDbPath,
    kgDbPath: files.kgDbPath,
    window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
    questionSet: questionSet(),
    ragInput: RAG_INPUT,
    retrieve: async (_question: string, questionId: string) => [
      `notes/source-${Number(questionId.slice(1))}`,
      'notes/decoy-a',
      'notes/decoy-b',
    ],
    ...overrides,
  };
}

describe('North-Star input contracts', () => {
  it('accepts only a packaged candidate/head/snapshot identity', () => {
    expect(validateReleaseIdentity(identity)).toEqual([]);
    expect(validateReleaseIdentity({ ...identity, candidate: '../escape' })).not.toEqual([]);
    expect(validateReleaseIdentity({ ...identity, sourceHead: 'dirty' })).not.toEqual([]);
    expect(validateReleaseIdentity({ ...identity, sourceSnapshotSha256: 'x' })).not.toEqual([]);
  });

  it('requires exactly 20 unique frozen human-labelled NJX questions', () => {
    expect(validateQuestionSet(questionSet())).toEqual([]);
    expect(validateQuestionSet(questionSet({ questions: questionSet().questions.slice(0, 19) }))).toContain('question set must contain exactly 20 questions');
    const duplicate = questionSet();
    duplicate.questions[1]!.question = duplicate.questions[0]!.question;
    expect(validateQuestionSet(duplicate)).toContain('question text must be unique');
    expect(validateQuestionSet(questionSet({ labelsAreHuman: false }))).toContain('human labels from NJX are required');
    expect(validateQuestionSet(questionSet({ labelledBy: 'generator' }))).toContain('human labels from NJX are required');
  });

  it('requires an exact NJX owner acceptance bound to the question-set SHA', () => {
    expect(validateOwnerAcceptance(ownerAcceptance(), SHA_A)).toEqual([]);
    expect(validateOwnerAcceptance({ ...ownerAcceptance(), acceptedBy: 'worker' }, SHA_A)).not.toEqual([]);
    expect(validateOwnerAcceptance(ownerAcceptance(SHA_B), SHA_A)).toContain('owner acceptance question-set SHA mismatch');
    expect(validateOwnerAcceptance({ ...ownerAcceptance(), extra: true }, SHA_A)).toContain('owner acceptance contains unknown fields');
  });

  it('rejects missing, duplicate and unsafe relevant source paths', () => {
    for (const paths of [[], ['notes/a', 'notes/a'], ['../private'], ['/Users/njx/private']]) {
      const set = questionSet();
      set.questions[0]!.relevantSourcePaths = paths;
      expect(validateQuestionSet(set).length).toBeGreaterThan(0);
    }
  });
});

describe('North-Star strict seven-day collection', () => {
  it('passes NS1/NS2/NS3 with candidate-bound genuine-shaped input and macro Recall@3', async () => {
    const files = await fixture();
    const result = await collectNorthStarMetrics(collectorInput(files));
    expect(result.status).toBe('PASS');
    expect(result.ns1).toMatchObject({ status: 'PASS', uniqueStartupSessions: 10, operationEvents: 1 });
    expect(result.ns2).toMatchObject({ status: 'PASS', publicNotesCreated: 30, kgNodeCount: 50 });
    expect(result.ns3).toMatchObject({ status: 'PASS', macroRecallAt3: 1, hitAt3: 1, questionCount: 20 });
    expect(result.inputs).toMatchObject({
      telemetry: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: expect.any(Number) },
      kb: { sha256: createHash('sha256').update(await readFile(files.kbDbPath)).digest('hex'), bytes: (await stat(files.kbDbPath)).size },
      kg: { sha256: createHash('sha256').update(await readFile(files.kgDbPath)).digest('hex'), bytes: (await stat(files.kgDbPath)).size },
      rag: RAG_INPUT,
    });
  });

  it('uses [start,end) and ignores events outside both endpoints correctly', async () => {
    const event = (timestamp: number, kind: 'startup' | 'operation', sessionId: string) => JSON.stringify({
      schemaVersion: 2,
      timestamp: new Date(timestamp).toISOString(),
      kind,
      process: 'main',
      sessionId,
      release: identity,
      ...(kind === 'operation' ? { operation: 'notes.create' } : { detail: {} }),
    });
    const files = await fixture({ sessions: 0, telemetryLines: [
      event(startMs - 1, 'startup', '10000000-0000-4000-8000-000000000000'),
      event(startMs, 'startup', '20000000-0000-4000-8000-000000000000'),
      event(startMs + 1, 'startup', '30000000-0000-4000-8000-000000000000'),
      event(startMs + 2, 'operation', '30000000-0000-4000-8000-000000000000'),
      event(endMs, 'startup', '40000000-0000-4000-8000-000000000000'),
    ] });
    const result = await collectNorthStarMetrics(collectorInput(files));
    expect(result.ns1.uniqueStartupSessions).toBe(2);
    expect(result.ns1.operationEvents).toBe(1);
  });

  it('requires an exact seven-day finite ISO window', async () => {
    const files = await fixture();
    for (const window of [
      { start: new Date(startMs).toISOString(), end: new Date(endMs - 1).toISOString() },
      { start: 'invalid', end: new Date(endMs).toISOString() },
      { start: new Date(endMs).toISOString(), end: new Date(startMs).toISOString() },
    ]) {
      await expect(collectNorthStarMetrics(collectorInput(files, { window }))).rejects.toThrow(/seven-day window/i);
    }
  });

  it('fails closed on malformed JSONL, identity mismatch, invalid session, forbidden field and operation enum', async () => {
    const variants = [
      '{bad',
      JSON.stringify({ schemaVersion: 2, timestamp: new Date(startMs + 1).toISOString(), kind: 'startup', process: 'main', sessionId: 'bad', release: identity, detail: {} }),
      JSON.stringify({ schemaVersion: 2, timestamp: new Date(startMs + 1).toISOString(), kind: 'startup', process: 'main', sessionId: crypto.randomUUID(), release: { ...identity, candidate: 'other' }, detail: {} }),
      JSON.stringify({ schemaVersion: 2, timestamp: new Date(startMs + 1).toISOString(), kind: 'operation', process: 'main', sessionId: crypto.randomUUID(), release: identity, operation: 'note.body', body: 'private' }),
    ];
    for (const line of variants) {
      const files = await fixture({ sessions: 0, telemetryLines: [line] });
      await expect(collectNorthStarMetrics(collectorInput(files))).rejects.toThrow(/telemetry/i);
    }
  });

  it('fails closed for operations without a startup session inside the window', async () => {
    const files = await fixture({ sessions: 10, operations: 0 });
    const raw = await readFile(files.telemetryPath, 'utf8');
    await writeFile(files.telemetryPath, `${raw}${JSON.stringify({
      schemaVersion: 2,
      timestamp: new Date(startMs + 5000).toISOString(),
      kind: 'operation',
      process: 'main',
      sessionId: '99999999-9999-4999-8999-999999999999',
      release: identity,
      operation: 'rag.ask',
    })}\n`);
    await expect(collectNorthStarMetrics(collectorInput(files))).rejects.toThrow(/before startup/);
  });

  it.each([
    ['duplicate startup', (base: Record<string, unknown>) => [base, { ...base, timestamp: new Date(startMs + 2).toISOString() }]],
    ['operation before startup', (base: Record<string, unknown>) => [{ ...base, kind: 'operation', operation: 'rag.ask' }, { ...base, timestamp: new Date(startMs + 2).toISOString() }]],
    ['time reversal', (base: Record<string, unknown>) => [{ ...base, timestamp: new Date(startMs + 2).toISOString() }, { ...base, kind: 'offline', timestamp: new Date(startMs + 1).toISOString(), detail: {} }]],
    ['cross candidate', (base: Record<string, unknown>) => [base, { ...base, kind: 'offline', timestamp: new Date(startMs + 2).toISOString(), release: { ...identity, candidate: 'other' }, detail: {} }]],
    ['duplicate event', (base: Record<string, unknown>) => [base, { ...base }]],
  ])('fails closed on strict session sequence violation: %s', async (_label, makeEvents) => {
    const base = {
      schemaVersion: 2,
      timestamp: new Date(startMs + 1).toISOString(),
      kind: 'startup',
      process: 'main',
      sessionId: '55555555-5555-4555-8555-555555555555',
      release: identity,
      detail: {},
    };
    const files = await fixture({ sessions: 0, telemetryLines: makeEvents(base).map((event) => JSON.stringify(event)) });
    await expect(collectNorthStarMetrics(collectorInput(files))).rejects.toThrow(/telemetry|startup|operation|monotonic|duplicate/i);
  });

  it('excludes system Todo backing notes by both path and reserved tag', async () => {
    const files = await fixture({ publicNotes: 30, todoNotes: 10 });
    const kb = new Database(files.kbDbPath);
    kb.prepare('INSERT INTO notes VALUES(?,?,?,?)').run('notes/disguised-todo', 'note', '["__copilot_todo__"]', startMs + 5);
    kb.close();
    const result = await collectNorthStarMetrics(collectorInput(files));
    expect(result.ns2.publicNotesCreated).toBe(30);
  });

  it('counts note creation with [start,end) and exact KG rows', async () => {
    const files = await fixture({ publicNotes: 29, kgNodes: 49 });
    const kb = new Database(files.kbDbPath);
    kb.prepare('INSERT INTO notes VALUES(?,?,?,?)').run('notes/start', 'note', '[]', startMs);
    kb.prepare('INSERT INTO notes VALUES(?,?,?,?)').run('notes/end', 'note', '[]', endMs);
    kb.close();
    const result = await collectNorthStarMetrics(collectorInput(files));
    expect(result.ns2).toMatchObject({ publicNotesCreated: 30, kgNodeCount: 49, status: 'BLOCKED' });
  });

  it('opens KB/KG databases read-only and fails closed on missing or mismatched schemas', async () => {
    const files = await fixture();
    const before = await Promise.all([stat(files.kbDbPath), stat(files.kgDbPath)]);
    await chmod(files.kbDbPath, 0o400);
    await chmod(files.kgDbPath, 0o400);
    await collectNorthStarMetrics(collectorInput(files));
    const after = await Promise.all([stat(files.kbDbPath), stat(files.kgDbPath)]);
    expect(after.map((value) => value.size)).toEqual(before.map((value) => value.size));
    await expect(collectNorthStarMetrics(collectorInput(files, { kbDbPath: path.join(files.root, 'missing.sqlite') }))).rejects.toThrow(/KB SQLite/i);
    const wrong = path.join(files.root, 'wrong.sqlite');
    new Database(wrong).close();
    await expect(collectNorthStarMetrics(collectorInput(files, { kgDbPath: wrong }))).rejects.toThrow(/KG SQLite schema/i);
  });

  it('rejects symbolic-link telemetry and SQLite inputs', async () => {
    const files = await fixture();
    const telemetryLink = path.join(files.root, 'telemetry-link.jsonl');
    const kbLink = path.join(files.root, 'kb-link.sqlite');
    await symlink(files.telemetryPath, telemetryLink);
    await symlink(files.kbDbPath, kbLink);
    await expect(collectNorthStarMetrics(collectorInput(files, { telemetryPath: telemetryLink }))).rejects.toThrow(/telemetry/i);
    await expect(collectNorthStarMetrics(collectorInput(files, { kbDbPath: kbLink }))).rejects.toThrow(/KB SQLite/i);
  });

  it('reads telemetry through one O_NOFOLLOW handle and rejects content or path changes between its two reads', async () => {
    const files = await fixture();
    const stable = await readStableTelemetrySnapshot(files.telemetryPath);
    expect(stable.sha256).toBe(createHash('sha256').update(await readFile(files.telemetryPath)).digest('hex'));
    expect(stable.bytes.length).toBe((await stat(files.telemetryPath)).size);

    await expect(readStableTelemetrySnapshot(files.telemetryPath, {
      afterFirstRead: async () => {
        const original = await readFile(files.telemetryPath);
        original[0] = original[0] === 0x7b ? 0x5b : 0x7b;
        await writeFile(files.telemetryPath, original);
      },
    })).rejects.toThrow(/telemetry.*changed|hash/i);

    const swapped = await fixture();
    await expect(readStableTelemetrySnapshot(swapped.telemetryPath, {
      afterFirstRead: async () => {
        await rename(swapped.telemetryPath, `${swapped.telemetryPath}.moved`);
        await writeFile(swapped.telemetryPath, await readFile(`${swapped.telemetryPath}.moved`));
      },
    })).rejects.toThrow(/telemetry.*changed|inode|unsafe/i);
  });

  it('requires exact schemas for every non-operation event and rejects diagnostics before startup', async () => {
    const base = {
      schemaVersion: 2,
      timestamp: new Date(startMs + 1).toISOString(),
      kind: 'startup',
      process: 'main',
      sessionId: '77777777-7777-4777-8777-777777777777',
      release: identity,
      detail: {},
    };
    for (const invalid of [
      { ...base, unexpected: true },
      (() => { const value = { ...base } as Record<string, unknown>; delete value.detail; return value; })(),
      { ...base, kind: 'offline', detail: { errorName: 'NetworkError' } },
    ]) {
      const files = await fixture({ sessions: 0, telemetryLines: [JSON.stringify(invalid)] });
      await expect(collectNorthStarMetrics(collectorInput(files))).rejects.toThrow(/telemetry|startup|schema/i);
    }
  });

  it('enforces strictly increasing timestamps across the whole file, including excluded lines', async () => {
    const outside = (timestamp: number, sessionId: string) => JSON.stringify({
      schemaVersion: 2,
      timestamp: new Date(timestamp).toISOString(),
      kind: 'startup',
      process: 'main',
      sessionId,
      release: identity,
      detail: {},
    });
    for (const lines of [
      [outside(startMs - 1, '88888888-8888-4888-8888-888888888888'), outside(startMs - 1, '99999999-9999-4999-8999-999999999999')],
      [outside(startMs - 1, '88888888-8888-4888-8888-888888888888'), outside(startMs - 2, '99999999-9999-4999-8999-999999999999')],
    ]) {
      const files = await fixture({ telemetryLines: lines });
      await expect(collectNorthStarMetrics(collectorInput(files))).rejects.toThrow(/monotonic|timestamp/i);
    }
  });

  it('fails closed when WAL/busy sidecars are present', async () => {
    const files = await fixture();
    await writeFile(`${files.kbDbPath}-wal`, 'active-wal');
    await expect(collectNorthStarMetrics(collectorInput(files))).rejects.toThrow(/WAL|busy/i);
  });

  it('rejects path replacement and inode/link swaps while copying a private SQLite snapshot', async () => {
    const files = await fixture();
    const stable = await snapshotSqliteDatabase(files.kbDbPath, 'KB');
    expect(stable.path).not.toBe(files.kbDbPath);
    expect(stable.sha256).toBe(createHash('sha256').update(await readFile(files.kbDbPath)).digest('hex'));
    expect((await stat(stable.path)).mode & 0o777).toBe(0o400);
    await stable.cleanup();
    const replacement = path.join(files.root, 'replacement.sqlite');
    await writeFile(replacement, await readFile(files.kbDbPath));
    await expect(snapshotSqliteDatabase(files.kbDbPath, 'KB', {
      afterCopy: async () => {
        const moved = `${files.kbDbPath}.moved`;
        await rename(files.kbDbPath, moved);
        await rename(replacement, files.kbDbPath);
      },
    })).rejects.toThrow(/changed|inode|unsafe/i);

    const second = await fixture();
    const other = path.join(second.root, 'other.sqlite');
    await writeFile(other, await readFile(second.kbDbPath));
    await expect(snapshotSqliteDatabase(second.kbDbPath, 'KB', {
      afterCopy: async () => {
        const moved = `${second.kbDbPath}.moved`;
        await rename(second.kbDbPath, moved);
        await symlink(other, second.kbDbPath);
      },
    })).rejects.toThrow(/changed|inode|unsafe/i);
  });

  it('uses source-only unique TopK=3 and computes macro Recall@3 and Hit@3 separately', async () => {
    const files = await fixture();
    const calls: unknown[][] = [];
    const result = await collectNorthStarMetrics(collectorInput(files, {
      questionSet: questionSet({ questions: questionSet().questions.map((question, index) => ({
        ...question,
        relevantSourcePaths: [`notes/source-${index + 1}`, `notes/second-${index + 1}`],
      })) }),
      retrieve: async (...args: unknown[]) => {
        calls.push(args);
        return ['notes/decoy', `notes/source-${Number(String(args[1]).slice(1))}`, 'notes/decoy', 'notes/fourth'];
      },
    }));
    expect(calls).toHaveLength(20);
    expect(calls.every((call) => call[2] === 3)).toBe(true);
    expect(result.ns3).toMatchObject({ macroRecallAt3: 0.5, hitAt3: 1, status: 'BLOCKED' });
    expect(JSON.stringify(result.ns3)).not.toContain('真实问题');
    expect(JSON.stringify(result.ns3)).not.toContain('notes/source');
  });

  it('dedupes retrieval output without inflating metrics and blocks unsafe paths', async () => {
    const files = await fixture();
    const deduped = await collectNorthStarMetrics(collectorInput(files, {
      retrieve: async (_question: string, id: string) => [
        `notes/source-${Number(id.slice(1))}`,
        `notes/source-${Number(id.slice(1))}`,
        'notes/a',
        'notes/b',
      ],
    }));
    expect(deduped.ns3.macroRecallAt3).toBe(1);
    await expect(collectNorthStarMetrics(collectorInput(files, {
      retrieve: async () => ['notes/a', '../escape'],
    }))).rejects.toThrow(/retrieval/i);
  });
});

describe('North-Star report binding and publication', () => {
  const artifacts = {
    'artifacts/mac.zip': SHA_A,
    'artifacts/win.exe': SHA_B,
  };
  const passingResults = Array.from({ length: 20 }, (_, index) => ({
    id: `q${String(index + 1).padStart(2, '0')}`,
    relevantCount: 1,
    retrievedCount: 1,
    matchedCount: index < 16 ? 1 : 0,
    recallAt3: index < 16 ? 1 : 0,
    hitAt3: index < 16 ? 1 : 0,
  }));
  const passingMetrics = {
    status: 'PASS',
    inputs: {
      telemetry: { sha256: '1'.repeat(64), bytes: 100 },
      kb: { sha256: '2'.repeat(64), bytes: 200 },
      kg: { sha256: '3'.repeat(64), bytes: 300 },
      rag: { sha256: '4'.repeat(64), bytes: 400 },
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
      status: 'PASS', questionCount: 20, macroRecallAt3: 0.8, hitAt3: 0.8,
      topK: 3, sourceOnly: true, generationLlmUsed: false, results: passingResults,
      thresholds: { macroRecallAt3: 0.8 },
    },
  };

  function report(overrides: Record<string, unknown> = {}) {
    return buildNorthStarReport({
      releaseIdentity: identity,
      artifacts,
      window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
      questionSetSha256: SHA_A,
      runnerSha256: SHA_B,
      ownerAcceptance: {
        sha256: '5'.repeat(64),
        bytes: 256,
        acceptedBy: 'NJX',
        questionSetSha256: SHA_A,
      },
      metrics: passingMetrics,
      ...overrides,
    });
  }

  it('binds candidate/head/snapshot/full artifact map/window/question-set/runner without private input', () => {
    const value = report();
    expect(value).toMatchObject({
      schemaVersion: 1,
      reportType: 'north-star',
      status: 'PASS',
      candidate: identity.candidate,
      source: { head: HEAD, snapshotSha256: SHA_A },
      artifacts,
      questionSetSha256: SHA_A,
      runnerSha256: SHA_B,
    });
    const raw = JSON.stringify(value);
    expect(raw).not.toMatch(/question\s*[:=]|transcript|prompt|api.?key|authorization|\/Users\//i);
  });

  it('validates exact report bindings and rejects missing data or false PASS', () => {
    const binding = {
      releaseIdentity: identity,
      artifacts,
      questionSetSha256: SHA_A,
      runnerSha256: SHA_B,
      ownerAcceptanceSha256: '5'.repeat(64),
    };
    expect(validateNorthStarEvidenceReport(report(), binding)).toEqual([]);
    expect(validateNorthStarEvidenceReport({ ...report(), candidate: 'other' }, binding)).toContain('north-star candidate mismatch');
    expect(validateNorthStarEvidenceReport({ ...report(), artifacts: { 'artifacts/mac.zip': SHA_A } }, binding)).toContain('north-star artifact map mismatch');
    expect(validateNorthStarEvidenceReport(report({ metrics: { ...passingMetrics, status: 'BLOCKED' } }), binding).length).toBeGreaterThan(0);
    expect(validateNorthStarEvidenceReport({ ...report(), ownerAcceptance: { ...report().ownerAcceptance, acceptedBy: 'worker' } }, binding)).toContain('north-star owner acceptance is invalid');
    const forged = report();
    forged.metrics.ns3.macroRecallAt3 = 1;
    expect(validateNorthStarEvidenceReport(forged, binding)).toContain('north-star NS3 aggregate metrics do not match result rows');
  });

  it('rejects coerced, non-finite, negative, fractional, oversized and unknown metric fields', () => {
    const binding = {
      releaseIdentity: identity,
      artifacts,
      questionSetSha256: SHA_A,
      runnerSha256: SHA_B,
      ownerAcceptanceSha256: '5'.repeat(64),
    };
    const mutations = [
      (value: any) => { value.metrics.ns1.uniqueStartupSessions = '10'; },
      (value: any) => { value.metrics.ns1.operationEvents = -1; },
      (value: any) => { value.metrics.ns2.publicNotesCreated = 30.5; },
      (value: any) => { value.metrics.ns2.kgNodeCount = Number.MAX_SAFE_INTEGER; },
      (value: any) => { value.metrics.ns3.macroRecallAt3 = Number.NaN; },
      (value: any) => { value.metrics.ns3.hitAt3 = Number.POSITIVE_INFINITY; },
      (value: any) => { value.metrics.ns3.topK = '3'; },
      (value: any) => { value.metrics.ns3.extra = true; },
      (value: any) => { value.metrics.inputs.telemetry.bytes = -1; },
      (value: any) => { value.extra = true; },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(report());
      mutate(value);
      expect(validateNorthStarEvidenceReport(value, binding).length).toBeGreaterThan(0);
    }
  });

  it('publishes mode 0600 atomically and refuses overwrite', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-north-star-report-'));
    tempDirs.push(root);
    const target = path.join(root, 'north-star.json');
    const value = report();
    const published = await publishNorthStarReport(target, value);
    expect(published.sha256).toBe(createHash('sha256').update(await readFile(target)).digest('hex'));
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    await expect(publishNorthStarReport(target, value)).rejects.toThrow(/exists|overwrite/i);
  });

  it('rejects unsafe artifact maps, bad SHA, blocked metrics and secret-shaped report fields', () => {
    for (const overrides of [
      { artifacts: { '../escape': SHA_A } },
      { artifacts: { 'artifacts/a': 'bad' } },
      { metrics: { ...passingMetrics, apiKey: 'sk-secret-value' } },
    ]) expect(() => report(overrides)).toThrow(/north-star report/i);
    expect(report({ metrics: { ...passingMetrics, status: 'BLOCKED' } }).status).toBe('BLOCKED');
  });
});

describe('canonical packaged identity integration', () => {
  it('writes the bound identity after source gates and before any macOS/Windows packaging', async () => {
    const source = await readFile(path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../scripts/build-canonical-release.mjs',
    ), 'utf8');
    const runGates = source.indexOf('await runGates();');
    const identityWrite = source.indexOf('await writePackagedReleaseIdentity();');
    const firstPackaging = Math.min(source.indexOf('await buildMac(arch);'), source.indexOf('await buildWindows(arch);'));
    expect(runGates).toBeGreaterThan(0);
    expect(identityWrite).toBeGreaterThan(runGates);
    expect(firstPackaging).toBeGreaterThan(identityWrite);
    expect(source).toContain("dist/main/release-identity.json");
    expect(source).toContain("'RELEASE-IDENTITY.json'");
  });

  it('main gates identity loading behind app.isPackaged and non-dev mode', async () => {
    const source = await readFile(path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../src/main/main.ts',
    ), 'utf8');
    expect(source).toContain('isCanonicalPackagedRuntime');
    expect(source).toContain('isPackaged: app.isPackaged');
    expect(source).toContain('isDev: IS_DEV');
  });
});

describe('classified CLI failure publication', () => {
  it('classifies known input faults but leaves unknown internal failures unclassified', () => {
    expect(classifyNorthStarFailure(new Error('KB SQLite schema/version mismatch'))?.code).toBe('BLOCKED_NORTH_STAR_SCHEMA');
    expect(classifyNorthStarFailure(new Error('KB SQLite WAL/busy sidecar is present'))?.code).toBe('BLOCKED_NORTH_STAR_BUSY');
    expect(classifyNorthStarFailure(new Error('release identity mismatch'))?.code).toBe('BLOCKED_NORTH_STAR_IDENTITY');
    expect(classifyNorthStarFailure(new Error('telemetry is unavailable'))?.code).toBe('BLOCKED_NORTH_STAR_INPUT_MISSING');
    expect(classifyNorthStarFailure(new Error('embedding request timed out'))?.code).toBe('BLOCKED_NORTH_STAR_EVIDENCE');
    expect(classifyNorthStarFailure(new Error('RAG query embedding has zero or non-finite norm'))?.code).toBe('BLOCKED_NORTH_STAR_EVIDENCE');
    expect(classifyNorthStarFailure(new Error('unexpected internal invariant'))).toBeNull();
  });

  it('publishes a redacted BLOCKED report and exits 2 for a classified missing input', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-north-star-cli-blocked-'));
    tempDirs.push(root);
    const output = path.join(root, 'blocked.json');
    const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../scripts/north-star-gates.mjs');
    const missing = path.join(root, 'missing-manifest.json');
    const identityPath = path.join(root, 'identity.json');
    const questionPath = path.join(root, 'questions.json');
    await writeFile(identityPath, `${JSON.stringify(identity)}\n`);
    await writeFile(questionPath, `${JSON.stringify(questionSet())}\n`);
    const result = spawnSync(process.execPath, [
      script,
      '--manifest', missing,
      '--release-identity', identityPath,
      '--telemetry', path.join(root, 'missing-events.jsonl'),
      '--kb-db', path.join(root, 'missing-kb.sqlite'),
      '--kg-db', path.join(root, 'missing-kg.sqlite'),
      '--rag-db', path.join(root, 'missing-rag.sqlite'),
      '--question-set', questionPath,
      '--window-start', '2026-07-01T00:00:00.000Z',
      '--window-end', '2026-07-08T00:00:00.000Z',
      '--output', output,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(2);
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report).toMatchObject({
      schemaVersion: 1,
      reportType: 'north-star',
      status: 'BLOCKED',
      blockers: [{ code: 'BLOCKED_NORTH_STAR_INPUT_MISSING' }],
    });
    expect(JSON.stringify(report)).not.toContain(root);
    expect(result.stdout).not.toContain(root);
  });
});

describe('bounded loopback embedding and RAG model/vector validation', () => {
  const endpoint = 'http://127.0.0.1:11434';
  const jsonResponse = (body: string, options: { url?: string; contentLength?: string } = {}) => ({
    ok: true,
    status: 200,
    url: options.url ?? `${endpoint}/api/embeddings`,
    headers: new Headers(options.contentLength ? { 'content-length': options.contentLength } : {}),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  });

  it('allows only plain HTTP IPv4/IPv6 loopback endpoints with no URL extras', async () => {
    const fetchImpl = async (url: string) => jsonResponse('{"embedding":[1,0]}', { url });
    await expect(fetchLocalEmbedding({ endpoint, model: 'model-a', question: 'q', fetchImpl, timeoutMs: 100 })).resolves.toEqual(new Float32Array([1, 0]));
    await expect(fetchLocalEmbedding({ endpoint: 'http://[::1]:11434', model: 'model-a', question: 'q', fetchImpl, timeoutMs: 100 })).resolves.toEqual(new Float32Array([1, 0]));
    for (const invalid of [
      'https://127.0.0.1:11434', 'http://localhost:11434', 'http://user:pass@127.0.0.1:11434',
      'http://127.0.0.1:11434?x=1', 'http://127.0.0.1:11434#x', 'http://127.0.0.2:11434',
    ]) {
      await expect(fetchLocalEmbedding({ endpoint: invalid, model: 'model-a', question: 'q', fetchImpl, timeoutMs: 100 })).rejects.toThrow(/loopback|endpoint/i);
    }
  });

  it('uses redirect:error, enforces same origin and rejects declared/chunked responses over 1 MiB', async () => {
    let request: any;
    const fetchImpl = async (url: string, init: any) => {
      request = { url, init };
      return jsonResponse('{"embedding":[1,0]}');
    };
    await fetchLocalEmbedding({ endpoint, model: 'model-a', question: 'private question', fetchImpl, timeoutMs: 100 });
    expect(request.init.redirect).toBe('error');
    expect(request.url).toBe(`${endpoint}/api/embeddings`);

    await expect(fetchLocalEmbedding({
      endpoint, model: 'model-a', question: 'q', timeoutMs: 100,
      fetchImpl: async () => jsonResponse('{"embedding":[1]}', { url: 'http://127.0.0.1:9999/api/embeddings' }),
    })).rejects.toThrow(/origin/i);
    await expect(fetchLocalEmbedding({
      endpoint, model: 'model-a', question: 'q', timeoutMs: 100,
      fetchImpl: async () => jsonResponse('{}', { contentLength: String(1024 * 1024 + 1) }),
    })).rejects.toThrow(/size|large/i);
    const huge = JSON.stringify({ embedding: [1], padding: 'x'.repeat(1024 * 1024) });
    await expect(fetchLocalEmbedding({
      endpoint, model: 'model-a', question: 'q', timeoutMs: 100,
      fetchImpl: async () => jsonResponse(huge),
    })).rejects.toThrow(/size|large/i);
  });

  it('rejects timeout, non-JSON and malformed embedding responses', async () => {
    await expect(fetchLocalEmbedding({
      endpoint, model: 'model-a', question: 'q', timeoutMs: 10,
      fetchImpl: async (_url: string, init: any) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
      }),
    })).rejects.toThrow();
    await expect(fetchLocalEmbedding({ endpoint, model: 'model-a', question: 'q', timeoutMs: 100, fetchImpl: async () => jsonResponse('not-json') })).rejects.toThrow(/JSON/i);
    await expect(fetchLocalEmbedding({ endpoint, model: 'model-a', question: 'q', timeoutMs: 100, fetchImpl: async () => jsonResponse('{"embedding":"bad"}') })).rejects.toThrow(/embedding/i);
  });

  it('keeps one timeout signal active through body read and cancels a timed-out response stream as BLOCKED evidence', async () => {
    let requestSignal: AbortSignal | undefined;
    let cancelled = false;
    let reads = 0;
    const response = {
      ok: true,
      status: 200,
      url: `${endpoint}/api/embeddings`,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: () => new Promise((resolve) => setTimeout(() => resolve(reads++ === 0 ? {
            done: false,
            value: new TextEncoder().encode('{"embedding":[1,0]}'),
          } : { done: true, value: undefined }), 50)),
          cancel: async () => { cancelled = true; },
        }),
      },
    };
    let failure: unknown;
    try {
      await fetchLocalEmbedding({
        endpoint,
        model: 'model-a',
        question: 'q',
        timeoutMs: 5,
        fetchImpl: async (_url: string, init: any) => {
          requestSignal = init.signal;
          return response;
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/embedding.*timeout|timed out/i);
    expect(requestSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    expect(classifyNorthStarFailure(failure)).toEqual({ code: 'BLOCKED_NORTH_STAR_EVIDENCE' });
  });

  it('requires meta/chunk/query model equality and finite fixed non-zero vectors with safe paths', () => {
    const rows = [
      { notePath: 'notes/a', model: 'model-a', embedding: new Float32Array([1, 0]) },
      { notePath: 'notes/b', model: 'model-a', embedding: new Float32Array([0, 1]) },
    ];
    expect(validateRagIndexRows({ metaModel: 'model-a', queryModel: 'model-a', rows })).toMatchObject({ dimensions: 2 });
    const invalidRows = [
      { ...rows[0], model: 'model-b' },
      { ...rows[0], embedding: new Float32Array([]) },
      { ...rows[0], embedding: new Float32Array([0, 0]) },
      { ...rows[0], embedding: new Float32Array([Number.NaN, 1]) },
      { ...rows[0], embedding: new Float32Array([Number.POSITIVE_INFINITY, 1]) },
      { ...rows[0], embedding: new Float32Array([1, 0, 0]) },
      { ...rows[0], notePath: '../escape' },
    ];
    for (const invalid of invalidRows) {
      expect(() => validateRagIndexRows({ metaModel: 'model-a', queryModel: 'model-a', rows: [rows[0], invalid] })).toThrow(/RAG|model|vector|path|dimension/i);
    }
    expect(() => validateRagIndexRows({ metaModel: 'model-b', queryModel: 'model-a', rows })).toThrow(/model/i);
  });
});
