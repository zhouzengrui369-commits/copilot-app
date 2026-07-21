/**
 * preload.test.ts — verify the contextBridge surface that preload.ts
 * exposes to the renderer. We mock `electron` so contextBridge.exposeInMainWorld
 * just records what the preload script attached to `globalThis.copilot`,
 * then assert against that record.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const exposeMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (channel: string, api: unknown) => {
      exposeMock(channel, api);
    },
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => {
      invokeMock(...args);
      return Promise.resolve();
    },
    on: () => undefined,
    removeListener: () => undefined,
    send: () => undefined,
  },
}));

describe('preload bridge (electron mock)', () => {
  beforeEach(() => {
    vi.resetModules();
    exposeMock.mockClear();
    invokeMock.mockClear();
  });

  it('exposes window.copilot under the "copilot" channel', async () => {
    await import('../src/main/preload');
    expect(exposeMock).toHaveBeenCalledTimes(1);
    expect(exposeMock.mock.calls[0][0]).toBe('copilot');
    const api = exposeMock.mock.calls[0][1] as Record<string, unknown>;
    expect(api).toBeDefined();
    expect(typeof api).toBe('object');
  });

  it('exposes a settings surface with the expected methods (incl. setModelApi)', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      settings: Record<string, (...args: unknown[]) => Promise<unknown>>;
    };
    expect(Object.keys(api.settings).sort()).toEqual([
      'get',
      'reset',
      'setCloudBackup',
      'setModelApi',
      'setShortcuts',
      'setTheme',
      'setWindowBounds',
    ]);
  });

  it('exposes a window surface with minimize/toggleMaximize/close', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      window: Record<string, (...args: unknown[]) => Promise<unknown>>;
    };
    expect(Object.keys(api.window).sort()).toEqual(['close', 'minimize', 'toggleMaximize']);
  });

  it('exposes the command-specific remote management surface', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      remote: Record<string, (...args: unknown[]) => unknown>;
    };
    expect(Object.keys(api.remote).sort()).toEqual([
      'createPairingRequest',
      'disable',
      'enable',
      'getState',
      'importPairing',
      'onApprovalLifecycle',
      'onApprovalRequest',
      'respondApproval',
      'revokePairing',
    ]);
    await api.remote.enable({ ownerConsent: true });
    expect(invokeMock).toHaveBeenCalledWith('copilot:remote:enable', { ownerConsent: true });
    await api.remote.createPairingRequest();
    expect(invokeMock).toHaveBeenCalledWith('copilot:remote:create-pairing-request', undefined);
    await api.remote.importPairing();
    expect(invokeMock).toHaveBeenCalledWith('copilot:remote:import-pairing', undefined);
    await api.remote.revokePairing();
    expect(invokeMock).toHaveBeenCalledWith('copilot:remote:revoke-pairing', undefined);
    const response = {
      approvalToken: Buffer.alloc(32, 7).toString('base64url'),
      commandDigest: 'a'.repeat(64),
      deadlineMs: 123,
      commandId: 'command-id',
      decision: 'reject',
    };
    await api.remote.respondApproval(response);
    expect(invokeMock).toHaveBeenCalledWith(
      'copilot:remote:approval-respond',
      response,
    );
  });

  it('exposes trusted runtime meta with local ASR denied by default', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      meta: {
        appVersion: string;
        platform: string;
        productName: string;
        runtime: {
          source: string;
          shell: string;
          electronVersion: string;
          chromiumVersion: string;
          localAsrCapabilities: string[];
        };
      };
    };
    expect(api.meta.productName).toBe('njx-copilot-v6');
    expect(typeof api.meta.appVersion).toBe('string');
    expect(typeof api.meta.platform).toBe('string');
    expect(api.meta.runtime).toMatchObject({
      source: 'electron-preload-process-versions',
      shell: 'electron',
      localAsrCapabilities: [],
    });
    expect(typeof api.meta.runtime.electronVersion).toBe('string');
    expect(typeof api.meta.runtime.chromiumVersion).toBe('string');
  });

  it('routes settings.get() through ipcRenderer.invoke(SETTINGS_GET)', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      settings: { get: () => Promise<unknown> };
    };
    await api.settings.get();
    expect(invokeMock).toHaveBeenCalledWith('copilot:settings:get', undefined);
  });

  it('routes settings.setCloudBackup(boolean) through ipcRenderer', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      settings: { setCloudBackup: (v: boolean) => Promise<unknown> };
    };
    await api.settings.setCloudBackup(true);
    expect(invokeMock).toHaveBeenCalledWith('copilot:settings:set-cloud-backup', true);
  });

  it('routes settings.setTheme(theme) through ipcRenderer', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      settings: { setTheme: (t: string) => Promise<unknown> };
    };
    await api.settings.setTheme('dark');
    expect(invokeMock).toHaveBeenCalledWith('copilot:settings:set-theme', 'dark');
  });

  it('routes settings.setModelApi(modelApi) through ipcRenderer (Sprint 1.2 T-1.2.6)', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      settings: { setModelApi: (cfg: { provider: string; baseUrl: string; model: string; apiKey: string }) => Promise<unknown> };
    };
    await api.settings.setModelApi({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '[REDACTED]' });
    expect(invokeMock).toHaveBeenCalledWith(
      'copilot:settings:set-model-api',
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '[REDACTED]' },
    );
  });
});
