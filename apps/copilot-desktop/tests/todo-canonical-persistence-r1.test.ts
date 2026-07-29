import { describe, expect, it } from 'vitest';
import {
  LocalKnowledgeService,
  type LocalKnowledgeServiceOptions,
} from '../src/main/local-knowledge-service.js';

interface StoredDocument {
  note: {
    path: string;
    title: string;
    type: string;
    status: string;
    tags: string[];
    related: string[];
    created_at: number;
    updated_at: number;
  };
  body: string;
}

type WriteMode = 'canonical' | 'absent' | 'wrong-id' | 'mismatch';

class TodoKb {
  readonly documents = new Map<string, StoredDocument>();

  constructor(
    private readonly createMode: WriteMode = 'canonical',
    private readonly updateMode: WriteMode = 'canonical',
  ) {}

  createNote(input: Record<string, unknown>) {
    const path = String(input.path);
    if (this.createMode === 'absent') return null;
    const body = mutateTodoBody(String(input.body), this.createMode);
    const document: StoredDocument = {
      note: {
        path,
        title: String(input.title),
        type: String(input.type),
        status: String(input.status),
        tags: [...(input.tags as string[])],
        related: [...(input.related as string[])],
        created_at: 1_000,
        updated_at: 1_000,
      },
      body,
    };
    this.documents.set(path, document);
    return document.note;
  }

  readNote(path: string) {
    return this.documents.get(path) ?? null;
  }

  updateNote(path: string, patch: Record<string, unknown>) {
    const current = this.documents.get(path);
    if (!current) return null;
    if (this.updateMode === 'absent') {
      this.documents.delete(path);
      return current.note;
    }
    const body = mutateTodoBody(String(patch.body), this.updateMode);
    const document: StoredDocument = {
      note: {
        ...current.note,
        title: typeof patch.title === 'string' ? patch.title : current.note.title,
        status: typeof patch.status === 'string' ? patch.status : current.note.status,
        related: Array.isArray(patch.related) ? [...patch.related] : current.note.related,
        updated_at: current.note.updated_at + 1,
      },
      body,
    };
    this.documents.set(path, document);
    return document.note;
  }

  listNotes(filter?: Record<string, unknown>) {
    let items = [...this.documents.values()].map(({ note }) => note);
    if (filter?.type) items = items.filter((note) => note.type === filter.type);
    if (Array.isArray(filter?.tags)) {
      items = items.filter((note) => (
        (filter.tags as string[]).every((tag) => note.tags.includes(tag))
      ));
    }
    return { items, total: items.length, limit: 1_000, offset: 0 };
  }

  deleteNote(path: string) {
    return this.documents.delete(path);
  }

  close() {}
}

function mutateTodoBody(body: string, mode: WriteMode): string {
  if (mode === 'canonical') return body;
  const value = JSON.parse(body) as Record<string, unknown>;
  if (mode === 'wrong-id') value.id = 'wrong-id';
  if (mode === 'mismatch') value.body = 'mismatched persisted body';
  return JSON.stringify(value);
}

function createService(kb: TodoKb): LocalKnowledgeService {
  return new LocalKnowledgeService({
    kb,
    kg: {
      getSubgraph: async () => ({ nodes: [], edges: [], degree: {} }),
      reindexNote: async () => ({ entitiesAdded: 0, entitiesLinked: 0 }),
      removeNote: async () => undefined,
      relatedNotes: async () => [],
      wikiForNote: async () => ({
        notePath: '',
        expectedContentDigest: null,
        truth: 'missing',
        projection: null,
        current: null,
        latest: null,
        stale: [],
        failed: [],
        provenance: null,
      }),
      close: () => undefined,
    },
    rag: {
      indexNote: async () => ({ chunksInserted: 0, errors: [] }),
      deleteNote: async () => undefined,
      ask: async () => ({ text: '', sources: [] }),
      close: async () => undefined,
    },
    settings: { get: () => false },
    clock: () => 1_000,
    uuid: () => 'todo-canonical',
  } as unknown as LocalKnowledgeServiceOptions);
}

describe('EXP-COP-008 canonical Todo persistence', () => {
  it.each([
    ['absent canonical readback', 'absent'],
    ['wrong canonical id', 'wrong-id'],
    ['mismatched canonical fields', 'mismatch'],
  ] as const)('fails closed after create when %s', async (_label, mode) => {
    const service = createService(new TodoKb(mode));
    await expect(service.todos.create({
      title: 'Grounded action',
      body: 'Answer context',
      due_at_ms: null,
      note_links: ['knowledge/source-a'],
    })).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it.each([
    ['absent canonical readback', 'absent'],
    ['wrong canonical id', 'wrong-id'],
    ['mismatched canonical fields', 'mismatch'],
  ] as const)('fails closed after update when %s', async (_label, mode) => {
    const kb = new TodoKb('canonical', mode);
    const service = createService(kb);
    const created = await service.todos.create({
      title: 'Grounded action',
      body: 'Answer context',
      due_at_ms: null,
      note_links: ['knowledge/source-a'],
    });

    await expect(service.todos.update({
      id: created.id,
      patch: {
        title: 'Edited action',
        body: 'Edited answer context',
        due_at_ms: 1_753_000_000_000,
        note_links: ['knowledge/source-a', 'knowledge/source-b'],
      },
    })).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('returns the canonical persisted record for create and update', async () => {
    const service = createService(new TodoKb());
    const created = await service.todos.create({
      title: 'Grounded action',
      body: 'Answer context',
      due_at_ms: null,
      note_links: ['knowledge/source-a'],
    });
    expect(created).toMatchObject({
      id: 'todo-canonical',
      title: 'Grounded action',
      body: 'Answer context',
      due_at_ms: null,
      note_links: ['knowledge/source-a'],
    });

    await expect(service.todos.update({
      id: created.id,
      patch: {
        title: 'Edited action',
        body: 'Edited answer context',
        due_at_ms: 1_753_000_000_000,
        note_links: ['knowledge/source-a', 'knowledge/source-b'],
      },
    })).resolves.toMatchObject({
      id: 'todo-canonical',
      title: 'Edited action',
      body: 'Edited answer context',
      due_at_ms: 1_753_000_000_000,
      note_links: ['knowledge/source-a', 'knowledge/source-b'],
    });
  });
});
