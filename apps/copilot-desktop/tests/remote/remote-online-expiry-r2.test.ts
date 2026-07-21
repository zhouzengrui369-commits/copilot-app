import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteOnlineClient, type RemoteSocket } from '../../src/main/remote/online-client';

class FakeSocket implements RemoteSocket {
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();
  on(event: string, listener: (value?: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  send(): void {}
  close(): void { this.closed = true; this.readyState = 3; }
}

function fixture(expiresAtMs: number) {
  let preference = { enabled: false, ownerConsentAtMs: null as number | null };
  const engine = {
    enableSession: vi.fn(),
    disable: vi.fn().mockResolvedValue(undefined),
    process: vi.fn(),
    recordAckLost: vi.fn(),
    recordAckSent: vi.fn(),
  };
  const clearSession = vi.fn();
  const socket = new FakeSocket();
  const client = new RemoteOnlineClient({
    engine: engine as never,
    preferences: {
      get: () => ({ ...preference }),
      set: (value) => { preference = { ...value }; },
      reset: () => { preference = { enabled: false, ownerConsentAtMs: null }; },
    },
    credentials: { read: async () => 'a'.repeat(43), clearSession },
    socketFactory: () => socket,
    endpoint: 'wss://relay.example.test/remote',
    binding: { ownerId: 'owner', sessionId: 'session', targetId: 'target' },
    clock: Date.now,
    sessionExpiresAtMs: expiresAtMs,
  });
  return { client, engine, clearSession, socket };
}

describe('Remote online idle session expiry r2', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('actively closes an idle socket and clears engine/session state exactly at expiry', async () => {
    const f = fixture(Date.now() + 5_000);
    await f.client.enable({ ownerConsent: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.socket.closed).toBe(true);
    expect(f.engine.disable).toHaveBeenCalledTimes(1);
    expect(f.clearSession).toHaveBeenCalledTimes(1);
    expect(f.client.state()).toMatchObject({
      enabled: false,
      connection: 'disabled',
      lastErrorCode: 'SESSION_EXPIRED',
    });
  });

  it('cancels the exact generation timer on disable so stale expiry cannot mutate the next state', async () => {
    const f = fixture(Date.now() + 5_000);
    await f.client.enable({ ownerConsent: true });
    await f.client.disable();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.engine.disable).toHaveBeenCalledTimes(1);
    expect(f.clearSession).toHaveBeenCalledTimes(1);
    expect(f.client.state()).toMatchObject({ enabled: false, lastErrorCode: null });
  });
});
