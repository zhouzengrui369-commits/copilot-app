import { describe, expect, it, vi } from 'vitest';
import { registerRemoteIpc, type RemoteRuntime } from '../../src/main/remote/ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

describe('Remote pairing IPC r2', () => {
  it('exposes intent-only request/import/revoke handlers and rejects renderer paths or bytes', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const runtime = {
      createPairingRequest: vi.fn(async () => ({ pairing: { pendingRequest: true } })),
      importPairing: vi.fn(async () => ({ pairing: { configured: true } })),
      revokePairing: vi.fn(async () => ({ pairing: { configured: false, revoked: true } })),
      getState: vi.fn(), enable: vi.fn(), disable: vi.fn(), respondApproval: vi.fn(),
    } as unknown as RemoteRuntime;
    registerRemoteIpc({
      handle: (channel, handler) => { handlers.set(channel, handler); },
    }, () => runtime, () => true);

    await expect(handlers.get(IPC_CHANNELS.REMOTE_CREATE_PAIRING_REQUEST)?.({}, undefined)).resolves.toMatchObject({ pairing: { pendingRequest: true } });
    await expect(handlers.get(IPC_CHANNELS.REMOTE_IMPORT_PAIRING)?.({}, undefined)).resolves.toMatchObject({ pairing: { configured: true } });
    await expect(handlers.get(IPC_CHANNELS.REMOTE_REVOKE_PAIRING)?.({}, undefined)).resolves.toMatchObject({ pairing: { revoked: true } });
    expect(() => handlers.get(IPC_CHANNELS.REMOTE_IMPORT_PAIRING)?.({}, { path: '/tmp/secret.copilot-pairing' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
    expect(() => handlers.get(IPC_CHANNELS.REMOTE_IMPORT_PAIRING)?.({}, Buffer.from('secret'))).toThrowError(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
    expect(() => handlers.get(IPC_CHANNELS.REMOTE_CREATE_PAIRING_REQUEST)?.({}, { path: '/tmp/request' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
  });
});
