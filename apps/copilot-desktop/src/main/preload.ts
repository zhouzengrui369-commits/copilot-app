/**
 * preload.ts — exposes a typed, narrow API to the renderer over
 * contextBridge. The renderer MUST NOT get access to ipcRenderer or
 * Node globals; only the methods below.
 *
 * Sprint 1.1 T-1.1.1 scope: settings get/set + reset + window control.
 * Sprint 1.2 T-1.2.6: added `setModelApi` so the settings panel can
 * persist a new LLM provider config (minimax / OpenAI / Claude / 自托管)
 * without restarting the app.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels.js';
import type {
  CopilotDomainBridge,
  DomainIpcChannel,
  DomainIpcRequest,
  DomainIpcResponse,
  RagStreamEvent,
} from '../shared/domain-api.js';
import type {
  ModelApiMutation,
  RendererSafeCopilotSettings,
  ShortcutBinding,
  Theme,
  WindowBounds,
} from './settings-store.js';
import type {
  RemoteApprovalLifecycleEvent,
  RemoteApprovalRequest,
  RemoteBridge,
} from '../shared/remote-management.js';
import type {
  BackupApprovalLifecycleEvent,
  BackupApprovalRequest,
  BackupManagementBridge,
} from '../shared/backup-management.js';
import type { ElectronRuntimeMeta } from '../shared/runtime-meta.js';
import type {
  LocalAsrDecodeRequest,
  LocalAsrDecodeResult,
  LocalAsrErrorCode,
  LocalAsrStatus,
} from '../shared/local-asr.js';
import {
  isExactLocalAsrIpcEnvelope,
  isExactPlainRecord,
  isKnownLocalAsrErrorCode,
} from '../shared/local-asr-ipc-envelope.js';
import {
  LocalAsrError,
  isLocalAsrTimings,
  isUuidV4,
  normalizeLocalAsrTranscript,
} from '../shared/local-asr.js';

export interface CopilotBridge extends CopilotDomainBridge {
  askConversation: NonNullable<CopilotDomainBridge['askConversation']>;
  trash: NonNullable<CopilotDomainBridge['trash']>;
  settings: {
    get(): Promise<RendererSafeCopilotSettings>;
    setCloudBackup(enabled: boolean): Promise<RendererSafeCopilotSettings>;
    setTheme(theme: Theme): Promise<RendererSafeCopilotSettings>;
    setWindowBounds(bounds: WindowBounds): Promise<RendererSafeCopilotSettings>;
    setShortcuts(shortcuts: ShortcutBinding[]): Promise<RendererSafeCopilotSettings>;
    setModelApi(cfg: ModelApiMutation): Promise<RendererSafeCopilotSettings>;
    reset(): Promise<RendererSafeCopilotSettings>;
  };
  remote: RemoteBridge;
  backup: BackupManagementBridge;
  localAsr: {
    status(): Promise<LocalAsrStatus>;
    decode(request: LocalAsrDecodeRequest): Promise<LocalAsrDecodeResult>;
    cancel(requestId: string): Promise<{ requestId: string; cancelled: boolean }>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
  startup: {
    /** Diagnostic-only monotonic offsets; the controller's outer duration remains the gate. */
    getMilestones(): Promise<StartupMilestoneReport>;
    /** Signals the first visible DOM app-root commit without sending DOM or user data. */
    appRootVisible(): void;
    /** Renderer-local latch set by a data-free main-process completion event. */
    isComplete(): boolean;
  };
  /** v6 product metadata for the renderer's "About" panel. */
  meta: {
    appVersion: string;
    platform: NodeJS.Platform;
    productName: string;
    /** Trusted runtime facts from isolated preload, not renderer UA sniffing. */
    runtime: ElectronRuntimeMeta;
  };
}

export type StartupMilestoneName =
  | 'processStart'
  | 'appWhenReady'
  | 'releaseIdentityStart'
  | 'releaseIdentityEnd'
  | 'directProbeInitStart'
  | 'directProbeInitEnd'
  | 'windowCreateStart'
  | 'windowCreated'
  | 'rendererLoadStart'
  | 'domReady'
  | 'readyToShow'
  | 'rendererShellCommit'
  | 'appRootVisible'
  | 'terminalReady';

export interface StartupMilestoneReport {
  clock: 'candidate-process-monotonic-diagnostic-only';
  milestones: Record<StartupMilestoneName, {
    offsetMs: number | null;
    reason: string | null;
  }>;
}

