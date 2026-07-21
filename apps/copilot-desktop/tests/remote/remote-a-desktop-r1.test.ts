import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  RemoteApprovalRequest,
  RemoteCommand,
  RemoteEnvelope,
} from '../../src/shared/remote-management';
import {
  DEFAULT_REMOTE_PREFERENCE,
  InMemoryRemoteAuditStore,
  InMemoryRemotePreferenceStore,
  PersistentRemoteAuditStore,
  ElectronSafeStorageCredentialAdapter,
  ProductionRemoteLocalAdapter,
  RemoteCommandEngine,
  RemoteOnlineClient,
  controllerApprovalBindingDigest,
  parseDecryptedCommand,
  parseRemoteEnvelope,
  type RemoteCryptoPort,
  type RemoteLocalAdapter,
  type RemoteSocket,
  type RemoteSocketFactory,
} from '../../src/main/remote/index';

const IDS = {
  request: '11111111-1111-4111-8111-111111111111',
  session: '22222222-2222-4222-8222-222222222222',
  command: '33333333-3333-4333-8333-333333333333',
  idempotency: '44444444-4444-4444-8444-444444444444',
};

function command(overrides: Partial<RemoteCommand> = {}): RemoteCommand {
  return {
    action: 'note.create',
    initiatedBy: 'user',
    reason: 'Create the owner-requested local note',
    resource: { type: 'note', id: null },
    expectedRevision: null,
    idempotencyKey: IDS.idempotency,
    input: {
      path: 'remote/synthetic-note',
      title: 'Synthetic note',
      body: 'PRIVATE_REMOTE_BODY_CANARY',
      tags: ['synthetic'],
    },
    ...overrides,
  } as RemoteCommand;
}

function envelope(overrides: Partial<RemoteEnvelope> = {}): RemoteEnvelope {
  const payload = Buffer.from('ciphertext').toString('base64url');
  return {
    schemaVersion: 1,
    messageType: 'command',
    requestId: IDS.request,
    sessionId: IDS.session,
    commandId: IDS.command,
    ownerId: 'owner-hash',
    controllerId: 'controller-01',
    targetId: 'desktop-01',
    nonce: Buffer.alloc(16, 1).toString('base64url'),
    issuedAtMs: 1_000_000,
    expiresAtMs: 1_060_000,
    payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
    payloadCiphertext: payload,
    payloadSha256: createHash('sha256').update(Buffer.from(payload, 'base64url')).digest('hex'),
    controllerSignature: Buffer.alloc(64, 2).toString('base64url'),
    ...overrides,
  };
}

class FakeCrypto implements RemoteCryptoPort {
  constructor(public next: RemoteCommand) {}
  async verifyAndDecrypt() {
    return { command: this.next, replyContext: { opaque: true } };
  }
  async encryptReply(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }
  clearSession(): void {}
}

class FakeLocal implements RemoteLocalAdapter {
  executeCalls = 0;
  removeCalls = 0;
  revision = 'note:7';

  async preview(cmd: RemoteCommand) {
    return {
      currentRevision: cmd.resource.id ? this.revision : null,
      proposedFields: { ...cmd.input },
      diff: cmd.action.endsWith('.update') ? [{ field: 'title', before: 'Old', after: 'New' }] : [],
    };
  }

  async execute(cmd: RemoteCommand) {
    this.executeCalls += 1;
    if (cmd.action.endsWith('.move_to_trash')) {
      // Existing desktop APIs only expose hard remove. The remote adapter must
      // never call it as a substitute for reversible trash.
      return { code: 'ACTION_NOT_ALLOWED' as const, preRevision: this.revision, postRevision: null };
    }
    return {
      code: 'EXECUTED' as const,
      preRevision: cmd.resource.id ? this.revision : null,
      postRevision: 'note:8',
      result: { id: cmd.resource.id ?? 'remote/synthetic-note' },
    };
  }
}

