import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteOnlineClient, type RemoteSocket } from '../../src/main/remote/online-client';

type CloseMode = 'sync' | 'async' | 'throw';

class ReentrantSocket implements RemoteSocket {
  readyState = 0;
  closeCalls = 0;
  closed = false;
  private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();

  constructor(private readonly closeMode: CloseMode) {}

  on(event: string, listener: (value?: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  send(): void {}

  close(): void {
    this.closeCalls += 1;
    if (this.closeMode === 'throw') throw new Error('close unavailable');
    this.closed = true;
    this.readyState = 3;
    if (this.closeMode === 'sync') this.emit('close');
  }

  emit(event: 'close' | 'error'): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

function fixture(modes: CloseMode[], expiresAtMs = Date.now() + 5_000) {
  let preference = { enabled: false, ownerConsentAtMs: null as number | null };
  const reset = vi.fn(() => { preference = { enabled: false, ownerConsentAtMs: null }; });
  const engine = {
    enableSession: vi.fn(),
    disable: vi.fn().mockResolvedValue(undefined),
    process: vi.fn(),
    recordAckLost: vi.fn(),
    recordAckSent: vi.fn(),
  };
  const clearSession = vi.fn();
  const sockets: ReentrantSocket[] = [];
  const client = new RemoteOnlineClient({
    engine: engine as never,
    preferences: {
      get: () => ({ ...preference }),
      set: (value) => { preference = { ...value }; },
      reset,
    },
    credentials: { read: async () => 'a'.repeat(43), clearSession },
    socketFactory: () => {
      const socket = new ReentrantSocket(modes[sockets.length] ?? 'sync');
      sockets.push(socket);
      return socket;
    },
    endpoint: 'wss://relay.example.test/remote',
    binding: { ownerId: 'owner', sessionId: 'session', targetId: 'target' },
    clock: Date.now,
    sessionExpiresAtMs: expiresAtMs,
  });
  return { client, engine, clearSession, reset, sockets };
}

describe('Remote online session expiry r3 re-enable lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('does not let a synchronous old close invalidate the new generation deadline', async () => {
    const f = fixture(['sync', 'sync']);
    await f.client.enable({ ownerConsent: true });
    await f.client.enable({ ownerConsent: true });
    await Promise.resolve();

    expect(f.sockets).toHaveLength(2);
    expect(f.sockets[0]).toMatchObject({ closed: true, closeCalls: 1 });
    expect(f.engine.disable).not.toHaveBeenCalled();
    expect(f.clearSession).not.toHaveBeenCalled();
    expect(f.reset).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.sockets[1]).toMatchObject({ closed: true, closeCalls: 1 });
    expect(f.engine.disable).toHaveBeenCalledTimes(1);
    expect(f.clearSession).toHaveBeenCalledTimes(1);
    expect(f.reset).toHaveBeenCalledTimes(1);
    expect(f.client.state()).toMatchObject({ enabled: false, connection: 'disabled', lastErrorCode: 'SESSION_EXPIRED' });
  });

  it('ignores an asynchronous stale old close and cleans only the active generation at expiry', async () => {
    const f = fixture(['async', 'sync']);
    await f.client.enable({ ownerConsent: true });
    await f.client.enable({ ownerConsent: true });
    f.sockets[0]!.emit('close');
    await Promise.resolve();

    expect(f.client.state()).toMatchObject({ enabled: true, connection: 'connecting', lastErrorCode: null });
    expect(f.engine.disable).not.toHaveBeenCalled();
    expect(f.clearSession).not.toHaveBeenCalled();
    expect(f.reset).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.sockets[1]).toMatchObject({ closed: true, closeCalls: 1 });
    expect(f.engine.disable).toHaveBeenCalledTimes(1);
    expect(f.clearSession).toHaveBeenCalledTimes(1);
    expect(f.reset).toHaveBeenCalledTimes(1);
  });

  it('fails closed without starting a replacement when the detached old socket cannot close', async () => {
    const f = fixture(['throw', 'sync']);
    await f.client.enable({ ownerConsent: true });

    await expect(f.client.enable({ ownerConsent: true })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(f.sockets).toHaveLength(1);
    expect(f.engine.disable).toHaveBeenCalledTimes(1);
    expect(f.clearSession).toHaveBeenCalledTimes(1);
    expect(f.reset).toHaveBeenCalledTimes(1);
    expect(f.client.state()).toMatchObject({ enabled: false, connection: 'disabled', lastErrorCode: 'SERVICE_UNAVAILABLE' });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.engine.disable).toHaveBeenCalledTimes(1);
    expect(f.clearSession).toHaveBeenCalledTimes(1);
  });
});