const invoke = <T>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>;

const invokeDomain = <C extends DomainIpcChannel>(
  channel: C,
  payload: DomainIpcRequest<C>,
): Promise<DomainIpcResponse<C>> =>
  ipcRenderer.invoke(channel, payload) as Promise<DomainIpcResponse<C>>;

type LocalAsrIpcChannel =
  | typeof IPC_CHANNELS.LOCAL_ASR_STATUS
  | typeof IPC_CHANNELS.LOCAL_ASR_DECODE
  | typeof IPC_CHANNELS.LOCAL_ASR_CANCEL;

async function invokeLocalAsr<T>(
  channel: LocalAsrIpcChannel,
  payload: unknown,
  isValue: (value: unknown) => value is T,
): Promise<T> {
  let received: unknown;
  try {
    received = await ipcRenderer.invoke(channel, payload) as unknown;
  } catch {
    throw rendererLocalAsrError('WORKER_FAILURE');
  }
  if (!isExactLocalAsrIpcEnvelope(received)) {
    throw rendererLocalAsrError('WORKER_FAILURE');
  }
  if (!received.ok) {
    throw rendererLocalAsrError(received.error.code);
  }
  try {
    if (isValue(received.value)) return received.value;
  } catch {
    // Malformed accessors/proxies are never allowed to surface raw failures.
  }
  throw rendererLocalAsrError('WORKER_FAILURE');
}

function rendererLocalAsrError(code: LocalAsrErrorCode): Error {
  const error = new Error(`[${code}] ${new LocalAsrError(code).message}`);
  error.name = 'LocalAsrError';
  error.stack = undefined;
  return error;
}

const LOCAL_ASR_STATES = [
  'NOT_READY',
  'AVAILABLE',
  'DECODING',
  'READY',
  'FAILED',
  'CANCELLED',
] as const;

function isLocalAsrStatusValue(value: unknown): value is LocalAsrStatus {
  if (!isExactPlainRecord(value, ['active', 'lastErrorCode', 'state'])) return false;
  return typeof value.active === 'boolean'
    && typeof value.state === 'string'
    && (LOCAL_ASR_STATES as readonly string[]).includes(value.state)
    && (value.lastErrorCode === null || isKnownLocalAsrErrorCode(value.lastErrorCode));
}

function isLocalAsrDecodeResultValue(
  value: unknown,
): value is LocalAsrDecodeResult {
  if (!isExactPlainRecord(value, ['requestId', 'timings', 'transcript'])) return false;
  const normalized = normalizeLocalAsrTranscript(value.transcript);
  return isUuidV4(value.requestId)
    && normalized !== null
    && normalized === value.transcript
    && isExactPlainRecord(value.timings, ['decodeMs', 'totalMs'])
    && isLocalAsrTimings(value.timings);
}

function isLocalAsrCancelValue(
  value: unknown,
): value is { requestId: string; cancelled: boolean } {
  return isExactPlainRecord(value, ['cancelled', 'requestId'])
    && isUuidV4(value.requestId)
    && typeof value.cancelled === 'boolean';
}

let startupComplete = false;
ipcRenderer.on(IPC_CHANNELS.STARTUP_COMPLETE, () => {
  startupComplete = true;
});

