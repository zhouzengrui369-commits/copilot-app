/**
 * main.ts — Electron entry for the v6 copilot app (Sprint 1.1 T-1.1.1).
 *
 * Boots a single BrowserWindow that loads either:
 *   - the vite dev server (when COPILOT_DEV=1 or no dist/renderer/index.html)
 *   - the built dist/renderer/index.html (production)
 *
 * Wires the IPC handlers exposed by preload.ts against a single
 * SettingsStorage instance. Window bounds and theme are read on startup
 * and written back whenever the user resizes.
 *
 * Sprint 1.2 T-1.2.6 adds the SETTINGS_SET_MODEL_API handler so the
 * settings panel can persist a multi-provider LLM config (minimax /
 * OpenAI / Claude / 自托管) at runtime.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../shared/ipc-channels.js';
import { registerDomainIpc } from './domain-ipc.js';
import { registerAskConversationIpc } from './ask-conversation-ipc.js';
import { AskConversationStore } from './ask-conversation-store.js';
import {
  DesktopApprovalBroker,
  registerRemoteIpc,
  type RemoteRuntime,
} from './remote/ipc.js';
import { createProductionRemoteRuntime } from './remote/production-runtime.js';
import { readSelectedPairingFile } from './remote/pairing.js';
import { ManagedPairingExchangePort } from './remote/pairing-file-port.js';
import { registerBackupIpc } from './backup-integration/ipc.js';
import { DesktopBackupApprovalBroker } from './backup-integration/approval.js';
import {
  createProductionBackupRuntime,
  type ProductionBackupRuntime,
} from './backup-integration/production-runtime.js';
import {
  createDirectPerformanceProbe,
  createRetryableStartupTelemetryLatch,
  createStartupCoordinator,
  type DirectPerformanceProbe,
  type StartupCoordinator,
  type StartupTerminalState,
} from './direct-performance-probe.js';
import { registerAudioMediaPermissionHandlers } from './media-permission.js';
import {
  createProductionKnowledgeService,
  resolveSourceSqliteNativeBinding,
  type LocalKnowledgeService,
} from './local-knowledge-service.js';
import {
  createLocalTelemetry,
  isCanonicalPackagedRuntime,
  loadPackagedReleaseIdentity,
  recordTelemetrySafely,
  safeMainErrorForLog,
  type LocalTelemetry,
  type PackagedReleaseIdentity,
} from './local-telemetry.js';
import {
  canonicalizeWindowBounds,
  createSettingsStore,
  DEFAULT_SETTINGS,
  type CopilotSettings,
  type ModelApiConfig,
  applyModelApiMutation,
  type ShortcutBinding,
  type Theme,
  type WindowBounds,
  type SettingsStorage,
  materializeWindowBoundsForSetBounds,
  parseWindowBoundsMutation,
  redactSettingsForRenderer,
} from './settings-store.js';
import { readManagedCredentialNamespace } from './managed-credential-namespace.js';
import { registerLocalAsrIpc } from './local-asr-ipc.js';
import { LocalAsrManager } from './local-asr-manager.js';
import {
  ModelCredentialError,
  ModelCredentialStore,
  createPersistentModelCredentialStore,
  credentialBinding,
  type CredentialStatus,
} from './model-credential-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE_REPO_ROOT = path.resolve(__dirname, '../../../..');

const VITE_DEV_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const IS_DEV = process.env.COPILOT_DEV === '1' || process.env.NODE_ENV === 'development';
const DIRECT_PERFORMANCE_MODE = process.env.NODE_ENV === 'test'
  && process.env.COPILOT_E2E === '1'
  && process.env.COPILOT_DIRECT_PERF === '1';
const RENDERER_INDEX = path.resolve(__dirname, '../renderer/index.html');
const PROCESS_STARTED_AT = Date.now();
const PROCESS_START_MONOTONIC = performance.now() - process.uptime() * 1_000;
const STARTUP_MILESTONE_NAMES = [
  'processStart',
  'appWhenReady',
  'releaseIdentityStart',
  'releaseIdentityEnd',
  'directProbeInitStart',
  'directProbeInitEnd',
  'windowCreateStart',
  'windowCreated',
  'rendererLoadStart',
  'domReady',
  'readyToShow',
  'rendererShellCommit',
  'appRootVisible',
  'terminalReady',
] as const;

type StartupMilestoneName = (typeof STARTUP_MILESTONE_NAMES)[number];
type StartupMilestone = { offsetMs: number | null; reason: string | null };
type StartupMilestoneReport = {
  clock: 'candidate-process-monotonic-diagnostic-only';
  milestones: Record<StartupMilestoneName, StartupMilestone>;
};

const startupMilestones = Object.fromEntries(
  STARTUP_MILESTONE_NAMES.map((name) => [name, { offsetMs: null, reason: 'not-reached' }]),
) as Record<StartupMilestoneName, StartupMilestone>;
startupMilestones.processStart = { offsetMs: 0, reason: null };

let mainWindow: BrowserWindow | null = null;
let storage: SettingsStorage | null = null;
let modelCredentials: ModelCredentialStore | null = null;
let knowledgeServicePromise: Promise<LocalKnowledgeService> | null = null;
let askConversationStore: AskConversationStore | null = null;
let telemetry: LocalTelemetry | null = null;
let directPerformanceProbe: DirectPerformanceProbe | null = null;
let startupCoordinator: StartupCoordinator | null = null;
let rendererAppRootReported = false;
let startupCompletionSent = false;
let remoteRuntime: RemoteRuntime | null = null;
let remoteApprovalBroker: DesktopApprovalBroker | null = null;
let backupRuntime: ProductionBackupRuntime | null = null;
let backupApprovalBroker: DesktopBackupApprovalBroker | null = null;
let localAsrManager: LocalAsrManager | null = null;

function startupOffsetMs(): number {
  return Math.max(0, Math.round((performance.now() - PROCESS_START_MONOTONIC) * 100) / 100);
}

function markStartupMilestone(name: Exclude<StartupMilestoneName, 'processStart'>): void {
  if (
    startupMilestones[name].offsetMs !== null
    || startupMilestones[name].reason !== 'not-reached'
  ) return;
  startupMilestones[name] = { offsetMs: startupOffsetMs(), reason: null };
}

function markStartupUnavailable(
  name: Exclude<StartupMilestoneName, 'processStart'>,
  reason:
    | 'development-runtime'
    | 'release-identity-unavailable'
    | 'direct-performance-mode-disabled'
    | 'ready-to-show-event-not-observed',
): void {
  if (
    startupMilestones[name].offsetMs !== null
    || startupMilestones[name].reason !== 'not-reached'
  ) return;
  startupMilestones[name] = { offsetMs: null, reason };
}

function getStartupMilestoneReport(): StartupMilestoneReport {
  return {
    clock: 'candidate-process-monotonic-diagnostic-only',
    milestones: Object.fromEntries(
      STARTUP_MILESTONE_NAMES.map((name) => [name, { ...startupMilestones[name] }]),
    ) as Record<StartupMilestoneName, StartupMilestone>,
  };
}

function markAppRootVisibleIfComplete(): void {
  const nativeWindowVisible = mainWindow?.isVisible() === true;
  startupCoordinator?.reportTerminal({ nativeWindowVisible });
  if (rendererAppRootReported && nativeWindowVisible) {
    markStartupMilestone('appRootVisible');
    directPerformanceProbe?.reportTerminal({
      nativeWindowVisible: true,
      rendererShellCommit: true,
      rendererAppRootVisible: true,
      completionSignal: startupCompletionSent,
    });
    startupCoordinator?.reportTerminal({
      nativeWindowVisible: true,
      rendererShellCommit: true,
      rendererAppRootVisible: true,
    });
  }
}

function publishStartupTerminalOnce(_state: StartupTerminalState): void {
  if (!startupCompletionSent && mainWindow && !mainWindow.webContents.isDestroyed()) {
    markStartupMilestone('terminalReady');
    startupCompletionSent = true;
    mainWindow.webContents.send(IPC_CHANNELS.STARTUP_COMPLETE);
  }
}

async function loadPackagedReleaseIdentityForStartup(): Promise<PackagedReleaseIdentity | null> {
  if (isCanonicalPackagedRuntime({ isPackaged: app.isPackaged, isDev: IS_DEV })) {
    markStartupMilestone('releaseIdentityStart');
    try {
      const releaseIdentity = await loadPackagedReleaseIdentity(
        path.join(__dirname, 'release-identity.json'),
      );
      telemetry = createLocalTelemetry(app.getPath('userData'), { releaseIdentity });
      markStartupMilestone('releaseIdentityEnd');
      return releaseIdentity;
    } catch {
      markStartupUnavailable('releaseIdentityEnd', 'release-identity-unavailable');
      console.error('[copilot-desktop] packaged release identity unavailable; usage evidence disabled');
      return null;
    }
  }
  markStartupUnavailable('releaseIdentityStart', 'development-runtime');
  markStartupUnavailable('releaseIdentityEnd', 'development-runtime');
  return null;
}

async function createDirectPerformanceProbeForStartup(
  releaseIdentityLane: Promise<PackagedReleaseIdentity | null>,
): Promise<{ reportTerminal(state: StartupTerminalState): void }> {
  markStartupMilestone('directProbeInitStart');
  const releaseIdentity = await releaseIdentityLane;
  directPerformanceProbe = await createDirectPerformanceProbe({
    app,
    env: process.env,
    userDataPath: app.getPath('userData'),
    releaseIdentity,
    getStartupMilestoneReport,
    onFailure: (code) => {
      console.error('[copilot-desktop] direct performance probe failed', code);
      app.exit(3);
    },
  });
  markStartupMilestone('directProbeInitEnd');
  return {
    reportTerminal(state) {
      directPerformanceProbe?.reportTerminal({
        nativeWindowVisible: state.nativeWindowVisible,
        rendererShellCommit: state.rendererShellCommit,
        rendererAppRootVisible: state.rendererAppRootVisible,
        completionSignal: startupCompletionSent,
      });
    },
  };
}

function applyPersistedSettings(settings: CopilotSettings): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const persistedBounds = clampBoundsToDisplay(canonicalizeWindowBounds(settings.windowBounds));
  const currentBounds = mainWindow.getBounds();
  const bounds = materializeWindowBoundsForSetBounds(persistedBounds, currentBounds);
  mainWindow.setBounds(bounds);
  mainWindow.setBackgroundColor(settings.theme === 'light' ? '#ffffff' : '#0e0e10');
}

function failDirectStartupClosed(code: string): void {
  console.error('[copilot-desktop] direct performance startup failed', code);
  app.exit(3);
}

const startupTelemetryLatch = createRetryableStartupTelemetryLatch(() => {
  const recorder = telemetry;
  if (!recorder) return null;
  return async () => {
    let persisted = false;
    await recordTelemetrySafely(async () => {
      const memory = await process.getProcessMemoryInfo();
      await recorder.record('startup', 'main', {
        launchMs: Date.now() - PROCESS_STARTED_AT,
        residentSetKb: memory.residentSet,
        privateKb: memory.private,
        platform: process.platform,
        arch: process.arch,
      });
      persisted = true;
    });
    if (!persisted) throw new Error('startup telemetry was not persisted');
  };
});

function recordStartupTelemetryOnce(): void {
  void startupTelemetryLatch.run();
}

function getStorage(): SettingsStorage {
  if (!storage) {
    storage = createSettingsStore(app.getPath('userData'));
  }
  return storage;
}

function getModelCredentials(): ModelCredentialStore {
  if (!modelCredentials) {
    modelCredentials = createPersistentModelCredentialStore(app.getPath('userData'), safeStorage);
  }
  return modelCredentials;
}

function migrateLegacyCredentialIfPresent(config: ModelApiConfig): void {
  const legacy = getStorage().readLegacyModelApiCredential?.() ?? null;
  if (!legacy) return;
  const { binding } = credentialBinding(config.provider, config.baseUrl);
  const clearLegacy = getStorage().clearLegacyModelApiCredentialExact;
  if (!clearLegacy) throw new ModelCredentialError('CREDENTIAL_MIGRATION_REQUIRED');
  getModelCredentials().migrateLegacy(
    binding,
    legacy,
    () => undefined,
    (expected) => clearLegacy.call(getStorage(), expected),
  );
}

function rendererSafeSettings(): ReturnType<typeof redactSettingsForRenderer> {
  const settings = getStorage().getAll();
  try {
    const { binding } = credentialBinding(settings.modelApi.provider, settings.modelApi.baseUrl);
    migrateLegacyCredentialIfPresent(settings.modelApi);
    const status = getModelCredentials().status(binding);
    return redactSettingsForRenderer(settings, {
      apiKeyConfigured: status === 'configured',
      status,
    });
  } catch (error) {
    const status: CredentialStatus | 'invalid-configuration' = error instanceof ModelCredentialError
      ? error.code === 'CREDENTIAL_BINDING_INVALID'
        ? 'invalid-configuration'
        : error.code === 'CREDENTIAL_PROTECTION_UNAVAILABLE'
          ? 'protection-unavailable'
          : 'migration-required'
      : 'migration-required';
    return redactSettingsForRenderer(settings, { apiKeyConfigured: false, status });
  }
}

function getKnowledgeService(): Promise<LocalKnowledgeService> {
  if (!knowledgeServicePromise) {
    const sqliteNativeBinding = resolveSourceSqliteNativeBinding({
      isPackaged: app.isPackaged,
      configuredPath: process.env.COPILOT_SQLITE_NATIVE_BINDING,
      allowedTaskRoot: path.join(SOURCE_REPO_ROOT, 'tasks/openclaw'),
      sharedNodeModulesRoot: path.join(SOURCE_REPO_ROOT, 'node_modules'),
    });
    knowledgeServicePromise = createProductionKnowledgeService({
      userDataPath: app.getPath('userData'),
      settings: getStorage(),
      credentials: getModelCredentials(),
      ...(sqliteNativeBinding === undefined ? {} : { sqliteNativeBinding }),
    });
  }
  return knowledgeServicePromise.catch((error) => {
    // A transient missing local runtime must be retryable on the next IPC call.
    knowledgeServicePromise = null;
    void recordTelemetrySafely(() => telemetry?.recordError('offline', 'main', error, {
      operation: 'knowledge-service-init',
    }));
    throw error;
  });
}

function getAskConversationStore(): AskConversationStore {
  if (!askConversationStore) {
    askConversationStore = new AskConversationStore(app.getPath('userData'));
  }
  return askConversationStore;
}

function getRemoteRuntime(): RemoteRuntime {
  if (!remoteApprovalBroker) {
    remoteApprovalBroker = new DesktopApprovalBroker(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return null;
      return mainWindow.webContents;
    });
  }
  if (!remoteRuntime) {
    const managedExchange = process.env.COPILOT_PAIRING_EXCHANGE_DIR
      ? new ManagedPairingExchangePort(process.env.COPILOT_PAIRING_EXCHANGE_DIR)
      : null;
    remoteRuntime = createProductionRemoteRuntime({
      userDataPath: app.getPath('userData'),
      getService: getKnowledgeService,
      approval: remoteApprovalBroker,
      managedProfileNamespace: readManagedCredentialNamespace(process.env),
      savePairingRequest: async (bytes) => {
        if (managedExchange) return managedExchange.saveRequest(bytes);
        const saveOptions: Electron.SaveDialogOptions = {
          title: 'Create public Copilot pairing request',
          defaultPath: 'target.copilot-pair-request',
          filters: [{ name: 'Copilot public pairing request', extensions: ['copilot-pair-request'] }],
        };
        const selected = mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showSaveDialog(mainWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);
        if (selected.canceled || !selected.filePath) return false;
        if (path.extname(selected.filePath) !== '.copilot-pair-request') {
          throw new Error('pairing request file extension is invalid');
        }
        const handle = await fs.promises.open(selected.filePath, 'wx', 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        return true;
      },
      pickPairingBundle: async (pendingRequestId) => {
        if (managedExchange) {
          if (!pendingRequestId) throw new Error('active pairing request is unavailable');
          return managedExchange.pickResponse(pendingRequestId);
        }
        const dialogOptions: Electron.OpenDialogOptions = {
          title: 'Import verified Copilot pairing',
          properties: ['openFile'],
          filters: [{ name: 'Copilot pairing', extensions: ['copilot-pairing'] }],
        };
        const selected = mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showOpenDialog(mainWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);
        if (selected.canceled || selected.filePaths.length !== 1) return null;
        return readSelectedPairingFile(selected.filePaths[0]);
      },
    });
  }
  return remoteRuntime;
}

function getBackupRuntime(): ProductionBackupRuntime {
  if (!backupApprovalBroker) {
    backupApprovalBroker = new DesktopBackupApprovalBroker(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return null;
      return mainWindow.webContents;
    });
  }
  if (!backupRuntime) {
    backupRuntime = createProductionBackupRuntime({
      userDataPath: app.getPath('userData'),
      settings: getStorage(),
      getService: getKnowledgeService,
      safeStorage,
      env: process.env,
      appVersion: app.getVersion(),
      approval: backupApprovalBroker,
      managedProfileNamespace: readManagedCredentialNamespace(process.env),
    });
  }
  return backupRuntime;
}

function getLocalAsrManager(): LocalAsrManager {
  if (!localAsrManager) {
    const assetRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'local-asr')
      : path.join(app.getAppPath(), 'resources', 'local-asr');
    const workerEntryUrl = app.isPackaged
      ? pathToFileURL(path.join(assetRoot, 'worker', 'local-asr-worker.js'))
      : null;
    localAsrManager = new LocalAsrManager({
      assetRoot,
      ...(workerEntryUrl ? { workerEntryUrl } : {}),
    });
  }
  return localAsrManager;
}

function clampBoundsToDisplay(bounds: WindowBounds): WindowBounds {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return bounds;
  const fits = displays.some((d) => {
    const wa = d.workArea;
    if (bounds.x === undefined || bounds.y === undefined) return true;
    return (
      bounds.x >= wa.x &&
      bounds.y >= wa.y &&
      bounds.x + bounds.width <= wa.x + wa.width &&
      bounds.y + bounds.height <= wa.y + wa.height
    );
  });
  if (fits) return bounds;
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    width: Math.min(bounds.width, primary.width),
    height: Math.min(bounds.height, primary.height),
  };
}

async function createMainWindow(): Promise<void> {
  markStartupMilestone('windowCreateStart');
  // Persisted settings are intentionally loaded on a separate startup lane.
  // The first shell is constructed from compiled-safe defaults.
  const bounds = clampBoundsToDisplay(DEFAULT_SETTINGS.windowBounds);
  const rendererFileAvailableLane = IS_DEV ? Promise.resolve(false) : exists(RENDERER_INDEX);

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(typeof bounds.x === 'number' ? { x: bounds.x } : {}),
    ...(typeof bounds.y === 'number' ? { y: bounds.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'njx-copilot-v6',
    backgroundColor: DEFAULT_SETTINGS.theme === 'light' ? '#ffffff' : '#0e0e10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  markStartupMilestone('windowCreated');
  const rendererFileAvailable = await rendererFileAvailableLane;
  const trustedRendererUrl = rendererFileAvailable
    ? pathToFileURL(RENDERER_INDEX).href
    : VITE_DEV_URL;

  const startupWindow = mainWindow;
  const showMainWindow = (trigger: 'ready-to-show' | 'did-finish-load-fallback') => {
    if (startupWindow.isDestroyed()) return;
    if (trigger === 'did-finish-load-fallback' && startupMilestones.readyToShow.offsetMs === null) {
      markStartupUnavailable('readyToShow', 'ready-to-show-event-not-observed');
    }
    if (!startupWindow.isVisible()) startupWindow.show();
    markAppRootVisibleIfComplete();
    if (!DIRECT_PERFORMANCE_MODE) recordStartupTelemetryOnce();
  };

  // Register one-shot readiness listeners before loading: ready-to-show may fire during load.
  mainWindow.once('ready-to-show', () => {
    if (startupMilestones.readyToShow.reason === 'not-reached') {
      markStartupMilestone('readyToShow');
    }
    showMainWindow('ready-to-show');
  });
  mainWindow.webContents.once('dom-ready', () => {
    markStartupMilestone('domReady');
  });
  mainWindow.webContents.once('did-finish-load', () => {
    showMainWindow('did-finish-load-fallback');
  });

  registerAudioMediaPermissionHandlers(
    mainWindow.webContents.session,
    mainWindow.webContents,
    trustedRendererUrl,
  );

  markStartupMilestone('rendererLoadStart');
  if (IS_DEV) {
    await mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (rendererFileAvailable) {
    await mainWindow.loadFile(RENDERER_INDEX);
  } else {
    // Fallback for a fresh checkout that has not run `npm run build:renderer`.
    await mainWindow.loadURL(VITE_DEV_URL);
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    void recordTelemetrySafely(() => telemetry?.record('offline', 'renderer', {
      operation: 'renderer-load',
      errorCode,
      errorDescription,
      validatedUrl,
    }));
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void recordTelemetrySafely(() => telemetry?.record('renderer-gone', 'renderer', {
      reason: details.reason,
      exitCode: details.exitCode,
    }));
  });
  mainWindow.on('unresponsive', () => {
    void recordTelemetrySafely(() => telemetry?.record(
      'renderer-unresponsive',
      'renderer',
      { window: 'main' },
    ));
  });

  // Persist window bounds on resize/move (debounced via the close event).
  const persistBounds = () => {
    if (!mainWindow) return;
    const b = mainWindow.getBounds();
    try {
      getStorage().set('windowBounds', { width: b.width, height: b.height, x: b.x, y: b.y });
    } catch (err) {
      console.error('[copilot-desktop] failed to persist window bounds', err);
    }
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('close', persistBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function registerIpc(): void {
  const isCurrentWindowSender = (event: unknown) =>
    Boolean(
      mainWindow
      && !mainWindow.isDestroyed()
      && (event as { sender?: { id?: number } } | null)?.sender?.id === mainWindow.webContents.id,
    );

  ipcMain.handle(IPC_CHANNELS.STARTUP_GET_MILESTONES, () => getStartupMilestoneReport());
  ipcMain.on(IPC_CHANNELS.STARTUP_APP_ROOT_VISIBLE, (event) => {
    if (mainWindow && event.sender.id === mainWindow.webContents.id) {
      rendererAppRootReported = true;
      markStartupMilestone('rendererShellCommit');
      markAppRootVisibleIfComplete();
      startupCoordinator?.reportTerminal({
        rendererShellCommit: true,
        rendererAppRootVisible: true,
      });
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => rendererSafeSettings());

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_CLOUD_BACKUP, async (_evt, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('cloudBackupEnabled must be boolean');
    }
    if (enabled) {
      throw new Error('[CONSENT_REQUIRED] use the Backup owner-consent flow');
    }
    await getBackupRuntime().disable();
    return rendererSafeSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_THEME, (_evt, theme: unknown) => {
    if (theme !== 'dark' && theme !== 'light' && theme !== 'auto') {
      throw new Error('theme must be dark|light|auto');
    }
    getStorage().set('theme', theme);
    return rendererSafeSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_WINDOW_BOUNDS, (_evt, bounds: unknown) => {
    const next = parseWindowBoundsMutation(bounds);
    if (!next) {
      throw new Error('windowBounds must have numeric width/height');
    }
    getStorage().set('windowBounds', next);
    return rendererSafeSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_SHORTCUTS, (_evt, shortcuts: unknown) => {
    if (!Array.isArray(shortcuts)) {
      throw new Error('shortcuts must be an array');
    }
    const filtered = (shortcuts as ShortcutBinding[]).filter(
      (s) =>
        s &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.label === 'string' &&
        typeof s.accelerator === 'string' &&
        s.accelerator.length > 0,
    );
    getStorage().set('shortcuts', filtered);
    return rendererSafeSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET_MODEL_API, (_evt, modelApi: unknown) => {
    const mutation = applyModelApiMutation(getStorage().get('modelApi'), modelApi);
    if (!mutation) {
      throw new Error('modelApi payload is invalid (id, baseUrl, model required)');
    }
    try {
      migrateLegacyCredentialIfPresent(getStorage().get('modelApi'));
      const { binding } = credentialBinding(
        mutation.config.provider,
        mutation.config.baseUrl,
      );
      if (mutation.credentialAction === 'replace') {
        getModelCredentials().write(binding, mutation.credential ?? '');
      } else if (mutation.credentialAction === 'clear') {
        getModelCredentials().clear(binding);
      }
      getStorage().set('modelApi', mutation.config);
      return rendererSafeSettings();
    } catch (error) {
      if (error instanceof ModelCredentialError) throw new Error(`[${error.code}] model credential update failed`);
      throw new Error('[CREDENTIAL_WRITE_FAILED] model credential update failed');
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, async () => {
    await getRemoteRuntime().disable();
    await getBackupRuntime().disable();
    getStorage().reset();
    getModelCredentials().reset();
    return redactSettingsForRenderer({
      ...DEFAULT_SETTINGS,
      modelApi: { ...DEFAULT_SETTINGS.modelApi },
    }, { status: 'not-configured', apiKeyConfigured: false });
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    mainWindow?.minimize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    mainWindow?.close();
  });

  registerDomainIpc(
    ipcMain,
    getKnowledgeService,
    (operation) => telemetry?.recordOperation(operation),
  );
  registerAskConversationIpc(
    ipcMain,
    getAskConversationStore,
    getKnowledgeService,
  );
  registerRemoteIpc(ipcMain, getRemoteRuntime, isCurrentWindowSender);
  registerBackupIpc(ipcMain, getBackupRuntime, isCurrentWindowSender, (response) => {
    if (!backupApprovalBroker) throw new Error('backup approval broker unavailable');
    return backupApprovalBroker.respond(response);
  });
  registerLocalAsrIpc(ipcMain, getLocalAsrManager, isCurrentWindowSender);
}

app.whenReady().then(async () => {
  markStartupMilestone('appWhenReady');
  if (!DIRECT_PERFORMANCE_MODE) {
    markStartupUnavailable('directProbeInitStart', 'direct-performance-mode-disabled');
    markStartupUnavailable('directProbeInitEnd', 'direct-performance-mode-disabled');
  }
  registerIpc();
  let releaseIdentityLane: Promise<PackagedReleaseIdentity | null> | null = null;
  const coordinator = createStartupCoordinator({
    directMode: DIRECT_PERFORMANCE_MODE,
    startWindow: () => createMainWindow(),
    loadReleaseIdentity: () => {
      releaseIdentityLane = loadPackagedReleaseIdentityForStartup();
      return releaseIdentityLane;
    },
    prepareDirectProbe: () => createDirectPerformanceProbeForStartup(
      releaseIdentityLane ?? Promise.resolve(null),
    ),
    loadSettings: async () => getStorage().getAll(),
    applySettings: (settings) => applyPersistedSettings(settings as CopilotSettings),
    onTerminalReady: publishStartupTerminalOnce,
    recordDefaultTelemetry: recordStartupTelemetryOnce,
    failClosed: failDirectStartupClosed,
  });
  startupCoordinator = coordinator;
  await coordinator.start();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
      applyPersistedSettings(getStorage().getAll());
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (remoteRuntime) void remoteRuntime.disable().catch(() => undefined);
  if (backupRuntime) void backupRuntime.disable().catch(() => undefined);
  if (knowledgeServicePromise) {
    void knowledgeServicePromise.then((service) => service.close()).catch(() => undefined);
  }
  if (localAsrManager) void localAsrManager.close().catch(() => undefined);
});

// Surface uncaught errors in the main log instead of dying silently.
process.on('uncaughtException', (err) => {
  console.error('[copilot-desktop] uncaughtException', safeMainErrorForLog(err));
  void recordTelemetrySafely(() => telemetry?.recordError(
    'crash', 'main', err, { source: 'uncaughtException' },
  ));
});
process.on('unhandledRejection', (reason) => {
  console.error('[copilot-desktop] unhandledRejection', safeMainErrorForLog(reason));
  void recordTelemetrySafely(() => telemetry?.recordError(
    'crash', 'main', reason, { source: 'unhandledRejection' },
  ));
});

export type { CopilotSettings, ShortcutBinding, Theme, ModelApiConfig };
