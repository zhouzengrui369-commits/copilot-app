import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteCommand, RemoteEnvelope } from '../../src/shared/remote-management';
import {
  InMemoryRemoteAuditStore,
  RemoteCommandEngine,
  commandApprovalDigest,
  controllerApprovalBindingDigest,
  stableJson,
  type RemoteCryptoPort,
} from '../../src/main/remote/index';

const BASE = {
  requestId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  commandId: '33333333-3333-4333-8333-333333333333',
  idempotencyKey: '44444444-4444-4444-8444-444444444444',
  ownerId: 'owner-a',
  controllerId: 'controller-a',
  targetId: 'desktop-a',
};

function plainAiCommand(overrides: Partial<RemoteCommand> = {}): RemoteCommand {
  return {
    action: 'note.create',
    initiatedBy: 'ai',
    reason: 'Controller-approved note creation',
    resource: { type: 'note', id: null },
    expectedRevision: null,
    idempotencyKey: BASE.idempotencyKey,
    input: { path: 'remote/r3', title: 'R3', body: 'body', tags: ['r3'] },
    ...overrides,
  } as RemoteCommand;
}

function envelope(overrides: Partial<RemoteEnvelope> = {}): RemoteEnvelope {
  const ciphertext = Buffer.from('r3-ciphertext');
  return {
    schemaVersion: 1,
    messageType: 'command',
    requestId: BASE.requestId,
    sessionId: BASE.sessionId,
    commandId: BASE.commandId,
    ownerId: BASE.ownerId,
    controllerId: BASE.controllerId,
    targetId: BASE.targetId,
    nonce: Buffer.alloc(16, 3).toString('base64url'),
    issuedAtMs: 1_000_000,
    expiresAtMs: 1_060_000,
    payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
    payloadCiphertext: ciphertext.toString('base64url'),
    payloadSha256: createHash('sha256').update(ciphertext).digest('hex'),
    controllerSignature: Buffer.alloc(64, 4).toString('base64url'),
    ...overrides,
  };
}

function expectedBindingDigest(value: RemoteEnvelope, command: RemoteCommand): string {
  return createHash('sha256').update(stableJson({
    schemaVersion: value.schemaVersion,
    messageType: value.messageType,
    ownerId: value.ownerId,
    controllerId: value.controllerId,
    targetId: value.targetId,
    sessionId: value.sessionId,
    requestId: value.requestId,
    commandId: value.commandId,
    payloadSha256: value.payloadSha256,
    issuedAtMs: value.issuedAtMs,
    expiresAtMs: value.expiresAtMs,
    action: command.action,
    resource: command.resource,
    expectedRevision: command.expectedRevision,
    idempotencyKey: command.idempotencyKey,
    commandDigest: commandApprovalDigest(command),
  })).digest('hex');
}

function claimed(value: RemoteEnvelope, approvedAtMs: number, digest = expectedBindingDigest(value, plainAiCommand())): RemoteCommand {
  const command = plainAiCommand();
  return {
    ...command,
    approvalClaim: {
      controllerApprovedAtMs: approvedAtMs,
      controllerApprovalDigest: digest,
    },
  };
}

