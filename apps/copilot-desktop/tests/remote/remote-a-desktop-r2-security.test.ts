import {
  createCipheriv,
  createDecipheriv,
  createHash,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  RemoteApprovalRequest,
  RemoteCommand,
  RemoteEnvelope,
} from '../../src/shared/remote-management';
import {
  InMemoryRemoteAuditStore,
  RemoteCommandEngine,
  PersistentRemoteAuditStore,
  envelopeSignatureBytes,
  parseDecryptedCommand,
  parseRemoteEnvelope,
  stableJson,
  type RemoteCryptoPort,
  type RemoteLocalAdapter,
} from '../../src/main/remote/index';
import { DesktopApprovalBroker } from '../../src/main/remote/ipc';

const IDS = {
  request: '11111111-1111-4111-8111-111111111111',
  session: '22222222-2222-4222-8222-222222222222',
  command: '33333333-3333-4333-8333-333333333333',
  command2: '55555555-5555-4555-8555-555555555555',
  idempotency: '44444444-4444-4444-8444-444444444444',
};

function command(overrides: Partial<RemoteCommand> = {}): RemoteCommand {
  return {
    action: 'note.create',
    initiatedBy: 'user',
    reason: 'Owner requested a local note',
    resource: { type: 'note', id: null },
    expectedRevision: null,
    idempotencyKey: IDS.idempotency,
    input: { path: 'remote/r2', title: 'R2', body: 'body', tags: ['r2'] },
    ...overrides,
  } as RemoteCommand;
}

function envelope(overrides: Partial<RemoteEnvelope> = {}): RemoteEnvelope {
  const bytes = Buffer.from('r2-ciphertext');
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
    payloadCiphertext: bytes.toString('base64url'),
    payloadSha256: createHash('sha256').update(bytes).digest('hex'),
    controllerSignature: Buffer.alloc(64, 2).toString('base64url'),
    ...overrides,
  };
}

class TestCrypto implements RemoteCryptoPort {
  constructor(readonly next = command()) {}
  async verifyAndDecrypt() {
    return { command: this.next, replyContext: { controller: 'test' } };
  }
  async encryptReply(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }
  clearSession(): void {}
}

function approvalDraft(
  overrides: Partial<Omit<RemoteApprovalRequest, 'approvalToken' | 'deadlineMs'>> = {},
): Omit<RemoteApprovalRequest, 'approvalToken' | 'deadlineMs'> {
  return {
    commandDigest: 'a'.repeat(64),
    commandId: IDS.command,
    controllerId: 'controller-01',
    initiatedBy: 'user',
    action: 'note.create',
    resource: { type: 'note', id: null },
    reason: 'Owner requested a local note',
    expiresAtMs: 10_100,
    proposedFields: { title: 'R2' },
    diff: [],
    localTruthWarning: 'Local truth',
    destructiveWarning: null,
    approvalScope: 'single-command',
    approveAll: false,
    controllerApprovalVerified: true,
    ...overrides,
  };
}

const signer = {
  signAck: async () => Buffer.alloc(64, 9).toString('base64url'),
  clearSession: vi.fn(),
};

