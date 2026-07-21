/**
 * settings-store.ts — typed wrapper around electron-store for the v6
 * copilot app settings panel (Sprint 1.1 T-1.1.1 + Sprint 1.2 T-1.2.6).
 *
 * Persisted state lives under app.getPath('userData')/copilot-desktop.json.
 * The default factory intentionally returns cloudBackupEnabled = false
 * because goal.md decision 2 (NJX 7/9 11:40) and rules.md §9.1 require
 * cloud backup to be OFF by default. Users must explicitly opt in.
 *
 * Sprint 1.2 T-1.2.6 adds `modelApi` so the user can switch between
 * minimax / OpenAI / Claude / 自托管 without restarting the world.
 *
 * The store is also exported as a pure factory (createSettingsStore) so
 * tests can pass an in-memory adapter without touching electron-store's
 * file system path.
 */
import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { BackupConsentReceipt, BackupRecoveryMarker } from '../shared/backup-management.js';
import {
  ModelCredentialError,
  normalizeModelEndpoint,
  type CredentialStatus,
} from './model-credential-store.js';

export type Theme = 'dark' | 'light' | 'auto';

export interface ShortcutBinding {
  /** Stable id used by the renderer to look up bindings. */
  id: string;
  /** Human label, e.g. "Open settings". */
  label: string;
  /** Accelerator string in Electron format, e.g. "CommandOrControl+,". */
  accelerator: string;
}

export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

/**
 * Return the Electron-facing bounds shape without materialising optional
 * coordinates as own properties unless they are numeric.
 *
 * electron-store may expose defaults through `store`, so this must be applied
 * both when persisted settings are read and when an IPC mutation is accepted.
 */
export function canonicalizeWindowBounds(bounds: {
  width: number;
  height: number;
  x?: unknown;
  y?: unknown;
}): WindowBounds {
  return {
    width: bounds.width,
    height: bounds.height,
    ...(typeof bounds.x === 'number' ? { x: bounds.x } : {}),
    ...(typeof bounds.y === 'number' ? { y: bounds.y } : {}),
  };
}

/** Validate and canonicalise an untrusted settings IPC window-bounds payload. */
export function parseWindowBoundsMutation(input: unknown): WindowBounds | null {
  if (!input || typeof input !== 'object') return null;
  const bounds = input as { width?: unknown; height?: unknown; x?: unknown; y?: unknown };
  if (typeof bounds.width !== 'number' || typeof bounds.height !== 'number') return null;
  return canonicalizeWindowBounds({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  });
}

/** Materialise the complete numeric Rectangle required by Electron setBounds. */
export function materializeWindowBoundsForSetBounds(
  bounds: WindowBounds,
  currentPosition: { x: number; y: number },
): Required<WindowBounds> {
  const canonical = canonicalizeWindowBounds(bounds);
  return {
    width: canonical.width,
    height: canonical.height,
    x: canonical.x ?? currentPosition.x,
    y: canonical.y ?? currentPosition.y,
  };
}

/** Provider id — minimax / OpenAI / Claude / 自托管. */
export type ModelProviderId = 'minimax' | 'openai' | 'claude' | 'custom';

export const MODEL_PROVIDER_IDS: ReadonlyArray<ModelProviderId> = [
  'minimax',
  'openai',
  'claude',
  'custom',
];

/** LLM provider config persisted in electron-store.
 *  `provider` is the field name used by the main process; the renderer
 *  mirrors the same shape but uses `id` (see renderer/types/settings.ts)
 *  because that's what the @copilot/llm-client config expects. The IPC
 *  bridge keeps them aligned. */
export interface ModelApiConfig {
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  /** Compatibility-only blank sentinel; production parsers never persist it. */
  apiKey?: '';
}

/** IPC write shape. Blank/missing apiKey preserves the stored credential. */
export interface ModelApiMutation {
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Credentials may only be removed through this explicit action. */
  clearApiKey?: boolean;
}

