import type {
  CopilotNote,
  CopilotNoteInput,
  CopilotNoteSummary,
  CopilotProductApi,
  CopilotTodo,
} from '../lib/copilot-api.js';
import type {
  RendererTrashItem,
  TrashPurgeRequest,
  TrashRestoreRequest,
  WikiProjectionReceipt,
  WikiTruthReceipt,
} from '../../shared/domain-api.js';
import type {
  BrowserPrototypeRuntime,
  BrowserPrototypeScenario,
} from '../preload-shim.js';

const PROTOTYPE_LABEL = 'PROTOTYPE / NOT_RUNTIME_PROOF' as const;

function scenarioFromLocation(): BrowserPrototypeScenario {
  const requested = new URLSearchParams(window.location.search).get('prototype');
  if (requested === 'empty' || requested === 'failure') return requested;
  return 'ready';
}

function missingWiki(path: string): WikiTruthReceipt {
  return {
    notePath: path,
    expectedContentDigest: null,
    truth: 'missing',
    projection: null,
    current: null,
    latest: null,
    stale: [],
    failed: [],
    provenance: null,
    knowledgeBuild: {
      state: 'not-ready',
      revision: null,
    },
  };
}

function currentWiki(
  note: CopilotNote,
  summary: string,
  tags: string[],
): WikiTruthReceipt {
  const contentDigest = `prototype:${note.path}:${note.updatedAt ?? 0}`;
  const projection: WikiProjectionReceipt = {
    projectionId: `prototype-wiki:${note.path}`,
    notePath: note.path,
    status: 'current',
    contentDigest,
    summary,
    tags,
    entityIds: [],
    relationSignatures: [],
    generatedAt: note.updatedAt ?? null,
    failureStage: null,
    failureReason: null,
    provenance: {
      provider: 'prototype-fixture',
      model: 'not-runtime-proof',
      generatedAt: note.updatedAt ?? 0,
    },
  };
  return {
    notePath: note.path,
    expectedContentDigest: contentDigest,
    truth: 'current',
    projection,
    current: projection,
    latest: projection,
    stale: [],
    failed: [],
    provenance: projection.provenance,
    knowledgeBuild: {
      state: 'ready',
      revision: contentDigest,
    },
  };
}

function savedNote(input: CopilotNoteInput, updatedAt = Date.now()): CopilotNote {
  return {
    ...input,
    tags: input.tags ?? [],
    type: input.type ?? 'note',
    status: input.status ?? 'active',
    updatedAt,
    localState: 'LOCAL_SAVED',
    knowledgeBuild: {
      state: 'not-ready',
      revision: `prototype:${updatedAt}`,
    },
  };
}

function trashItem(
  kind: RendererTrashItem['kind'],
  title: string,
  ordinal: number,
): RendererTrashItem {
  return {
    trashId: `prototype-trash-${ordinal}`,
    kind,
    title,
    revision: `prototype:${ordinal}`,
    state: 'trashed',
    movedAt: Date.now(),
    recoveryRequired: false,
  };
}

