import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  RemoteApprovalRequest,
  RemoteCommand,
  RemoteCommandStatus,
  RemoteEnvelope,
  RemoteExecutionAck,
  RemoteTerminalCode,
} from '../../shared/remote-management.js';
import {
  controllerApprovalBindingDigest,
  envelopeSignatureBytes,
  parseDecryptedCommand,
  parseRemoteEnvelope,
  RemoteError,
  stableJson,
} from './protocol.js';
import {
  opaqueHash,
  riskForAction,
  type RemoteAuditEntry,
  type RemoteAuditEvent,
  type RemoteAuditStore,
  type RemoteCommandIdentity,
} from './audit.js';

export interface RemoteReplyContext {
  readonly [key: string]: unknown;
}

export interface RemoteCryptoPort {
  verifyAndDecrypt(envelope: RemoteEnvelope): Promise<{
    command: unknown;
    replyContext: RemoteReplyContext;
  }>;
  encryptReply(value: unknown, context: RemoteReplyContext): Promise<string>;
  clearSession(): void | Promise<void>;
}

export interface RemoteDesktopSignerPort {
  signAck(bytes: Buffer): Promise<string>;
  clearSession(): void | Promise<void>;
}

export interface RemoteLocalPreview {
  currentRevision: string | null;
  proposedFields: Record<string, unknown>;
  diff: Array<{ field: string; before: unknown; after: unknown }>;
}

export interface RemoteLocalResult {
  code: 'EXECUTED' | 'ACTION_NOT_ALLOWED' | 'REVISION_CONFLICT' | 'LOCAL_EXECUTION_FAILED';
  preRevision: string | null;
  postRevision: string | null;
  result?: unknown;
}

export interface RemoteLocalAdapter {
  preview(command: RemoteCommand): Promise<RemoteLocalPreview>;
  execute(command: RemoteCommand): Promise<RemoteLocalResult>;
}

export interface RemoteApprovalPort {
  request(request: Omit<RemoteApprovalRequest, 'approvalToken' | 'deadlineMs'>): Promise<boolean>;
  cancelAll(): void;
}

interface RemoteCommandEngineOptions {
  ownerId: string;
  controllerId: string;
  targetId: string;
  sessionId: string;
  crypto: RemoteCryptoPort;
  signer: RemoteDesktopSignerPort;
  local: RemoteLocalAdapter;
  audit: RemoteAuditStore;
  approval: RemoteApprovalPort;
  clock?: () => number;
}

export class RemoteCommandEngine {
  private readonly replay = new Map<string, number>();
  private readonly clock: () => number;
  private readonly activeWork = new Set<Promise<RemoteExecutionAck>>();
  private readonly inFlight = new Map<string, {
    promise: Promise<RemoteCommandStatus | null>;
    resolve: (status: RemoteCommandStatus | null) => void;
  }>();
  private readonly mutationMutex = new AsyncMutex();
  private generation = 0;
  private accepting = true;

  constructor(private readonly options: RemoteCommandEngineOptions) {
    this.clock = options.clock ?? Date.now;
  }

  process(raw: string): Promise<RemoteExecutionAck> {
    if (!this.accepting) {
      return Promise.resolve({
        commandId: safeUuidFromRaw(raw, 'commandId'),
        requestId: safeUuidFromRaw(raw, 'requestId'),
        code: 'SESSION_EXPIRED',
        retryable: false,
      });
    }
    const generation = this.generation;
    let tracked!: Promise<RemoteExecutionAck>;
    tracked = this.processInternal(raw, generation).finally(() => this.activeWork.delete(tracked));
    this.activeWork.add(tracked);
    return tracked;
  }

  enableSession(): void {
    this.generation += 1;
    this.accepting = true;
    this.replay.clear();
  }

