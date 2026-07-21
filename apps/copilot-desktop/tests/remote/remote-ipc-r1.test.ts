import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteApprovalRequest } from '../../src/shared/remote-management';
import {
  DesktopApprovalBroker,
  registerRemoteIpc,
  type RemoteRuntime,
} from '../../src/main/remote/ipc';

const approval: RemoteApprovalRequest = {
  approvalToken: Buffer.alloc(32, 7).toString('base64url'),
  commandDigest: 'a'.repeat(64),
  deadlineMs: 10_100,
  commandId: '33333333-3333-4333-8333-333333333333',
  controllerId: 'controller-01',
  initiatedBy: 'user',
  action: 'note.read',
  resource: { type: 'note', id: 'remote/synthetic-note' },
  reason: 'Read the selected local note',
  expiresAtMs: 10_100,
  proposedFields: {},
  diff: [],
  localTruthWarning: 'Local truth',
  destructiveWarning: null,
  approvalScope: 'single-command',
  approveAll: false,
  controllerApprovalVerified: true,
};

afterEach(() => vi.useRealTimers());

describe('Remote A IPC approval boundary', () => {
  it('accepts exactly one matching desktop response', async () => {
    const send = vi.fn();
    const broker = new DesktopApprovalBroker(() => ({ send }), () => 10_000);
    const pending = broker.request(approval);
    const delivered = send.mock.calls[0]?.[1] as RemoteApprovalRequest;
    expect(delivered).toMatchObject({ commandId: approval.commandId, commandDigest: approval.commandDigest, deadlineMs: approval.expiresAtMs });
    const response = {
      approvalToken: delivered.approvalToken,
      commandDigest: delivered.commandDigest,
      deadlineMs: delivered.deadlineMs,
      commandId: delivered.commandId,
      decision: 'approve' as const,
    };
    expect(broker.respond(response)).toEqual({ accepted: true });
    await expect(pending).resolves.toBe(true);
    expect(() => broker.respond(response)).toThrowError(
      expect.objectContaining({ code: 'APPROVAL_EXPIRED' }),
    );
  });

  it('expires an unanswered prompt without approve-all or execution', async () => {
    vi.useFakeTimers();
    let now = 10_000;
    const broker = new DesktopApprovalBroker(() => ({ send: vi.fn() }), () => now);
    const pending = broker.request(approval);
    now = 10_101;
    await vi.advanceTimersByTimeAsync(101);
    await expect(pending).resolves.toBe(false);
  });

  it('rejects untrusted renderer IPC before it reaches runtime', async () => {
    const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
    const runtime = {
      getState: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      respondApproval: vi.fn(),
    } as unknown as RemoteRuntime;
    registerRemoteIpc({
      handle: (channel, listener) => handlers.set(channel, listener),
    }, () => runtime, (event) => (event as { trusted?: boolean }).trusted === true);
    expect(() => handlers.get('copilot:remote:get-state')?.({ trusted: false })).toThrowError(
      expect.objectContaining({ code: 'AUTH_INVALID' }),
    );
    expect(runtime.getState).not.toHaveBeenCalled();
  });
});
