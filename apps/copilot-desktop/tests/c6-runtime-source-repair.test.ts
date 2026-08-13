import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerDomainIpc } from '../src/main/domain-ipc.js';
import type { LocalKnowledgeService } from '../src/main/local-knowledge-service.js';
import { createProductionBackupRuntime } from '../src/main/backup-integration/production-runtime.js';
import { DEFAULT_SETTINGS, type SettingsStorage } from '../src/main/settings-store.js';
import { BackupManagementSettings } from '../src/renderer/components/Settings/BackupManagementSettings.js';
import { IPC_CHANNELS } from '../src/shared/ipc-channels.js';

type Handler = (event: unknown, payload?: unknown) => Promise<unknown>;

const tempRoots: string[] = [];

function resolveAppRoot(cwd = process.cwd()): string {
  const workspace = path.join(cwd, 'apps/copilot-desktop');
  return cwd.endsWith(path.join('apps', 'copilot-desktop')) ? cwd : workspace;
}

const appRoot = resolveAppRoot();

function runtimeIdentity() {
  return {
    schemaVersion: 1,
    source: 'launched-electron-main-process',
    electron: '38.8.6',
    chrome: '140.0.7339.249',
    node: '22.22.0',
    modules: '139',
    napi: '10',
    arch: 'arm64',
    platform: 'darwin',
  };
}

function memorySettings(): SettingsStorage {
  let values = structuredClone(DEFAULT_SETTINGS) as any;
  return {
    get: (key: any) => structuredClone(values[key]),
    set: (key: any, value: any) => { values[key] = structuredClone(value); },
    getAll: () => structuredClone(values),
    setAll: (value: any) => { values = structuredClone(value); },
    reset: () => { values = structuredClone(DEFAULT_SETTINGS); },
  } as SettingsStorage;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (typeof window !== 'undefined') {
    try { delete (window as any).copilot; } catch { /* test-only cleanup */ }
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('C6 runtime source repair', () => {
  it('preserves INVALID_ARGUMENT for an empty RAG ask at the main-process IPC boundary', async () => {
    const handlers = new Map<string, Handler>();
    const ask = vi.fn(async () => ({ text: 'provider must not run', sources: [] }));
    const service = { rag: { ask } } as unknown as LocalKnowledgeService;

    registerDomainIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Handler) },
      () => service,
    );

    await expect(handlers.get(IPC_CHANNELS.RAG_ASK)!({}, '')).rejects.toThrow(
      '[INVALID_ARGUMENT] question is required',
    );
    await expect(handlers.get(IPC_CHANNELS.RAG_ASK)!({}, '   ')).rejects.toThrow(
      '[INVALID_ARGUMENT] question is required',
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it('aggregates multiple launch-scoped runtime identities without requiring a shared wx target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'c6-runtime-identity-'));
    tempRoots.push(root);
    const basePath = path.join(root, 'runtime-identity.json');
    const firstPath = path.join(root, 'runtime-identity-worker-0-pid-111-first.json');
    const secondPath = path.join(root, 'runtime-identity-worker-0-pid-222-second.json');
    await writeFile(firstPath, `${JSON.stringify(runtimeIdentity())}\n`, { flag: 'wx' });
    await writeFile(secondPath, `${JSON.stringify(runtimeIdentity())}\n`, { flag: 'wx' });

    const runner = await import(pathToFileURL(path.join(appRoot, 'scripts/run-electron-e2e.mjs')).href);
    const evidence = await runner.readElectronRuntimeIdentityEvidence(basePath, 'current-source');

    expect(evidence).toHaveLength(2);
    expect(new Set(evidence.map((entry: { path: string }) => entry.path))).toEqual(
      new Set([firstPath, secondPath]),
    );
    expect(evidence.every((entry: { identity: { electron: string; modules: string } }) =>
      entry.identity.electron === '38.8.6' && entry.identity.modules === '139')).toBe(true);
    await expect(readFile(basePath, 'utf8')).rejects.toThrow();
  });

  it('keeps fixture writes launch-unique instead of overwriting the shared runtime identity base path', async () => {
    const fixture = await readFile(path.join(appRoot, 'tests/e2e/electron.fixture.ts'), 'utf8');
    expect(fixture).toContain('launchScopedRuntimeIdentityPath');
    expect(fixture).toContain('workerInfo.workerIndex');
    expect(fixture).toContain('randomUUID()');
    expect(fixture).toContain("flag: 'wx'");
    expect(fixture).not.toContain('writeFile(runtimeIdentityBasePath');
  });

  it('keeps unconfigured backup state free of renderer-visible secret vocabulary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'c6-backup-unconfigured-'));
    tempRoots.push(root);
    const runtime = createProductionBackupRuntime({
      userDataPath: root,
      settings: memorySettings(),
      getService: async () => { throw new Error('knowledge service must not be needed for empty backup state'); },
      safeStorage: {} as never,
      env: {},
      appVersion: '0.1.0',
      approval: {} as never,
    });

    const state = await runtime.getState();
    expect(state).toMatchObject({ enabled: false, configured: false, catalog: [], allowedScopes: [] });
    expect(state.platformProtection).toBe('OS-protected local key store unavailable');
    expect(JSON.stringify(state)).not.toMatch(/token|secret|credential|ciphertext/i);
  });

  it('preserves the baseline cloud-backup OFF and metadata-only compatibility surface', async () => {
    const state = {
      enabled: false,
      configured: false,
      region: 'not configured',
      platformProtection: 'OS-protected local key store unavailable',
      catalog: [],
      allowedScopes: [],
      activeOperation: null,
      schedulingAvailable: false,
      replaceCurrentAvailable: false,
      recoveryRequired: false,
    } as const;
    const unsubscribe = vi.fn();
    Object.defineProperty(window, 'copilot', {
      configurable: true,
      writable: true,
      value: {
        backup: {
          getState: vi.fn(async () => structuredClone(state)),
          onApprovalRequest: vi.fn(() => unsubscribe),
          onApprovalLifecycle: vi.fn(() => unsubscribe),
        },
      },
    });

    render(createElement(BackupManagementSettings));
    await waitFor(() => expect(screen.getByTestId('cloud-backup-toggle')).not.toBeChecked());
    expect(screen.getByTestId('status-cloud-backup')).toHaveTextContent('UNAVAILABLE (metadata-only)');
  });

  it('keeps the legacy settings cloud opt-in bridge fail-closed as UNAVAILABLE', async () => {
    const preload = await readFile(path.join(appRoot, 'src/main/preload.ts'), 'utf8');
    expect(preload).toContain("String(error).includes('[CONSENT_REQUIRED]')");
    expect(preload).toContain('[UNAVAILABLE] direct cloud backup toggle is unavailable; use the Backup owner-consent flow');
    expect(preload).toContain('setCloudBackup: (enabled) => setLegacyCloudBackup(enabled)');
  });
});
