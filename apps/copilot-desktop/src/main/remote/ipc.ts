import { randomBytes } from 'node:crypto';
import type {
  RemoteApprovalLifecycleEvent,
  RemoteApprovalRequest,
  RemoteApprovalResponse,
  RemoteBridge,
} from '../../shared/remote-management.js';
import { IPC_CHANNELS } from '../../shared/ipc-channels.js';
import type { IpcMainRegistrar } from '../domain-ipc.js';
import type { RemoteApprovalPort } from './controller.js';
import { RemoteError } from './protocol.js';

export interface RemoteRuntime extends Pick<
  RemoteBridge,
  'getState' | 'enable' | 'disable' | 'createPairingRequest' | 'importPairing' | 'revokePairing'
> {
  respondApproval(response: RemoteApprovalResponse): Promise<{ accepted: true }>;
}

export interface RemoteApprovalSender {
  send(channel: string, payload: RemoteApprovalRequest | RemoteApprovalLifecycleEvent): void;
}

export class DesktopApprovalBroker implements RemoteApprovalPort {
  private readonly queue: Array<{
    request: RemoteApprovalRequest;
    resolve: (approved: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    private readonly sender: () => RemoteApprovalSender | null,
    private readonly clock: () => number = Date.now,
    private readonly createToken: () => string = () => randomBytes(32).toString('base64url'),
  ) {}

  request(draft: Omit<RemoteApprovalRequest, 'approvalToken' | 'deadlineMs'>): Promise<boolean> {
    if (this.queue.some((pending) => pending.request.commandId === draft.commandId)) {
      return Promise.reject(new RemoteError('DUPLICATE_COMMAND', 'approval is already pending'));
    }
    if (!/^[0-9a-f]{64}$/.test(draft.commandDigest)) {
      return Promise.reject(new RemoteError('INVALID_SCHEMA', 'approval command digest is invalid'));
    }
    if (!this.sender()) return Promise.resolve(false);
    const request: RemoteApprovalRequest = {
      ...draft,
      approvalToken: this.createToken(),
      deadlineMs: draft.expiresAtMs,
    };
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.approvalToken)) {
      return Promise.reject(new RemoteError('AUTH_INVALID', 'approval token generation failed'));
    }
    return new Promise<boolean>((resolve) => {
      const timeoutMs = Math.max(0, request.deadlineMs - this.clock());
      const timer = setTimeout(() => {
        const index = this.queue.findIndex((pending) => pending.request.approvalToken === request.approvalToken);
        if (index < 0) return;
        const [pending] = this.queue.splice(index, 1);
        this.sendLifecycle(pending.request, 'expired');
        pending.resolve(false);
        if (index === 0) this.sendHead();
      }, timeoutMs);
      this.queue.push({ request, resolve, timer });
      if (this.queue.length === 1) this.sendHead();
    });
  }

  respond(response: RemoteApprovalResponse): { accepted: true } {
    const pending = this.queue[0];
    if (!pending) throw new RemoteError('APPROVAL_EXPIRED', 'approval request is not pending');
    const exact = response.commandId === pending.request.commandId
      && response.approvalToken === pending.request.approvalToken
      && response.commandDigest === pending.request.commandDigest
      && response.deadlineMs === pending.request.deadlineMs;
    if (!exact) throw new RemoteError('AUTH_INVALID', 'approval response binding mismatch');
    if (this.clock() > pending.request.deadlineMs) {
      this.queue.shift();
      clearTimeout(pending.timer);
      this.sendLifecycle(pending.request, 'expired');
      pending.resolve(false);
      this.sendHead();
      throw new RemoteError('APPROVAL_EXPIRED', 'approval request expired');
    }
    this.queue.shift();
    clearTimeout(pending.timer);
    const approved = response.decision === 'approve';
    this.sendLifecycle(pending.request, 'resolved');
    pending.resolve(approved);
    this.sendHead();
    return { accepted: true };
  }

  cancelAll(): void {
    const pendingItems = this.queue.splice(0);
    for (const pending of pendingItems) {
      clearTimeout(pending.timer);
      this.sendLifecycle(pending.request, 'cancelled');
      pending.resolve(false);
    }
  }

  private sendHead(): void {
    const pending = this.queue[0];
    if (!pending) return;
    const target = this.sender();
    if (!target) {
      this.queue.shift();
      clearTimeout(pending.timer);
      pending.resolve(false);
      this.sendHead();
      return;
    }
    try {
      target.send(IPC_CHANNELS.REMOTE_APPROVAL_REQUEST, pending.request);
    } catch {
      this.queue.shift();
      clearTimeout(pending.timer);
      pending.resolve(false);
      this.sendHead();
    }
  }

  private sendLifecycle(request: RemoteApprovalRequest, state: RemoteApprovalLifecycleEvent['state']): void {
    try {
      this.sender()?.send(IPC_CHANNELS.REMOTE_APPROVAL_LIFECYCLE, {
        approvalToken: request.approvalToken,
        commandId: request.commandId,
        state,
      });
    } catch {
      // Lifecycle notification is UI hygiene only; main remains authoritative.
    }
  }
}