function engine(options: {
  next?: RemoteCommand;
  approve?: (request: RemoteApprovalRequest) => Promise<boolean>;
  local?: FakeLocal;
  audit?: InMemoryRemoteAuditStore;
} = {}) {
  const local = options.local ?? new FakeLocal();
  const audit = options.audit ?? new InMemoryRemoteAuditStore();
  const crypto = new FakeCrypto(options.next ?? command());
  return {
    local,
    audit,
    crypto,
    subject: new RemoteCommandEngine({
      ownerId: 'owner-hash',
      controllerId: 'controller-01',
      targetId: 'desktop-01',
      sessionId: IDS.session,
      crypto,
      signer: {
        signAck: async () => Buffer.alloc(64, 9).toString('base64url'),
        clearSession: vi.fn(),
      },
      local,
      audit,
      approval: {
        request: options.approve ?? (async () => true),
        cancelAll: vi.fn(),
      },
      clock: () => 1_010_000,
    }),
  };
}

describe('Remote A strict protocol', () => {
  it('rejects unknown outer and decrypted fields, oversized bodies, and bad TTL', () => {
    expect(() => parseRemoteEnvelope(JSON.stringify({ ...envelope(), extra: true }), 1_010_000)).toThrowError(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
    expect(() => parseRemoteEnvelope(JSON.stringify(envelope({ expiresAtMs: 1_120_001 })), 1_010_000)).toThrowError(
      expect.objectContaining({ code: 'TTL_INVALID' }),
    );
    expect(() => parseRemoteEnvelope('x'.repeat(65_537), 1_010_000)).toThrowError(
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }),
    );
    expect(() => parseDecryptedCommand({ ...command(), shell: 'rm -rf' }, envelope())).toThrowError(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
  });

  it('rejects permanent delete and path traversal before approval', () => {
    expect(() => parseDecryptedCommand({ ...command(), action: 'note.delete' }, envelope())).toThrowError(
      expect.objectContaining({ code: 'ACTION_NOT_ALLOWED' }),
    );
    expect(() => parseDecryptedCommand({ ...command(), input: { path: '../../private', title: 'x' } }, envelope())).toThrowError(
      expect.objectContaining({ code: 'INVALID_SCHEMA' }),
    );
  });
});