  private async processInternal(raw: string, generation: number): Promise<RemoteExecutionAck> {
    const startedAt = this.clock();
    let envelope: RemoteEnvelope | null = null;
    let identity: RemoteCommandIdentity | null = null;
    let waiter: { resolve: (status: RemoteCommandStatus | null) => void } | null = null;
    try {
      envelope = parseRemoteEnvelope(raw, startedAt);
      this.assertBinding(envelope);
      await this.audit('remote.command.received', envelope, null, null, null, null, startedAt);
      this.assertGeneration(generation);
      const replayKey = [envelope.ownerId, envelope.controllerId, envelope.targetId, envelope.nonce].join(':');
      for (const [key, expiresAt] of this.replay) {
        if (expiresAt < startedAt) this.replay.delete(key);
      }
      if (this.replay.has(replayKey)) throw new RemoteError('NONCE_REPLAYED', 'remote nonce was already used');
      this.replay.set(replayKey, envelope.expiresAtMs + 30_000);

      const decrypted = await this.options.crypto.verifyAndDecrypt(envelope).catch((error: unknown) => {
        if (error instanceof RemoteError) throw error;
        throw new RemoteError('DECRYPT_FAILED', 'remote payload could not be decrypted');
      });
      this.assertGeneration(generation);
      const command = parseDecryptedCommand(decrypted.command, envelope);
      const inputDigest = createHash('sha256').update(stableJson(command.input)).digest('hex');
      await this.audit('remote.command.validated', envelope, command, inputDigest, null, null, startedAt);
      this.assertGeneration(generation);

      if (command.action === 'command.status') {
        const prior = await this.options.audit.findTerminalByCommandId(String(command.input.commandId));
        const code = prior?.terminalCode ?? 'LOCAL_EXECUTION_FAILED';
        return this.reply(envelope, code, inputDigest, prior?.preRevision ?? null, prior?.postRevision ?? null,
          decrypted.replyContext, prior ? { status: prior } : {}, false, startedAt);
      }

      this.assertAiApproval(command, envelope);
      const idempotencyHash = opaqueHash(command.idempotencyKey) as string;
      identity = { commandId: envelope.commandId, inputDigest, idempotencyHash };
      const reservation = this.options.audit.reserve(identity);
      if (reservation.kind === 'conflict') {
        return this.reply(envelope, 'DUPLICATE_COMMAND', inputDigest, null, null,
          decrypted.replyContext, {}, false, startedAt);
      }
      if (reservation.kind === 'terminal') {
        return this.reply(envelope, 'DUPLICATE_COMMAND', inputDigest,
          reservation.status.preRevision, reservation.status.postRevision,
          decrypted.replyContext, { status: reservation.status }, false, startedAt);
      }
      if (reservation.kind === 'pending') {
        const active = this.inFlight.get(reservation.record.idempotencyHash);
        const terminal = active ? await active.promise : null;
        const persisted = terminal
          ?? await this.options.audit.findTerminalByIdempotencyHash(reservation.record.idempotencyHash);
        return this.reply(envelope, 'DUPLICATE_COMMAND', inputDigest,
          persisted?.preRevision ?? null, persisted?.postRevision ?? null,
          decrypted.replyContext, persisted ? { status: persisted } : {}, false, startedAt);
      }

      const deferred = createDeferred<RemoteCommandStatus | null>();
      waiter = deferred;
      this.inFlight.set(idempotencyHash, deferred);

      const preview = await this.options.local.preview(command).catch(() => {
        throw new RemoteError('LOCAL_EXECUTION_FAILED', 'local preview failed');
      });
      this.assertGeneration(generation);
      if (command.expectedRevision !== null && preview.currentRevision !== command.expectedRevision) {
        return await this.finishTerminal(identity, envelope, command, 'remote.command.conflict', 'REVISION_CONFLICT',
          inputDigest, preview.currentRevision, null, decrypted.replyContext, {}, startedAt);
      }

      const approvalRequest = this.toApprovalRequest(envelope, command, preview);
      await this.audit('remote.approval_prompted', envelope, command, inputDigest, preview.currentRevision, null, startedAt);
      const approved = await this.options.approval.request(approvalRequest);
      this.assertGeneration(generation);
      if (this.clock() > envelope.expiresAtMs) {
        return await this.finishTerminal(identity, envelope, command, 'remote.command.expired', 'APPROVAL_EXPIRED',
          inputDigest, preview.currentRevision, null, decrypted.replyContext, {}, startedAt);
      }
      if (!approved) {
        return await this.finishTerminal(identity, envelope, command, 'remote.command.rejected', 'APPROVAL_REJECTED',
          inputDigest, preview.currentRevision, null, decrypted.replyContext, {}, startedAt);
      }
      await this.audit('remote.command.approved', envelope, command, inputDigest, preview.currentRevision, null, startedAt);
      this.assertGeneration(generation);
      const execute = async (): Promise<RemoteLocalResult> => {
        this.assertGeneration(generation);
        await this.audit('remote.execution_started', envelope as RemoteEnvelope, command, inputDigest,
          preview.currentRevision, null, startedAt);
        this.assertGeneration(generation);
        return this.options.local.execute(command).catch((): RemoteLocalResult => ({
          code: 'LOCAL_EXECUTION_FAILED',
          preRevision: preview.currentRevision,
          postRevision: null,
        }));
      };
      const result = isMutation(command.action)
        ? await this.mutationMutex.runExclusive(execute)
        : await execute();
      const event: RemoteAuditEvent = result.code === 'EXECUTED'
        ? 'remote.command.executed'
        : result.code === 'REVISION_CONFLICT'
          ? 'remote.command.conflict'
          : 'remote.command.failed';
      return await this.finishTerminal(identity, envelope, command, event, result.code, inputDigest,
        result.preRevision, result.postRevision, decrypted.replyContext, { result: result.result }, startedAt);
    } catch (error) {
      const remote = error instanceof RemoteError
        ? error
        : new RemoteError('LOCAL_EXECUTION_FAILED', 'remote command failed');
      if (envelope && remote.code === 'COMMAND_EXPIRED') {
        await this.audit('remote.command.expired', envelope, null, null, null, null, startedAt, remote.code);
      }
      if (identity && envelope) {
        const persisted = await this.options.audit.findTerminalByCommandId(envelope.commandId);
        const status = persisted
          ?? this.statusFor(envelope.commandId, remote.code, identity.inputDigest, null, null);
        try {
          if (!persisted) this.options.audit.complete(identity, status);
          waiter?.resolve(status);
        } catch {
          waiter?.resolve(null);
        }
      }
      return {
        commandId: envelope?.commandId ?? safeUuidFromRaw(raw, 'commandId'),
        requestId: envelope?.requestId ?? safeUuidFromRaw(raw, 'requestId'),
        code: identity && envelope
          ? (await this.options.audit.findTerminalByCommandId(envelope.commandId))?.terminalCode ?? remote.code
          : remote.code,
        retryable: remote.retryable,
      };
    } finally {
      if (identity) this.inFlight.delete(identity.idempotencyHash);
    }
  }

