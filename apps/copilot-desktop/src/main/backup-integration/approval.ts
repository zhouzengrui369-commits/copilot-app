import { createHash, randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../../shared/ipc-channels.js';
import type {
  BackupApprovalLifecycleEvent,
  BackupApprovalRequest,
  BackupApprovalResponse,
} from '../../shared/backup-management.js';

import type { BackupScope } from '../backup/index.js';
import { BackupProtocolError } from '../backup/index.js';
import { stableStringify } from '../backup/validation.js';

export type BackupApprovalAction = 'enable' | 'create' | 'upload' | 'download-verify' | 'restore-preview' | 'restore-apply' | 'delete';

export interface BackupApprovalPrompt {
  commandId: string;
  commandDigest: string;
  issuedAtMs: number;
  deadlineMs: number;
  action: BackupApprovalAction;
  scopes: readonly BackupScope[];
  objectId: string;
  bytes: number;
  sha256: string;
  generation?: number;
  previewDigest?: string | null;
  destructiveWarning: string | null;
}

export interface BackupApprovalDecision {
  commandId: string;
  commandDigest: string;
  deadlineMs: number;
  decision: 'approve' | 'deny';
  decidedAtMs: number;
}

export interface BackupApprovalPort {
  request(prompt: BackupApprovalPrompt, signal: AbortSignal): Promise<BackupApprovalDecision>;
}

export interface BackupApprovalSender {
  send(
    channel: string,
    payload: BackupApprovalRequest | BackupApprovalLifecycleEvent,
  ): void;
}

/**
 * Renderer-visible transport only. Main owns prompt generation, queue order,
 * deadline, abort and the exact bound decision.
 */
export class DesktopBackupApprovalBroker implements BackupApprovalPort {
  private readonly queue: Array<{
    prompt: BackupApprovalPrompt;
    resolve: (decision: BackupApprovalDecision) => void;
    timer: ReturnType<typeof setTimeout>;
    signal: AbortSignal;
    onAbort: () => void;
  }> = [];

  constructor(
    private readonly sender: () => BackupApprovalSender | null,
    private readonly now: () => number = Date.now,
  ) {}

  request(prompt: BackupApprovalPrompt, signal: AbortSignal): Promise<BackupApprovalDecision> {
    if (signal.aborted || this.now() >= prompt.deadlineMs) return Promise.resolve(denied(prompt, this.now()));
    if (this.queue.some((pending) => pending.prompt.commandId === prompt.commandId)) {
      return Promise.resolve(denied(prompt, this.now()));
    }
    return new Promise<BackupApprovalDecision>((resolve) => {
      const onAbort = () => this.cancel(prompt.commandId, 'cancelled');
      const timer = setTimeout(
        () => this.cancel(prompt.commandId, 'expired'),
        Math.max(0, prompt.deadlineMs - this.now()),
      );
      timer.unref?.();
      const pending = { prompt, resolve, timer, signal, onAbort };
      signal.addEventListener('abort', onAbort, { once: true });
      this.queue.push(pending);
      if (this.queue.length === 1) this.sendHead();
    });
  }

  respond(response: BackupApprovalResponse): { accepted: true } {
    const pending = this.queue[0];
    if (!pending) throw new BackupProtocolError('CONSENT_REQUIRED');
    const exact = response.commandId === pending.prompt.commandId
      && response.commandDigest === pending.prompt.commandDigest
      && response.deadlineMs === pending.prompt.deadlineMs;
    if (!exact) throw new BackupProtocolError('CONSENT_REQUIRED');
    const decidedAtMs = this.now();
    if (decidedAtMs >= pending.prompt.deadlineMs || pending.signal.aborted) {
      this.finishHead('expired', 'deny', decidedAtMs);
      throw new BackupProtocolError('CONSENT_EXPIRED');
    }
    this.finishHead('resolved', response.decision, decidedAtMs);
    return { accepted: true };
  }

  cancelAll(): void {
    while (this.queue.length > 0) this.finishHead('cancelled', 'deny', this.now());
  }

  private cancel(commandId: string, state: BackupApprovalLifecycleEvent['state']): void {
    const index = this.queue.findIndex((pending) => pending.prompt.commandId === commandId);
    if (index < 0) return;
    const [pending] = this.queue.splice(index, 1);
    this.settle(pending!, state, 'deny', this.now());
    if (index === 0) this.sendHead();
  }

  private finishHead(
    state: BackupApprovalLifecycleEvent['state'],
    decision: BackupApprovalResponse['decision'] | 'deny',
    decidedAtMs: number,
  ): void {
    const pending = this.queue.shift();
    if (!pending) return;
    this.settle(pending, state, decision, decidedAtMs);
    this.sendHead();
  }

  private settle(
    pending: (typeof this.queue)[number],
    state: BackupApprovalLifecycleEvent['state'],
    decision: BackupApprovalResponse['decision'] | 'deny',
    decidedAtMs: number,
  ): void {
    clearTimeout(pending.timer);
    pending.signal.removeEventListener('abort', pending.onAbort);
    this.sendLifecycle(pending.prompt.commandId, state);
    pending.resolve({
      commandId: pending.prompt.commandId,
      commandDigest: pending.prompt.commandDigest,
      deadlineMs: pending.prompt.deadlineMs,
      decision: decision === 'approve' ? 'approve' : 'deny',
      decidedAtMs,
    });
  }

  private sendHead(): void {
    const pending = this.queue[0];
    if (!pending) return;
    const target = this.sender();
    if (!target) {
      this.finishHead('cancelled', 'deny', this.now());
      return;
    }
    try {
      target.send(IPC_CHANNELS.BACKUP_APPROVAL_REQUEST, {
        commandId: pending.prompt.commandId,
        commandDigest: pending.prompt.commandDigest,
        issuedAtMs: pending.prompt.issuedAtMs,
        deadlineMs: pending.prompt.deadlineMs,
        action: pending.prompt.action,
        scopes: [...pending.prompt.scopes],
        objectId: pending.prompt.objectId,
        bytes: pending.prompt.bytes,
        sha256: pending.prompt.sha256,
        generation: pending.prompt.generation,
        previewDigest: pending.prompt.previewDigest ?? null,
        destructiveWarning: pending.prompt.destructiveWarning,
      });
    } catch {
      this.finishHead('cancelled', 'deny', this.now());
    }
  }

  private sendLifecycle(commandId: string, state: BackupApprovalLifecycleEvent['state']): void {
    try {
      this.sender()?.send(IPC_CHANNELS.BACKUP_APPROVAL_LIFECYCLE, { commandId, state });
    } catch {
      // UI lifecycle is non-authoritative; main already settled the prompt.
    }
  }
}

export class BackupApprovalGate {
  private readonly usedCommandIds = new Set<string>();

  constructor(
    private readonly port: BackupApprovalPort,
    private readonly now: () => number = Date.now,
    private readonly commandId: () => string = randomUUID,
  ) {}

  async approve(
    intent: Omit<BackupApprovalPrompt, 'commandId' | 'commandDigest' | 'issuedAtMs' | 'deadlineMs'>,
    signal: AbortSignal,
  ): Promise<BackupApprovalPrompt> {
    if (signal.aborted) throw new BackupProtocolError('BACKUP_DISABLED');
    const issuedAtMs = this.now();
    const commandId = this.commandId();
    const deadlineMs = issuedAtMs + 60_000;
    const commandDigest = createHash('sha256').update(stableStringify({
      commandId, issuedAtMs, deadlineMs, ...intent,
    })).digest('hex');
    const prompt: BackupApprovalPrompt = Object.freeze({ commandId, commandDigest, issuedAtMs, deadlineMs, ...intent });
    const decision = await raceAbort(this.port.request(prompt, signal), signal);
    if (this.usedCommandIds.has(decision.commandId)) throw new BackupProtocolError('CONSENT_REQUIRED');
    this.usedCommandIds.add(decision.commandId);
    if (
      decision.commandId !== commandId
      || decision.commandDigest !== commandDigest
      || decision.deadlineMs !== deadlineMs
      || decision.decision !== 'approve'
    ) throw new BackupProtocolError('CONSENT_REQUIRED');
    const now = this.now();
    if (
      now >= deadlineMs
      || decision.decidedAtMs < issuedAtMs
      || decision.decidedAtMs >= deadlineMs
    ) throw new BackupProtocolError('CONSENT_EXPIRED');
    if (signal.aborted) throw new BackupProtocolError('BACKUP_DISABLED');
    return prompt;
  }
}

function denied(prompt: BackupApprovalPrompt, now: number): BackupApprovalDecision {
  return { commandId: prompt.commandId, commandDigest: prompt.commandDigest, deadlineMs: prompt.deadlineMs, decision: 'deny', decidedAtMs: now };
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new BackupProtocolError('BACKUP_DISABLED'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new BackupProtocolError('BACKUP_DISABLED'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
