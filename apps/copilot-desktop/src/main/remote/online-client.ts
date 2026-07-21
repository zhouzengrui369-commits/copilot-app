import type { RemoteClientState } from '../../shared/remote-management.js';
import type { RemoteAuditStore } from './audit.js';
import type { RemoteCommandEngine } from './controller.js';
import type { RemotePreferenceStore } from './preferences.js';
import { RemoteError } from './protocol.js';

export interface RemoteCredentialPort {
  read(name: 'relay-token'): Promise<string | null>;
  clearSession(): void | Promise<void>;
}

export interface RemoteSocket {
  readonly readyState: number;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (value?: unknown) => void): void;
  send(value: string): void;
  close(): void;
}

export type RemoteSocketFactory = (
  endpoint: string,
  headers: Readonly<{
    Authorization: string;
    'X-Remote-Role': 'target';
    'X-Owner-Id': string;
    'X-Session-Id': string;
    'X-Target-Id': string;
  }>,
) => RemoteSocket;

interface RemoteOnlineClientOptions {
  engine: RemoteCommandEngine;
  preferences: RemotePreferenceStore;
  credentials: RemoteCredentialPort;
  socketFactory: RemoteSocketFactory;
  endpoint: string;
  binding: Readonly<{ ownerId: string; sessionId: string; targetId: string }>;
  audit?: RemoteAuditStore;
  clock?: () => number;
  sessionExpiresAtMs?: number;
}

