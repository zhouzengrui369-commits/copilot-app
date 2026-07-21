/**
 * Settings useSettings + settings-store modelApi tests.
 *
 *   - Default state has minimax provider
 *   - setModelApi round-trips through the bridge
 *   - mergeWithDefaults fills in modelApi defaults when missing
 *   - validateModelApi returns null for broken payloads
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSettings } from '../src/renderer/components/Settings/useSettings';
import { resetSettingsStoreForTests, useSettingsStore } from '../src/renderer/stores/settings';
import { mergeWithDefaults, validateModelApi } from '../src/main/settings-store';

function makeBridge() {
  const baseSettings = {
    cloudBackupEnabled: false,
    theme: 'auto' as const,
    windowBounds: { width: 1280, height: 800 },
    shortcuts: [],
    modelApi: {
      provider: 'minimax' as const,
      baseUrl: 'http://127.0.0.1:45557/v1',
      model: 'MiniMax-M3',
      apiKey: '' as const,
      apiKeyConfigured: false,
      credentialStatus: 'not-configured' as const,
    },
    schemaVersion: 3,
  };
  const setModelApi = vi.fn().mockImplementation(async (cfg: {
    provider: 'minimax' | 'openai' | 'claude' | 'custom';
    baseUrl: string;
    model: string;
    apiKey?: string;
    clearApiKey?: boolean;
  }) => ({
    ...baseSettings,
    modelApi: {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      apiKey: '' as const,
      apiKeyConfigured: typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0,
      credentialStatus: typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0
        ? 'configured' as const
        : 'not-configured' as const,
    },
  }));
  (window as unknown as { copilot: unknown }).copilot = {
    settings: {
      get: vi.fn().mockResolvedValue(baseSettings),
      setCloudBackup: vi.fn(),
      setTheme: vi.fn(),
      setWindowBounds: vi.fn(),
      setShortcuts: vi.fn(),
      setModelApi,
      reset: vi.fn().mockResolvedValue(baseSettings),
    },
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    meta: { appVersion: '0.1.0-test', platform: 'darwin' as const, productName: 'njx-copilot-v6' },
  };
  return { setModelApi };
}

describe('useSettings — modelApi', () => {
  beforeEach(() => {
    resetSettingsStoreForTests();
    vi.restoreAllMocks();
  });

  it('starts with the minimax defaults when the store is empty', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.modelApi.id).toBe('minimax');
    expect(result.current.modelApi.baseUrl).toBe('http://127.0.0.1:45557/v1');
  });

  it('setProvider switches provider and does not carry a credential', async () => {
    makeBridge();
    const { setModelApi } = makeBridge();
    (window as unknown as { copilot: { settings: { setModelApi: typeof setModelApi } } }).copilot.settings.setModelApi =
      setModelApi;
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await result.current.setProvider('openai');
    });
    await waitFor(() => expect(setModelApi).toHaveBeenCalled());
    // setModelApi is called with the MAIN-shape (provider field) — the
    // renderer's setModelApi action translates id → provider before
    // invoking the bridge.
    const last = setModelApi.mock.calls[setModelApi.mock.calls.length - 1]?.[0] as
      | { provider: string; baseUrl: string; model: string; apiKey: string }
      | undefined;
    expect(last?.provider).toBe('openai');
    expect(last?.baseUrl).toBe('https://api.openai.com/v1');
    expect(last?.apiKey).toBe('');
  });

  it('updateModelApi patches only the provided fields', async () => {
    makeBridge();
    const { setModelApi } = makeBridge();
    (window as unknown as { copilot: { settings: { setModelApi: typeof setModelApi } } }).copilot.settings.setModelApi =
      setModelApi;
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await result.current.updateModelApi({ model: 'gpt-4o' });
    });
    const last = setModelApi.mock.calls[setModelApi.mock.calls.length - 1]?.[0] as
      | { model: string }
      | undefined;
    expect(last?.model).toBe('gpt-4o');
  });
});

describe('settings-store — modelApi merge/validate', () => {
  it('mergeWithDefaults fills in defaults when stored snapshot has no modelApi', () => {
    const merged = mergeWithDefaults({ cloudBackupEnabled: false });
    expect(merged.modelApi.provider).toBe('minimax');
    expect(merged.modelApi.baseUrl).toBe('http://127.0.0.1:45557/v1');
  });

  it('mergeWithDefaults preserves an existing modelApi (provider field)', () => {
    const merged = mergeWithDefaults({
      modelApi: { provider: 'claude', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022', apiKey: '[REDACTED]' },
    });
    expect(merged.modelApi.provider).toBe('claude');
    expect(merged.modelApi).not.toHaveProperty('apiKey');
  });

  it('mergeWithDefaults downgrades unknown provider ids to minimax', () => {
    // @ts-ignore — testing runtime guard
    const merged = mergeWithDefaults({ modelApi: { provider: 'bogus', baseUrl: 'x', model: 'y' } });
    expect(merged.modelApi.provider).toBe('minimax');
  });

  it('validateModelApi returns null for empty baseUrl', () => {
    expect(
      validateModelApi({ provider: 'openai', baseUrl: '', model: 'gpt-4o', apiKey: '[REDACTED]' }),
    ).toBeNull();
  });

  it('validateModelApi returns null for empty model', () => {
    expect(
      validateModelApi({ provider: 'openai', baseUrl: 'https://x', model: '', apiKey: '[REDACTED]' }),
    ).toBeNull();
  });

  it('validateModelApi returns null for non-object input', () => {
    expect(validateModelApi(null)).toBeNull();
    expect(validateModelApi('hello')).toBeNull();
  });

  it('validateModelApi returns a valid config for good input', () => {
    const v = validateModelApi({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '[REDACTED]',
    });
    expect(v).not.toBeNull();
    expect(v?.provider).toBe('openai');
  });
});