  async recordAckSent(commandId: string, requestId: string): Promise<void> {
    await this.options.audit.append(emptyAudit('remote.ack.sent', this.clock(), commandId, requestId));
  }

  async recordAckLost(commandId: string, requestId: string): Promise<void> {
    await this.options.audit.append({
      ...emptyAudit('remote.ack.delivery_lost', this.clock(), commandId, requestId),
      terminalCode: 'ACK_DELIVERY_LOST',
    });
  }

  async disable(): Promise<void> {
    this.accepting = false;
    this.generation += 1;
    this.replay.clear();
    this.options.approval.cancelAll();
    await Promise.allSettled([...this.activeWork]);
    await this.options.crypto.clearSession();
    await this.options.signer.clearSession();
    await this.options.audit.append(emptyAudit('remote.disabled', this.clock(), null, null));
  }

  private assertBinding(envelope: RemoteEnvelope): void {
    if (envelope.ownerId !== this.options.ownerId || envelope.targetId !== this.options.targetId) {
      throw new RemoteError('TARGET_MISMATCH', 'remote target binding mismatch');
    }
    if (envelope.controllerId !== this.options.controllerId) {
      throw new RemoteError('AUTH_INVALID', 'remote controller binding mismatch');
    }
    if (envelope.sessionId !== this.options.sessionId) {
      throw new RemoteError('SESSION_EXPIRED', 'remote session binding mismatch');
    }
    if (envelope.messageType !== 'command' && envelope.messageType !== 'status_query') {
      throw new RemoteError('INVALID_SCHEMA', 'desktop accepts command/status_query only');
    }
  }

