/**
 * preload.test.ts — verify the contextBridge surface that preload.ts
 * exposes to the renderer. We mock `electron` so contextBridge.exposeInMainWorld
 * just records what the preload script attached to `globalThis.copilot`,
 * then assert against that record.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { LocalAsrError } from '../src/shared/local-asr';
import { LOCAL_ASR_ERROR_CODES } from '../src/shared/local-asr-ipc-envelope';
import { registerLocalAsrIpc } from '../src/main/local-asr-ipc';

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
      return Promise.resolve(invokeMock(...args));
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
    invokeMock.mockReset();
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

  it('exposes only the typed local ASR methods and exact IPC payloads', async () => {
    const request = {
      requestId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
      format: 'PCM16LE',
      sampleRate: 16_000,
      channels: 1,
      byteLength: 4,
      sampleCount: 2,
      sha256: 'a'.repeat(64),
      pcm: new Uint8Array([0, 0, 1, 0]),
    };
    const statusValue = {
      state: 'NOT_READY',
      active: false,
      lastErrorCode: null,
    };
    const decodeValue = {
      requestId: request.requestId,
      transcript: '本地语音',
      timings: { decodeMs: 1, totalMs: 2 },
    };
    const cancelValue = { requestId: request.requestId, cancelled: true };
    invokeMock.mockImplementation((channel: unknown) => {
      if (channel === 'copilot:local-asr:status') {
        return jsonRoundTrip({ ok: true, value: statusValue });
      }
      if (channel === 'copilot:local-asr:decode') {
        return jsonRoundTrip({ ok: true, value: decodeValue });
      }
      if (channel === 'copilot:local-asr:cancel') {
        return jsonRoundTrip({ ok: true, value: cancelValue });
      }
      return undefined;
    });
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      localAsr: {
        status(): Promise<unknown>;
        decode(value: unknown): Promise<unknown>;
        cancel(requestId: string): Promise<unknown>;
      };
    };
    expect(Object.keys(api.localAsr).sort()).toEqual(['cancel', 'decode', 'status']);

    await expect(api.localAsr.status()).resolves.toEqual(statusValue);
    await expect(api.localAsr.decode(request)).resolves.toEqual(decodeValue);
    await expect(api.localAsr.cancel(request.requestId)).resolves.toEqual(cancelValue);

    expect(invokeMock).toHaveBeenCalledWith('copilot:local-asr:status', undefined);
    expect(invokeMock).toHaveBeenCalledWith('copilot:local-asr:decode', request);
    expect(invokeMock).toHaveBeenCalledWith(
      'copilot:local-asr:cancel',
      request.requestId,
    );
  });

  it('consumes a JSON-round-tripped main failure without relying on Error.code', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const trusted = {};
    registerLocalAsrIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => ({
        status: () => ({ state: 'NOT_READY', active: false, lastErrorCode: null }),
        decode: async () => {
          throw new LocalAsrError('INVALID_AUDIO');
        },
        cancel: async (requestId) => ({ requestId, cancelled: false }),
      }),
      (event) => event === trusted,
    );
    const request = {
      requestId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
      format: 'PCM16LE' as const,
      sampleRate: 16_000 as const,
      channels: 1 as const,
      byteLength: 4,
      sampleCount: 2,
      sha256: 'a'.repeat(64),
      pcm: new Uint8Array([0, 0, 1, 0]),
    };
    const mainHandler = handlers.get('copilot:local-asr:decode');
    if (!mainHandler) throw new Error('local ASR decode handler was not registered');
    const serialized = jsonRoundTrip(await mainHandler(trusted, request));
    invokeMock.mockReturnValueOnce(serialized);

    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      localAsr: { decode(value: typeof request): Promise<unknown> };
    };
    await expect(api.localAsr.decode(request)).rejects.toThrow(
      '[INVALID_AUDIO] The local speech audio envelope is invalid.',
    );
    expect(JSON.stringify(serialized)).toBe(
      '{"ok":false,"error":{"code":"INVALID_AUDIO"}}',
    );
  });

  it('renders every known envelope code and fails malformed data closed', async () => {
    await import('../src/main/preload');
    const api = exposeMock.mock.calls[0][1] as {
      localAsr: { status(): Promise<unknown> };
    };
    for (const code of LOCAL_ASR_ERROR_CODES) {
      invokeMock.mockReturnValueOnce(jsonRoundTrip({
        ok: false,
        error: { code },
      }));
      await expect(api.localAsr.status()).rejects.toThrow(
        `[${code}] ${new LocalAsrError(code).message}`,
      );
    }

    const malformedValues: unknown[] = [
      null,
      { ok: false, error: { code: 'UNKNOWN_SECRET_CODE' } },
      { ok: false, error: { code: 'WORKER_FAILURE' }, raw: '/Users/private' },
      { ok: true, value: { state: 'UNKNOWN', active: false, lastErrorCode: null } },
      { ok: true, value: {
        state: 'NOT_READY',
        active: false,
        lastErrorCode: null,
        transcript: 'secret',
      } },
      Object.assign(Object.create(null) as object, {
        ok: false,
        error: { code: 'INVALID_AUDIO' },
      }),
    ];
    for (const malformed of malformedValues) {
      invokeMock.mockReturnValueOnce(malformed);
      const failure = await api.localAsr.status().catch((error: unknown) => error);
      expect((failure as Error).message).toBe(
        '[WORKER_FAILURE] The local speech worker failed.',
      );
      expect((failure as Error).stack).toBeUndefined();
      expect((failure as Error).message).not.toMatch(/Users|secret|transcript/u);
    }

    invokeMock.mockImplementationOnce(() => {
      throw new Error('raw transport /Users/private transcript secret');
    });
    await expect(api.localAsr.status()).rejects.toThrow(
      '[WORKER_FAILURE] The local speech worker failed.',
    );
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

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
