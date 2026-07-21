/**
 * renderer-side type definitions. Mirrors settings-store.ts so the
 * renderer can stay isolated from the main process while still typing
 * its store against the same shape.
 *
 * Sprint 1.2 T-1.2.6 adds `ModelProviderId` + `ModelApiConfig` (with
 * `id` as the field name, mirroring @copilot/llm-client) and a
 * `modelApi` slice on `CopilotSettings`.
 */
export type Theme = 'dark' | 'light' | 'auto';

export interface ShortcutBinding {
  id: string;
  label: string;
  accelerator: string;
}

/** LLM provider id — mirrors @copilot/llm-client ProviderId. */
export type ModelProviderId = 'minimax' | 'openai' | 'claude' | 'custom';

export const MODEL_PROVIDER_IDS: ReadonlyArray<ModelProviderId> = ['minimax', 'openai', 'claude', 'custom'];

/** Provider config persisted in the renderer's settings store.
 *  Uses `id` (not `provider`) so it matches the @copilot/llm-client
 *  ProviderConfig shape directly. The IPC bridge translates between
 *  `id` (renderer) and `provider` (main) on its way through preload. */
export interface ModelApiConfig {
  id: ModelProviderId;
  baseUrl: string;
  model: string;
  /** Write-only draft. Main-process reads always return the empty string. */
  apiKey: string;
  apiKeyConfigured?: boolean;
  credentialStatus?:
    | 'configured'
    | 'not-configured'
    | 'migration-required'
    | 'protection-unavailable'
    | 'invalid-configuration';
}

export interface ModelApiMutation extends Omit<ModelApiConfig, 'apiKey'> {
  apiKey?: string;
  clearApiKey?: boolean;
}

export const DEFAULT_MODEL_API: ModelApiConfig = Object.freeze({
  id: 'minimax',
  baseUrl: 'http://127.0.0.1:45557/v1',
  model: 'MiniMax-M3',
  apiKey: '',
  apiKeyConfigured: false,
  credentialStatus: 'not-configured',
}) as ModelApiConfig;

export interface CopilotSettings {
  cloudBackupEnabled: boolean;
  theme: Theme;
  windowBounds: { width: number; height: number; x?: number; y?: number };
  shortcuts: ShortcutBinding[];
  /** LLM provider config — Sprint 1.2 T-1.2.6. */
  modelApi: ModelApiConfig;
  schemaVersion: number;
}