  private assertAiApproval(command: RemoteCommand, envelope: RemoteEnvelope): void {
    if (command.initiatedBy !== 'ai') return;
    const claim = command.approvalClaim;
    if (!claim) throw new RemoteError('APPROVAL_REQUIRED', 'AI command lacks controller approval');
    const approvedAtMs = claim.controllerApprovedAtMs;
    const expectedDigest = controllerApprovalBindingDigest(envelope, command);
    if (
      approvedAtMs < envelope.issuedAtMs
      || approvedAtMs > this.clock()
      || approvedAtMs > envelope.expiresAtMs
      || !constantTimeHexDigestEqual(claim.controllerApprovalDigest, expectedDigest)
    ) {
      throw new RemoteError('APPROVAL_REQUIRED', 'AI controller approval is invalid');
    }
  }

  private toApprovalRequest(
    envelope: RemoteEnvelope,
    command: RemoteCommand,
    preview: RemoteLocalPreview,
  ): Omit<RemoteApprovalRequest, 'approvalToken' | 'deadlineMs'> {
    const inputDigest = createHash('sha256').update(stableJson(command.input)).digest('hex');
    return {
      commandDigest: createHash('sha256').update(stableJson({
        ownerId: envelope.ownerId,
        controllerId: envelope.controllerId,
        targetId: envelope.targetId,
        sessionId: envelope.sessionId,
        commandId: envelope.commandId,
        action: command.action,
        resource: command.resource,
        expectedRevision: command.expectedRevision,
        idempotencyKey: command.idempotencyKey,
        inputDigest,
        expiresAtMs: envelope.expiresAtMs,
      })).digest('hex'),
      commandId: envelope.commandId,
      controllerId: envelope.controllerId,
      initiatedBy: command.initiatedBy,
      action: command.action,
      resource: command.resource,
      reason: command.reason,
      expiresAtMs: envelope.expiresAtMs,
      proposedFields: preview.proposedFields,
      diff: preview.diff,
      localTruthWarning: 'Local data remains the authoritative truth. Remote approval applies only to this command.',
      destructiveWarning: command.action.endsWith('.move_to_trash')
        ? 'Destructive confirmation: this may move the item to reversible local trash only. Permanent deletion is forbidden.'
        : null,
      approvalScope: 'single-command',
      approveAll: false,
      controllerApprovalVerified: command.initiatedBy === 'user' || Boolean(command.approvalClaim),
    };
  }

  private async reply(
    envelope: RemoteEnvelope,
    code: RemoteTerminalCode,
    inputDigest: string | null,
    preRevision: string | null,
    postRevision: string | null,
    context: RemoteReplyContext,
    detail: Record<string, unknown>,
    retryable: boolean,
    startedAt: number,
  ): Promise<RemoteExecutionAck> {
    const base: RemoteExecutionAck = {
      commandId: envelope.commandId,
      requestId: envelope.requestId,
      code,
      retryable,
      ...(detail.status ? { status: detail.status as RemoteExecutionAck['status'] } : {}),
    };
    if (!inputDigest) return base;
    try {
      const payload = {
        commandId: envelope.commandId,
        inputDigest,
        preRevision,
        postRevision,
        terminalCode: code,
        latencyMs: Math.max(0, this.clock() - startedAt),
        ...detail,
      };
      const encryptedPayload = await this.options.crypto.encryptReply(payload, context);
      if (!/^[A-Za-z0-9_-]+$/.test(encryptedPayload)) throw new Error('invalid ACK ciphertext');
      const ciphertextBytes = Buffer.from(encryptedPayload, 'base64url');
      if (ciphertextBytes.length === 0) throw new Error('empty ACK ciphertext');
      const issuedAtMs = this.clock();
      const unsigned: RemoteEnvelope = {
        schemaVersion: 1,
        messageType: envelope.messageType === 'status_query' ? 'status_reply' : 'ack',
        requestId: envelope.requestId,
        sessionId: envelope.sessionId,
        commandId: envelope.commandId,
        ownerId: envelope.ownerId,
        controllerId: envelope.controllerId,
        targetId: envelope.targetId,
        nonce: randomBytes(16).toString('base64url'),
        issuedAtMs,
        expiresAtMs: issuedAtMs + 60_000,
        payloadAlgorithm: 'X25519-HKDF-SHA256+A256GCM',
        payloadCiphertext: encryptedPayload,
        payloadSha256: createHash('sha256').update(ciphertextBytes).digest('hex'),
        // The v1 common envelope retains this legacy field name; on ACK/status
        // it contains the desktop Ed25519 signature, never a controller echo.
        controllerSignature: '',
      };
      const signature = await this.options.signer.signAck(envelopeSignatureBytes(unsigned));
      if (!/^[A-Za-z0-9_-]{43,512}$/.test(signature)) throw new Error('invalid desktop signature');
      const wireEnvelope = { ...unsigned, controllerSignature: signature };
      return { ...base, encryptedPayload, wireEnvelope };
    } catch {
      // Never construct or send an unsigned/fake ACK fallback.
      return base;
    }
  }

