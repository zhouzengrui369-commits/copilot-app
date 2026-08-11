import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KbClient } from '../../../../packages/kb/src/api/crud.js';
import { MdFileStore } from '../../../../packages/kb/src/store/md-file-store.js';
import { SqliteStore } from '../../../../packages/kb/src/store/sqlite-store.js';
import {
  LocalKnowledgeService,
  type LocalKnowledgeServiceOptions,
} from '../../src/main/local-knowledge-service.js';
import type {
  NoteDocument,
  WikiProjectionReceipt,
  WikiTruthReceipt,
} from '../../src/shared/domain-api.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createDiskKb(): KbClient {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-wiki-rag-bg-'));
  tempDirs.push(dir);
  return new KbClient({
    sqlite: new SqliteStore({ dbPath: path.join(dir, 'kb.sqlite') }),
    md: new MdFileStore({ rootDir: path.join(dir, 'notes') }),
  });
}

function currentWiki(document: NoteDocument): WikiTruthReceipt {
  const projection: WikiProjectionReceipt = {
    projectionId: 'projection-current',
    notePath: document.note.path,
    status: 'current',
    contentDigest: 'c'.repeat(64),
    summary: `summary:${document.body.trim()}`,
    tags: ['local'],
    entityIds: ['concept:local'],
    relationSignatures: [],
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
    truth: 'current',
    projection,
    current: projection,
    latest: projection,
    stale: [],
    failed: [],
    provenance: projection.provenance,
  };
}

function failedWiki(document: NoteDocument): WikiTruthReceipt {
  const projection: WikiProjectionReceipt = {
    projectionId: 'projection-failed',
    notePath: document.note.path,
    status: 'failed',
    contentDigest: 'f'.repeat(64),
    summary: null,
    tags: [],
    entityIds: [],
    relationSignatures: [],
    generatedAt: null,
    failureStage: 'provider',
    failureReason: 'WIKI_PROVIDER_DOWN',
    provenance: null,
  };
  return {
    notePath: document.note.path,
    expectedContentDigest: projection.contentDigest,
    truth: 'failed',
    projection,
    current: null,
    latest: null,
    stale: [],
    failed: [projection],
    provenance: null,
  };
}

function createService(options: {
  kb?: KbClient;
  reindexNote?: (document: NoteDocument) => Promise<{
    entitiesAdded: number;
    entitiesLinked: number;
    status?: 'done' | 'failed';
    reason?: string;
  }>;
  wikiForNote?: (document: NoteDocument) => Promise<WikiTruthReceipt> | WikiTruthReceipt;
  indexNote?: (document: NoteDocument) => Promise<{
    chunksInserted: number;
    errors: string[];
  }>;
}) {
  const kb = options.kb ?? createDiskKb();
  const kg = {
    getSubgraph: vi.fn(async () => ({ nodes: [], edges: [], degree: {} })),
    reindexNote: vi.fn(options.reindexNote ?? (async () => ({
      entitiesAdded: 1,
      entitiesLinked: 1,
      status: 'done' as const,
    }))),
    wikiForNote: vi.fn(options.wikiForNote ?? currentWiki),
    removeNote: vi.fn(async () => undefined),
  };
  const rag = {
    indexNote: vi.fn(options.indexNote ?? (async () => ({
      chunksInserted: 1,
      errors: [] as string[],
    }))),
    deleteNote: vi.fn(async () => undefined),
    ask: vi.fn(async () => ({ text: '', sources: [] as string[] })),
    close: vi.fn(async () => undefined),
  };
  const service = new LocalKnowledgeService({
    kb,
    kg,
    rag,
    settings: { get: () => false },
  } as unknown as LocalKnowledgeServiceOptions);
  return { service, kb, kg, rag };
}