export interface RendererSafeModelApiConfig {
  provider: ModelProviderId;
  baseUrl: string;
  model: string;
  apiKey: '';
  apiKeyConfigured: boolean;
  credentialStatus: CredentialStatus | 'invalid-configuration';
}

export const DEFAULT_MODEL_API: Readonly<ModelApiConfig> = Object.freeze({
  provider: 'minimax',
  baseUrl: 'http://127.0.0.1:45557/v1',
  model: 'MiniMax-M3',
});

export interface CopilotSettings {
  cloudBackupEnabled: boolean;
  /** Main-only receipt. Renderer-safe settings explicitly omit it. */
  backupConsentReceipt: BackupConsentReceipt | null;
  /** Monotonic local revocation fence for stale receipts. */
  backupConsentGeneration: number;
  /** Main-only redacted rollback quarantine marker. */
  backupRecoveryMarker: BackupRecoveryMarker | null;
  theme: Theme;
  windowBounds: WindowBounds;
  shortcuts: ShortcutBinding[];
  /** Sprint 1.2 T-1.2.6 — current LLM provider config. */
  modelApi: ModelApiConfig;
  schemaVersion: number;
}

export interface RendererSafeCopilotSettings extends Omit<CopilotSettings, 'modelApi' | 'backupConsentReceipt' | 'backupRecoveryMarker'> {
  modelApi: RendererSafeModelApiConfig;
}

export const DEFAULT_SHORTCUTS: ReadonlyArray<ShortcutBinding> = [
  { id: 'open-settings', label: 'Open settings', accelerator: 'CommandOrControl+,' },
  { id: 'new-note', label: 'New note', accelerator: 'CommandOrControl+N' },
  { id: 'toggle-search', label: 'Toggle search', accelerator: 'CommandOrControl+K' },
];

export const DEFAULT_SETTINGS: Readonly<CopilotSettings> = Object.freeze({
  cloudBackupEnabled: false, // ← goal.md decision 2: default OFF
  backupConsentReceipt: null,
  backupConsentGeneration: 0,
  backupRecoveryMarker: null,
  theme: 'auto',
  windowBounds: { width: 1280, height: 800 },
  shortcuts: DEFAULT_SHORTCUTS.map((s) => ({ ...s })),
  modelApi: { ...DEFAULT_MODEL_API },
  schemaVersion: 3, // credential bytes moved out of this JSON store
});

export const SETTINGS_STORE_NAME = 'copilot-desktop';

/** Minimal interface satisfied by electron-store AND in-memory test fakes. */
export interface SettingsStorage {
  get<K extends keyof CopilotSettings>(key: K): CopilotSettings[K];
  set<K extends keyof CopilotSettings>(key: K, value: CopilotSettings[K]): void;
  getAll(): CopilotSettings;
  setAll(value: CopilotSettings): void;
  reset(): void;
  /** Main-only migration access; never exposed through preload/renderer. */
  readLegacyModelApiCredential?(): string | null;
  clearLegacyModelApiCredentialExact?(expected: string): void;
}

/** Production factory: persists to userData/copilot-desktop.json. */
export function createSettingsStore(cwd?: string): SettingsStorage {
  const store = new Store({
    name: SETTINGS_STORE_NAME,
    cwd,
    defaults: { ...DEFAULT_SETTINGS },
    // Electron-store uses JSON; schema bumps are read-time validated
    // by mergeWithDefaults below.
    clearInvalidConfig: false,
  });
  return wrapElectronStore(store);
}

/** Minimal shape we need from electron-store / conf. */
interface ElectronStoreLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  store: Record<string, unknown>;
  clear(): void;
}

