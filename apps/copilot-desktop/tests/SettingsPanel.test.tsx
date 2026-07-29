/**
 * SettingsPanel tests — verify the user-facing contract:
 *   - The cloud-backup toggle is OFF on first paint (the goal.md
 *     decision 2 default).
 *   - Clicking the toggle flips the underlying state via the bridge.
 *   - Theme select triggers a setTheme call (now via radio tiles).
 *   - Shortcuts editor surfaces the three seeded defaults and Save
 *     becomes enabled once the user edits a binding.
 *   - Reset is gated behind a 3-second arm window + window.confirm.
 *
 * The bridge (`window.copilot`) is mocked with vi.fn() spies so we can
 * assert call counts and arguments without spawning Electron.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsPanel } from '../src/renderer/components/SettingsPanel';

function makeBridge(overrides: Partial<{
  get: ReturnType<typeof vi.fn>;
  setCloudBackup: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  setShortcuts: ReturnType<typeof vi.fn>;
  setModelApi: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}> = {}) {
  const baseSettings = {
    cloudBackupEnabled: false,
    theme: 'auto' as const,
    windowBounds: { width: 1280, height: 800 },
    shortcuts: [
      { id: 'open-settings', label: 'Open settings', accelerator: 'CommandOrControl+,' },
      { id: 'new-note', label: 'New note', accelerator: 'CommandOrControl+N' },
      { id: 'toggle-search', label: 'Toggle search', accelerator: 'CommandOrControl+K' },
    ],
    modelApi: { id: 'minimax' as const, baseUrl: 'http://127.0.0.1:45557/v1', model: 'MiniMax-M3', apiKey: '' },
    schemaVersion: 2,
  };

  const get = overrides.get ?? vi.fn().mockResolvedValue(baseSettings);
  const setCloudBackup =
    overrides.setCloudBackup ?? vi.fn().mockImplementation(async (v: boolean) => ({
      ...baseSettings,
      cloudBackupEnabled: v,
    }));
  const setTheme =
    overrides.setTheme ?? vi.fn().mockImplementation(async (t: string) => ({ ...baseSettings, theme: t }));
  const setShortcuts =
    overrides.setShortcuts ??
    vi.fn().mockImplementation(async (s: typeof baseSettings.shortcuts) => ({
      ...baseSettings,
      shortcuts: s,
    }));
  const setModelApi =
    overrides.setModelApi ??
    vi.fn().mockImplementation(async (cfg: typeof baseSettings.modelApi) => ({
      ...baseSettings,
      modelApi: cfg,
    }));
  const reset = overrides.reset ?? vi.fn().mockResolvedValue(baseSettings);

  // Attach the bridge to the existing jsdom window — DO NOT replace the
  // window object wholesale, otherwise jsdom-provided methods (confirm,
  // matchMedia, etc.) vanish and downstream tests crash.
  (window as unknown as { copilot: unknown }).copilot = {
    settings: { get, setCloudBackup, setTheme, setWindowBounds: vi.fn(), setShortcuts, setModelApi, reset },
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    meta: { appVersion: '0.1.0-test', platform: 'darwin' as const, productName: 'njx-copilot-v6' },
  };

  return { get, setCloudBackup, setTheme, setShortcuts, setModelApi, reset, baseSettings };
}

describe('SettingsPanel — explicit backup owner consent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Remote and Backup as a read-only post-MVP boundary', async () => {
    makeBridge();
    render(<SettingsPanel />);
    await screen.findByTestId('settings-post-mvp-boundary');
    expect(screen.getByTestId('settings-post-mvp-boundary')).toHaveTextContent('OFF · POST-MVP');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('does not expose owner-consent or route enable through settings.setCloudBackup', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    await screen.findByTestId('settings-post-mvp-boundary');
    expect(screen.queryByTestId('backup-owner-consent')).not.toBeInTheDocument();
    expect(bridge.setCloudBackup).not.toHaveBeenCalled();
  });

  it('does not trust the legacy settings flag as backup runtime state', async () => {
    makeBridge({
      get: vi.fn().mockResolvedValue({
        cloudBackupEnabled: true,
        theme: 'dark',
        windowBounds: { width: 1024, height: 768 },
        shortcuts: [],
        // Bridge returns the MAIN-shape (provider field).
        modelApi: { provider: 'minimax', baseUrl: 'http://127.0.0.1:45557/v1', model: 'MiniMax-M3', apiKey: '' },
        schemaVersion: 2,
      }),
    });
    render(<SettingsPanel />);
    await screen.findByTestId('settings-post-mvp-boundary');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

describe('SettingsPanel — theme select', () => {
  it('renders the three theme radio tiles', async () => {
    makeBridge();
    render(<SettingsPanel />);
    // Sprint 1.2 T-1.2.6: ThemeSelector switched from <select> to a
    // radio group — verify all three radios render.
    await screen.findByTestId('settings-theme-selector');
    expect(screen.getByTestId('theme-radio-dark')).toBeInTheDocument();
    expect(screen.getByTestId('theme-radio-light')).toBeInTheDocument();
    expect(screen.getByTestId('theme-radio-auto')).toBeInTheDocument();
  });

  it('calls setTheme when the user picks a different value', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    const dark = await screen.findByTestId('theme-radio-dark');
    fireEvent.click(dark);
    await waitFor(() => expect(bridge.setTheme).toHaveBeenCalledWith('dark'));
  });
});

describe('SettingsPanel — shortcuts', () => {
  it('lists the three default shortcuts with editable inputs', async () => {
    makeBridge();
    render(<SettingsPanel />);
    expect((await screen.findByTestId('shortcut-open-settings'))).toBeInTheDocument();
    expect((await screen.findByTestId('shortcut-new-note'))).toBeInTheDocument();
    expect((await screen.findByTestId('shortcut-toggle-search'))).toBeInTheDocument();
  });

  it('enables Save after the user edits an accelerator', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    const save = (await screen.findByTestId('shortcuts-save')) as HTMLButtonElement;
    expect(save).toBeDisabled();
    const input = (await screen.findByTestId('shortcut-open-settings')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Command+Shift+S' } });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(bridge.setShortcuts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'open-settings', accelerator: 'Command+Shift+S' }),
        ]),
      ),
    );
  });
});

describe('SettingsPanel — reset', () => {
  it('gates reset behind 3-second arm window + window.confirm', async () => {
    const bridge = makeBridge();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsPanel />);
    // Sprint 1.2 T-1.2.6: ResetButton now uses a 3-second arm window
    // before the confirm dialog appears, so a single click should not
    // call bridge.reset at all (not even after window.confirm returns
    // false — because the user is still in the "armed" state).
    fireEvent.click(await screen.findByTestId('settings-reset-button'));
    expect(bridge.reset).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    // Confirm dialog only opens on the second click (after arming).
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('settings-reset-button'));
    await waitFor(() => expect(bridge.reset).toHaveBeenCalledTimes(1));
  });
});

describe('SettingsPanel — loading and error states', () => {
  it('renders a loading state while settings hydrate', () => {
    makeBridge({ get: vi.fn().mockReturnValue(new Promise(() => {})) });
    render(<SettingsPanel />);
    expect(screen.getByTestId('settings-panel-loading')).toBeInTheDocument();
  });

  it('surfaces a bridge error via the error banner', async () => {
    makeBridge({
      get: vi.fn().mockRejectedValue(new Error('ipc channel closed')),
    });
    render(<SettingsPanel />);
    await waitFor(() =>
      expect(screen.getByTestId('settings-error').textContent).toContain('ipc channel closed'),
    );
  });
});
