import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/ipc-channels.js';

const electron = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    exposedName: null as string | null,
    bridge: null as any,
    listeners,
    exposeInMainWorld: vi.fn((name: string, bridge: unknown) => {
      electron.exposedName = name;
      electron.bridge = bridge;
    }),
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'local-asr:status') {
        return { ok: true, value: { active: false, lastErrorCode: null, state: 'AVAILABLE' } };
      }
      if (channel === 'local-asr:decode') {
        return {
          ok: true,
          value: {
            requestId: '123e4567-e89b-42d3-a456-426614174000',
            transcript: 'local transcript',
            timings: { decodeMs: 1, totalMs: 2 },
          },
        };
      }
      if (channel === 'local-asr:cancel') {
        return {
          ok: true,
          value: {
            requestId: '123e4567-e89b-42d3-a456-426614174000',
            cancelled: true,
          },
        };
      }
      return { channel, payload };
    }),
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      const current = electron.listeners.get(channel) ?? [];
      current.push(listener);
      electron.listeners.set(channel, current);
    }),
    removeListener: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      electron.listeners.set(
        channel,
        (electron.listeners.get(channel) ?? []).filter((candidate) => candidate !== listener),
      );
    }),
    send: vi.fn(),
  };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    on: electron.on,
    removeListener: electron.removeListener,
    send: electron.send,
  },
}));

beforeAll(async () => {
  await import('../src/main/preload.js');
});

function expected(channel: string, payload?: unknown) {
  return { channel, payload };
}

