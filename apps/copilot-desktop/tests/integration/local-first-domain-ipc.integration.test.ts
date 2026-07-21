import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KbClient } from '../../../../packages/kb/src/api/crud.js';
import { MdFileStore } from '../../../../packages/kb/src/store/md-file-store.js';
import { SqliteStore } from '../../../../packages/kb/src/store/sqlite-store.js';
import { registerDomainIpc } from '../../src/main/domain-ipc.js';
import {
  LocalKnowledgeService,
  type CloudBackupPort,
  type LocalKnowledgeServiceOptions,
} from '../../src/main/local-knowledge-service.js';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels.js';

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>;

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createDiskKb(dir: string): KbClient {
  return new KbClient({
    sqlite: new SqliteStore({ dbPath: path.join(dir, 'kb.sqlite') }),
    md: new MdFileStore({ rootDir: path.join(dir, 'notes') }),
  });
}

function createHarness(dir: string, cloudEnabled = false) {
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, listener: Handler) => handlers.set(channel, listener),
  };
  const kg = {
    getSubgraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], degree: {} }),
    reindexNote: vi.fn().mockResolvedValue({ entitiesAdded: 2, entitiesLinked: 2 }),
    removeNote: vi.fn().mockResolvedValue(undefined),
    relatedNotes: vi.fn().mockReturnValue([
      { notePath: 'inbox/opc', score: 0.91, evidence: ['kg-entity'] },
    ]),
  };
  const rag = {
    indexNote: vi.fn().mockResolvedValue({ chunksInserted: 1, errors: [] }),
    deleteNote: vi.fn().mockResolvedValue(undefined),
    ask: vi.fn().mockResolvedValue({ text: 'OPC 是个人公司。', sources: ['inbox/opc'] }),
    stream: vi.fn(async function* () {
      yield {
        delta: 'OPC 是个人公司。',
        sourceDetails: [{ notePath: 'inbox/opc', score: 0.91, evidence: ['kg-entity'] }],
      };
      return {
        text: 'OPC 是个人公司。',
        sources: ['inbox/opc'],
        sourceDetails: [{ notePath: 'inbox/opc', score: 0.91, evidence: ['kg-entity'] }],
      };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const backupEvents: Array<{ operation: string; path: string }> = [];
  const cloudBackup: CloudBackupPort = {
    enqueue: vi.fn(async (event) => { backupEvents.push(event); }),
  };
  const settings = {
    get: (key: string) => key === 'cloudBackupEnabled' ? cloudEnabled : undefined,
  };
  const service = new LocalKnowledgeService({
    kb: createDiskKb(dir),
    kg,
    rag,
    settings,
    cloudBackup,
  } as unknown as LocalKnowledgeServiceOptions);
  registerDomainIpc(ipc, () => service);
  return { handlers, service, kg, rag, backupEvents };
}

describe('Phase 1 local-first desktop domain IPC integration', () => {
  it('writes through typed IPC, reopens local disk state, and never invokes cloud while backup is off', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-domain-int-'));
    tempDirs.push(dir);
    const first = createHarness(dir, false);
    const create = first.handlers.get(IPC_CHANNELS.NOTES_CREATE)!;
    const get = first.handlers.get(IPC_CHANNELS.NOTES_GET)!;
    const reindex = first.handlers.get(IPC_CHANNELS.KG_REINDEX_NOTE)!;

    await expect(create({}, {
      path: 'inbox/opc',
      title: 'OPC',
      body: 'private local note body',
      tags: ['local-first'],
    })).resolves.toMatchObject({ path: 'inbox/opc', title: 'OPC' });
    await expect(get({}, 'inbox/opc')).resolves.toMatchObject({ body: 'private local note body\n' });
    await expect(reindex({}, 'inbox/opc')).resolves.toMatchObject({
      entitiesAdded: 2,
      ragChunksInserted: 1,
    });
    expect(first.backupEvents).toEqual([]);
    await first.service.close();

    const reopened = createHarness(dir, false);
    await expect(reopened.handlers.get(IPC_CHANNELS.NOTES_GET)!({}, 'inbox/opc'))
      .resolves.toMatchObject({ body: 'private local note body\n' });
    expect(fs.existsSync(path.join(dir, 'kb.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'notes', 'inbox', 'opc.md'))).toBe(true);
    await reopened.service.close();
  });

  it('exposes aligned KG/RAG sources, sends metadata-only backup events, and redacts failures', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-domain-int-'));
    tempDirs.push(dir);
    const harness = createHarness(dir, true);
    const create = harness.handlers.get(IPC_CHANNELS.NOTES_CREATE)!;
    const ask = harness.handlers.get(IPC_CHANNELS.RAG_ASK)!;

    await create({}, { path: 'inbox/opc', title: 'OPC', body: 'must-not-leave-device' });
    expect(harness.backupEvents).toEqual([{ operation: 'create', path: 'inbox/opc' }]);
    expect(JSON.stringify(harness.backupEvents)).not.toContain('must-not-leave-device');
    await expect(ask({}, 'OPC 是什么？')).resolves.toMatchObject({
      text: 'OPC 是个人公司。',
      sources: ['inbox/opc'],
      sourceDetails: [{
        notePath: 'inbox/opc',
        score: 0.91,
        evidence: ['kg-entity'],
      }],
    });

    harness.rag.stream.mockImplementationOnce(async function* () {
      throw new Error('private-note-body [REDACTED]');
    });
    const safeFailure = ask({}, 'secret question');
    await expect(safeFailure).rejects.toThrow('[INTERNAL] local knowledge operation failed');
    await expect(safeFailure).rejects.not.toThrow(/private-note-body|\[REDACTED\]/);
    await expect(create({}, {
      path: 'system/todos/escape', title: 'escape', body: 'hidden',
    })).rejects.toThrow('[INVALID_ARGUMENT]');
    await harness.service.close();
  });
});