  private async finishTerminal(
    identity: RemoteCommandIdentity,
    envelope: RemoteEnvelope,
    command: RemoteCommand,
    event: RemoteAuditEvent,
    code: RemoteTerminalCode,
    inputDigest: string,
    preRevision: string | null,
    postRevision: string | null,
    context: RemoteReplyContext,
    detail: Record<string, unknown>,
    startedAt: number,
  ): Promise<RemoteExecutionAck> {
    const status = this.statusFor(envelope.commandId, code, inputDigest, preRevision, postRevision);
    // Durable terminal safety index is committed independently of display-audit
    // trimming. If this fails, the earlier reservation remains fail-closed.
    this.options.audit.complete(identity, status);
    this.inFlight.get(identity.idempotencyHash)?.resolve(status);
    await this.audit(event, envelope, command, inputDigest, preRevision, postRevision, startedAt, code);
    return this.reply(envelope, code, inputDigest, preRevision, postRevision, context, detail, false, startedAt);
  }

  private statusFor(
    commandId: string,
    terminalCode: RemoteTerminalCode,
    inputDigest: string,
    preRevision: string | null,
    postRevision: string | null,
  ): RemoteCommandStatus {
    return { commandId, terminalCode, inputDigest, preRevision, postRevision };
  }

  private assertGeneration(generation: number): void {
    if (!this.accepting || generation !== this.generation) {
      throw new RemoteError('SESSION_EXPIRED', 'remote session was disabled');
    }
  }

  private async audit(
    event: RemoteAuditEvent,
    envelope: RemoteEnvelope,
    command: RemoteCommand | null,
    inputDigest: string | null,
    preRevision: string | null,
    postRevision: string | null,
    startedAt: number,
    terminalCode: RemoteTerminalCode | null = null,
  ): Promise<void> {
    const entry: RemoteAuditEntry = {
      event,
      atMs: this.clock(),
      commandId: envelope.commandId,
      requestId: envelope.requestId,
      controllerHash: opaqueHash(envelope.controllerId),
      targetHash: opaqueHash(envelope.targetId),
      resourceHash: opaqueHash(command?.resource.id),
      idempotencyHash: opaqueHash(command?.idempotencyKey),
      inputDigest,
      action: command?.action ?? null,
      risk: command ? riskForAction(command.action) : null,
      terminalCode,
      preRevision,
      postRevision,
      latencyMs: Math.max(0, this.clock() - startedAt),
    };
    await this.options.audit.append(entry);
  }
}

function constantTimeHexDigestEqual(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(actual) || !/^[0-9a-f]{64}$/.test(expected)) return false;
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(actualBytes, expectedBytes);
}

function isMutation(action: RemoteCommand['action']): boolean {
  return action.endsWith('.create') || action.endsWith('.update') || action.endsWith('.move_to_trash');
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

function emptyAudit(
  event: RemoteAuditEvent,
  atMs: number,
  commandId: string | null,
  requestId: string | null,
): RemoteAuditEntry {
  return {
    event,
    atMs,
    commandId,
    requestId,
    controllerHash: null,
    targetHash: null,
    resourceHash: null,
    idempotencyHash: null,
    inputDigest: null,
    action: null,
    risk: null,
    terminalCode: null,
    preRevision: null,
    postRevision: null,
    latencyMs: null,
  };
}

function safeUuidFromRaw(raw: string, key: 'commandId' | 'requestId'): string {
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>)[key];
    return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : '';
  } catch {
    return '';
  }
}
