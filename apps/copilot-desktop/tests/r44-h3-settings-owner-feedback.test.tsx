import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModelApiConfig } from '../src/renderer/components/Settings/ModelApiConfig';

const BASE_CONFIG = {
  id: 'minimax' as const,
  baseUrl: 'http://127.0.0.1:45557/v1',
  model: 'MiniMax-M3',
  apiKey: '' as const,
  apiKeyConfigured: false,
  credentialStatus: 'not-configured' as const,
};

describe('R44 H3 Settings owner feedback', () => {
  it('renders no browser credential input or autofill target', () => {
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
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps only non-sensitive prototype fields editable in component memory', () => {
    const onChange = vi.fn();
    render(
      <ModelApiConfig
        modelApi={BASE_CONFIG}
        onChange={onChange}
        prototypeMode
      />,
    );

    fireEvent.change(screen.getByTestId('model-provider-select'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByTestId('model-base-url'), { target: { value: 'https://example.invalid/v1' } });
    fireEvent.change(screen.getByTestId('model-name'), { target: { value: 'test-model' } });
    expect(screen.getByTestId('model-provider-select')).toHaveValue('openai');
    expect(screen.getByTestId('model-base-url')).toHaveValue('https://example.invalid/v1');
    expect(screen.getByTestId('model-name')).toHaveValue('test-model');
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});