describe('Remote A command engine', () => {
  it('requires an individual desktop approval and shows exact local-truth context', async () => {
    const requests: RemoteApprovalRequest[] = [];
    const { subject, local } = engine({
      approve: async (request) => {
        requests.push(request);
        return true;
      },
    });
    const ack = await subject.process(JSON.stringify(envelope()));
    expect(ack.code).toBe('EXECUTED');
    expect(local.executeCalls).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      controllerId: 'controller-01',
      initiatedBy: 'user',
      action: 'note.create',
      resource: { type: 'note', id: null },
      reason: 'Create the owner-requested local note',
      approveAll: false,
      approvalScope: 'single-command',
      localTruthWarning: expect.stringMatching(/local/i),
    });
    expect(requests[0]?.proposedFields).toMatchObject({ title: 'Synthetic note' });
  });

  it('rejects a command when the desktop owner refuses it', async () => {
    const { subject, local } = engine({ approve: async () => false });
    await expect(subject.process(JSON.stringify(envelope()))).resolves.toMatchObject({
      code: 'APPROVAL_REJECTED',
    });
    expect(local.executeCalls).toBe(0);
  });

  it('requires controller approval claim for AI-originated work before desktop approval', async () => {
    const approve = vi.fn(async () => true);
    const ai = command({ initiatedBy: 'ai' });
    const missing = engine({ next: ai, approve });
    await expect(missing.subject.process(JSON.stringify(envelope()))).resolves.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(approve).not.toHaveBeenCalled();

    const claimed: RemoteCommand = {
      ...ai,
      approvalClaim: {
        controllerApprovedAtMs: 1_005_000,
        controllerApprovalDigest: controllerApprovalBindingDigest(envelope(), ai),
      },
    };
    const accepted = engine({ next: claimed, approve });
    await expect(accepted.subject.process(JSON.stringify(envelope({ nonce: Buffer.alloc(16, 3).toString('base64url') })))).resolves.toMatchObject({
      code: 'EXECUTED',
    });
    expect(approve).toHaveBeenCalledOnce();
  });

  it('fails expectedRevision conflicts without mutation', async () => {
    const update = command({
      action: 'note.update',
      resource: { type: 'note', id: 'remote/synthetic-note' },
      expectedRevision: 'note:6',
      input: { patch: { title: 'New' } },
    });
    const { subject, local } = engine({ next: update });
    await expect(subject.process(JSON.stringify(envelope()))).resolves.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    expect(local.executeCalls).toBe(0);
  });

  it('never maps move_to_trash to the existing permanent remove APIs', async () => {
    const trash = command({
      action: 'note.move_to_trash',
      resource: { type: 'note', id: 'remote/synthetic-note' },
      expectedRevision: 'note:7',
      input: {},
    });
    const requests: RemoteApprovalRequest[] = [];
    const local = new FakeLocal();
    const { subject } = engine({ next: trash, local, approve: async (request) => (requests.push(request), true) });
    await expect(subject.process(JSON.stringify(envelope()))).resolves.toMatchObject({
      code: 'ACTION_NOT_ALLOWED',
    });
    expect(requests[0]?.destructiveWarning).toMatch(/reversible|trash/i);
    expect(local.removeCalls).toBe(0);
  });

  it('uses local audit idempotency and command.status so ack loss cannot re-execute', async () => {
    const audit = new InMemoryRemoteAuditStore();
    const local = new FakeLocal();
    const first = engine({ audit, local });
    await expect(first.subject.process(JSON.stringify(envelope()))).resolves.toMatchObject({ code: 'EXECUTED' });
    expect(local.executeCalls).toBe(1);

    const duplicate = engine({ audit, local });
    await expect(duplicate.subject.process(JSON.stringify(envelope({
      commandId: '55555555-5555-4555-8555-555555555555',
      requestId: '66666666-6666-4666-8666-666666666666',
      nonce: Buffer.alloc(16, 4).toString('base64url'),
    })))).resolves.toMatchObject({ code: 'DUPLICATE_COMMAND' });
    expect(local.executeCalls).toBe(1);

    const status = command({
      action: 'command.status',
      resource: { type: 'note', id: null },
      expectedRevision: null,
      idempotencyKey: '77777777-7777-4777-8777-777777777777',
      input: { commandId: IDS.command },
    });
    const statusEngine = engine({ audit, local, next: status });
    await expect(statusEngine.subject.process(JSON.stringify(envelope({
      messageType: 'status_query',
      commandId: '88888888-8888-4888-8888-888888888888',
      requestId: '99999999-9999-4999-8999-999999999999',
      nonce: Buffer.alloc(16, 5).toString('base64url'),
    })))).resolves.toMatchObject({ code: 'EXECUTED', status: { terminalCode: 'EXECUTED' } });
    expect(local.executeCalls).toBe(1);
  });

  it('expires before prompting and stores only redacted audit fields', async () => {
    const approve = vi.fn(async () => true);
    const audit = new InMemoryRemoteAuditStore();
    const { subject } = engine({ approve, audit });
    await expect(subject.process(JSON.stringify(envelope({ issuedAtMs: 900_000, expiresAtMs: 950_000 })))).resolves.toMatchObject({
      code: 'COMMAND_EXPIRED',
    });
    expect(approve).not.toHaveBeenCalled();

    const fresh = engine({ audit });
    await fresh.subject.process(JSON.stringify(envelope({ nonce: Buffer.alloc(16, 6).toString('base64url') })));
    const serialized = JSON.stringify(audit.entries());
    expect(serialized).not.toContain('PRIVATE_REMOTE_BODY_CANARY');
    expect(serialized).not.toContain('Synthetic note');
    expect(serialized).not.toContain('ciphertext');
    expect(serialized).not.toMatch(/Bearer |\/Users\/|[A-Za-z]:\\/);
  });
});

