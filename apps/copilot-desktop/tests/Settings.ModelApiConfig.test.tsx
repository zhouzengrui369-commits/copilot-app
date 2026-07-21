/**
 * Settings/ModelApiConfig tests.
 *
 *   - Renders the 4-provider select
 *   - Updates baseUrl/model/apiKey on input change
 *   - Switching provider pre-fills defaults
 *   - Calls onChange / updateModelApi
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelApiConfig } from '../src/renderer/components/Settings/ModelApiConfig';
import type { ModelApiConfig as ModelApiConfigT } from '../src/renderer/types/settings';

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
  const setModelApi = vi.fn().mockImplementation(async (cfg: ModelApiConfigT) => ({
    ...baseSettings,
    modelApi: cfg,
  }));
  (window as unknown as { copilot: unknown }).copilot = {
    settings: {
      get: vi.fn().mockResolvedValue(baseSettings),
      setCloudBackup: vi.fn(),
      setTheme: vi.fn(),
      setWindowBounds: vi.fn(),
      setShortcuts: vi.fn(),
      setModelApi,
      reset: vi.fn(),
    },
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    meta: { appVersion: '0.1.0-test', platform: 'darwin' as const, productName: 'njx-copilot-v6' },
  };
  return { setModelApi, baseSettings };
}

describe('ModelApiConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the 4-provider select with minimax as default', () => {
    makeBridge();
    render(<ModelApiConfig />);
    const select = screen.getByTestId('model-provider-select') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'minimax',
      'openai',
      'claude',
      'custom',
    ]);
    expect(select.value).toBe('minimax');
  });

  it('pre-fills baseUrl / model from props', () => {
    makeBridge();
    render(
      <ModelApiConfig
        modelApi={{
          id: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          apiKey: '',
          apiKeyConfigured: true,
          credentialStatus: 'configured',
        }}
        onChange={() => undefined}
      />,
    );
    expect((screen.getByTestId('model-base-url') as HTMLInputElement).value).toBe(
      'https://api.openai.com/v1',
    );
    expect((screen.getByTestId('model-name') as HTMLInputElement).value).toBe('gpt-4o');
  });

  it('fires onChange when the user edits baseUrl', () => {
    makeBridge();
    const onChange = vi.fn();
    render(
      <ModelApiConfig
        modelApi={{ id: 'openai', baseUrl: '', model: 'gpt-4o-mini', apiKey: '', apiKeyConfigured: false, credentialStatus: 'not-configured' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId('model-base-url'), {
      target: { value: 'https://my-proxy.example/v1' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://my-proxy.example/v1' }),
    );
  });

  it('switches provider without carrying credential state', () => {
    makeBridge();
    const onChange = vi.fn();
    render(
      <ModelApiConfig
        modelApi={{ id: 'minimax', baseUrl: 'https://model.example/v1', model: 'y', apiKey: '', apiKeyConfigured: true, credentialStatus: 'configured' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId('model-provider-select'), {
      target: { value: 'openai' },
    });
    expect(onChange).toHaveBeenCalledWith({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '',
      apiKeyConfigured: false,
      credentialStatus: 'not-configured',
    });
  });

  it('states that valid changes apply dynamically without restart', () => {
    makeBridge();
    render(
      <ModelApiConfig
        modelApi={{ id: 'claude', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-20241022', apiKey: '', apiKeyConfigured: true, credentialStatus: 'configured' }}
        onChange={() => undefined}
      />,
    );
    const hint = screen.getByTestId('model-restart-hint');
    expect(hint.dataset.state).toBe('dynamic');
    expect(hint.textContent).toContain('No app restart is required');
  });

  it('submits a credential once and clears the local write-only draft after the result', async () => {
    makeBridge();
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(
      <ModelApiConfig
        modelApi={{ id: 'minimax', baseUrl: 'https://model.example/v1', model: 'MiniMax-M3', apiKey: '', apiKeyConfigured: false, credentialStatus: 'not-configured' }}
        onChange={onChange}
      />,
    );
    const input = screen.getByTestId('model-api-key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '[REDACTED]' } });
    fireEvent.click(screen.getByTestId('model-credential-save'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '[REDACTED]' }));
    await vi.waitFor(() => expect(input.value).toBe(''));
  });
});
