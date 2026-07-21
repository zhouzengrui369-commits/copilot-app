import { createHash } from 'node:crypto';
import {
  REMOTE_ACTIONS,
  type RemoteAction,
  type RemoteCommand,
  type RemoteEnvelope,
  type RemoteTerminalCode,
} from '../../shared/remote-management.js';

const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_TTL_MS = 120_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const LOGICAL_ID = /^[\p{L}\p{N}._/-]{1,240}$/u;
const NOTE_TYPES = ['article', 'note', 'meeting', 'todo', 'reference', 'idea'] as const;
const NOTE_STATUSES = ['draft', 'active', 'archived'] as const;
const TODO_STATUSES = ['pending', 'done', 'cancelled'] as const;
const TODO_PRIORITIES = ['low', 'normal', 'high'] as const;

export class RemoteError extends Error {
  constructor(
    public readonly code: RemoteTerminalCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

const ENVELOPE_KEYS = [
  'schemaVersion', 'messageType', 'requestId', 'sessionId', 'commandId',
  'ownerId', 'controllerId', 'targetId', 'nonce', 'issuedAtMs', 'expiresAtMs',
  'payloadAlgorithm', 'payloadCiphertext', 'payloadSha256', 'controllerSignature',
] as const;

const COMMAND_KEYS = [
  'action', 'initiatedBy', 'reason', 'resource', 'expectedRevision',
  'idempotencyKey', 'input', 'approvalClaim',
] as const;

export function parseRemoteEnvelope(raw: string, nowMs: number): RemoteEnvelope {
  if (Buffer.byteLength(raw, 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new RemoteError('PAYLOAD_TOO_LARGE', 'remote envelope exceeds 64 KiB');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RemoteError('INVALID_SCHEMA', 'remote envelope must be valid JSON');
  }
  const obj = strictObject(value, ENVELOPE_KEYS, 'remote envelope');
  if (obj.schemaVersion !== 1) invalid('schemaVersion must be 1');
  if (!['command', 'ack', 'status_query', 'status_reply'].includes(String(obj.messageType))) {
    invalid('messageType is invalid');
  }
  for (const key of ['requestId', 'sessionId', 'commandId'] as const) {
    if (typeof obj[key] !== 'string' || !UUID_V4.test(obj[key])) invalid(`${key} must be UUIDv4`);
  }
  for (const key of ['ownerId', 'controllerId', 'targetId'] as const) {
    if (!boundedString(obj[key], 1, 160)) invalid(`${key} is invalid`);
  }
  if (!boundedString(obj.nonce, 22, 256) || !BASE64URL.test(obj.nonce)) invalid('nonce is invalid');
  const nonceBytes = decodeBase64Url(obj.nonce as string, 'nonce');
  if (nonceBytes.byteLength < 16) invalid('nonce must contain at least 128 bits');
  if (!integer(obj.issuedAtMs) || !integer(obj.expiresAtMs)) invalid('times must be integer milliseconds');
  const issuedAtMs = obj.issuedAtMs as number;
  const expiresAtMs = obj.expiresAtMs as number;
  const ttl = expiresAtMs - issuedAtMs;
  if (ttl < 1 || ttl > MAX_TTL_MS) throw new RemoteError('TTL_INVALID', 'command TTL is invalid');
  if (issuedAtMs > nowMs + MAX_CLOCK_SKEW_MS) throw new RemoteError('TTL_INVALID', 'command issue time exceeds clock skew');
  if (expiresAtMs <= nowMs) throw new RemoteError('COMMAND_EXPIRED', 'command has expired');
  if (obj.payloadAlgorithm !== 'X25519-HKDF-SHA256+A256GCM') invalid('payload algorithm is invalid');
  if (!boundedString(obj.payloadCiphertext, 1, MAX_ENVELOPE_BYTES) || !BASE64URL.test(obj.payloadCiphertext)) {
    invalid('payloadCiphertext is invalid');
  }
  if (typeof obj.payloadSha256 !== 'string' || !HEX_64.test(obj.payloadSha256)) invalid('payloadSha256 is invalid');
  const ciphertext = decodeBase64Url(obj.payloadCiphertext as string, 'payloadCiphertext');
  const actualSha = createHash('sha256').update(ciphertext).digest('hex');
  if (actualSha !== obj.payloadSha256) invalid('payloadSha256 mismatch');
  if (!boundedString(obj.controllerSignature, 43, 512) || !BASE64URL.test(obj.controllerSignature)) {
    invalid('controllerSignature is invalid');
  }
  return obj as unknown as RemoteEnvelope;
}

export function parseDecryptedCommand(value: unknown, envelope: RemoteEnvelope): RemoteCommand {
  const obj = strictObject(value, COMMAND_KEYS, 'decrypted command', ['approvalClaim']);
  if (typeof obj.action !== 'string' || !REMOTE_ACTIONS.includes(obj.action as RemoteAction)) {
    throw new RemoteError('ACTION_NOT_ALLOWED', 'remote action is not allowlisted');
  }
  if (obj.initiatedBy !== 'user' && obj.initiatedBy !== 'ai') invalid('initiatedBy is invalid');
  if (!boundedString(obj.reason, 1, 300)) invalid('reason is required and limited to 300 chars');
  const resource = strictObject(obj.resource, ['type', 'id'], 'resource');
  if (resource.type !== 'note' && resource.type !== 'todo') invalid('resource type is invalid');
  if (resource.id !== null && !safeLogicalId(resource.id)) invalid('resource id is invalid');
  if (obj.expectedRevision !== null && !boundedString(obj.expectedRevision, 1, 160)) invalid('expectedRevision is invalid');
  if (typeof obj.idempotencyKey !== 'string' || !UUID_V4.test(obj.idempotencyKey)) invalid('idempotencyKey must be UUIDv4');
  const input = strictObject(obj.input, [], 'input', undefined, true);
  const action = obj.action as RemoteAction;
  validateResource(action, resource as { type: 'note' | 'todo'; id: string | null }, obj.expectedRevision);
  validateInput(action, input);
  if (envelope.messageType === 'status_query' && action !== 'command.status') invalid('status_query requires command.status');
  if (envelope.messageType === 'command' && action === 'command.status') invalid('command.status requires status_query');
  let approvalClaim: RemoteCommand['approvalClaim'];
  if (obj.approvalClaim !== undefined) {
    const claim = strictObject(
      obj.approvalClaim,
      ['controllerApprovedAtMs', 'controllerApprovalDigest'],
      'approvalClaim',
    );
    if (!integer(claim.controllerApprovedAtMs)) invalid('controllerApprovedAtMs is invalid');
    if (typeof claim.controllerApprovalDigest !== 'string' || !HEX_64.test(claim.controllerApprovalDigest)) {
      invalid('controllerApprovalDigest is invalid');
    }
    approvalClaim = claim as unknown as RemoteCommand['approvalClaim'];
  }
  return {
    action,
    initiatedBy: obj.initiatedBy as 'user' | 'ai',
    reason: obj.reason as string,
    resource: resource as unknown as RemoteCommand['resource'],
    expectedRevision: obj.expectedRevision as string | null,
    idempotencyKey: obj.idempotencyKey as string,
    input,
    ...(approvalClaim ? { approvalClaim } : {}),
  };
}

export function commandApprovalDigest(command: RemoteCommand): string {
  return createHash('sha256').update(stableJson({
    action: command.action,
    initiatedBy: command.initiatedBy,
    reason: command.reason,
    resource: command.resource,
    expectedRevision: command.expectedRevision,
    idempotencyKey: command.idempotencyKey,
    input: command.input,
  })).digest('hex');
}

/**
 * Canonical controller-side Execute-with-approval binding. The inner command
 * digest excludes the claim itself; the outer fields prevent a valid claim
 * from being replayed across another owner/controller/desktop/session/request,
 * command, ciphertext, or validity window.
 */
export function controllerApprovalBindingDigest(
  envelope: RemoteEnvelope,
  command: RemoteCommand,
): string {
  return createHash('sha256').update(stableJson({
    schemaVersion: envelope.schemaVersion,
    messageType: envelope.messageType,
    ownerId: envelope.ownerId,
    controllerId: envelope.controllerId,
    targetId: envelope.targetId,
    sessionId: envelope.sessionId,
    requestId: envelope.requestId,
    commandId: envelope.commandId,
    payloadSha256: envelope.payloadSha256,
    issuedAtMs: envelope.issuedAtMs,
    expiresAtMs: envelope.expiresAtMs,
    action: command.action,
    resource: command.resource,
    expectedRevision: command.expectedRevision,
    idempotencyKey: command.idempotencyKey,
    commandDigest: commandApprovalDigest(command),
  })).digest('hex');
}

export function envelopeSignatureBytes(envelope: RemoteEnvelope): Buffer {
  return Buffer.from(stableJson({
    schemaVersion: envelope.schemaVersion,
    messageType: envelope.messageType,
    requestId: envelope.requestId,
    sessionId: envelope.sessionId,
    commandId: envelope.commandId,
    ownerId: envelope.ownerId,
    controllerId: envelope.controllerId,
    targetId: envelope.targetId,
    nonce: envelope.nonce,
    issuedAtMs: envelope.issuedAtMs,
    expiresAtMs: envelope.expiresAtMs,
    payloadAlgorithm: envelope.payloadAlgorithm,
    payloadSha256: envelope.payloadSha256,
  }), 'utf8');
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
}

function validateResource(
  action: RemoteAction,
  resource: { type: 'note' | 'todo'; id: string | null },
  expectedRevision: unknown,
): void {
  if (action === 'command.status') return;
  const expectedType = action.startsWith('note.') ? 'note' : 'todo';
  if (resource.type !== expectedType) invalid('resource type does not match action');
  const createOrList = action.endsWith('.create') || action.endsWith('.list');
  if (createOrList && resource.id !== null) invalid('create/list resource id must be null');
  if (!createOrList && resource.id === null) invalid('resource id is required');
  const revisionRequired = action.endsWith('.update') || action.endsWith('.move_to_trash');
  if (revisionRequired && !boundedString(expectedRevision, 1, 160)) invalid('expectedRevision is required');
  if (!revisionRequired && expectedRevision !== null) invalid('expectedRevision must be null for this action');
}

function validateInput(action: RemoteAction, input: Record<string, unknown>): void {
  switch (action) {
    case 'note.list':
      allowOnly(input, ['query', 'type', 'status', 'folder', 'tags', 'limit', 'offset'], 'note.list input');
      optionalBoundedStrings(input, ['query', 'folder'], 240);
      optionalEnum(input.type, NOTE_TYPES, 'type');
      optionalEnum(input.status, NOTE_STATUSES, 'status');
      optionalStringArray(input.tags, 32, 80, 'tags');
      optionalInteger(input.limit, 1, 100, 'limit');
      optionalInteger(input.offset, 0, 100_000, 'offset');
      return;
    case 'note.read':
    case 'todo.read':
    case 'note.move_to_trash':
    case 'todo.move_to_trash':
      allowOnly(input, [], `${action} input`);
      return;
    case 'note.create':
      allowOnly(input, ['path', 'title', 'body', 'tags', 'type', 'status', 'related'], 'note.create input');
      if (!safeLogicalId(input.path)) invalid('note path is invalid');
      requiredString(input.title, 1, 240, 'title');
      if (!Object.prototype.hasOwnProperty.call(input, 'body')) invalid('body is required');
      requiredString(input.body, 0, 32_000, 'body');
      if (!Object.prototype.hasOwnProperty.call(input, 'tags')) invalid('tags is required');
      requiredStringArray(input.tags, 64, 120, 'tags');
      optionalLogicalIdArray(input.related, 64, 'related');
      optionalEnum(input.type, NOTE_TYPES, 'type', true);
      optionalEnum(input.status, NOTE_STATUSES, 'status', true);
      return;
    case 'note.update': {
      allowOnly(input, ['patch'], 'note.update input');
      if (!('patch' in input)) invalid('note.update input is missing patch');
      const patch = strictObject(input.patch, [], 'note patch', undefined, true);
      allowOnly(patch, ['title', 'body', 'tags', 'type', 'status', 'related'], 'note patch');
      if (Object.keys(patch).length === 0) invalid('note patch is empty');
      optionalString(patch.title, 240, 'title');
      optionalString(patch.body, 32_000, 'body');
      optionalStringArray(patch.tags, 64, 120, 'tags');
      optionalLogicalIdArray(patch.related, 64, 'related');
      optionalEnum(patch.type, NOTE_TYPES, 'type', true);
      optionalEnum(patch.status, NOTE_STATUSES, 'status', true);
      return;
    }
    case 'todo.list':
      allowOnly(input, ['status', 'fromMs', 'toMs'], 'todo.list input');
      optionalEnum(input.status, TODO_STATUSES, 'status');
      optionalInteger(input.fromMs, 0, Number.MAX_SAFE_INTEGER, 'fromMs');
      optionalInteger(input.toMs, 0, Number.MAX_SAFE_INTEGER, 'toMs');
      return;
    case 'todo.create':
      allowOnly(input, ['title', 'body', 'due_at_ms', 'remind_at_ms', 'status', 'priority', 'note_links'], 'todo.create input');
      requiredString(input.title, 1, 240, 'title');
      optionalString(input.body, 8_000, 'body');
      optionalTodoFields(input);
      return;
    case 'todo.update': {
      allowOnly(input, ['patch'], 'todo.update input');
      if (!('patch' in input)) invalid('todo.update input is missing patch');
      const patch = strictObject(input.patch, [], 'todo patch', undefined, true);
      allowOnly(patch, ['title', 'body', 'due_at_ms', 'remind_at_ms', 'status', 'priority', 'note_links', 'reminder_fired'], 'todo patch');
      if (Object.keys(patch).length === 0) invalid('todo patch is empty');
      optionalString(patch.title, 240, 'title');
      optionalString(patch.body, 8_000, 'body');
      optionalTodoFields(patch);
      if (patch.reminder_fired !== undefined && patch.reminder_fired !== 0 && patch.reminder_fired !== 1) invalid('reminder_fired is invalid');
      return;
    }
    case 'command.status':
      allowOnly(input, ['commandId'], 'command.status input');
      if (typeof input.commandId !== 'string' || !UUID_V4.test(input.commandId)) invalid('command.status commandId is invalid');
      return;
  }
}

function optionalTodoFields(input: Record<string, unknown>): void {
  optionalInteger(input.due_at_ms, 0, Number.MAX_SAFE_INTEGER, 'due_at_ms', true);
  optionalInteger(input.remind_at_ms, 0, Number.MAX_SAFE_INTEGER, 'remind_at_ms', true);
  optionalEnum(input.status, TODO_STATUSES, 'status');
  optionalEnum(input.priority, TODO_PRIORITIES, 'priority');
  optionalLogicalIdArray(input.note_links, 64, 'note_links');
}

function strictObject(
  value: unknown,
  allowed: readonly string[],
  label: string,
  optional: readonly string[] = [],
  deferKeys = false,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
  const obj = value as Record<string, unknown>;
  if (!deferKeys) strictKeys(obj, allowed, label, optional);
  return obj;
}

function strictKeys(obj: Record<string, unknown>, allowed: readonly string[], label: string, optional: readonly string[] = []): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) if (!allowedSet.has(key)) invalid(`${label} has unknown field`);
  for (const key of allowed) if (!optional.includes(key) && !(key in obj)) invalid(`${label} is missing field`);
}

function allowOnly(obj: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(obj)) if (!allowedSet.has(key)) invalid(`${label} has unknown field`);
}

