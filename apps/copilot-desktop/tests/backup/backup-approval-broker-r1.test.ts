import { afterEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../../src/shared/ipc-channels.js';
import {
  BackupApprovalGate,
  DesktopBackupApprovalBroker,
  type BackupApprovalPort,
  type BackupApprovalPrompt,
} from '../../src/main/backup-integration/approval.js';
import { registerBackupIpc } from '../../src/main/backup-integration/ipc.js';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);

function prompt(overrides: Partial<BackupApprovalPrompt> = {}): BackupApprovalPrompt {
  return {
    commandId: COMMAND_ID,
    commandDigest: DIGEST,
    issuedAtMs: 1_000,
    deadlineMs: 2_000,
    action: 'upload',
    scopes: ['todos'],
    objectId: '22222222-2222-4222-8222-222222222222',
    bytes: 123,
    sha256: 'b'.repeat(64),
    destructiveWarning: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Desktop Backup approval broker r1', () => {
  it('publishes only the sanitized prompt and accepts the exact head response once', async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    let now = 1_100;
    const broker = new DesktopBackupApprovalBroker(() => ({
      send: (channel, payload) => sent.push({ channel, payload }),
    }), () => now);
    const decision = broker.request(prompt(), new AbortController().signal);
    expect(sent[0]).toEqual({ channel: IPC_CHANNELS.BACKUP_APPROVAL_REQUEST, payload: prompt() });
    expect(JSON.stringify(sent)).not.toMatch(/token|url|path|credential/i);

    expect(broker.respond({
      commandId: COMMAND_ID,
      commandDigest: DIGEST,
      deadlineMs: 2_000,
      decision: 'approve',
    })).toEqual({ accepted: true });
    await expect(decision).resolves.toMatchObject({ decision: 'approve', decidedAtMs: now });
    expect(() => broker.respond({ commandId: COMMAND_ID, commandDigest: DIGEST, deadlineMs: 2_000, decision: 'approve' })).toThrow();
  });

  it('denies a duplicate pending prompt and accepts no duplicate decision', async () => {
    const broker = new DesktopBackupApprovalBroker(() => ({ send: vi.fn() }), () => 1_200);
    const controller = new AbortController();
    const first = broker.request(prompt(), controller.signal);
    await expect(broker.request(prompt(), controller.signal)).resolves.toMatchObject({ decision: 'deny' });
    expect(broker.respond({ commandId: COMMAND_ID, commandDigest: DIGEST, deadlineMs: 2_000, decision: 'reject' })).toEqual({ accepted: true });
    await expect(first).resolves.toMatchObject({ decision: 'deny' });
    expect(() => broker.respond({ commandId: COMMAND_ID, commandDigest: DIGEST, deadlineMs: 2_000, decision: 'approve' })).toThrow();
  });

  it('preserves FIFO order and rejects a response for a queued non-head command', async () => {
    const sent: BackupApprovalPrompt[] = [];
    const broker = new DesktopBackupApprovalBroker(() => ({
      send: (channel, payload) => {
        if (channel === IPC_CHANNELS.BACKUP_APPROVAL_REQUEST) sent.push(payload as BackupApprovalPrompt);
      },
    }), () => 1_200);
    const firstPrompt = prompt();
    const secondPrompt = prompt({
      commandId: '33333333-3333-4333-8333-333333333333',
      commandDigest: 'c'.repeat(64),
    });
    const first = broker.request(firstPrompt, new AbortController().signal);
    const second = broker.request(secondPrompt, new AbortController().signal);
    expect(sent.map((item) => item.commandId)).toEqual([firstPrompt.commandId]);
    expect(() => broker.respond({
      commandId: secondPrompt.commandId,
      commandDigest: secondPrompt.commandDigest,
      deadlineMs: secondPrompt.deadlineMs,
      decision: 'approve',
    })).toThrow();
    broker.respond({ commandId: firstPrompt.commandId, commandDigest: firstPrompt.commandDigest, deadlineMs: 2_000, decision: 'reject' });
    await expect(first).resolves.toMatchObject({ decision: 'deny' });
    expect(sent.map((item) => item.commandId)).toEqual([firstPrompt.commandId, secondPrompt.commandId]);
    broker.respond({ commandId: secondPrompt.commandId, commandDigest: secondPrompt.commandDigest, deadlineMs: 2_000, decision: 'approve' });
    await expect(second).resolves.toMatchObject({ decision: 'approve' });
  });

  it.each([
    ['command id', { commandId: '33333333-3333-4333-8333-333333333333' }],
    ['digest', { commandDigest: 'c'.repeat(64) }],
    ['deadline', { deadlineMs: 2_001 }],
  ])('rejects a mismatched %s and leaves the exact head pending', async (_label, mismatch) => {
    const broker = new DesktopBackupApprovalBroker(() => ({ send: vi.fn() }), () => 1_200);
    const controller = new AbortController();
    const decision = broker.request(prompt(), controller.signal);
    expect(() => broker.respond({
      commandId: COMMAND_ID,
      commandDigest: DIGEST,
      deadlineMs: 2_000,
      decision: 'approve',
      ...mismatch,
    })).toThrow();
    controller.abort();
    await expect(decision).resolves.toMatchObject({ decision: 'deny' });
  });

  it('expires on its authoritative timer and a cleared stale timer cannot settle twice', async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const lifecycle: unknown[] = [];
    const broker = new DesktopBackupApprovalBroker(() => ({
      send: (channel, payload) => {
        if (channel === IPC_CHANNELS.BACKUP_APPROVAL_LIFECYCLE) lifecycle.push(payload);
      },
    }), () => now);
    const expiring = broker.request(prompt({ deadlineMs: 1_100 }), new AbortController().signal);
    now = 1_100;
    await vi.advanceTimersByTimeAsync(100);
    await expect(expiring).resolves.toMatchObject({ decision: 'deny', decidedAtMs: 1_100 });
    expect(lifecycle).toEqual([{ commandId: COMMAND_ID, state: 'expired' }]);

    now = 2_000;
    const stalePrompt = prompt({
      commandId: '33333333-3333-4333-8333-333333333333',
      commandDigest: 'c'.repeat(64),
      issuedAtMs: 2_000,
      deadlineMs: 2_100,
    });
    const stale = broker.request(stalePrompt, new AbortController().signal);
    now = 2_001;
    broker.respond({ commandId: stalePrompt.commandId, commandDigest: stalePrompt.commandDigest, deadlineMs: stalePrompt.deadlineMs, decision: 'reject' });
    await expect(stale).resolves.toMatchObject({ decision: 'deny' });
    await vi.advanceTimersByTimeAsync(100);
    expect(lifecycle).toHaveLength(2);
    expect(lifecycle[1]).toEqual({ commandId: stalePrompt.commandId, state: 'resolved' });
  });

  it('fails closed when the sender is missing, on cancelAll, and after disable abort', async () => {
    const missing = new DesktopBackupApprovalBroker(() => null, () => 1_200);
    await expect(missing.request(prompt(), new AbortController().signal)).resolves.toMatchObject({ decision: 'deny' });

    const broker = new DesktopBackupApprovalBroker(() => ({ send: vi.fn() }), () => 1_200);
    const first = broker.request(prompt(), new AbortController().signal);
    const second = broker.request(prompt({ commandId: '33333333-3333-4333-8333-333333333333' }), new AbortController().signal);
    broker.cancelAll();
    await expect(first).resolves.toMatchObject({ decision: 'deny' });
    await expect(second).resolves.toMatchObject({ decision: 'deny' });

    const disabled = new AbortController();
    disabled.abort();
    await expect(broker.request(prompt({ commandId: '44444444-4444-4444-8444-444444444444' }), disabled.signal)).resolves.toMatchObject({ decision: 'deny' });
  });

  it('accepts one millisecond before the final deadline and rejects the exact deadline', async () => {
    const intent = {
      action: 'upload' as const,
      scopes: ['todos'] as const,
      objectId: '22222222-2222-4222-8222-222222222222',
      bytes: 123,
      sha256: 'b'.repeat(64),
      destructiveWarning: null,
    };
    const portAt = (decidedAtMs: number): BackupApprovalPort => ({
      request: async (bound) => ({
        commandId: bound.commandId,
        commandDigest: bound.commandDigest,
        deadlineMs: bound.deadlineMs,
        decision: 'approve',
        decidedAtMs,
      }),
    });
    const beforeTimes = [1_000, 60_999];
    const before = new BackupApprovalGate(portAt(60_999), () => beforeTimes.shift()!, () => COMMAND_ID);
    await expect(before.approve(intent, new AbortController().signal)).resolves.toMatchObject({ deadlineMs: 61_000 });

    const exactTimes = [1_000, 61_000];
    const exact = new BackupApprovalGate(portAt(61_000), () => exactTimes.shift()!, () => COMMAND_ID);
    await expect(exact.approve(intent, new AbortController().signal)).rejects.toMatchObject({ code: 'CONSENT_EXPIRED' });
  });

  it('strictly validates approval IPC and rejects unknown fields or untrusted senders', () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const respond = vi.fn(() => ({ accepted: true as const }));
    registerBackupIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      () => ({}) as never,
      (event) => event === 'trusted',
      respond,
    );
    const handle = handlers.get(IPC_CHANNELS.BACKUP_APPROVAL_RESPOND)!;
    const exact = { commandId: COMMAND_ID, commandDigest: DIGEST, deadlineMs: 2_000, decision: 'reject' };
    expect(handle('trusted', exact)).toEqual({ accepted: true });
    expect(() => handle('trusted', { ...exact, ownerId: 'forged' })).toThrow();
    expect(() => handle('untrusted', exact)).toThrow();
  });
});