describe('Remote A desktop r2 security RED contracts', () => {
  it('main creates a one-time approval token and exact digest/deadline binding', async () => {
    const send = vi.fn();
    const broker = new DesktopApprovalBroker(() => ({ send }), () => 10_000);
    const pending = broker.request(approvalDraft());
    const delivered = send.mock.calls[0]?.[1] as Record<string, unknown>;
    broker.cancelAll();
    await pending;
    expect(delivered.approvalToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(delivered.commandDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(delivered.deadlineMs).toBe(10_100);
  });

  it('rejects forged/stale/cross-payload approval IPC and presents pending prompts FIFO', async () => {
    const send = vi.fn();
    const tokens = [Buffer.alloc(32, 1).toString('base64url'), Buffer.alloc(32, 2).toString('base64url')];
    const broker = new DesktopApprovalBroker(() => ({ send }), () => 10_000, () => tokens.shift() as string);
    const first = broker.request(approvalDraft());
    const second = broker.request(approvalDraft({
      commandId: IDS.command2,
      commandDigest: 'b'.repeat(64),
    }));
    const requestCalls = () => send.mock.calls.filter((call) => call[0] === 'copilot:remote:approval-request');
    expect(requestCalls()).toHaveLength(1);
    const active = requestCalls()[0]?.[1] as RemoteApprovalRequest;
    expect(() => broker.respond({
      approvalToken: Buffer.alloc(32, 9).toString('base64url'),
      commandDigest: active.commandDigest,
      deadlineMs: active.deadlineMs,
      commandId: active.commandId,
      decision: 'approve',
    })).toThrowError(expect.objectContaining({ code: 'AUTH_INVALID' }));
    expect(() => broker.respond({
      approvalToken: active.approvalToken,
      commandDigest: 'f'.repeat(64),
      deadlineMs: active.deadlineMs,
      commandId: active.commandId,
      decision: 'approve',
    })).toThrowError(expect.objectContaining({ code: 'AUTH_INVALID' }));
    broker.respond({
      approvalToken: active.approvalToken,
      commandDigest: active.commandDigest,
      deadlineMs: active.deadlineMs,
      commandId: active.commandId,
      decision: 'approve',
    });
    await expect(first).resolves.toBe(true);
    expect(requestCalls()).toHaveLength(2);
    const next = requestCalls()[1]?.[1] as RemoteApprovalRequest;
    expect(next.commandId).toBe(IDS.command2);
    expect(() => broker.respond({
      approvalToken: active.approvalToken,
      commandDigest: active.commandDigest,
      deadlineMs: active.deadlineMs,
      commandId: active.commandId,
      decision: 'approve',
    })).toThrowError(expect.objectContaining({ code: 'AUTH_INVALID' }));
    broker.cancelAll();
    await expect(second).resolves.toBe(false);
  });

  it('pushes main-owned expiry and cancellation lifecycle events to remove the modal', async () => {
    const send = vi.fn();
    const token = Buffer.alloc(32, 4).toString('base64url');
    const broker = new DesktopApprovalBroker(() => ({ send }), () => 10_000, () => token);
    const expired = broker.request(approvalDraft({ expiresAtMs: 10_001 }));
    await expect(expired).resolves.toBe(false);
    expect(send).toHaveBeenCalledWith('copilot:remote:approval-lifecycle', {
      approvalToken: token,
      commandId: IDS.command,
      state: 'expired',
    });

    const cancelled = broker.request(approvalDraft({ expiresAtMs: 20_000 }));
    broker.cancelAll();
    await expect(cancelled).resolves.toBe(false);
    expect(send).toHaveBeenCalledWith('copilot:remote:approval-lifecycle', {
      approvalToken: token,
      commandId: IDS.command,
      state: 'cancelled',
    });
  });

  it('atomically reserves concurrent same-idempotency work before preview', async () => {
    let releaseExecute!: () => void;
    const gate = new Promise<void>((resolve) => { releaseExecute = resolve; });
    let executeCalls = 0;
    const local: RemoteLocalAdapter = {
      preview: async () => ({ currentRevision: null, proposedFields: {}, diff: [] }),
      execute: async () => {
        executeCalls += 1;
        await gate;
        return { code: 'EXECUTED', preRevision: null, postRevision: `note:${executeCalls}` };
      },
    };
    const subject = new RemoteCommandEngine({
      ownerId: 'owner-hash', controllerId: 'controller-01', targetId: 'desktop-01', sessionId: IDS.session,
      crypto: new TestCrypto(), signer, local, audit: new InMemoryRemoteAuditStore(),
      approval: { request: async () => true, cancelAll: vi.fn() }, clock: () => 1_010_000,
    });
    const first = subject.process(JSON.stringify(envelope()));
    const second = subject.process(JSON.stringify(envelope({
      commandId: IDS.command2,
      requestId: '66666666-6666-4666-8666-666666666666',
      nonce: Buffer.alloc(16, 3).toString('base64url'),
    })));
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseExecute();
    const results = await Promise.all([first, second]);
    expect(executeCalls).toBe(1);
    expect(results.map((result) => result.code).sort()).toEqual(['DUPLICATE_COMMAND', 'EXECUTED']);
  });

  it('serializes resource mutation and rechecks expectedRevision so two updates cannot both pass', async () => {
    const firstCommand = command({
      action: 'note.update', resource: { type: 'note', id: 'remote/r2' },
      expectedRevision: 'note:1', input: { patch: { title: 'First' } },
    });
    const secondCommand = command({
      action: 'note.update', resource: { type: 'note', id: 'remote/r2' },
      expectedRevision: 'note:1', idempotencyKey: '77777777-7777-4777-8777-777777777777',
      input: { patch: { title: 'Second' } },
    });
    let revision = 'note:1';
    let mutations = 0;
    const local: RemoteLocalAdapter = {
      preview: async () => ({ currentRevision: revision, proposedFields: {}, diff: [] }),
      execute: async (value) => {
        if (value.expectedRevision !== revision) {
          return { code: 'REVISION_CONFLICT', preRevision: revision, postRevision: null };
        }
        mutations += 1;
        const before = revision;
        revision = 'note:2';
        return { code: 'EXECUTED', preRevision: before, postRevision: revision };
      },
    };
    const crypto: RemoteCryptoPort = {
      verifyAndDecrypt: async (value) => ({
        command: value.commandId === IDS.command ? firstCommand : secondCommand,
        replyContext: {},
      }),
      encryptReply: async (value) => Buffer.from(JSON.stringify(value)).toString('base64url'),
      clearSession: () => undefined,
    };
    const subject = new RemoteCommandEngine({
      ownerId: 'owner-hash', controllerId: 'controller-01', targetId: 'desktop-01', sessionId: IDS.session,
      crypto, signer, local, audit: new InMemoryRemoteAuditStore(),
      approval: { request: async () => true, cancelAll: vi.fn() }, clock: () => 1_010_000,
    });
    const results = await Promise.all([
      subject.process(JSON.stringify(envelope())),
      subject.process(JSON.stringify(envelope({
        commandId: IDS.command2,
        requestId: '66666666-6666-4666-8666-666666666666',
        nonce: Buffer.alloc(16, 8).toString('base64url'),
      }))),
    ]);
    expect(mutations).toBe(1);
    expect(results.map((result) => result.code).sort()).toEqual(['EXECUTED', 'REVISION_CONFLICT']);
  });

  it('disable waits for an admitted adapter call and resolves behind a generation fence', async () => {
    let releaseExecute!: () => void;
    let enteredExecute!: () => void;
    const gate = new Promise<void>((resolve) => { releaseExecute = resolve; });
    const entered = new Promise<void>((resolve) => { enteredExecute = resolve; });
    const local: RemoteLocalAdapter = {
      preview: async () => ({ currentRevision: null, proposedFields: {}, diff: [] }),
      execute: async () => {
        enteredExecute();
        await gate;
        return { code: 'EXECUTED', preRevision: null, postRevision: 'note:1' };
      },
    };
    const subject = new RemoteCommandEngine({
      ownerId: 'owner-hash', controllerId: 'controller-01', targetId: 'desktop-01', sessionId: IDS.session,
      crypto: new TestCrypto(), signer, local, audit: new InMemoryRemoteAuditStore(),
      approval: { request: async () => true, cancelAll: vi.fn() }, clock: () => 1_010_000,
    });
    const processing = subject.process(JSON.stringify(envelope()));
    await entered;
    const disabling = subject.disable();
    const race = await Promise.race([
      disabling.then(() => 'disabled'),
      new Promise<'waiting'>((resolve) => setImmediate(() => resolve('waiting'))),
    ]);
    releaseExecute();
    await Promise.all([processing, disabling]);
    expect(race).toBe('waiting');
  });

  it('does not execute an approval resolved across the disable generation boundary', async () => {
    let resolveApproval!: (approved: boolean) => void;
    let approvalStarted!: () => void;
    const started = new Promise<void>((resolve) => { approvalStarted = resolve; });
    const approval = {
      request: () => {
        approvalStarted();
        return new Promise<boolean>((resolve) => { resolveApproval = resolve; });
      },
      cancelAll: () => resolveApproval(false),
    };
    const execute = vi.fn(async () => ({ code: 'EXECUTED' as const, preRevision: null, postRevision: 'note:1' }));
    const subject = new RemoteCommandEngine({
      ownerId: 'owner-hash', controllerId: 'controller-01', targetId: 'desktop-01', sessionId: IDS.session,
      crypto: new TestCrypto(), signer,
      local: { preview: async () => ({ currentRevision: null, proposedFields: {}, diff: [] }), execute },
      audit: new InMemoryRemoteAuditStore(), approval, clock: () => 1_010_000,
    });
    const processing = subject.process(JSON.stringify(envelope()));
    await started;
    const disabling = subject.disable();
    await expect(processing).resolves.toMatchObject({ code: 'SESSION_EXPIRED' });
    await disabling;
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns only a signed encrypted contract ACK envelope', async () => {
    const desktopX = generateKeyPairSync('x25519');
    const controllerX = generateKeyPairSync('x25519');
    const desktopSign = generateKeyPairSync('ed25519');
    const shared = diffieHellman({ privateKey: desktopX.privateKey, publicKey: controllerX.publicKey });
    const ackKey = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('remote-a-ack-r2'), 32));
    const crypto: RemoteCryptoPort = {
      verifyAndDecrypt: async () => ({ command: command(), replyContext: {} }),
      encryptReply: async (value) => {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', ackKey, iv);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
      },
      clearSession: () => undefined,
    };
    const realSigner = {
      signAck: async (bytes: Buffer) => sign(null, bytes, desktopSign.privateKey).toString('base64url'),
      clearSession: () => undefined,
    };
    const subject = new RemoteCommandEngine({
      ownerId: 'owner-hash', controllerId: 'controller-01', targetId: 'desktop-01', sessionId: IDS.session,
      crypto,
      signer: realSigner,
      local: {
        preview: async () => ({ currentRevision: null, proposedFields: {}, diff: [] }),
        execute: async () => ({ code: 'EXECUTED', preRevision: null, postRevision: 'note:1' }),
      },
      audit: new InMemoryRemoteAuditStore(),
      approval: { request: async () => true, cancelAll: vi.fn() },
      clock: () => 1_010_000,
    });
    const ack = await subject.process(JSON.stringify(envelope()));
    expect(ack.wireEnvelope).toMatchObject({
      schemaVersion: 1,
      messageType: 'ack',
      commandId: IDS.command,
      payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
      controllerSignature: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    });
    expect(ack).not.toHaveProperty('unsignedPayload');
    const wire = ack.wireEnvelope as RemoteEnvelope;
    expect(() => parseRemoteEnvelope(JSON.stringify(wire), 1_010_000)).not.toThrow();
    expect(verify(
      null,
      envelopeSignatureBytes(wire),
      desktopSign.publicKey,
      Buffer.from(wire.controllerSignature, 'base64url'),
    )).toBe(true);
    const packed = Buffer.from(wire.payloadCiphertext, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', ackKey, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const clear = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'));
    expect(clear).toMatchObject({
      commandId: IDS.command,
      inputDigest: createHash('sha256').update(stableJson(command().input)).digest('hex'),
      preRevision: null,
      postRevision: 'note:1',
      terminalCode: 'EXECUTED',
      latencyMs: 0,
    });
  });

  it('keeps terminal idempotency records beyond display-audit trimming and rejects digest rebinding', () => {
    let display: unknown = [];
    let identities: unknown = [];
    const displayPort = { get: () => display, set: (value: unknown) => { display = structuredClone(value); } };
    const identityPort = { get: () => identities, set: (value: unknown) => { identities = structuredClone(value); } };
    const first = new PersistentRemoteAuditStore(displayPort as never, 3, identityPort as never);
    const identity = { commandId: IDS.command, inputDigest: 'a'.repeat(64), idempotencyHash: 'b'.repeat(64) };
    expect(first.reserve(identity)).toMatchObject({ kind: 'reserved' });
    first.complete(identity, {
      commandId: IDS.command, terminalCode: 'EXECUTED', inputDigest: identity.inputDigest,
      preRevision: null, postRevision: 'note:1',
    });
    for (let index = 0; index < 10; index += 1) {
      first.append({
        event: 'remote.disabled', atMs: index, commandId: null, requestId: null,
        controllerHash: null, targetHash: null, resourceHash: null, idempotencyHash: null,
        inputDigest: null, action: null, risk: null, terminalCode: null,
        preRevision: null, postRevision: null, latencyMs: null,
      });
    }
    expect((display as unknown[])).toHaveLength(3);
    const restarted = new PersistentRemoteAuditStore(displayPort as never, 3, identityPort as never);
    expect(restarted.findTerminalByCommandId(IDS.command)).toMatchObject({ terminalCode: 'EXECUTED' });
    expect(restarted.reserve(identity)).toMatchObject({ kind: 'terminal' });
    expect(restarted.reserve({ ...identity, inputDigest: 'c'.repeat(64) })).toMatchObject({ kind: 'conflict' });
    expect(JSON.stringify({ display, identities })).not.toMatch(/body|ciphertext|Bearer|\/Users\//);
  });

  it('keeps the terminal reservation after display-audit failure so retry/status cannot reexecute', async () => {
    class FailingDisplayAudit extends InMemoryRemoteAuditStore {
      override append(entry: Parameters<InMemoryRemoteAuditStore['append']>[0]): void {
        if (entry.event === 'remote.command.executed') throw new Error('display audit unavailable');
        super.append(entry);
      }
    }
    const audit = new FailingDisplayAudit();
    let executions = 0;
    const subject = new RemoteCommandEngine({
      ownerId: 'owner-hash', controllerId: 'controller-01', targetId: 'desktop-01', sessionId: IDS.session,
      crypto: new TestCrypto(), signer,
      local: {
        preview: async () => ({ currentRevision: null, proposedFields: {}, diff: [] }),
        execute: async () => {
          executions += 1;
          return { code: 'EXECUTED', preRevision: null, postRevision: 'note:1' };
        },
      },
      audit, approval: { request: async () => true, cancelAll: vi.fn() }, clock: () => 1_010_000,
    });
    await expect(subject.process(JSON.stringify(envelope()))).resolves.toMatchObject({ code: 'EXECUTED' });
    await expect(subject.process(JSON.stringify(envelope({
      nonce: Buffer.alloc(16, 6).toString('base64url'),
      requestId: '66666666-6666-4666-8666-666666666666',
    })))).resolves.toMatchObject({ code: 'DUPLICATE_COMMAND' });
    expect(executions).toBe(1);
    expect(audit.findTerminalByCommandId(IDS.command)).toMatchObject({ terminalCode: 'EXECUTED' });
  });

  it('never creates an unsigned or placeholder ACK when the desktop signer is unavailable', async () => {
    const subject = new RemoteCommandEngine({
      ownerId: 'owner-hash', controllerId: 'controller-01', targetId: 'desktop-01', sessionId: IDS.session,
      crypto: new TestCrypto(),
      signer: {
        signAck: async () => { throw new Error('AUTH_REQUIRED'); },
        clearSession: () => undefined,
      },
      local: {
        preview: async () => ({ currentRevision: null, proposedFields: {}, diff: [] }),
        execute: async () => ({ code: 'EXECUTED', preRevision: null, postRevision: 'note:1' }),
      },
      audit: new InMemoryRemoteAuditStore(),
      approval: { request: async () => true, cancelAll: vi.fn() }, clock: () => 1_010_000,
    });
    const ack = await subject.process(JSON.stringify(envelope()));
    expect(ack.code).toBe('EXECUTED');
    expect(ack.wireEnvelope).toBeUndefined();
    expect(ack.encryptedPayload).toBeUndefined();
  });

  it('rejects missing required note fields, arbitrary enums and path-shaped links before approval', () => {
    expect(() => parseDecryptedCommand(command({ input: { path: 'remote/r2', title: 'R2' } }), envelope())).toThrow();
    expect(() => parseDecryptedCommand(command({ input: {
      path: 'remote/r2', title: 'R2', body: 'body', tags: [], status: 'arbitrary',
    } }), envelope())).toThrow();
    expect(() => parseDecryptedCommand(command({
      action: 'todo.create', resource: { type: 'todo', id: null },
      input: { title: 'Todo', status: 'open', priority: 'high', note_links: ['../../secret'] },
    }), envelope())).toThrow();
  });
});