describe('preload complete critical bridge', () => {
  it('exposes exactly one narrow Copilot bridge with trusted runtime metadata', () => {
    expect(electron.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(electron.exposedName).toBe('copilot');
    expect(electron.bridge.meta).toMatchObject({
      productName: 'njx-copilot-v6',
      runtime: {
        source: 'electron-preload-process-versions',
        shell: 'electron',
        localAsrCapabilities: [],
      },
    });
  });

  it('executes every settings, window and startup bridge function', async () => {
    const bridge = electron.bridge;
    await expect(bridge.settings.get()).resolves.toEqual(expected(IPC_CHANNELS.SETTINGS_GET));
    await expect(bridge.settings.setCloudBackup(false)).resolves.toEqual(
      expected(IPC_CHANNELS.SETTINGS_SET_CLOUD_BACKUP, false),
    );
    await expect(bridge.settings.setTheme('dark')).resolves.toEqual(
      expected(IPC_CHANNELS.SETTINGS_SET_THEME, 'dark'),
    );
    await expect(bridge.settings.setWindowBounds({ width: 900, height: 700 })).resolves.toEqual(
      expected(IPC_CHANNELS.SETTINGS_SET_WINDOW_BOUNDS, { width: 900, height: 700 }),
    );
    await expect(bridge.settings.setShortcuts([{ id: 'capture', label: 'Capture', accelerator: 'Cmd+K' }]))
      .resolves.toEqual(expected(IPC_CHANNELS.SETTINGS_SET_SHORTCUTS, [
        { id: 'capture', label: 'Capture', accelerator: 'Cmd+K' },
      ]));
    const model = { provider: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' };
    await expect(bridge.settings.setModelApi(model)).resolves.toEqual(
      expected(IPC_CHANNELS.SETTINGS_SET_MODEL_API, model),
    );
    await expect(bridge.settings.reset()).resolves.toEqual(expected(IPC_CHANNELS.SETTINGS_RESET));

    await expect(bridge.window.minimize()).resolves.toEqual(expected(IPC_CHANNELS.WINDOW_MINIMIZE));
    await expect(bridge.window.toggleMaximize()).resolves.toEqual(expected(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE));
    await expect(bridge.window.close()).resolves.toEqual(expected(IPC_CHANNELS.WINDOW_CLOSE));
    await expect(bridge.startup.getMilestones()).resolves.toEqual(
      expected(IPC_CHANNELS.STARTUP_GET_MILESTONES),
    );
    expect(bridge.startup.isComplete()).toBe(false);
    bridge.startup.appRootVisible();
    expect(electron.send).toHaveBeenCalledWith(IPC_CHANNELS.STARTUP_APP_ROOT_VISIBLE);
    const complete = electron.listeners.get(IPC_CHANNELS.STARTUP_COMPLETE)?.[0];
    expect(complete).toBeTypeOf('function');
    complete?.({}, undefined);
    expect(bridge.startup.isComplete()).toBe(true);
  });

  it('executes every local-first domain, conversation, Todo and Trash bridge function', async () => {
    const bridge = electron.bridge;
    const calls: Array<[() => Promise<unknown>, string, unknown?]> = [
      [() => bridge.notes.list({ limit: 2 }), IPC_CHANNELS.NOTES_LIST, { limit: 2 }],
      [() => bridge.notes.get('notes/a'), IPC_CHANNELS.NOTES_GET, 'notes/a'],
      [() => bridge.notes.create({ path: 'notes/a' }), IPC_CHANNELS.NOTES_CREATE, { path: 'notes/a' }],
      [() => bridge.notes.createWithBuild({ path: 'notes/a' }), IPC_CHANNELS.NOTES_CREATE_WITH_BUILD, { path: 'notes/a' }],
      [() => bridge.notes.update({ path: 'notes/a' }), IPC_CHANNELS.NOTES_UPDATE, { path: 'notes/a' }],
      [() => bridge.notes.updateWithBuild({ path: 'notes/a' }), IPC_CHANNELS.NOTES_UPDATE_WITH_BUILD, { path: 'notes/a' }],
      [() => bridge.notes.remove('notes/a'), IPC_CHANNELS.NOTES_REMOVE, 'notes/a'],
      [() => bridge.notes.getBacklinks('notes/a'), IPC_CHANNELS.NOTES_GET_BACKLINKS, 'notes/a'],
      [() => bridge.wiki.getForNote('notes/a'), IPC_CHANNELS.WIKI_GET_FOR_NOTE, 'notes/a'],
      [() => bridge.kg.getSubgraph({ center: 'a' }), IPC_CHANNELS.KG_GET_SUBGRAPH, { center: 'a' }],
      [() => bridge.kg.reindexNote('notes/a'), IPC_CHANNELS.KG_REINDEX_NOTE, 'notes/a'],
      [() => bridge.rag.ask('question'), IPC_CHANNELS.RAG_ASK, 'question'],
      [() => bridge.rag.startStream({ requestId: 'r', question: 'q' }), IPC_CHANNELS.RAG_STREAM_START, { requestId: 'r', question: 'q' }],
      [() => bridge.rag.cancelStream('r'), IPC_CHANNELS.RAG_STREAM_CANCEL, 'r'],
      [() => bridge.askConversation.save({ messages: [] }), IPC_CHANNELS.ASK_CONVERSATION_SAVE, { messages: [] }],
      [() => bridge.askConversation.load(), IPC_CHANNELS.ASK_CONVERSATION_LOAD, undefined],
      [() => bridge.askConversation.clear(), IPC_CHANNELS.ASK_CONVERSATION_CLEAR, undefined],
      [() => bridge.todos.list({ status: 'pending' }), IPC_CHANNELS.TODOS_LIST, { status: 'pending' }],
      [() => bridge.todos.create({ title: 'x' }), IPC_CHANNELS.TODOS_CREATE, { title: 'x' }],
      [() => bridge.todos.update({ id: '1', patch: {} }), IPC_CHANNELS.TODOS_UPDATE, { id: '1', patch: {} }],
      [() => bridge.todos.remove('1'), IPC_CHANNELS.TODOS_REMOVE, '1'],
      [() => bridge.todos.listDue(100), IPC_CHANNELS.TODOS_LIST_DUE, 100],
      [() => bridge.todos.markReminderFired('1'), IPC_CHANNELS.TODOS_MARK_REMINDER_FIRED, '1'],
      [() => bridge.trash.moveNote('notes/a'), IPC_CHANNELS.TRASH_MOVE_NOTE, { path: 'notes/a' }],
      [() => bridge.trash.moveTodo('1'), IPC_CHANNELS.TRASH_MOVE_TODO, { id: '1' }],
      [() => bridge.trash.list(), IPC_CHANNELS.TRASH_LIST, undefined],
      [() => bridge.trash.restore({ trashId: 't', revision: 'r' }), IPC_CHANNELS.TRASH_RESTORE, { trashId: 't', revision: 'r' }],
      [() => bridge.trash.purge({ trashId: 't', revision: 'r', confirmed: true }), IPC_CHANNELS.TRASH_PURGE, { trashId: 't', revision: 'r', confirmed: true }],
    ];
    for (const [invoke, channel, payload] of calls) {
      await expect(invoke()).resolves.toEqual(expected(channel, payload));
    }
  });

  it('executes owner-deferred bridge wrappers without leaking raw Electron listeners', async () => {
    const bridge = electron.bridge;
    const remoteCalls: Array<[() => Promise<unknown>, string, unknown?]> = [
      [() => bridge.remote.getState(), IPC_CHANNELS.REMOTE_GET_STATE, undefined],
      [() => bridge.remote.enable({}), IPC_CHANNELS.REMOTE_ENABLE, {}],
      [() => bridge.remote.disable(), IPC_CHANNELS.REMOTE_DISABLE, undefined],
      [() => bridge.remote.createPairingRequest(), IPC_CHANNELS.REMOTE_CREATE_PAIRING_REQUEST, undefined],
      [() => bridge.remote.importPairing(), IPC_CHANNELS.REMOTE_IMPORT_PAIRING, undefined],
      [() => bridge.remote.revokePairing(), IPC_CHANNELS.REMOTE_REVOKE_PAIRING, undefined],
      [() => bridge.remote.respondApproval({ requestId: 'r', approved: false }), IPC_CHANNELS.REMOTE_APPROVAL_RESPOND, { requestId: 'r', approved: false }],
    ];
    const backupCalls: Array<[() => Promise<unknown>, string, unknown?]> = [
      [() => bridge.backup.getState(), IPC_CHANNELS.BACKUP_GET_STATE, undefined],
      [() => bridge.backup.prepareEnable(['notes']), IPC_CHANNELS.BACKUP_PREPARE_ENABLE, ['notes']],
      [() => bridge.backup.enable({}), IPC_CHANNELS.BACKUP_ENABLE, {}],
      [() => bridge.backup.disable(), IPC_CHANNELS.BACKUP_DISABLE, undefined],
      [() => bridge.backup.create({}), IPC_CHANNELS.BACKUP_CREATE, {}],
      [() => bridge.backup.upload({}), IPC_CHANNELS.BACKUP_UPLOAD, {}],
      [() => bridge.backup.downloadVerify({}), IPC_CHANNELS.BACKUP_DOWNLOAD_VERIFY, {}],
      [() => bridge.backup.restorePreview({}), IPC_CHANNELS.BACKUP_RESTORE_PREVIEW, {}],
      [() => bridge.backup.restoreApply({}), IPC_CHANNELS.BACKUP_RESTORE_APPLY, {}],
      [() => bridge.backup.deleteRemote({}), IPC_CHANNELS.BACKUP_DELETE, {}],
      [() => bridge.backup.respondApproval({ requestId: 'b', approved: false }), IPC_CHANNELS.BACKUP_APPROVAL_RESPOND, { requestId: 'b', approved: false }],
    ];
    for (const [invoke, channel, payload] of [...remoteCalls, ...backupCalls]) {
      await expect(invoke()).resolves.toEqual(expected(channel, payload));
    }

    const observed: unknown[] = [];
    const disposers = [
      bridge.remote.onApprovalRequest((value: unknown) => observed.push(value)),
      bridge.remote.onApprovalLifecycle((value: unknown) => observed.push(value)),
      bridge.backup.onApprovalRequest((value: unknown) => observed.push(value)),
      bridge.backup.onApprovalLifecycle((value: unknown) => observed.push(value)),
      bridge.rag.onStreamEvent((value: unknown) => observed.push(value)),
    ];
    const channels = [
      IPC_CHANNELS.REMOTE_APPROVAL_REQUEST,
      IPC_CHANNELS.REMOTE_APPROVAL_LIFECYCLE,
      IPC_CHANNELS.BACKUP_APPROVAL_REQUEST,
      IPC_CHANNELS.BACKUP_APPROVAL_LIFECYCLE,
      IPC_CHANNELS.RAG_STREAM_EVENT,
    ];
    channels.forEach((channel, index) => electron.listeners.get(channel)?.at(-1)?.({}, { index }));
    expect(observed).toEqual(channels.map((_, index) => ({ index })));
    disposers.forEach((dispose: () => void) => dispose());
    for (const channel of channels) {
      expect(electron.removeListener).toHaveBeenCalledWith(channel, expect.any(Function));
    }
  });

  it('validates successful local ASR envelopes through every bridge method', async () => {
    const bridge = electron.bridge;
    await expect(bridge.localAsr.status()).resolves.toEqual({
      active: false,
      lastErrorCode: null,
      state: 'AVAILABLE',
    });
    await expect(bridge.localAsr.decode({ requestId: REQUEST_ID })).resolves.toEqual({
      requestId: REQUEST_ID,
      transcript: 'local transcript',
      timings: { decodeMs: 1, totalMs: 2 },
    });
    await expect(bridge.localAsr.cancel(REQUEST_ID)).resolves.toEqual({
      requestId: REQUEST_ID,
      cancelled: true,
    });
  });
});

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