export class RemoteOnlineClient {
  private socket: RemoteSocket | null = null;
  private connection: RemoteClientState['connection'] = 'disabled';
  private lastErrorCode: RemoteClientState['lastErrorCode'] = null;
  private readonly activeMessages = new Set<Promise<void>>();
  private readonly clock: () => number;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly options: RemoteOnlineClientOptions) {
    this.clock = options.clock ?? Date.now;
    this.connection = options.preferences.get().enabled ? 'offline' : 'disabled';
  }

  state(): RemoteClientState {
    const preference = this.options.preferences.get();
    return {
      enabled: preference.enabled,
      ownerConsentAtMs: preference.ownerConsentAtMs,
      connection: preference.enabled ? this.connection : 'disabled',
      queuedCommands: 0,
      lastErrorCode: this.lastErrorCode,
    };
  }

  async enable(request: { ownerConsent: boolean }): Promise<RemoteClientState> {
    if (request.ownerConsent !== true) throw new RemoteError('AUTH_REQUIRED', 'owner consent is required');
    if (this.options.sessionExpiresAtMs !== undefined && this.options.sessionExpiresAtMs <= this.clock()) {
      throw new RemoteError('SESSION_EXPIRED', 'paired remote session expired');
    }
    validateEndpoint(this.options.endpoint);
    const token = await this.options.credentials.read('relay-token');
    if (!token) throw new RemoteError('AUTH_REQUIRED', 'relay credential is unavailable');
    this.clearExpiryTimer();
    const oldSocket = this.socket;
    this.socket = null;
    ++this.generation;
    if (oldSocket && !this.closeSocket(oldSocket)) {
      await this.failDetachedEnable();
    }
    let socket: RemoteSocket;
    try {
      socket = this.options.socketFactory(this.options.endpoint, {
        Authorization: `Bearer ${token}`,
        'X-Remote-Role': 'target',
        'X-Owner-Id': this.options.binding.ownerId,
        'X-Session-Id': this.options.binding.sessionId,
        'X-Target-Id': this.options.binding.targetId,
      });
    } catch {
      return this.failDetachedEnable();
    }
    const generation = ++this.generation;
    this.options.engine.enableSession();
    this.connection = 'connecting';
    this.lastErrorCode = null;
    this.options.preferences.set({ enabled: true, ownerConsentAtMs: this.clock() });
    this.socket = socket;
    this.scheduleExpiry(socket, generation);
    socket.on('open', () => {
      if (this.socket === socket) this.connection = 'online';
    });
    socket.on('close', () => {
      if (this.socket === socket) void this.expireSocket(socket, 'SERVICE_UNAVAILABLE', false);
    });
    socket.on('error', () => {
      if (this.socket === socket) void this.expireSocket(socket, 'SERVICE_UNAVAILABLE', true);
    });
    socket.on('message', (value) => {
      if (this.socket !== socket || socket.readyState !== 1) return;
      if (this.options.sessionExpiresAtMs !== undefined && this.options.sessionExpiresAtMs <= this.clock()) {
        void this.expireSocket(socket, 'SESSION_EXPIRED', true);
        return;
      }
      const raw = decodeSocketMessage(value);
      if (raw === null) return;
      let tracked!: Promise<void>;
      tracked = this.processOnlineMessage(socket, raw).finally(() => this.activeMessages.delete(tracked));
      this.activeMessages.add(tracked);
      void tracked.catch(() => undefined);
    });
    return this.state();
  }

  async disable(): Promise<RemoteClientState> {
    ++this.generation;
    this.clearExpiryTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) this.closeSocket(socket);
    this.options.preferences.reset();
    this.connection = 'disabled';
    this.lastErrorCode = null;
    try {
      await this.options.engine.disable();
      await Promise.allSettled([...this.activeMessages]);
    } finally {
      await this.options.credentials.clearSession();
    }
    return this.state();
  }

  private async processOnlineMessage(socket: RemoteSocket, raw: string): Promise<void> {
    const ack = await this.options.engine.process(raw);
    if (!ack.wireEnvelope) {
      await this.options.engine.recordAckLost(ack.commandId, ack.requestId);
      return;
    }
    const routed = JSON.stringify(ack.wireEnvelope);
    if (this.socket !== socket || socket.readyState !== 1) {
      await this.options.engine.recordAckLost(ack.commandId, ack.requestId);
      return;
    }
    try {
      socket.send(routed);
      await this.options.engine.recordAckSent(ack.commandId, ack.requestId);
    } catch {
      await this.options.engine.recordAckLost(ack.commandId, ack.requestId);
    }
  }

  private async expireSocket(
    socket: RemoteSocket,
    code: 'SERVICE_UNAVAILABLE' | 'SESSION_EXPIRED',
    close: boolean,
  ): Promise<void> {
    if (this.socket !== socket) return;
    ++this.generation;
    this.clearExpiryTimer();
    this.socket = null;
    if (close) this.closeSocket(socket);
    if (code === 'SESSION_EXPIRED') {
      this.options.preferences.reset();
      this.connection = 'disabled';
    } else {
      this.connection = 'offline';
    }
    this.lastErrorCode = code;
    try {
      await this.options.engine.disable();
    } finally {
      await this.options.credentials.clearSession();
    }
  }

  private scheduleExpiry(socket: RemoteSocket, generation: number): void {
    if (this.options.sessionExpiresAtMs === undefined) return;
    const delay = Math.max(0, this.options.sessionExpiresAtMs - this.clock());
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      if (generation !== this.generation || this.socket !== socket) return;
      void this.expireSocket(socket, 'SESSION_EXPIRED', true).catch(() => undefined);
    }, delay);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private closeSocket(socket: RemoteSocket): boolean {
    try {
      socket.close();
      return true;
    } catch {
      return false;
    }
  }

  private async failDetachedEnable(): Promise<never> {
    this.options.preferences.reset();
    this.connection = 'disabled';
    this.lastErrorCode = 'SERVICE_UNAVAILABLE';
    try {
      await this.options.engine.disable();
      await Promise.allSettled([...this.activeMessages]);
    } finally {
      await this.options.credentials.clearSession();
    }
    throw new RemoteError('SERVICE_UNAVAILABLE', 'WebSocket transport is unavailable', true);
  }
}

function validateEndpoint(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteError('SERVICE_UNAVAILABLE', 'relay endpoint is invalid');
  }
  if (
    url.protocol !== 'wss:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.port !== '' && url.port !== '443')
  ) {
    throw new RemoteError('SERVICE_UNAVAILABLE', 'relay endpoint must be query-free WSS');
  }
}

function decodeSocketMessage(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  const data = (value as { data?: unknown } | null)?.data;
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return null;
}