function run(value: RemoteEnvelope, command: RemoteCommand) {
  const approve = vi.fn(async () => true);
  let executeCalls = 0;
  const crypto: RemoteCryptoPort = {
    verifyAndDecrypt: async () => ({ command, replyContext: {} }),
    encryptReply: async (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url'),
    clearSession: () => undefined,
  };
  const subject = new RemoteCommandEngine({
    ownerId: value.ownerId,
    controllerId: value.controllerId,
    targetId: value.targetId,
    sessionId: value.sessionId,
    crypto,
    signer: {
      signAck: async () => Buffer.alloc(64, 5).toString('base64url'),
      clearSession: () => undefined,
    },
    local: {
      preview: async () => ({ currentRevision: null, proposedFields: {}, diff: [] }),
      execute: async () => {
        executeCalls += 1;
        return { code: 'EXECUTED', preRevision: null, postRevision: 'note:1' };
      },
    },
    audit: new InMemoryRemoteAuditStore(),
    approval: { request: approve, cancelAll: vi.fn() },
    clock: () => 1_010_000,
  });
  return { subject, approve, executeCalls: () => executeCalls };
}

describe('Remote A desktop r3 AI controller approval binding RED', () => {
  it('accepts a canonical controller approval bound to the complete envelope and command', async () => {
    const value = envelope();
    const fixture = run(value, claimed(value, 1_005_000));
    await expect(fixture.subject.process(JSON.stringify(value))).resolves.toMatchObject({ code: 'EXECUTED' });
    expect(fixture.approve).toHaveBeenCalledOnce();
    expect(fixture.executeCalls()).toBe(1);
  });

  it('uses the frozen canonical digest and binds schema plus explicit command fields', () => {
    const value = envelope();
    const command = plainAiCommand();
    const baseDigest = controllerApprovalBindingDigest(value, command);
    expect(baseDigest).toBe(expectedBindingDigest(value, command));
    const variants: Array<[RemoteEnvelope, RemoteCommand]> = [
      [{ ...value, schemaVersion: 2 } as unknown as RemoteEnvelope, command],
      [value, plainAiCommand({ action: 'note.update' })],
      [value, plainAiCommand({ resource: { type: 'note', id: 'remote/r3' } })],
      [value, plainAiCommand({ expectedRevision: 'note:7' })],
      [value, plainAiCommand({ idempotencyKey: '88888888-8888-4888-8888-888888888888' })],
      [value, plainAiCommand({ input: { path: 'remote/r3', title: 'changed', body: 'body', tags: ['r3'] } })],
    ];
    for (const [nextEnvelope, nextCommand] of variants) {
      expect(controllerApprovalBindingDigest(nextEnvelope, nextCommand)).not.toBe(baseDigest);
    }
  });

  const reboundEnvelopes: Array<[string, () => RemoteEnvelope]> = [
    ['ownerId', () => envelope({ ownerId: 'owner-b' })],
    ['controllerId', () => envelope({ controllerId: 'controller-b' })],
    ['targetId', () => envelope({ targetId: 'desktop-b' })],
    ['sessionId', () => envelope({ sessionId: '55555555-5555-4555-8555-555555555555' })],
    ['requestId', () => envelope({ requestId: '66666666-6666-4666-8666-666666666666' })],
    ['commandId', () => envelope({ commandId: '77777777-7777-4777-8777-777777777777' })],
    ['payloadSha256', () => {
      const ciphertext = Buffer.from('r3-other-ciphertext');
      return envelope({
        payloadCiphertext: ciphertext.toString('base64url'),
        payloadSha256: createHash('sha256').update(ciphertext).digest('hex'),
      });
    }],
    ['issuedAtMs', () => envelope({ issuedAtMs: 1_001_000 })],
    ['expiresAtMs', () => envelope({ expiresAtMs: 1_050_000 })],
  ];

  it.each(reboundEnvelopes)('rejects an old canonical approval after %s rebinding', async (_field, makeEnvelope) => {
    const originalEnvelope = envelope();
    const originalCommand = plainAiCommand();
    const oldDigest = expectedBindingDigest(originalEnvelope, originalCommand);
    const value = makeEnvelope();
    const rebound = claimed(value, 1_005_000, oldDigest);
    const fixture = run(value, rebound);
    await expect(fixture.subject.process(JSON.stringify(value))).resolves.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(fixture.approve).not.toHaveBeenCalled();
    expect(fixture.executeCalls()).toBe(0);
  });

  it.each([
    ['before issuedAtMs', 999_999],
    ['later than desktop now', 1_020_000],
    ['after expiresAtMs', 1_060_001],
  ])('rejects a canonically bound approval timestamp %s', async (_label, approvedAtMs) => {
    const value = envelope();
    const fixture = run(value, claimed(value, approvedAtMs));
    await expect(fixture.subject.process(JSON.stringify(value))).resolves.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(fixture.approve).not.toHaveBeenCalled();
    expect(fixture.executeCalls()).toBe(0);
  });

  it('does not require a controller claim for user origin but still requires desktop approval', async () => {
    const value = envelope();
    const fixture = run(value, plainAiCommand({ initiatedBy: 'user' }));
    await expect(fixture.subject.process(JSON.stringify(value))).resolves.toMatchObject({ code: 'EXECUTED' });
    expect(fixture.approve).toHaveBeenCalledOnce();
    expect(fixture.executeCalls()).toBe(1);
  });
});
