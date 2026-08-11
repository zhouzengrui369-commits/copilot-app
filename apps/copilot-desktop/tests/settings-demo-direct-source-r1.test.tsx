import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SettingsPanel } from '../src/renderer/components/SettingsPanel';
import { resetSettingsStoreForTests } from '../src/renderer/stores/settings';

const SETTINGS = {
  cloudBackupEnabled: false,
  theme: 'auto' as const,
  windowBounds: { width: 1440, height: 900 },
  shortcuts: [
    { id: 'open-settings', label: 'Open settings', accelerator: 'CommandOrControl+,' },
    { id: 'new-note', label: 'New note', accelerator: 'CommandOrControl+N' },
    { id: 'toggle-search', label: 'Toggle search', accelerator: 'CommandOrControl+K' },
  ],
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

function installBridge() {
  (window as unknown as { copilot: unknown }).copilot = {
    settings: {
      get: vi.fn().mockResolvedValue(SETTINGS),
      setCloudBackup: vi.fn().mockResolvedValue(SETTINGS),
      setTheme: vi.fn().mockResolvedValue(SETTINGS),
      setWindowBounds: vi.fn().mockResolvedValue(SETTINGS),
      setShortcuts: vi.fn().mockResolvedValue(SETTINGS),
      setModelApi: vi.fn().mockResolvedValue(SETTINGS),
      reset: vi.fn().mockResolvedValue(SETTINGS),
    },
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    meta: {
      appVersion: '0.1.0-test',
      platform: 'darwin' as const,
      productName: 'njx-copilot-v6',
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetSettingsStoreForTests();
  installBridge();
});

describe('Settings Demo direct-source adoption R1', () => {
  it('adopts the Demo settings framework without dropping live controls', async () => {
    render(<SettingsPanel />);

    const panel = await screen.findByTestId('settings-panel');
    expect(panel).toHaveAttribute(
      'data-demo-source',
      'copilot-phase1-mvp-demo-v3-calendar-moc#settings',
    );
    expect(screen.getByTestId('settings-demo-layout')).toBeInTheDocument();

    const menu = screen.getByRole('navigation', { name: '设置分类' });
    expect(within(menu).getAllByRole('link')).toHaveLength(5);
    for (const label of ['模型与 AI', '本地语音与后台记录', '数据与隐私', '快捷键', '外观']) {
      expect(within(menu).getByRole('link', { name: label })).toBeInTheDocument();
    }

    expect(screen.getByTestId('settings-model-api')).toBeInTheDocument();
    expect(screen.getByTestId('model-provider-select')).toBeInTheDocument();
    expect(screen.getByTestId('model-api-key')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('settings-theme-selector')).toBeInTheDocument();
    expect(screen.getByTestId('settings-shortcuts-group')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-open-settings')).toBeInTheDocument();
    expect(screen.getByTestId('trash-management-settings')).toBeInTheDocument();
    expect(screen.getByTestId('settings-reset-button')).toBeInTheDocument();
  });

  it('keeps ASR, Remote, Backup and release truth fail-closed', async () => {
    render(<SettingsPanel />);
    await screen.findByTestId('settings-panel');

    expect(screen.getByTestId('settings-voice-section')).toHaveTextContent(
      'LOCAL ASR · NOT_READY',
    );
    expect(screen.getByTestId('settings-voice-section')).toHaveTextContent(
      '不使用 WebSpeech 或云 ASR fallback',
    );
    expect(screen.getByTestId('settings-post-mvp-boundary')).toHaveTextContent(
      'Remote / Backup · OFF · POST-MVP',
    );
    expect(screen.getByTestId('settings-local-first-boundaries')).toHaveTextContent(
      '本地真值，模型不可覆盖',
    );
    expect(screen.getByTestId('settings-release-boundary')).toHaveTextContent(
      'macOS final candidate · 未验证',
    );
    expect(screen.getByTestId('settings-release-boundary')).toHaveTextContent(
      'MVP_NOT_COMPLETE',
    );
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
