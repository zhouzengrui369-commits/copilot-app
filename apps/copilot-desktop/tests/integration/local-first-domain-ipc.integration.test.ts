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
    reindexNote: vi.fn().mockResolvedValue({
      entitiesAdded: 2,
      entitiesLinked: 2,
      status: 'done',
    }),
    wikiForNote: vi.fn().mockImplementation(async (document: { note: { path: string } }) => {
      const projection = {
        projectionId: '1',
        notePath: document.note.path,
        status: 'current' as const,
        contentDigest: 'a'.repeat(64),
        summary: '本地摘要',
        tags: ['local-first'],
        entityIds: ['concept:opc'],
        relationSignatures: ['concept:opc|related_to|concept:local'],
        generatedAt: 1_753_000_000_000,
        failureStage: null,
        failureReason: null,
        provenance: {
          provider: 'minimax',
          model: 'MiniMax-M3',
          generatedAt: 1_753_000_000_000,
        },
      };
      return {
        notePath: document.note.path,
        expectedContentDigest: projection.contentDigest,
        truth: 'current' as const,
        projection,
        current: projection,
        latest: projection,
        stale: [],
        failed: [],
        provenance: projection.provenance,
      };
    }),
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
    })).resolves.toMatchObject({
      path: 'inbox/opc',
      title: 'OPC',
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'queued', revision: expect.stringMatching(/^note:/u) },
    });
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

  it('persists canonical Todo body, due, and all source links across update and full service reopen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-todo-canonical-int-'));
    tempDirs.push(dir);
    const first = createHarness(dir, false);
    const create = first.handlers.get(IPC_CHANNELS.TODOS_CREATE)!;
    const list = first.handlers.get(IPC_CHANNELS.TODOS_LIST)!;
    const update = first.handlers.get(IPC_CHANNELS.TODOS_UPDATE)!;

    const created = await create({}, {
      title: '来源回答待办',
      body: '不可丢失的最终回答正文',
      due_at_ms: null,
      remind_at_ms: null,
      note_links: ['notes/source-a.md', 'notes/source-b.md'],
    }) as { id: string | number };
    await expect(list({}, undefined)).resolves.toContainEqual(expect.objectContaining({
      id: created.id,
      title: '来源回答待办',
      body: '不可丢失的最终回答正文',
      due_at_ms: null,
      status: 'pending',
      note_links: ['notes/source-a.md', 'notes/source-b.md'],
    }));

    const dueAt = 1_785_552_200_000;
    await expect(update({}, {
      id: created.id,
      patch: {
        title: '已编辑来源回答待办',
        body: '重启前已编辑的正文',
        due_at_ms: dueAt,
        remind_at_ms: dueAt,
        note_links: ['notes/source-a.md', 'notes/source-c.md'],
      },
    })).resolves.toMatchObject({
      id: created.id,
      title: '已编辑来源回答待办',
      body: '重启前已编辑的正文',
      due_at_ms: dueAt,
      note_links: ['notes/source-a.md', 'notes/source-c.md'],
    });
    await first.service.close();

    const reopened = createHarness(dir, false);
    await expect(reopened.handlers.get(IPC_CHANNELS.TODOS_LIST)!({}, undefined))
      .resolves.toContainEqual(expect.objectContaining({
        id: created.id,
        title: '已编辑来源回答待办',
        body: '重启前已编辑的正文',
        due_at_ms: dueAt,
        status: 'pending',
        note_links: ['notes/source-a.md', 'notes/source-c.md'],
      }));
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

  it('commits locally before build and returns digest-bound WIKI truth through additive IPC', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-domain-int-'));
    tempDirs.push(dir);
    const harness = createHarness(dir, false);
    const receipt = await harness.handlers.get(IPC_CHANNELS.NOTES_CREATE_WITH_BUILD)!({}, {
      path: 'inbox/built',
      title: 'Built',
      body: 'canonical local bytes',
      tags: ['local-first'],
    });

    expect(receipt).toMatchObject({
      localState: 'LOCAL_SAVED',
      note: { path: 'inbox/built' },
      build: {
        state: 'BUILT',
        wiki: {
          truth: 'current',
          expectedContentDigest: 'a'.repeat(64),
        },
      },
    });
    await expect(harness.handlers.get(IPC_CHANNELS.WIKI_GET_FOR_NOTE)!({}, 'inbox/built'))
      .resolves.toMatchObject({
        notePath: 'inbox/built',
        truth: 'current',
        projection: { summary: '本地摘要' },
      });
    await expect(harness.handlers.get(IPC_CHANNELS.NOTES_UPDATE_WITH_BUILD)!({}, {
      path: 'inbox/built',
      patch: { body: 'updated canonical bytes' },
    })).resolves.toMatchObject({
      localState: 'LOCAL_SAVED',
      note: { path: 'inbox/built' },
      build: { state: 'BUILT', wiki: { truth: 'current' } },
    });
    expect(harness.kg.wikiForNote).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'updated canonical bytes\n' }),
    );
    await harness.service.close();
  });

  it('keeps LOCAL_SAVED readable when the build provider fails and redacts the raw failure', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-domain-int-'));
    tempDirs.push(dir);
    const harness = createHarness(dir, false);
    harness.kg.reindexNote.mockRejectedValueOnce(new Error('private endpoint and credential'));

    const receipt = await harness.handlers.get(IPC_CHANNELS.NOTES_CREATE_WITH_BUILD)!({}, {
      path: 'inbox/provider-failed',
      title: 'Provider failed',
      body: 'must remain local',
    });
    expect(receipt).toMatchObject({
      localState: 'LOCAL_SAVED',
      note: { path: 'inbox/provider-failed' },
      build: {
        state: 'BUILD_FAILED',
        failureStage: 'kg',
        failureReason: 'INTERNAL',
      },
    });
    expect(JSON.stringify(receipt)).not.toMatch(/private endpoint|credential/u);
    await expect(harness.handlers.get(IPC_CHANNELS.NOTES_GET)!({}, 'inbox/provider-failed'))
      .resolves.toMatchObject({ body: 'must remain local\n' });
    expect(fs.existsSync(path.join(dir, 'notes', 'inbox', 'provider-failed.md'))).toBe(true);
    await harness.service.close();
  });

  it('keeps older build receipts from overwriting newer local bytes via deferred reindex promises and external concurrent writes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-domain-int-'));
    tempDirs.push(dir);
    const harness = createHarness(dir, false);
    const create = harness.handlers.get(IPC_CHANNELS.NOTES_CREATE_WITH_BUILD)!;
    const update = harness.handlers.get(IPC_CHANNELS.NOTES_UPDATE_WITH_BUILD)!;
    const get = harness.handlers.get(IPC_CHANNELS.NOTES_GET)!;
    const wikiGet = harness.handlers.get(IPC_CHANNELS.WIKI_GET_FOR_NOTE)!;

    // External kb handle simulates a concurrent writer that bypasses the
    // service-level path lock. This is the only safe way to change local bytes
    // while A's build is still pending, since the path lock would otherwise
    // serialize all operations through the service.
    const externalKb = createDiskKb(dir);

    // Deferred A: first reindexNote call awaits external resolution.
    let resolveAReindex!: (value: unknown) => void;
    const deferredAReindex = new Promise<unknown>((resolve) => { resolveAReindex = resolve; });
    let reindexCallIndex = 0;
    const reindexInputs: Array<{ body: string; path: string }> = [];
    harness.kg.reindexNote.mockImplementation(async (doc: { note: { path: string }; body: string }) => {
      reindexCallIndex += 1;
      reindexInputs.push({ body: doc.body, path: doc.note.path });
      if (reindexCallIndex === 1) return deferredAReindex;
      return { entitiesAdded: 1, entitiesLinked: 1, status: 'done' as const };
    });

    // Operation A: commit local bytes 'older local bytes' then await reindex.
    const promiseA = create({}, {
      path: 'inbox/deferred-ab',
      title: 'Deferred A/B',
      body: 'older local bytes',
    });

    // Yield so A's local commit and reindex start happen.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reindexInputs).toHaveLength(1);
    expect(reindexInputs[0]?.body).toBe('older local bytes\n');

    // External writer replaces local bytes on disk + SQLite while A is in flight.
    externalKb.updateNote('inbox/deferred-ab', { body: 'newer local bytes', title: 'Newer title' });

    // A's reindex resolves with a stale KG payload that was produced from the
    // older bytes. A's isCurrentNoteDocument check must reject this.
    resolveAReindex({ entitiesAdded: 5, entitiesLinked: 5, status: 'done' });
    const receiptA = await promiseA;

    // A's build is marked NOTE_CHANGED_DURING_BUILD; no stale wiki or rag state.
    // The note field is the local commit (not the externally-updated one).
    expect(receiptA).toMatchObject({
      localState: 'LOCAL_SAVED',
      note: { path: 'inbox/deferred-ab', title: 'Deferred A/B' },
      build: {
        state: 'BUILD_FAILED',
        failureStage: 'kg',
        failureReason: 'NOTE_CHANGED_DURING_BUILD',
        wiki: { truth: 'missing', projection: null, current: null, latest: null },
      },
    });

    // The local bytes on disk remain the newer content — older build did not
    // overwrite them, and A's kg/wikiForNote was not consulted.
    await expect(get({}, 'inbox/deferred-ab'))
      .resolves.toMatchObject({ body: 'newer local bytes\n' });
    expect(reindexCallIndex).toBe(1); // A's reindexNote is the only call; B has not started.

    // Operation B: update on the same path with yet newer bytes. The path lock
    // released after A completed, so B can run normally. B's build must use
    // the latest local bytes and produce a current receipt.
    const receiptB = await update({}, {
      path: 'inbox/deferred-ab',
      patch: { body: 'newest local bytes' },
    });
    expect(receiptB).toMatchObject({
      localState: 'LOCAL_SAVED',
      build: { state: 'BUILT', wiki: { truth: 'current' } },
    });
    expect(reindexInputs.at(-1)?.body).toBe('newest local bytes\n');

    // B's wiki truth shows the current digest; A's stale kg payload is not
    // surfaced as the current truth.
    await expect(wikiGet({}, 'inbox/deferred-ab'))
      .resolves.toMatchObject({ truth: 'current', projection: { summary: '本地摘要' } });

    // Final local bytes are B's 'newest'; A did not leak older bytes.
    await expect(get({}, 'inbox/deferred-ab'))
      .resolves.toMatchObject({ body: 'newest local bytes\n' });
    await harness.service.close();
    externalKb.close();
  });
});