/** Wrap an electron-store instance in our typed SettingsStorage interface. */
export function wrapElectronStore(raw: ElectronStoreLike): SettingsStorage {
  return {
    get(key) {
      const all = mergeWithDefaults(raw.store);
      return all[key];
    },
    set(key, value) {
      raw.set(key, value);
    },
    getAll() {
      return mergeWithDefaults(raw.store);
    },
    setAll(value) {
      raw.store = { ...value };
    },
    reset() {
      raw.clear();
    },
    readLegacyModelApiCredential() {
      const modelApi = raw.store.modelApi;
      if (!modelApi || typeof modelApi !== 'object') return null;
      const legacy = (modelApi as { apiKey?: unknown }).apiKey;
      return typeof legacy === 'string' && legacy.length > 0 ? legacy : null;
    },
    clearLegacyModelApiCredentialExact(expected) {
      const modelApi = raw.store.modelApi;
      if (!modelApi || typeof modelApi !== 'object') {
        throw new Error('LEGACY_CREDENTIAL_STATE_CHANGED');
      }
      const current = (modelApi as { apiKey?: unknown }).apiKey;
      if (typeof current !== 'string' || current !== expected) {
        throw new Error('LEGACY_CREDENTIAL_STATE_CHANGED');
      }
      const next = { ...(modelApi as Record<string, unknown>) };
      delete next.apiKey;
      raw.set('modelApi', next);
    },
  };
}

/**
 * Merge a stored snapshot over DEFAULT_SETTINGS so newer schema versions
 * still see sane defaults for any keys the file lacks. Unknown keys are
 * preserved so we don't drop user data on downgrade.
 */
export function mergeWithDefaults(stored: Record<string, unknown>): CopilotSettings {
  const out: CopilotSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const [k, v] of Object.entries(stored)) {
    if (v === undefined || v === null) continue;
    if (k === 'cloudBackupEnabled' && typeof v === 'boolean') {
      out.cloudBackupEnabled = v;
    } else if (k === 'backupConsentReceipt') {
      out.backupConsentReceipt = isBackupConsentReceiptShape(v) ? structuredClone(v) : null;
    } else if (k === 'backupConsentGeneration' && Number.isSafeInteger(v) && Number(v) >= 0) {
      out.backupConsentGeneration = Number(v);
    } else if (k === 'backupRecoveryMarker') {
      out.backupRecoveryMarker = isBackupRecoveryMarkerShape(v) ? structuredClone(v) : null;
    } else if (k === 'theme' && (v === 'dark' || v === 'light' || v === 'auto')) {
      out.theme = v;
    } else if (k === 'windowBounds' && typeof v === 'object') {
      const wb = v as { width?: unknown; height?: unknown; x?: unknown; y?: unknown };
      if (typeof wb.width === 'number' && typeof wb.height === 'number') {
        out.windowBounds = canonicalizeWindowBounds({
          width: wb.width,
          height: wb.height,
          x: wb.x,
          y: wb.y,
        });
      }
    } else if (k === 'shortcuts' && Array.isArray(v)) {
      out.shortcuts = (v as ShortcutBinding[]).filter(isValidShortcut);
    } else if (k === 'modelApi' && typeof v === 'object') {
      out.modelApi = parseModelApi(v);
    } else if (k === 'schemaVersion' && typeof v === 'number') {
      // Always allow upgrade — but cap to the latest known.
      out.schemaVersion = Math.max(v, DEFAULT_SETTINGS.schemaVersion);
    }
  }
  return out;
}

/** Parse + validate a `modelApi` payload from the persisted store.
 *  Returns the canonical shape (provider/baseUrl/model/apiKey). Falls
 *  back to defaults for missing/invalid fields. The renderer side uses
 *  `id` instead of `provider` — see also `parseModelApiFromId` below.
 *  Empty-string model/baseUrl are preserved so `validateModelApi` can
 *  surface them as a hard error. */
