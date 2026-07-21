/**
 * useSettings — renderer-side hook facade for the settings zustand store.
 *
 * Wraps `useSettingsStore` with convenient derived helpers:
 *   - `modelApi`        — current LLM provider config
 *   - `setProvider`     — switch provider id (pre-fills defaults)
 *   - `updateModelApi`  — patch arbitrary provider fields
 *   - `resetModelApi`   — clear LLM config back to minimax defaults
 *
 * The actual IPC persistence happens inside the store actions; this
 * hook just bundles the shape and validation that the UI needs.
 *
 * Sprint 1.2 T-1.2.6 (settings panel + multi-provider).
 */
import { useCallback, useMemo } from 'react';
import { selectModelApi, useSettingsStore } from '../../stores/settings';
import type { ModelApiConfig, ModelApiMutation, ModelProviderId } from '../../types/settings';

export interface UseSettingsReturn {
  modelApi: ModelApiConfig;
  setProvider: (id: ModelProviderId) => Promise<void>;
  updateModelApi: (patch: Partial<ModelApiMutation>) => Promise<void>;
  resetModelApi: () => Promise<void>;
  isReady: boolean;
}

const DEFAULT: ModelApiConfig = {
  id: 'minimax',
  baseUrl: 'http://127.0.0.1:45557/v1',
  model: 'MiniMax-M3',
  apiKey: '',
  apiKeyConfigured: false,
  credentialStatus: 'not-configured',
};

export function useSettings(): UseSettingsReturn {
  const storeConfig = useSettingsStore(selectModelApi);
  const setModelApi = useSettingsStore((s) => s.setModelApi);
  const hydrated = useSettingsStore((s) => s.hydrated);

  const modelApi = useMemo<ModelApiConfig>(
    () => storeConfig ?? DEFAULT,
    [storeConfig],
  );

  const setProvider = useCallback(
    async (id: ModelProviderId) => {
      // Switching provider resets baseUrl/model to that provider's
      // defaults. Credentials are never copied across provider/origin
      // bindings; the new exact binding starts unconfigured.
      const defaults = providerDefaults(id);
      await setModelApi({
        id,
        baseUrl: defaults.baseUrl,
        model: defaults.model,
        apiKey: '',
        apiKeyConfigured: false,
        credentialStatus: 'not-configured',
      });
    },
    [setModelApi],
  );

  const updateModelApi = useCallback(
    async (patch: Partial<ModelApiConfig>) => {
      await setModelApi({ ...modelApi, ...patch, apiKey: patch.apiKey });
    },
    [setModelApi, modelApi],
  );

  const resetModelApi = useCallback(async () => {
    await setModelApi({ ...DEFAULT });
  }, [setModelApi]);

  return {
    modelApi,
    setProvider,
    updateModelApi,
    resetModelApi,
    isReady: hydrated,
  };
}

export function providerDefaults(id: ModelProviderId): Pick<ModelApiConfig, 'baseUrl' | 'model'> {
  switch (id) {
    case 'minimax':
      return { baseUrl: 'http://127.0.0.1:45557/v1', model: 'MiniMax-M3' };
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
    case 'claude':
      return { baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' };
    case 'custom':
      return { baseUrl: '', model: 'self-hosted-model' };
  }
}