function safeLogicalId(value: unknown): value is string {
  if (typeof value !== 'string' || !LOGICAL_ID.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return false;
  return !value.split('/').some((part) => part === '..' || part === '');
}

function requiredString(value: unknown, min: number, max: number, label: string): void {
  if (!boundedString(value, min, max)) invalid(`${label} is invalid`);
}

function optionalString(value: unknown, max: number, label: string): void {
  if (value !== undefined && !boundedString(value, 0, max)) invalid(`${label} is invalid`);
}

function optionalBoundedStrings(obj: Record<string, unknown>, keys: readonly string[], max: number): void {
  for (const key of keys) optionalString(obj[key], max, key);
}

function optionalStringArray(value: unknown, maxItems: number, maxLength: number, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => !boundedString(item, 1, maxLength))) {
    invalid(`${label} is invalid`);
  }
}

function requiredStringArray(value: unknown, maxItems: number, maxLength: number, label: string): void {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => !boundedString(item, 1, maxLength))) {
    invalid(`${label} is invalid`);
  }
}

function optionalLogicalIdArray(value: unknown, maxItems: number, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => !safeLogicalId(item))) {
    invalid(`${label} is invalid`);
  }
}

function optionalEnum(
  value: unknown,
  allowed: readonly string[],
  label: string,
  allowNull = false,
): void {
  if (value === undefined || (allowNull && value === null)) return;
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(`${label} is invalid`);
}

function optionalInteger(value: unknown, min: number, max: number, label: string, allowNull = false): void {
  if (value === undefined || (allowNull && value === null)) return;
  if (!integer(value) || (value as number) < min || (value as number) > max) invalid(`${label} is invalid`);
}

function boundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function decodeBase64Url(value: string, label: string): Buffer {
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length === 0) invalid(`${label} is invalid`);
    return decoded;
  } catch {
    invalid(`${label} is invalid`);
  }
}

function invalid(message: string): never {
  throw new RemoteError('INVALID_SCHEMA', message);
}