export function parseModelApi(input: unknown): ModelApiConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_MODEL_API };
  const v = input as { provider?: unknown; baseUrl?: unknown; model?: unknown };
  const provider: ModelProviderId =
    v.provider === 'minimax' ||
    v.provider === 'openai' ||
    v.provider === 'claude' ||
    v.provider === 'custom'
      ? v.provider
      : DEFAULT_MODEL_API.provider;
  const baseUrl = typeof v.baseUrl === 'string' ? v.baseUrl : DEFAULT_MODEL_API.baseUrl;
  return {
    provider,
    baseUrl: normalizeEndpointForStoredRead(baseUrl),
    model: typeof v.model === 'string' ? v.model : DEFAULT_MODEL_API.model,
  };
}

/** Render-side mirror: `id` is the field name there. */
export function parseModelApiFromId(input: unknown): ModelApiConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_MODEL_API };
  const v = input as { id?: unknown; baseUrl?: unknown; model?: unknown };
  const provider: ModelProviderId =
    v.id === 'minimax' || v.id === 'openai' || v.id === 'claude' || v.id === 'custom'
      ? v.id
      : DEFAULT_MODEL_API.provider;
  const baseUrl = typeof v.baseUrl === 'string' ? v.baseUrl : DEFAULT_MODEL_API.baseUrl;
  return {
    provider,
    baseUrl: normalizeEndpointForStoredRead(baseUrl),
    model: typeof v.model === 'string' ? v.model : DEFAULT_MODEL_API.model,
  };
}

/** Validate a fresh `modelApi` value sent over the IPC bridge.
 *  Returns the cleaned config (or `null` if the payload was so broken
 *  we couldn't recover a usable shape). */
export function validateModelApi(input: unknown): ModelApiConfig | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { provider?: unknown; id?: unknown; baseUrl?: unknown; model?: unknown };
  const provider = raw.provider ?? raw.id;
  if (!MODEL_PROVIDER_IDS.includes(provider as ModelProviderId)) return null;
  if (typeof raw.baseUrl !== 'string' || typeof raw.model !== 'string') return null;
  if (raw.model.length === 0 || raw.model !== raw.model.trim() || /[\u0000-\u001f\u007f]/u.test(raw.model)) {
    return null;
  }
  let normalizedBaseUrl: string;
  try {
    normalizedBaseUrl = normalizeModelEndpoint(raw.baseUrl).endpoint;
  } catch {
    return null;
  }
  // Accept either {provider} or {id} as the field name.
  const candidate = raw.provider !== undefined
    ? parseModelApi(input)
    : parseModelApiFromId(input);
  return { ...candidate, baseUrl: normalizedBaseUrl, model: raw.model };
}

export interface ModelApiMutationResult {
  config: ModelApiConfig;
  credentialAction: 'preserve' | 'replace' | 'clear';
  /** Present only for the main-process write call; never persisted in settings. */
  credential?: string;
}

/** Parse renderer writes while keeping credential bytes outside settings JSON. */
export function applyModelApiMutation(
  current: ModelApiConfig,
  input: unknown,
): ModelApiMutationResult | null {
  const validated = validateModelApi(input);
  if (!validated) return null;
  const mutation = input as Partial<ModelApiMutation>;
  if (mutation.clearApiKey === true && typeof mutation.apiKey === 'string' && mutation.apiKey.length > 0) {
    return null;
  }
  if (mutation.clearApiKey === true) {
    return { config: validated, credentialAction: 'clear' };
  }
  if (typeof mutation.apiKey === 'string' && mutation.apiKey.length > 0) {
    return { config: validated, credentialAction: 'replace', credential: mutation.apiKey };
  }
  void current;
  return { config: validated, credentialAction: 'preserve' };
}

/**
 * Renderer-safe snapshot. Credentials stay in the main-process store and are
 * accepted only on writes; reads expose an empty value so the UI can replace
 * a key but can never recover the persisted plaintext.
 */
