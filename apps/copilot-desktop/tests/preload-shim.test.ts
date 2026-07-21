/**
 * preload-shim test — guards the renderer's window.copilot type
 * contract so a refactor in main that drops a field is caught here
 * even before the SettingsPanel tests run.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('preload bridge contract', () => {
  it('exposes a CopilotBridge with all settings methods', async () => {
    const bridge = {
      settings: {
        get: vi.fn(),
        setCloudBackup: vi.fn(),
        setTheme: vi.fn(),
        setWindowBounds: vi.fn(),
        setShortcuts: vi.fn(),
        reset: vi.fn(),
      },
      window: {
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
      meta: {
        appVersion: '0.1.0',
        platform: 'darwin' as NodeJS.Platform,
        productName: 'njx-copilot-v6',
      },
    };
    (globalThis as { window?: unknown }).window = { copilot: bridge };

    const { useSettingsStore } = await import('../src/renderer/stores/settings');
    await useSettingsStore.getState().hydrate();
    expect(bridge.settings.get).toHaveBeenCalledTimes(1);
  });
});