export function registerRemoteIpc(
  ipc: IpcMainRegistrar,
  getRuntime: () => RemoteRuntime,
  isTrustedSender: (event: unknown) => boolean = () => true,
): void {
  ipc.handle(IPC_CHANNELS.REMOTE_GET_STATE, (event) => {
    assertTrusted(event, isTrustedSender);
    return getRuntime().getState();
  });
  ipc.handle(IPC_CHANNELS.REMOTE_ENABLE, (event, request) => {
    assertTrusted(event, isTrustedSender);
    return getRuntime().enable(assertEnableRequest(request));
  });
  ipc.handle(IPC_CHANNELS.REMOTE_DISABLE, (event) => {
    assertTrusted(event, isTrustedSender);
    return getRuntime().disable();
  });
  ipc.handle(IPC_CHANNELS.REMOTE_IMPORT_PAIRING, (event, payload) => {
    assertTrusted(event, isTrustedSender);
    assertIntentOnly(payload, 'pairing import');
    return getRuntime().importPairing();
  });
  ipc.handle(IPC_CHANNELS.REMOTE_CREATE_PAIRING_REQUEST, (event, payload) => {
    assertTrusted(event, isTrustedSender);
    assertIntentOnly(payload, 'pairing request creation');
    return getRuntime().createPairingRequest();
  });
  ipc.handle(IPC_CHANNELS.REMOTE_REVOKE_PAIRING, (event, payload) => {
    assertTrusted(event, isTrustedSender);
    assertIntentOnly(payload, 'pairing revoke');
    return getRuntime().revokePairing();
  });
  ipc.handle(IPC_CHANNELS.REMOTE_APPROVAL_RESPOND, (event, response) => {
    assertTrusted(event, isTrustedSender);
    return getRuntime().respondApproval(assertApprovalResponse(response));
  });
}

function assertIntentOnly(value: unknown, label: string): void {
  if (value !== undefined && value !== null) {
    throw new RemoteError('INVALID_SCHEMA', `remote ${label} accepts no renderer payload`);
  }
}

function assertTrusted(event: unknown, predicate: (event: unknown) => boolean): void {
  if (!predicate(event)) throw new RemoteError('AUTH_INVALID', 'remote IPC sender is not trusted');
}

function assertEnableRequest(value: unknown): { ownerConsent: boolean } {
  if (!value || typeof value !== 'object' || Object.keys(value).some((key) => key !== 'ownerConsent')) {
    throw new RemoteError('INVALID_SCHEMA', 'remote enable request is invalid');
  }
  const request = value as { ownerConsent?: unknown };
  if (typeof request.ownerConsent !== 'boolean') throw new RemoteError('INVALID_SCHEMA', 'ownerConsent must be boolean');
  return { ownerConsent: request.ownerConsent };
}

function assertApprovalResponse(value: unknown): RemoteApprovalResponse {
  if (!value || typeof value !== 'object') throw new RemoteError('INVALID_SCHEMA', 'approval response is invalid');
  const response = value as Partial<RemoteApprovalResponse>;
  if (
    Object.keys(value).some((key) => !['approvalToken', 'commandDigest', 'deadlineMs', 'commandId', 'decision'].includes(key))
    || typeof response.approvalToken !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(response.approvalToken)
    || typeof response.commandDigest !== 'string'
    || !/^[0-9a-f]{64}$/.test(response.commandDigest)
    || !Number.isSafeInteger(response.deadlineMs)
    || typeof response.commandId !== 'string'
    || (response.decision !== 'approve' && response.decision !== 'reject')
  ) {
    throw new RemoteError('INVALID_SCHEMA', 'approval response is invalid');
  }
  return response as RemoteApprovalResponse;
}
