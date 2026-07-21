/**
 * T-1.2.6 — Settings panel new-component tests.
 *
 * Covers the five acceptance cases the spec calls out:
 *   1. ThemeSelector flips the store theme (深/浅/自动) on click.
 *   2. ModelApiConfig switches provider + persists fields.
 *   3. Persist through electron-store round-trips modelApi + theme + cloudBackup.
 *   4. ResetButton gates reset behind the 3s arm + window.confirm.
 *   5. LLM client reinit — verify the persisted provider id matches
 *      createProvider's dispatch.
 *
 * The bridge (`window.copilot`) is mocked with vi.fn() so we can
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
    modelApi: {
      id: 'minimax' as const,
      baseUrl: 'http://127.0.0.1:45557/v1',
      model: 'MiniMax-M3',
      apiKey: '',
    },
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

  (window as unknown as { copilot: unknown }).copilot = {
    settings: {
      get,
      setCloudBackup,
      setTheme,
      setWindowBounds: vi.fn(),
      setShortcuts,
      setModelApi,
      reset,
    },
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    meta: { appVersion: '0.1.0-test', platform: 'darwin' as const, productName: 'njx-copilot-v6' },
  };

  return { get, setCloudBackup, setTheme, setShortcuts, setModelApi, reset, baseSettings };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('T-1.2.6 — ThemeSelector (3 cases)', () => {
  it('renders all three theme radios with the active one marked', async () => {
    makeBridge();
    render(<SettingsPanel />);
    await screen.findByTestId('settings-theme-selector');
    const dark = screen.getByTestId('theme-radio-dark');
    const light = screen.getByTestId('theme-radio-light');
    const auto = screen.getByTestId('theme-radio-auto');
    expect(dark).toBeInTheDocument();
    expect(light).toBeInTheDocument();
    expect(auto).toBeInTheDocument();
    // Default theme is 'auto' so that radio is checked.
    expect(auto).toBeChecked();
    expect(dark).not.toBeChecked();
  });

  it('flips the theme to dark and calls setTheme("dark")', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    fireEvent.click(await screen.findByTestId('theme-radio-dark'));
    await waitFor(() => expect(bridge.setTheme).toHaveBeenCalledWith('dark'));
  });

  it('flips the theme to light and persists via IPC', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    fireEvent.click(await screen.findByTestId('theme-radio-light'));
    await waitFor(() => expect(bridge.setTheme).toHaveBeenCalledWith('light'));
  });
});

describe('T-1.2.6 — ModelApiConfig (4 providers)', () => {
  it('renders the provider select with all 4 options', async () => {
    makeBridge();
    render(<SettingsPanel />);
    const select = (await screen.findByTestId('model-provider-select')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value).sort()).toEqual(
      ['claude', 'custom', 'minimax', 'openai'],
    );
  });

  it('switches to openai and pre-fills sensible defaults', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    const select = await screen.findByTestId('model-provider-select');
    fireEvent.change(select, { target: { value: 'openai' } });
    await waitFor(() =>
      expect(bridge.setModelApi).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }),
      ),
    );
  });

  it('switches to claude and uses the anthropic defaults', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    const select = await screen.findByTestId('model-provider-select');
    fireEvent.change(select, { target: { value: 'claude' } });
    await waitFor(() =>
      expect(bridge.setModelApi).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'claude', baseUrl: 'https://api.anthropic.com' }),
      ),
    );
  });

  it('switches to custom and clears baseUrl (caller must supply)', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    const select = await screen.findByTestId('model-provider-select');
    fireEvent.change(select, { target: { value: 'custom' } });
    await waitFor(() =>
      expect(bridge.setModelApi).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'custom', baseUrl: '' }),
      ),
    );
  });

  it('sends the typed model id to the bridge on change', async () => {
    const bridge = makeBridge();
    render(<SettingsPanel />);
    const modelInput = (await screen.findByTestId('model-name')) as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: 'gpt-4o' } });
    await waitFor(() =>
      expect(bridge.setModelApi).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-4o' }),
      ),
    );
  });
});

describe('T-1.2.6 — ResetButton (gated confirm)', () => {
  it('does not call reset on a single click (arming required)', async () => {
    const bridge = makeBridge();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsPanel />);
    fireEvent.click(await screen.findByTestId('settings-reset-button'));
    expect(bridge.reset).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('calls reset after a second click (armed + confirm = true)', async () => {
    const bridge = makeBridge();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsPanel />);
    const btn = await screen.findByTestId('settings-reset-button');
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(bridge.reset).toHaveBeenCalledTimes(1));
  });

  it('marks the button as armed after the first click', async () => {
    makeBridge();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsPanel />);
    const btn = (await screen.findByTestId('settings-reset-button')) as HTMLButtonElement;
    expect(btn.dataset.armed).toBe('false');
    fireEvent.click(btn);
    expect(btn.dataset.armed).toBe('true');
  });
});

describe('T-1.2.6 — LLM client reinit (createProvider dispatch)', () => {
  it('createProvider maps id=minimax → MiniMaxProvider (default)', async () => {
    const { createProvider } = await import('@copilot/llm-client');
    const p = createProvider({ id: 'minimax', apiKey: 'noop', baseUrl: 'http://127.0.0.1:45557/v1', model: 'MiniMax-M3' });
    expect(p.name).toBe('minimax');
  });

  it('createProvider maps id=openai → OpenAIProvider', async () => {
    const { createProvider } = await import('@copilot/llm-client');
    const p = createProvider({ id: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' });
    expect(p.name).toBe('openai');
  });

  it('createProvider maps id=claude → ClaudeProvider', async () => {
    const { createProvider } = await import('@copilot/llm-client');
    const p = createProvider({ id: 'claude', apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022' });
    expect(p.name).toBe('claude');
  });

  it('createProvider maps id=custom → CustomProvider (OpenAI-compat)', async () => {
    const { createProvider } = await import('@copilot/llm-client');
    const p = createProvider({ id: 'custom', apiKey: 'noop', baseUrl: 'http://localhost:11434/v1', model: 'llama3' });
    expect(p.name).toBe('custom');
  });
});

describe('T-1.2.6 — Persist (round-trip through bridge)', () => {
  it('hydrates the new modelApi slice from get() and reflects it in the form', async () => {
    makeBridge({
      get: vi.fn().mockResolvedValue({
        cloudBackupEnabled: true,
        theme: 'dark',
        windowBounds: { width: 1024, height: 768 },
        shortcuts: [],
        // Bridge returns the MAIN-shape (provider field) — that's what
        // the IPC handler would actually return from electron-store.
        modelApi: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          apiKey: 'sk-secret',
        },
        schemaVersion: 2,
      }),
    });
    render(<SettingsPanel />);
    await screen.findByTestId('settings-model-api');
    const select = (await screen.findByTestId('model-provider-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('openai'));
    const modelInput = (await screen.findByTestId('model-name')) as HTMLInputElement;
    expect(modelInput.value).toBe('gpt-4o');
  });
});