class FakeSocket implements RemoteSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(value?: unknown) => void>>();
  readyState = 0;
  closeCalls = 0;
  on(event: 'open' | 'message' | 'close' | 'error', listener: (value?: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  send(value: string): void {
    if (this.readyState !== 1) throw new Error('closed');
    this.sent.push(value);
  }
  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
    this.emit('close');
  }
  emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

describe('Remote A online-only client', () => {
  const binding = { ownerId: 'owner-hash', sessionId: IDS.session, targetId: 'desktop-01' };
  it('defaults and resets OFF; enable requires explicit owner consent', async () => {
    expect(DEFAULT_REMOTE_PREFERENCE).toEqual({ enabled: false, ownerConsentAtMs: null });
    const preferences = new InMemoryRemotePreferenceStore({ enabled: true, ownerConsentAtMs: 1 });
    preferences.reset();
    expect(preferences.get()).toEqual(DEFAULT_REMOTE_PREFERENCE);
    const { subject } = engine();
    const client = new RemoteOnlineClient({
      engine: subject,
      preferences,
      credentials: { read: async () => 'relay-secret', clearSession: vi.fn() },
      socketFactory: vi.fn() as unknown as RemoteSocketFactory,
      endpoint: 'wss://relay.example.test/remote',
      binding,
      clock: () => 1_010_000,
    });
    await expect(client.enable({ ownerConsent: false })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('sends bearer auth only as a header and never queues or retries while offline', async () => {
    const socket = new FakeSocket();
    const factorySpy = vi.fn((_endpoint: string, _headers: Readonly<{ Authorization: string }>) => socket);
    const factory = factorySpy as unknown as RemoteSocketFactory;
    const { subject } = engine();
    const preferences = new InMemoryRemotePreferenceStore();
    const client = new RemoteOnlineClient({
      engine: subject,
      preferences,
      credentials: { read: async () => 'relay-secret', clearSession: vi.fn() },
      socketFactory: factory,
      endpoint: 'wss://relay.example.test/remote',
      binding,
      clock: () => 1_010_000,
    });
    await client.enable({ ownerConsent: true });
    expect(factorySpy).toHaveBeenCalledWith('wss://relay.example.test/remote', {
      Authorization: 'Bearer relay-secret',
      'X-Remote-Role': 'target',
      'X-Owner-Id': 'owner-hash',
      'X-Session-Id': IDS.session,
      'X-Target-Id': 'desktop-01',
    });
    expect(factorySpy.mock.calls[0]?.[0]).not.toContain('relay-secret');
    expect(client.state()).toMatchObject({ enabled: true, connection: 'connecting', queuedCommands: 0 });
    socket.emit('error', new Error('PRIVATE_REMOTE_BODY_CANARY'));
    expect(client.state()).toMatchObject({ connection: 'offline', queuedCommands: 0, lastErrorCode: 'SERVICE_UNAVAILABLE' });
    expect(factorySpy).toHaveBeenCalledTimes(1);
    expect(socket.sent).toEqual([]);
  });

  it('disable closes the socket, clears session material, preserves audit and does not touch local data', async () => {
    const socket = new FakeSocket();
    const clearSession = vi.fn();
    const { subject, local, audit } = engine();
    const client = new RemoteOnlineClient({
      engine: subject,
      preferences: new InMemoryRemotePreferenceStore(),
      credentials: { read: async () => 'relay-secret', clearSession },
      socketFactory: (() => socket) as RemoteSocketFactory,
      endpoint: 'wss://relay.example.test/remote',
      binding,
      clock: () => 1_010_000,
    });
    await client.enable({ ownerConsent: true });
    await client.disable();
    expect(socket.closeCalls).toBe(1);
    expect(clearSession).toHaveBeenCalledOnce();
    expect(client.state()).toMatchObject({ enabled: false, connection: 'disabled', queuedCommands: 0 });
    expect(local.executeCalls).toBe(0);
    expect(audit.entries().some((entry) => entry.event === 'remote.disabled')).toBe(true);
  });
});

describe('Remote A production boundaries', () => {
  it('persists only the redacted terminal audit needed by command.status across restart', () => {
    let persisted: unknown = [];
    const port = {
      get: () => persisted,
      set: (entries: unknown) => { persisted = structuredClone(entries); },
    };
    const first = new PersistentRemoteAuditStore(port);
    first.append({
      event: 'remote.command.executed',
      atMs: 1,
      commandId: IDS.command,
      requestId: IDS.request,
      controllerHash: 'a'.repeat(64),
      targetHash: 'b'.repeat(64),
      resourceHash: 'c'.repeat(64),
      idempotencyHash: 'd'.repeat(64),
      inputDigest: 'e'.repeat(64),
      action: 'note.create',
      risk: 'write',
      terminalCode: 'EXECUTED',
      preRevision: null,
      postRevision: 'note:8',
      latencyMs: 5,
    });
    const restarted = new PersistentRemoteAuditStore(port);
    expect(restarted.findTerminalByCommandId(IDS.command)).toMatchObject({
      terminalCode: 'EXECUTED',
      postRevision: 'note:8',
    });
    expect(JSON.stringify(persisted)).not.toContain('PRIVATE_REMOTE_BODY_CANARY');
  });

  it('stores relay credentials only as safeStorage ciphertext and fails closed without OS protection', async () => {
    const values = new Map<string, string>();
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
      decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
    };
    const adapter = new ElectronSafeStorageCredentialAdapter(safeStorage, {
      get: (name) => values.get(name) ?? null,
      set: (name, value) => values.set(name, value),
      delete: (name) => values.delete(name),
    }, 'darwin');
    adapter.write('relay-token', 'relay-secret');
    expect([...values.values()].join('')).not.toBe('relay-secret');
    await expect(adapter.read('relay-token')).resolves.toBe('relay-secret');

    const unavailable = new ElectronSafeStorageCredentialAdapter(
      { ...safeStorage, isEncryptionAvailable: () => false },
      { get: () => null, set: vi.fn(), delete: vi.fn() },
      'win32',
    );
    await expect(unavailable.read('relay-token')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('production local adapter rechecks revision and maps only reversible trash', async () => {
    const removeNote = vi.fn();
    const removeTodo = vi.fn();
    const moveNoteToTrash = vi.fn(async () => ({
      trashId: '55555555-5555-4555-8555-555555555555',
      kind: 'note',
      originalPath: 'remote/synthetic-note',
      originalRevision: 'note:7',
      trashRevision: 'trash:note:7',
      state: 'trashed',
    }));
    const moveTodoToTrash = vi.fn(async () => ({
      trashId: '66666666-6666-4666-8666-666666666666',
      kind: 'todo',
      originalPath: 'system/todos/todo-1',
      originalRevision: 'todo:9',
      trashRevision: 'trash:todo:9',
      state: 'trashed',
    }));
    const service = {
      notes: {
        get: vi.fn(async () => ({
          note: { path: 'remote/synthetic-note', updatedAt: 7, title: 'Old' },
          body: 'local body',
        })),
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: removeNote,
        moveToTrash: moveNoteToTrash,
      },
      todos: {
        list: vi.fn(async () => [{ id: 'todo-1', updated_at: 9, title: 'Todo' }]),
        create: vi.fn(),
        update: vi.fn(),
        remove: removeTodo,
        moveToTrash: moveTodoToTrash,
      },
    };
    const adapter = new ProductionRemoteLocalAdapter(
      async () => service as unknown as import('../../src/main/local-knowledge-service').LocalKnowledgeService,
    );
    const trashNote = command({
      action: 'note.move_to_trash',
      resource: { type: 'note', id: 'remote/synthetic-note' },
      expectedRevision: 'note:7',
      input: {},
    });
    await expect(adapter.preview(trashNote)).resolves.toMatchObject({ currentRevision: 'note:7' });
    await expect(adapter.execute(trashNote)).resolves.toMatchObject({
      code: 'EXECUTED',
      preRevision: 'note:7',
      postRevision: 'trash:note:7',
    });
    const trashTodo = command({
      action: 'todo.move_to_trash',
      resource: { type: 'todo', id: 'todo-1' },
      expectedRevision: 'todo:9',
      input: {},
    });
    await expect(adapter.execute(trashTodo)).resolves.toMatchObject({
      code: 'EXECUTED',
      preRevision: 'todo:9',
      postRevision: 'trash:todo:9',
    });
    expect(moveNoteToTrash).toHaveBeenCalledWith({
      path: 'remote/synthetic-note',
      expectedRevision: 'note:7',
      idempotencyKey: IDS.idempotency,
    });
    expect(moveTodoToTrash).toHaveBeenCalledWith({
      id: 'todo-1',
      expectedRevision: 'todo:9',
      idempotencyKey: IDS.idempotency,
    });
    expect(removeNote).not.toHaveBeenCalled();
    expect(removeTodo).not.toHaveBeenCalled();
  });
});