export function redactSettingsForRenderer(
  settings: CopilotSettings,
  credential: {
    apiKeyConfigured?: boolean;
    status?: CredentialStatus | 'invalid-configuration';
  } = {},
): RendererSafeCopilotSettings {
  const { backupConsentReceipt: _mainOnlyReceipt, backupRecoveryMarker: _mainOnlyRecovery, ...safeSettings } = settings;
  return {
    ...safeSettings,
    shortcuts: settings.shortcuts.map((shortcut) => ({ ...shortcut })),
    windowBounds: { ...settings.windowBounds },
    modelApi: {
      provider: settings.modelApi.provider,
      baseUrl: settings.modelApi.baseUrl,
      model: settings.modelApi.model,
      apiKey: '',
      apiKeyConfigured: credential.apiKeyConfigured === true,
      credentialStatus: credential.status ?? 'not-configured',
    },
  };
}

function normalizeEndpointForStoredRead(baseUrl: string): string {
  try {
    return normalizeModelEndpoint(baseUrl).endpoint;
  } catch (error) {
    if (error instanceof ModelCredentialError) return baseUrl;
    return baseUrl;
  }
}

function isBackupRecoveryMarkerShape(value: unknown): value is BackupRecoveryMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<BackupRecoveryMarker>;
  return Object.keys(value).sort().join('|') === ['attempts', 'createdAtMs', 'markerId', 'phase', 'reason', 'schemaVersion', 'snapshotId'].sort().join('|')
    && item.schemaVersion === 1
    && typeof item.markerId === 'string'
    && typeof item.snapshotId === 'string'
    && item.reason === 'CREATE_ROLLBACK_INCOMPLETE'
    && (item.phase === 'credential-cleanup' || item.phase === 'snapshot-discard')
    && Number.isSafeInteger(item.createdAtMs)
    && Number.isSafeInteger(item.attempts)
    && Number(item.attempts) >= 0;
}

function isBackupConsentReceiptShape(value: unknown): value is BackupConsentReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<BackupConsentReceipt>;
  return item.schemaVersion === 1
    && typeof item.consentId === 'string'
    && typeof item.region === 'string'
    && typeof item.bucket === 'string'
    && Array.isArray(item.selectedScopes)
    && Number.isSafeInteger(item.estimatedEncryptedBytes)
    && item.counts !== null && typeof item.counts === 'object' && !Array.isArray(item.counts)
    && typeof item.retentionAndDelete === 'string'
    && typeof item.keyLoss === 'string'
    && typeof item.cloudCannotDecrypt === 'string'
    && typeof item.exactFirstUpload === 'string'
    && Number.isSafeInteger(item.issuedAtMs)
    && Number.isSafeInteger(item.expiresAtMs)
    && Number.isSafeInteger(item.generation)
    && typeof item.ownerHash === 'string'
    && typeof item.targetHash === 'string'
    && typeof item.bindingSha256 === 'string';
}

function isValidShortcut(s: unknown): s is ShortcutBinding {
  if (!s || typeof s !== 'object') return false;
  const sc = s as Partial<ShortcutBinding>;
  return (
    typeof sc.id === 'string' &&
    sc.id.length > 0 &&
    typeof sc.label === 'string' &&
    typeof sc.accelerator === 'string' &&
    sc.accelerator.length > 0
  );
}

/** Pure utility — validate a single shortcut without touching storage. */
export function validateShortcut(input: Partial<ShortcutBinding>): ShortcutBinding | null {
  if (!input || typeof input !== 'object') return null;
  const id = typeof input.id === 'string' && input.id.length > 0 ? input.id : randomUUID();
  const label = typeof input.label === 'string' && input.label.length > 0 ? input.label : 'Shortcut';
  const accelerator =
    typeof input.accelerator === 'string' &&
    /^[A-Za-z0-9+]+(\+[A-Za-z0-9+]+)*$/.test(input.accelerator)
      ? input.accelerator
      : null;
  if (!accelerator) return null;
  return { id, label, accelerator };
}
