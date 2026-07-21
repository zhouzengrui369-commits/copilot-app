/**
 * settings.ts — Zustand store that mirrors CopilotSettings, hydrates from
 * the preload bridge on mount, and persists writes through ipcRenderer.
 *
 * Sprint 1.1 T-1.1.1 scope: settings panel only. Sprint 1.2 T-1.2.6
 * adds: LLM provider config (minimax / OpenAI / Claude / 自托管) +
 *       a `setModelApi` action that round-trips through the new
 *       `ipc:copilot:settings:set-model-api` channel.
 *
 * Field-name translation: the main process stores `provider` (e.g.
 * "minimax") and the renderer side stores `id` (matches the
 * @copilot/llm-client ProviderConfig). We translate at the IPC
 * boundary so neither side has to know about the other.
 */
import { create } from 'zustand';
import type {
  CopilotSettings as RendererCopilotSettings,
  ModelApiConfig as RendererModelApiConfig,
  ModelApiMutation as RendererModelApiMutation,
  ShortcutBinding,
  Theme,
} from '../types/settings';
import { DEFAULT_MODEL_API } from '../types/settings';
import type { ModelApiMutation as MainModelApiMutation, RendererSafeCopilotSettings, RendererSafeModelApiConfig } from '../../main/settings-store';

export interface SettingsState extends RendererCopilotSettings {
  /** True after the first successful hydrate. Components that need real
   *  settings should show a loading skeleton until this flips true. */
  hydrated: boolean;
  /** True while a hydrate (or other IPC) call is in flight. */
  loading: boolean;
  /** Last error surfaced to the renderer (string). */
  error: string | null;

  hydrate(): Promise<void>;
  setCloudBackup(enabled: boolean): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  setShortcuts(shortcuts: ShortcutBinding[]): Promise<void>;
  /** Sprint 1.2 T-1.2.6 — persist a new LLM provider config. */
  setModelApi(cfg: RendererModelApiMutation): Promise<void>;
  reset(): Promise<void>;
}

const BRIDGE = () => {
  if (typeof window === 'undefined' || !window.copilot) {
    throw new Error('copilot bridge unavailable — preload did not run');
  }
  return window.copilot;
};

/** Translate the main-process payload (uses `provider`) into the
 *  renderer-side shape (uses `id` to match @copilot/llm-client). */
function toRendererModelApi(main: RendererSafeModelApiConfig): RendererModelApiConfig {
  return {
    id: main.provider,
    baseUrl: main.baseUrl,
    model: main.model,
    apiKey: main.apiKey,
    apiKeyConfigured: main.apiKeyConfigured,
    credentialStatus: main.credentialStatus,
  };
}

/** Inverse: renderer-shape → main-shape for the IPC payload. */
function toMainModelApi(renderer: RendererModelApiMutation): MainModelApiMutation {
  return {
    provider: renderer.id,
    baseUrl: renderer.baseUrl,
    model: renderer.model,
    ...(typeof renderer.apiKey === 'string' ? { apiKey: renderer.apiKey } : {}),
    ...(renderer.clearApiKey === true ? { clearApiKey: true } : {}),
  };
}

/** Translate the full main-process CopilotSettings snapshot. */
function toRendererSettings(next: RendererSafeCopilotSettings): RendererCopilotSettings {
  return {
    cloudBackupEnabled: next.cloudBackupEnabled,
    theme: next.theme,
    windowBounds: next.windowBounds,
    shortcuts: next.shortcuts,
    modelApi: toRendererModelApi(next.modelApi),
    schemaVersion: next.schemaVersion,
  };
}

function applyToState(next: RendererSafeCopilotSettings): Partial<SettingsState> {
  const r = toRendererSettings(next);
  return {
    cloudBackupEnabled: r.cloudBackupEnabled,
    theme: r.theme,
    windowBounds: r.windowBounds,
    shortcuts: r.shortcuts,
    modelApi: r.modelApi ?? { ...DEFAULT_MODEL_API },
    schemaVersion: r.schemaVersion,
    hydrated: true,
    loading: false,
    error: null,
  };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  cloudBackupEnabled: false,
  theme: 'auto',
  windowBounds: { width: 1280, height: 800 },
  shortcuts: [],
  modelApi: { ...DEFAULT_MODEL_API },
  schemaVersion: 3,
  hydrated: false,
  loading: false,
  error: null,

  hydrate: async () => {
    set({ loading: true });
    try {
      const next = await BRIDGE().settings.get();
      set(applyToState(next));
    } catch (err) {
      // Even on error we mark the store as hydrated so the UI can render
      // the error banner instead of being stuck on a loading skeleton.
      set({ error: (err as Error).message, loading: false, hydrated: true });
    }
  },

  setCloudBackup: async (enabled) => {
    try {
      const next = await BRIDGE().settings.setCloudBackup(enabled);
      set(applyToState(next));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  setTheme: async (theme) => {
    try {
      const next = await BRIDGE().settings.setTheme(theme);
      set(applyToState(next));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  setShortcuts: async (shortcuts) => {
    try {
      const next = await BRIDGE().settings.setShortcuts(shortcuts);
      set(applyToState(next));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  setModelApi: async (cfg) => {
    try {
      const next = await BRIDGE().settings.setModelApi(toMainModelApi(cfg));
      set(applyToState(next));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  reset: async () => {
    try {
      const next = await BRIDGE().settings.reset();
      set(applyToState(next));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));

/** Selector helpers — keep components from re-rendering on unrelated slices. */
export const selectCloudBackup = (s: SettingsState) => s.cloudBackupEnabled;
export const selectTheme = (s: SettingsState) => s.theme;
export const selectShortcuts = (s: SettingsState) => s.shortcuts;
export const selectModelApi = (s: SettingsState) => s.modelApi;
export const selectLoading = (s: SettingsState) => s.loading;
export const selectHydrated = (s: SettingsState) => s.hydrated;
export const selectError = (s: SettingsState) => s.error;

/**
 * Reset the store to its initial (un-hydrated) state. Test helper —
 * production code should rely on `reset()` (which round-trips defaults
 * through the IPC bridge) instead.
 */
export function resetSettingsStoreForTests(): void {
  useSettingsStore.setState({
    cloudBackupEnabled: false,
    theme: 'auto',
    windowBounds: { width: 1280, height: 800 },
    shortcuts: [],
    modelApi: { ...DEFAULT_MODEL_API },
    schemaVersion: 3,
    hydrated: false,
    loading: false,
    error: null,
  });
}
