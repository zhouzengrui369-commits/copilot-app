import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelApiConfig } from '../src/renderer/components/Settings/ModelApiConfig';
import { SettingsPanel } from '../src/renderer/components/Settings';

const BASE_CONFIG = {
  id: 'minimax' as const,
  baseUrl: 'http://127.0.0.1:45557/v1',
  model: 'MiniMax-M3',
  apiKey: '' as const,
  apiKeyConfigured: false,
  credentialStatus: 'not-configured' as const,
};

describe('R44 H4 browser credential boundary', () => {
  it('keeps provider fields in page memory while rendering zero credential capture surface', () => {
    const onChange = vi.fn();
    render(
      <ModelApiConfig
        modelApi={BASE_CONFIG}
        onChange={onChange}
        prototypeMode
      />,
    );

    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByTestId('model-api-key')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-credential-save')).not.toBeInTheDocument();
    expect(screen.queryByTestId('model-credential-clear')).not.toBeInTheDocument();
    expect(screen.getByTestId('model-credential-browser-boundary')).toHaveTextContent(
      '仅桌面 App 可配置 · NOT_RUNTIME_PROOF',
    );
    expect(screen.getByTestId('model-credential-browser-boundary')).toHaveTextContent(
      '浏览器原型不会接收、保存或发送 API key',
    );

    fireEvent.change(screen.getByTestId('model-provider-select'), {
      target: { value: 'openai' },
    });
    fireEvent.change(screen.getByTestId('model-base-url'), {
      target: { value: 'https://example.invalid/v1' },
    });
    fireEvent.change(screen.getByTestId('model-name'), {
      target: { value: 'page-memory-model' },
    });

    expect(screen.getByTestId('model-provider-select')).toHaveValue('openai');
    expect(screen.getByTestId('model-base-url')).toHaveValue('https://example.invalid/v1');
    expect(screen.getByTestId('model-name')).toHaveValue('page-memory-model');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats missing desktop preload as a normal prototype boundary, not an error', async () => {
    window.history.replaceState(null, '', '/?prototype=ready#settings');
    Object.defineProperty(window, 'copilot', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    render(<SettingsPanel hideReset />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-model-section')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-browser-environment')).toHaveTextContent(
      '浏览器原型 · 未连接桌面凭据服务',
    );
  });
});
