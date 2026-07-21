/**
 * Settings/ThemeSelector tests.
 *
 *   - Renders the 3 radio tiles (dark / light / auto)
 *   - Marks the currently active theme
 *   - Calls setTheme on change
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeSelector } from '../src/renderer/components/Settings/ThemeSelector';

function makeBridge(overrides: Partial<{ setTheme: ReturnType<typeof vi.fn> }> = {}) {
  const baseSettings = {
    cloudBackupEnabled: false,
    theme: 'auto' as const,
    windowBounds: { width: 1280, height: 800 },
    shortcuts: [],
    modelApi: { id: 'minimax' as const, baseUrl: 'http://127.0.0.1:45557/v1', model: 'MiniMax-M3', apiKey: '' },
    schemaVersion: 2,
  };
  const setTheme = overrides.setTheme ?? vi.fn().mockResolvedValue(baseSettings);
  (window as unknown as { copilot: unknown }).copilot = {
    settings: {
      get: vi.fn().mockResolvedValue(baseSettings),
      setCloudBackup: vi.fn(),
      setTheme,
      setWindowBounds: vi.fn(),
      setShortcuts: vi.fn(),
      setModelApi: vi.fn(),
      reset: vi.fn(),
    },
    window: { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() },
    meta: { appVersion: '0.1.0-test', platform: 'darwin' as const, productName: 'njx-copilot-v6' },
  };
  return { setTheme, baseSettings };
}

describe('ThemeSelector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the three theme radio options', () => {
    makeBridge();
    render(<ThemeSelector />);
    expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-auto')).toBeInTheDocument();
  });

  it('marks the currently active theme (default auto)', () => {
    makeBridge();
    render(<ThemeSelector />);
    expect(screen.getByTestId('theme-radio-auto')).toBeChecked();
    expect(screen.getByTestId('theme-radio-dark')).not.toBeChecked();
    expect(screen.getByTestId('theme-radio-light')).not.toBeChecked();
  });

  it('marks the current theme when it is dark', () => {
    makeBridge();
    render(<ThemeSelector currentTheme="dark" onChange={() => undefined} />);
    expect(screen.getByTestId('theme-radio-dark')).toBeChecked();
  });

  it('calls onChange when the user picks a different theme', () => {
    makeBridge();
    const onChange = vi.fn();
    render(<ThemeSelector onChange={onChange} />);
    fireEvent.click(screen.getByTestId('theme-radio-light'));
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('shows the active theme in the hint footer', () => {
    makeBridge();
    render(<ThemeSelector currentTheme="light" onChange={() => undefined} />);
    expect(screen.getByTestId('theme-current').textContent).toContain('light');
  });
});