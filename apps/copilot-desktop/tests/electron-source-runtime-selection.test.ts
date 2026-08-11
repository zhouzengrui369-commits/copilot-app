import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_ROOT,
  resolveSourceElectronExecutable,
  selectElectronExecutable,
  validateSourceElectronRuntimeSelection,
} from './e2e/electron.fixture.js';

describe('Electron source runtime selection', () => {
  it('accepts the app-local Electron 38.8.6 executable', () => {
    const executablePath = resolveSourceElectronExecutable();

    expect(executablePath).toBe(path.join(
      APP_ROOT,
      'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ));
    expect(validateSourceElectronRuntimeSelection({
      expectedVersion: '38.8.6',
      packageVersion: '38.8.6',
      executablePath,
      executableExists: true,
    })).toBe(executablePath);
  });

  it('fails closed when the app-local Electron version is 33.x', () => {
    expect(() => validateSourceElectronRuntimeSelection({
      expectedVersion: '38.8.6',
      packageVersion: '33.4.11',
      executablePath: '/repo/apps/copilot-desktop/node_modules/electron/Electron',
      executableExists: true,
    })).toThrow(
      'BLOCKED_SOURCE_ELECTRON_VERSION_MISMATCH: expected=38.8.6 actual=33.4.11',
    );
  });

  it('fails closed for non-absolute or missing source executables', () => {
    expect(() => validateSourceElectronRuntimeSelection({
      expectedVersion: '38.8.6',
      packageVersion: '38.8.6',
      executablePath: 'node_modules/electron/Electron',
      executableExists: true,
    })).toThrow(
      'BLOCKED_SOURCE_ELECTRON_EXECUTABLE_NOT_ABSOLUTE: node_modules/electron/Electron',
    );

    expect(() => validateSourceElectronRuntimeSelection({
      expectedVersion: '38.8.6',
      packageVersion: '38.8.6',
      executablePath: '/missing/app-local/Electron',
      executableExists: false,
    })).toThrow(
      'BLOCKED_SOURCE_ELECTRON_EXECUTABLE_MISSING: /missing/app-local/Electron',
    );
  });

  it('keeps a packaged override and never invokes the source resolver', () => {
    const packagedExecutable = '/Applications/njx-copilot-v6.app/Contents/MacOS/njx-copilot-v6';
    const sourceResolver = vi.fn(() => {
      throw new Error('source resolver must not run');
    });

    expect(selectElectronExecutable(
      packagedExecutable,
      sourceResolver,
    )).toBe(packagedExecutable);
    expect(sourceResolver).not.toHaveBeenCalled();
  });
});