function createPrototypeApi(scenario: BrowserPrototypeScenario): CopilotProductApi {
  const now = Date.now();
  const notes = new Map<string, CopilotNote>();
  const todos = new Map<string, CopilotTodo>();
  const trash = new Map<string, {
    receipt: RendererTrashItem;
    note?: CopilotNote;
    todo?: CopilotTodo;
  }>();
  const wiki = new Map<string, WikiTruthReceipt>();
  let nextTodo = 3;
  let nextTrash = 1;

  if (scenario === 'ready') {
    const seedNotes: CopilotNote[] = [
      savedNote({
        path: 'inbox/mvp-acceptance',
        title: 'MVP 验收清单',
        body: '<article><h1>MVP 验收清单</h1><p>先验证今天与知识主旅程，再进入 Electron 运行门。</p></article>',
        tags: ['mvp', '验收'],
        type: 'note',
        status: 'active',
      }, now - 3_600_000),
      savedNote({
        path: 'projects/copilot-html-first',
        title: 'HTML-first 交付记录',
        body: '# HTML-first 交付记录\n\n同源 renderer、显式 fixture 边界、浏览器操作验收。',
        tags: ['copilot', '交付'],
        type: 'article',
        status: 'active',
      }, now - 1_800_000),
    ];
    seedNotes.forEach((note) => notes.set(note.path, note));
    const acceptance = notes.get('inbox/mvp-acceptance');
    const delivery = notes.get('projects/copilot-html-first');
    if (acceptance) {
      wiki.set(
        acceptance.path,
        currentWiki(
          acceptance,
          '<article><h2>已整理的 MVP 验收清单</h2><p>先验证 F0 人机旅程，再进入真实 Electron 运行门。</p><script>window.__R44_UNSAFE_HTML_EXECUTED__=true</script>',
          ['mvp', '验收'],
        ),
      );
    }
    if (delivery) {
      wiki.set(
        delivery.path,
        currentWiki(
          delivery,
          '# 已整理的 HTML-first 交付摘要\n\n同源 renderer 保留显式 fixture 与运行证据边界。',
          ['copilot', '交付'],
        ),
      );
    }
    [
      {
        id: 'prototype-todo-1',
        title: '验证 Today 主旅程',
        status: 'pending',
        dueAt: now,
        remindAt: null,
        linkedNotePaths: ['inbox/mvp-acceptance'],
      },
      {
        id: 'prototype-todo-2',
        title: '检查 Knowledge MOC',
        status: 'done',
        dueAt: now + 3_600_000,
        remindAt: null,
        linkedNotePaths: ['projects/copilot-html-first'],
      },
    ].forEach((todo) => todos.set(String(todo.id), todo as CopilotTodo));
  }

  const requireFixtureAvailable = () => {
    if (scenario === 'failure') {
      throw new Error('PROTOTYPE FAILURE FIXTURE · NOT_RUNTIME_PROOF');
    }
  };

  const listNotes = (): CopilotNoteSummary[] => [...notes.values()].map((note) => ({
    path: note.path,
    title: note.title,
    tags: note.tags,
    type: note.type,
    status: note.status,
    updatedAt: note.updatedAt,
  }));

  const restore = async (request: TrashRestoreRequest): Promise<RendererTrashItem> => {
    requireFixtureAvailable();
    const entry = trash.get(request.trashId);
    if (!entry || entry.receipt.revision !== request.revision) {
      throw new Error('PROTOTYPE trash receipt not found');
    }
    if (entry.note) notes.set(entry.note.path, entry.note);
    if (entry.todo) todos.set(String(entry.todo.id), entry.todo);
    const restored = { ...entry.receipt, state: 'restored' as const };
    trash.delete(request.trashId);
    return restored;
  };

  return {
    notes: {
      list: async () => {
        requireFixtureAvailable();
        return listNotes();
      },
      get: async (path) => {
        requireFixtureAvailable();
        return notes.get(path) ?? null;
      },
      create: async (input) => {
        requireFixtureAvailable();
        const note = savedNote(input);
        notes.set(note.path, note);
        return note;
      },
      update: async (path, patch) => {
        requireFixtureAvailable();
        const current = notes.get(path);
        if (!current) return null;
        const next = savedNote({
          path: patch.path ?? current.path,
          title: patch.title ?? current.title,
          body: patch.body ?? current.body,
          tags: patch.tags ?? current.tags,
          type: patch.type ?? current.type,
          status: patch.status ?? current.status,
        });
        notes.delete(path);
        notes.set(next.path, next);
        return next;
      },
      remove: async (path) => {
        requireFixtureAvailable();
        return notes.delete(path);
      },
      getBacklinks: async () => {
        requireFixtureAvailable();
        return [];
      },
    },
    wiki: {
      getForNote: async (path) => {
        requireFixtureAvailable();
        return wiki.get(path) ?? missingWiki(path);
      },
    },
    kg: {
      getSubgraph: async () => {
        requireFixtureAvailable();
        return { nodes: [], edges: [], degree: {} };
      },
      reindexNote: async () => {
        requireFixtureAvailable();
        return { prototype: true, runtimeProof: false };
      },
    },
    rag: {
      ask: async () => {
        requireFixtureAvailable();
        return {
          text: 'PROTOTYPE / NOT_RUNTIME_PROOF / NOT_PROBED',
          sources: [],
        };
      },
    },
    todos: {
      list: async () => {
        requireFixtureAvailable();
        return [...todos.values()];
      },
      create: async (input) => {
        requireFixtureAvailable();
        const todo: CopilotTodo = {
          ...input,
          id: `prototype-todo-${nextTodo++}`,
          status: 'pending',
        };
        todos.set(String(todo.id), todo);
        return todo;
      },
      update: async (id, patch) => {
        requireFixtureAvailable();
        const current = todos.get(String(id));
        if (!current) return null;
        const next = { ...current, ...patch };
        todos.set(String(id), next);
        return next;
      },
      remove: async (id) => {
        requireFixtureAvailable();
        return todos.delete(String(id));
      },
      listDue: async () => {
        requireFixtureAvailable();
        return [];
      },
      markReminderFired: async (id) => {
        requireFixtureAvailable();
        return todos.get(String(id)) ?? null;
      },
    },
    trash: {
      moveNote: async (path) => {
        requireFixtureAvailable();
        const note = notes.get(path);
        if (!note) throw new Error('PROTOTYPE note not found');
        const receipt = trashItem('note', note.title, nextTrash++);
        notes.delete(path);
        trash.set(receipt.trashId, { receipt, note });
        return receipt;
      },
      moveTodo: async (id) => {
        requireFixtureAvailable();
        const todo = todos.get(String(id));
        if (!todo) throw new Error('PROTOTYPE todo not found');
        const receipt = trashItem('todo', todo.title, nextTrash++);
        todos.delete(String(id));
        trash.set(receipt.trashId, { receipt, todo });
        return receipt;
      },
      list: async () => {
        requireFixtureAvailable();
        return [...trash.values()].map(({ receipt }) => receipt);
      },
      restore,
      purge: async (request: TrashPurgeRequest) => {
        requireFixtureAvailable();
        const entry = trash.get(request.trashId);
        if (!entry || entry.receipt.revision !== request.revision) {
          throw new Error('PROTOTYPE trash receipt not found');
        }
        trash.delete(request.trashId);
        return { ...entry.receipt, state: 'purged' };
      },
    },
  };
}

export function installBrowserPrototype(): BrowserPrototypeRuntime {
  const scenario = scenarioFromLocation();
  const runtime: BrowserPrototypeRuntime = {
    api: createPrototypeApi(scenario),
    scenario,
    label: PROTOTYPE_LABEL,
  };
  window.__COPILOT_BROWSER_PROTOTYPE__ = runtime;
  return runtime;
}