const bridge: CopilotBridge = {
  settings: {
    get: () => invoke<RendererSafeCopilotSettings>(IPC_CHANNELS.SETTINGS_GET),
    setCloudBackup: (enabled) =>
      invoke<RendererSafeCopilotSettings>(IPC_CHANNELS.SETTINGS_SET_CLOUD_BACKUP, enabled),
    setTheme: (theme) => invoke<RendererSafeCopilotSettings>(IPC_CHANNELS.SETTINGS_SET_THEME, theme),
    setWindowBounds: (bounds) =>
      invoke<RendererSafeCopilotSettings>(IPC_CHANNELS.SETTINGS_SET_WINDOW_BOUNDS, bounds),
    setShortcuts: (shortcuts) =>
      invoke<RendererSafeCopilotSettings>(IPC_CHANNELS.SETTINGS_SET_SHORTCUTS, shortcuts),
    setModelApi: (cfg) => invoke<RendererSafeCopilotSettings>(IPC_CHANNELS.SETTINGS_SET_MODEL_API, cfg),
    reset: () => invoke<RendererSafeCopilotSettings>(IPC_CHANNELS.SETTINGS_RESET),
  },
  remote: {
    getState: () => invoke(IPC_CHANNELS.REMOTE_GET_STATE),
    enable: (request) => invoke(IPC_CHANNELS.REMOTE_ENABLE, request),
    disable: () => invoke(IPC_CHANNELS.REMOTE_DISABLE),
    createPairingRequest: () => invoke(IPC_CHANNELS.REMOTE_CREATE_PAIRING_REQUEST),
    importPairing: () => invoke(IPC_CHANNELS.REMOTE_IMPORT_PAIRING),
    revokePairing: () => invoke(IPC_CHANNELS.REMOTE_REVOKE_PAIRING),
    respondApproval: (response) => invoke(IPC_CHANNELS.REMOTE_APPROVAL_RESPOND, response),
    onApprovalRequest: (listener: (request: RemoteApprovalRequest) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, request: RemoteApprovalRequest) => listener(request);
      ipcRenderer.on(IPC_CHANNELS.REMOTE_APPROVAL_REQUEST, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REMOTE_APPROVAL_REQUEST, wrapped);
    },
    onApprovalLifecycle: (listener: (event: RemoteApprovalLifecycleEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: RemoteApprovalLifecycleEvent) => listener(payload);
      ipcRenderer.on(IPC_CHANNELS.REMOTE_APPROVAL_LIFECYCLE, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.REMOTE_APPROVAL_LIFECYCLE, wrapped);
    },
  },
  backup: {
    getState: () => invoke(IPC_CHANNELS.BACKUP_GET_STATE),
    prepareEnable: (scopes) => invoke(IPC_CHANNELS.BACKUP_PREPARE_ENABLE, scopes),
    enable: (request) => invoke(IPC_CHANNELS.BACKUP_ENABLE, request),
    disable: () => invoke(IPC_CHANNELS.BACKUP_DISABLE),
    create: (request) => invoke(IPC_CHANNELS.BACKUP_CREATE, request),
    upload: (request) => invoke(IPC_CHANNELS.BACKUP_UPLOAD, request),
    downloadVerify: (request) => invoke(IPC_CHANNELS.BACKUP_DOWNLOAD_VERIFY, request),
    restorePreview: (request) => invoke(IPC_CHANNELS.BACKUP_RESTORE_PREVIEW, request),
    restoreApply: (request) => invoke(IPC_CHANNELS.BACKUP_RESTORE_APPLY, request),
    deleteRemote: (request) => invoke(IPC_CHANNELS.BACKUP_DELETE, request),
    respondApproval: (response) => invoke(IPC_CHANNELS.BACKUP_APPROVAL_RESPOND, response),
    onApprovalRequest: (listener: (request: BackupApprovalRequest) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, request: BackupApprovalRequest) => listener(request);
      ipcRenderer.on(IPC_CHANNELS.BACKUP_APPROVAL_REQUEST, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BACKUP_APPROVAL_REQUEST, wrapped);
    },
    onApprovalLifecycle: (listener: (event: BackupApprovalLifecycleEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: BackupApprovalLifecycleEvent) => listener(payload);
      ipcRenderer.on(IPC_CHANNELS.BACKUP_APPROVAL_LIFECYCLE, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BACKUP_APPROVAL_LIFECYCLE, wrapped);
    },
  },
  localAsr: {
    status: () => invokeLocalAsr(
      IPC_CHANNELS.LOCAL_ASR_STATUS,
      undefined,
      isLocalAsrStatusValue,
    ),
    decode: (request) =>
      invokeLocalAsr(
        IPC_CHANNELS.LOCAL_ASR_DECODE,
        request,
        isLocalAsrDecodeResultValue,
      ),
    cancel: (requestId) =>
      invokeLocalAsr(
        IPC_CHANNELS.LOCAL_ASR_CANCEL,
        requestId,
        isLocalAsrCancelValue,
      ),
  },
  window: {
    minimize: () => invoke<void>(IPC_CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => invoke<void>(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    close: () => invoke<void>(IPC_CHANNELS.WINDOW_CLOSE),
  },
  startup: {
    getMilestones: () => invoke<StartupMilestoneReport>(IPC_CHANNELS.STARTUP_GET_MILESTONES),
    appRootVisible: () => ipcRenderer.send(IPC_CHANNELS.STARTUP_APP_ROOT_VISIBLE),
    isComplete: () => startupComplete,
  },
  notes: {
    list: (request?: unknown) => invokeDomain(IPC_CHANNELS.NOTES_LIST, request as never),
    get: (path: string) => invokeDomain(IPC_CHANNELS.NOTES_GET, path as never),
    create: (request: unknown) => invokeDomain(IPC_CHANNELS.NOTES_CREATE, request as never),
    createWithBuild: (request: unknown) =>
      invokeDomain(IPC_CHANNELS.NOTES_CREATE_WITH_BUILD, request as never),
    update: (request: unknown) => invokeDomain(IPC_CHANNELS.NOTES_UPDATE, request as never),
    updateWithBuild: (request: unknown) =>
      invokeDomain(IPC_CHANNELS.NOTES_UPDATE_WITH_BUILD, request as never),
    remove: (path: string) => invokeDomain(IPC_CHANNELS.NOTES_REMOVE, path as never),
    getBacklinks: (path: string) => invokeDomain(IPC_CHANNELS.NOTES_GET_BACKLINKS, path as never),
  },
  wiki: {
    getForNote: (path: string) => invokeDomain(IPC_CHANNELS.WIKI_GET_FOR_NOTE, path as never),
  },
  kg: {
    getSubgraph: (request?: unknown) => invokeDomain(IPC_CHANNELS.KG_GET_SUBGRAPH, request as never),
    reindexNote: (path: string) => invokeDomain(IPC_CHANNELS.KG_REINDEX_NOTE, path as never),
  },
  rag: {
    ask: (question: string) => invokeDomain(IPC_CHANNELS.RAG_ASK, question as never),
    startStream: (request: unknown) => invokeDomain(IPC_CHANNELS.RAG_STREAM_START, request as never),
    cancelStream: (requestId: string) => invokeDomain(IPC_CHANNELS.RAG_STREAM_CANCEL, requestId as never),
    onStreamEvent: (listener: (event: RagStreamEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: RagStreamEvent) => listener(payload);
      ipcRenderer.on(IPC_CHANNELS.RAG_STREAM_EVENT, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RAG_STREAM_EVENT, wrapped);
    },
  },
  askConversation: {
    save: (request) => invokeDomain(IPC_CHANNELS.ASK_CONVERSATION_SAVE, request),
    load: () => invokeDomain(IPC_CHANNELS.ASK_CONVERSATION_LOAD, undefined),
    clear: () => invokeDomain(IPC_CHANNELS.ASK_CONVERSATION_CLEAR, undefined),
  },
  todos: {
    list: (request?: unknown) => invokeDomain(IPC_CHANNELS.TODOS_LIST, request as never),
    create: (request: unknown) => invokeDomain(IPC_CHANNELS.TODOS_CREATE, request as never),
    update: (request: unknown) => invokeDomain(IPC_CHANNELS.TODOS_UPDATE, request as never),
    remove: (id: string) => invokeDomain(IPC_CHANNELS.TODOS_REMOVE, id as never),
    listDue: (now: number) => invokeDomain(IPC_CHANNELS.TODOS_LIST_DUE, now as never),
    markReminderFired: (id: string) =>
      invokeDomain(IPC_CHANNELS.TODOS_MARK_REMINDER_FIRED, id as never),
  },
  trash: {
    moveNote: (path: string) => invokeDomain(IPC_CHANNELS.TRASH_MOVE_NOTE, { path }),
    moveTodo: (id) => invokeDomain(IPC_CHANNELS.TRASH_MOVE_TODO, { id }),
    list: () => invokeDomain(IPC_CHANNELS.TRASH_LIST, undefined),
    restore: (request) => invokeDomain(IPC_CHANNELS.TRASH_RESTORE, request),
    purge: (request) => invokeDomain(IPC_CHANNELS.TRASH_PURGE, request),
  },
  meta: {
    appVersion: process.env.npm_package_version ?? '0.0.0',
    platform: process.platform,
    productName: 'njx-copilot-v6',
    runtime: {
      source: 'electron-preload-process-versions',
      shell: 'electron',
      electronVersion: process.versions.electron ?? 'unknown',
      chromiumVersion: process.versions.chrome ?? 'unknown',
      // Electron 38 exposes the Chrome 139+ API surface but has no matching
      // on-device speech Mojo binder. Keep empty until a real binder probe is
      // proven and explicitly allowlisted.
      localAsrCapabilities: [],
    },
  },
};

contextBridge.exposeInMainWorld('copilot', bridge);