function backgroundInternals(service: LocalKnowledgeService): {
  scheduleBackgroundBuild(notePath: string): void;
  backgroundBuilds: Map<string, Promise<void>>;
} {
  return service as unknown as {
    scheduleBackgroundBuild(notePath: string): void;
    backgroundBuilds: Map<string, Promise<void>>;
  };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('background local note build preserves WIKI-before-RAG truth', () => {
  it('returns LOCAL_SAVED + queued before a slow build, then exposes running and ready', async () => {
    let releaseBuild!: () => void;
    const buildGate = new Promise<void>((resolve) => { releaseBuild = resolve; });
    const builtBodies = new Set<string>();
    const { service, kg, rag } = createService({
      reindexNote: async (document) => {
        await buildGate;
        builtBodies.add(document.body);
        return { entitiesAdded: 1, entitiesLinked: 1, status: 'done' };
      },
      wikiForNote: (document) => builtBodies.has(document.body)
        ? currentWiki(document)
        : {
            ...currentWiki(document),
            truth: 'missing',
            projection: null,
            current: null,
            latest: null,
            provenance: null,
          },
    });

    const saved = await service.notes.create({
      path: 'inbox/slow',
      title: 'Slow',
      body: 'local bytes',
    });
    expect(saved).toMatchObject({
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'queued', revision: expect.stringMatching(/^note:/u) },
    });
    await expect(service.notes.get('inbox/slow')).resolves.toMatchObject({ body: 'local bytes\n' });
    await waitFor(() => kg.reindexNote.mock.calls.length === 1, 'slow KG build start');
    await expect(service.wiki.getForNote('inbox/slow')).resolves.toMatchObject({
      truth: 'missing',
      knowledgeBuild: { state: 'running' },
    });
    expect(rag.indexNote).not.toHaveBeenCalled();

    releaseBuild();
    await waitFor(() => rag.indexNote.mock.calls.length === 1, 'RAG after current WIKI');
    await expect(service.wiki.getForNote('inbox/slow')).resolves.toMatchObject({
      truth: 'current',
      knowledgeBuild: { state: 'ready' },
    });
    await service.close();
  });

  it('keeps exact current WIKI running until slow RAG settles and failed after RAG failure', async () => {
    let releaseRag!: () => void;
    const ragGate = new Promise<void>((resolve) => { releaseRag = resolve; });
    const { service, kb, rag } = createService({
      indexNote: async () => {
        await ragGate;
        return {
          chunksInserted: 0,
          errors: ['RAG_EMBEDDING_UNAVAILABLE'],
        };
      },
    });

    try {
      await service.notes.create({
        path: 'inbox/wiki-before-slow-rag',
        title: 'WIKI before slow RAG',
        body: 'digest-current local note',
      });
      await waitFor(() => rag.indexNote.mock.calls.length === 1, 'slow RAG start');
      expect(kb.listKgPending()
        .find((entry) => entry.note_path === 'inbox/wiki-before-slow-rag')?.status)
        .toBe('processing');
      await expect(service.wiki.getForNote('inbox/wiki-before-slow-rag')).resolves.toMatchObject({
        truth: 'current',
        knowledgeBuild: { state: 'running' },
      });

      releaseRag();
      await waitFor(
        () => kb.listKgPending()
          .find((entry) => entry.note_path === 'inbox/wiki-before-slow-rag')?.status === 'failed',
        'downstream RAG failure',
      );
      await expect(service.wiki.getForNote('inbox/wiki-before-slow-rag')).resolves.toMatchObject({
        truth: 'current',
        knowledgeBuild: { state: 'failed' },
      });
    } finally {
      releaseRag();
      await service.close();
    }
  });

  it('keeps a completed row for an older queued revision fail-closed', async () => {
    const notePath = 'inbox/stale-completed-revision';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-wiki-rag-revision-'));
    tempDirs.push(dir);
    let now = 1_753_100_000_000;
    const sqlite = new SqliteStore({ dbPath: path.join(dir, 'kb.sqlite') });
    const kb = new KbClient({
      sqlite,
      md: new MdFileStore({ rootDir: path.join(dir, 'notes') }),
      clock: () => now,
    });
    kb.createNote({ path: notePath, title: 'Revision', body: 'older bytes' });
    kb.setKgStatus(notePath, 'done');
    const { service } = createService({ kb });

    try {
      await expect(service.wiki.getForNote(notePath)).resolves.toMatchObject({
        truth: 'current',
        knowledgeBuild: { state: 'ready' },
      });

      now += 1_000;
      kb.updateNote(notePath, { body: 'newer bytes' });
      sqlite.queueKg(notePath, now - 1_000, 'done');
      await expect(service.wiki.getForNote(notePath)).resolves.toMatchObject({
        truth: 'current',
        knowledgeBuild: { state: 'not-ready' },
      });
    } finally {
      await service.close();
    }
  });

  it('keeps non-current and mismatched WIKI receipts fail-closed', async () => {
    const notePath = 'inbox/non-current-wiki';
    const kb = createDiskKb();
    kb.createNote({
      path: notePath,
      title: 'Non-current WIKI',
      body: 'local bytes',
    });
    let receiptKind: 'missing' | 'stale' | 'failed' | 'wrong-path' | 'wrong-digest' = 'missing';
    const { service } = createService({
      kb,
      wikiForNote: (document) => {
        const exact = currentWiki(document);
        const projection = exact.current!;
        if (receiptKind === 'missing') {
          return {
            ...exact,
            truth: 'missing',
            projection: null,
            current: null,
            latest: null,
            provenance: null,
          };
        }
        if (receiptKind === 'stale') {
          const stale = { ...projection, status: 'stale' as const };
          return {
            ...exact,
            truth: 'stale',
            projection: stale,
            current: null,
            latest: stale,
            stale: [stale],
          };
        }
        if (receiptKind === 'failed') return failedWiki(document);
        if (receiptKind === 'wrong-path') {
          const wrongPath = { ...projection, notePath: 'inbox/other-note' };
          return {
            ...exact,
            notePath: wrongPath.notePath,
            projection: wrongPath,
            current: wrongPath,
            latest: wrongPath,
          };
        }
        const wrongDigest = { ...projection, contentDigest: 'd'.repeat(64) };
        return {
          ...exact,
          projection: wrongDigest,
          current: wrongDigest,
          latest: wrongDigest,
        };
      },
    });

    try {
      const cases = [
        { kind: 'missing', queue: 'pending', truth: 'missing', state: 'queued' },
        { kind: 'missing', queue: 'processing', truth: 'missing', state: 'running' },
        { kind: 'failed', queue: 'failed', truth: 'failed', state: 'failed' },
        { kind: 'stale', queue: 'done', truth: 'stale', state: 'not-ready' },
        { kind: 'wrong-path', queue: 'done', truth: 'current', state: 'not-ready' },
        { kind: 'wrong-digest', queue: 'done', truth: 'current', state: 'not-ready' },
      ] as const;
      for (const item of cases) {
        receiptKind = item.kind;
        kb.setKgStatus(notePath, item.queue);
        await expect(service.wiki.getForNote(notePath)).resolves.toMatchObject({
          truth: item.truth,
          knowledgeBuild: { state: item.state },
        });
      }
    } finally {
      await service.close();
    }
  });

  it('retains the note and blocks RAG when KG/WIKI fails', async () => {
    const { service, kb, rag } = createService({
      reindexNote: async () => ({
        entitiesAdded: 0,
        entitiesLinked: 0,
        status: 'failed',
        reason: 'WIKI_PROVIDER_DOWN',
      }),
      wikiForNote: failedWiki,
    });
    await expect(service.notes.create({
      path: 'inbox/failed',
      title: 'Failed',
      body: 'must remain local',
    })).resolves.toMatchObject({
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'queued' },
    });
    await waitFor(
      () => kb.listKgPending()
        .find((entry) => entry.note_path === 'inbox/failed')?.status === 'failed',
      'durable failed state',
    );
    await expect(service.notes.get('inbox/failed'))
      .resolves.toMatchObject({ body: 'must remain local\n' });
    await expect(service.wiki.getForNote('inbox/failed')).resolves.toMatchObject({
      truth: 'failed',
      knowledgeBuild: { state: 'failed' },
    });
    expect(rag.indexNote).not.toHaveBeenCalled();
    await service.close();
  });

  it('serializes per path and only indexes the latest write', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const reindexBodies: string[] = [];
    const builtBodies = new Set<string>();
    const { service, kg, rag } = createService({
      reindexNote: async (document) => {
        reindexBodies.push(document.body);
        if (reindexBodies.length === 1) await firstGate;
        builtBodies.add(document.body);
        return { entitiesAdded: 1, entitiesLinked: 1, status: 'done' };
      },
      wikiForNote: (document) => builtBodies.has(document.body)
        ? currentWiki(document)
        : failedWiki(document),
    });

    await service.notes.create({
      path: 'inbox/latest',
      title: 'Latest',
      body: 'older',
    });
    await waitFor(() => kg.reindexNote.mock.calls.length === 1, 'first build start');
    const updated = await service.notes.update({
      path: 'inbox/latest',
      patch: { body: 'newest' },
    });
    expect(updated).toMatchObject({
      localState: 'LOCAL_SAVED',
      knowledgeBuild: { state: 'queued' },
    });

    releaseFirst();
    await waitFor(() => kg.reindexNote.mock.calls.length === 2, 'latest build start');
    await waitFor(() => rag.indexNote.mock.calls.length === 1, 'latest RAG index');
    expect(reindexBodies).toEqual(['older\n', 'newest\n']);
    expect(rag.indexNote).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'newest\n' }),
    );
    await expect(service.notes.get('inbox/latest')).resolves.toMatchObject({ body: 'newest\n' });
    await expect(service.wiki.getForNote('inbox/latest')).resolves.toMatchObject({
      truth: 'current',
      knowledgeBuild: { state: 'ready' },
    });
    await service.close();
  });

  it('hands a settlement-window generation to a successor owner without losing its wakeup', async () => {
    const notePath = 'inbox/settlement-handoff';
    const kb = createDiskKb();
    const originalRead = kb.readNote.bind(kb);
    const originalUpdate = kb.updateNote.bind(kb);
    const originalSetKgStatus = kb.setKgStatus.bind(kb);
    let armSettlementMutation = false;
    let mutationFired = false;
    let service!: LocalKnowledgeService;
    let resolveLatestDone!: () => void;
    const latestDone = new Promise<void>((resolve) => { resolveLatestDone = resolve; });
    const reindexBodies: string[] = [];
    const ragBodies: string[] = [];
    let activeBuilds = 0;
    let maxActiveBuilds = 0;

    kb.setKgStatus = ((pathValue, status) => {
      originalSetKgStatus(pathValue, status);
      if (pathValue !== notePath || status !== 'done') return;
      const currentBody = originalRead(pathValue)?.body;
      if (currentBody === 'newest settlement bytes\n') {
        resolveLatestDone();
      } else {
        armSettlementMutation = true;
      }
    }) as KbClient['setKgStatus'];
    kb.readNote = ((pathValue) => {
      const snapshot = originalRead(pathValue);
      if (pathValue === notePath && armSettlementMutation && !mutationFired) {
        mutationFired = true;
        originalUpdate(notePath, { body: 'newest settlement bytes' });
        backgroundInternals(service).scheduleBackgroundBuild(notePath);
      }
      return snapshot;
    }) as KbClient['readNote'];

    const harness = createService({
      kb,
      reindexNote: async (document) => {
        activeBuilds += 1;
        maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
        reindexBodies.push(document.body);
        await Promise.resolve();
        activeBuilds -= 1;
        return { entitiesAdded: 1, entitiesLinked: 1, status: 'done' };
      },
      indexNote: async (document) => {
        ragBodies.push(document.body);
        return { chunksInserted: 1, errors: [] };
      },
    });
    service = harness.service;

    await service.notes.create({
      path: notePath,
      title: 'Settlement handoff',
      body: 'older settlement bytes',
    });
    await latestDone;

    expect(mutationFired).toBe(true);
    expect(maxActiveBuilds).toBe(1);
    expect(reindexBodies).toEqual([
      'older settlement bytes\n',
      'newest settlement bytes\n',
    ]);
    expect(ragBodies).toEqual([
      'older settlement bytes\n',
      'newest settlement bytes\n',
    ]);
    expect(originalRead(notePath)?.body).toBe('newest settlement bytes\n');
    expect(kb.listKgPending().find((entry) => entry.note_path === notePath)?.status)
      .toBe('done');
    await service.close();
  });

  it('hands a rejection-window generation to a successor owner with no unhandled rejection', async () => {
    const notePath = 'inbox/rejection-handoff';
    const kb = createDiskKb();
    const originalRead = kb.readNote.bind(kb);
    const originalUpdate = kb.updateNote.bind(kb);
    const originalSetKgStatus = kb.setKgStatus.bind(kb);
    let rejectionFired = false;
    let service!: LocalKnowledgeService;
    let resolveLatestDone!: () => void;
    const latestDone = new Promise<void>((resolve) => { resolveLatestDone = resolve; });
    const reindexBodies: string[] = [];
    const ragBodies: string[] = [];
    let activeBuilds = 0;
    let maxActiveBuilds = 0;
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    kb.setKgStatus = ((pathValue, status) => {
      originalSetKgStatus(pathValue, status);
      if (
        pathValue === notePath
        && status === 'done'
        && originalRead(pathValue)?.body === 'newest rejection bytes\n'
      ) {
        resolveLatestDone();
      }
    }) as KbClient['setKgStatus'];
    kb.readNote = ((pathValue) => {
      const snapshot = originalRead(pathValue);
      if (
        pathValue === notePath
        && !rejectionFired
        && backgroundInternals(service).backgroundBuilds.size === 1
      ) {
        rejectionFired = true;
        originalUpdate(notePath, { body: 'newest rejection bytes' });
        backgroundInternals(service).scheduleBackgroundBuild(notePath);
        throw new Error('deterministic rejection-window fault');
      }
      return snapshot;
    }) as KbClient['readNote'];

    const harness = createService({
      kb,
      reindexNote: async (document) => {
        activeBuilds += 1;
        maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
        reindexBodies.push(document.body);
        await Promise.resolve();
        activeBuilds -= 1;
        return { entitiesAdded: 1, entitiesLinked: 1, status: 'done' };
      },
      indexNote: async (document) => {
        ragBodies.push(document.body);
        return { chunksInserted: 1, errors: [] };
      },
    });
    service = harness.service;

    try {
      await service.notes.create({
        path: notePath,
        title: 'Rejection handoff',
        body: 'older rejection bytes',
      });
      await latestDone;
      await Promise.resolve();
      await Promise.resolve();

      expect(rejectionFired).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
      expect(maxActiveBuilds).toBe(1);
      expect(reindexBodies).toEqual(['newest rejection bytes\n']);
      expect(ragBodies).toEqual(['newest rejection bytes\n']);
      expect(originalRead(notePath)?.body).toBe('newest rejection bytes\n');
      expect(kb.listKgPending().find((entry) => entry.note_path === notePath)?.status)
        .toBe('done');
    } finally {
      process.off('unhandledRejection', unhandled);
      await service.close();
    }
  });

  it('recovers a durable processing row on startup without delaying readiness', async () => {
    const kb = createDiskKb();
    kb.createNote({ path: 'inbox/recover', title: 'Recover', body: 'persisted' });
    kb.setKgStatus('inbox/recover', 'processing');
    const { service, rag } = createService({ kb });

    service.reconcileKnowledgeBuildStartup();
    await waitFor(() => rag.indexNote.mock.calls.length === 1, 'recovered RAG index');
    expect(kb.listKgPending().find((entry) => entry.note_path === 'inbox/recover')?.status)
      .toBe('done');
    await expect(service.wiki.getForNote('inbox/recover')).resolves.toMatchObject({
      truth: 'current',
      knowledgeBuild: { state: 'ready' },
    });
    await service.close();
  });
});
