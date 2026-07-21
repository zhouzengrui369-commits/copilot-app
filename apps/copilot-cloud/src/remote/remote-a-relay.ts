/**
 * Phase 1 Remote A: online-only opaque WebSocket relay.
 *
 * This module intentionally owns no queue, database, object storage, retry,
 * command history, payload decryption, or backup behavior. Production defaults
 * OFF and both auth/signature verifiers deny unless explicitly wired.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';

export const REMOTE_ENVELOPE_MAX_BYTES = 64 * 1024;
export const REMOTE_IDLE_TTL_MS = 15 * 60_000;
export const REMOTE_HARD_TTL_MS = 8 * 60 * 60_000;
export const REMOTE_MAX_COMMAND_TTL_MS = 120_000;
export const REMOTE_MAX_CLOCK_SKEW_MS = 30_000;
export const REMOTE_VERIFY_TIMEOUT_DEFAULT_MS = 2_000;
export const REMOTE_VERIFY_TIMEOUT_MAX_MS = 5_000;
const REPLAY_RETENTION_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_MESSAGE_RATE_LIMIT = 120;
const WS_OPEN = 1;
const ALGORITHM = 'X25519-HKDF-SHA256+A256GCM';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ENVELOPE_FIELDS = new Set([
  'schemaVersion',
  'messageType',
  'requestId',
  'sessionId',
  'commandId',
  'ownerId',
  'controllerId',
  'targetId',
  'nonce',
  'issuedAtMs',
  'expiresAtMs',
  'payloadAlgorithm',
  'payloadCiphertext',
  'payloadSha256',
  'controllerSignature',
]);

export type RemoteMessageType = 'command' | 'ack' | 'status_query' | 'status_reply';
export type RemoteRole = 'controller' | 'target';
export type RemoteErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'SESSION_EXPIRED'
  | 'TARGET_OFFLINE'
  | 'TARGET_MISMATCH'
  | 'INVALID_SCHEMA'
  | 'PAYLOAD_TOO_LARGE'
  | 'TTL_INVALID'
  | 'COMMAND_EXPIRED'
  | 'NONCE_REPLAYED'
  | 'SIGNATURE_INVALID'
  | 'SIGNATURE_TIMEOUT'
  | 'VERIFY_TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'ACTION_NOT_ALLOWED'
  | 'ACK_DELIVERY_LOST';

export interface RemoteEnvelope {
  schemaVersion: 1;
  messageType: RemoteMessageType;
  requestId: string;
  sessionId: string;
  commandId: string;
  ownerId: string;
  controllerId: string;
  targetId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  payloadAlgorithm: typeof ALGORITHM;
  payloadCiphertext: string;
  payloadSha256: string;
  controllerSignature: string;
}

export interface RemoteSocketBinding {
  role: RemoteRole;
  ownerId: string;
  principalId: string;
  sessionId: string;
}

export interface RemoteAuthInput extends RemoteSocketBinding {
  authorization: string;
}

export interface RemoteSignatureInput {
  schemaVersion: 1;
  messageType: RemoteMessageType;
  requestId: string;
  sessionId: string;
  commandId: string;
  ownerId: string;
  controllerId: string;
  targetId: string;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  payloadAlgorithm: typeof ALGORITHM;
  payloadSha256: string;
  signerRole: RemoteRole;
  signerId: string;
}

export interface RemoteRelayOptions {
  authVerifier?: (input: RemoteAuthInput) => boolean | Promise<boolean>;
  signatureVerifier?: (
    input: RemoteSignatureInput,
    signature: string,
  ) => boolean | Promise<boolean>;
  transportVerifier?: (request: IncomingMessage) => boolean;
  clock?: () => number;
  sweepIntervalMs?: number;
  messageRateLimit?: number;
  authVerifyTimeoutMs?: number;
  signatureVerifyTimeoutMs?: number;
}

interface WebSocketLike {
  readonly readyState: number;
  send(data: string | Buffer, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: string, listener: (...args: any[]) => void): this;
}

interface WebSocketServerLike {
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (socket: WebSocketLike) => void,
  ): void;
  close(callback?: (error?: Error) => void): void;
}

interface WebSocketModule {
  WebSocketServer: new (options: {
    noServer: true;
    maxPayload: number;
    perMessageDeflate: boolean;
  }) => WebSocketServerLike;
}

interface SocketRecord {
  socket: WebSocketLike;
  binding: RemoteSocketBinding;
  generation: number;
  connectedAtMs: number;
  lastActivityMs: number;
}

interface RateRecord {
  windowStartedAtMs: number;
  count: number;
}

type EnvelopeResult =
  | { ok: true; envelope: RemoteEnvelope }
  | { ok: false; code: RemoteErrorCode; requestId: string };

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws') as WebSocketModule;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function decodeCanonicalBase64Url(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !BASE64URL.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length > 0 && decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
}

function safeDigestEqual(actual: string, expected: string): boolean {
  if (!SHA256_HEX.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function safeRequestId(value: unknown): string {
  return typeof value === 'string' && UUID_V4.test(value) ? value : randomUUID();
}

/** Pure envelope boundary used by the relay and hermetic cross-workspace contract tests. */
export function parseRemoteRelayEnvelope(raw: Buffer, now: number): EnvelopeResult {
  if (raw.byteLength > REMOTE_ENVELOPE_MAX_BYTES) {
    return { ok: false, code: 'PAYLOAD_TOO_LARGE', requestId: randomUUID() };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, code: 'INVALID_SCHEMA', requestId: randomUUID() };
  }
  if (!isRecord(value)) {
    return { ok: false, code: 'INVALID_SCHEMA', requestId: randomUUID() };
  }
  const requestId = safeRequestId(value.requestId);
  if (
    Object.keys(value).length !== ENVELOPE_FIELDS.size ||
    Object.keys(value).some((field) => !ENVELOPE_FIELDS.has(field)) ||
    value.schemaVersion !== 1 ||
    !['command', 'ack', 'status_query', 'status_reply'].includes(String(value.messageType)) ||
    !UUID_V4.test(String(value.requestId)) ||
    !UUID_V4.test(String(value.sessionId)) ||
    !UUID_V4.test(String(value.commandId)) ||
    !OPAQUE_ID.test(String(value.ownerId)) ||
    !OPAQUE_ID.test(String(value.controllerId)) ||
    !OPAQUE_ID.test(String(value.targetId)) ||
    value.payloadAlgorithm !== ALGORITHM ||
    typeof value.payloadSha256 !== 'string' ||
    !SHA256_HEX.test(value.payloadSha256) ||
    !Number.isSafeInteger(value.issuedAtMs) ||
    !Number.isSafeInteger(value.expiresAtMs)
  ) {
    return { ok: false, code: 'INVALID_SCHEMA', requestId };
  }

  const nonce = decodeCanonicalBase64Url(value.nonce);
  const ciphertext = decodeCanonicalBase64Url(value.payloadCiphertext);
  const signature = decodeCanonicalBase64Url(value.controllerSignature);
  if (!nonce || nonce.byteLength < 16 || !ciphertext || !signature || signature.byteLength !== 64) {
    return { ok: false, code: 'INVALID_SCHEMA', requestId };
  }
  const digest = createHash('sha256').update(ciphertext).digest('hex');
  if (!safeDigestEqual(digest, value.payloadSha256)) {
    return { ok: false, code: 'INVALID_SCHEMA', requestId };
  }

  const issuedAtMs = value.issuedAtMs as number;
  const expiresAtMs = value.expiresAtMs as number;
  const ttlMs = expiresAtMs - issuedAtMs;
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 1 ||
    ttlMs > REMOTE_MAX_COMMAND_TTL_MS ||
    issuedAtMs > now + REMOTE_MAX_CLOCK_SKEW_MS
  ) {
    return { ok: false, code: 'TTL_INVALID', requestId };
  }
  if (expiresAtMs <= now) {
    return { ok: false, code: 'COMMAND_EXPIRED', requestId };
  }

  return { ok: true, envelope: value as unknown as RemoteEnvelope };
}

function controllerKey(ownerId: string, controllerId: string, sessionId: string): string {
  return `${ownerId}\u0000${controllerId}\u0000${sessionId}`;
}

function targetKey(ownerId: string, targetId: string, sessionId: string): string {
  return `${ownerId}\u0000${targetId}\u0000${sessionId}`;
}

function replayKey(envelope: RemoteEnvelope): string {
  return [
    envelope.ownerId,
    envelope.controllerId,
    envelope.targetId,
    envelope.nonce,
  ].join('\u0000');
}

function rateKey(binding: RemoteSocketBinding): string {
  return [binding.role, binding.ownerId, binding.principalId, binding.sessionId].join('\u0000');
}

function retryable(code: RemoteErrorCode): boolean {
  return [
    'TARGET_OFFLINE',
    'RATE_LIMITED',
    'SERVICE_UNAVAILABLE',
    'ACK_DELIVERY_LOST',
    'SIGNATURE_TIMEOUT',
    'VERIFY_TIMEOUT',
  ].includes(code);
}

function sendError(socket: WebSocketLike, requestId: string, code: RemoteErrorCode): void {
  if (socket.readyState !== WS_OPEN) return;
  socket.send(JSON.stringify({
    error: 'remote_relay_error',
    code,
    requestId,
    retryable: retryable(code),
  }));
}

function rejectUpgrade(
  socket: Duplex,
  statusCode: number,
  code: RemoteErrorCode,
): void {
  const reason = statusCode === 401
    ? 'Unauthorized'
    : statusCode === 426
      ? 'Upgrade Required'
      : statusCode === 503
        ? 'Service Unavailable'
        : 'Bad Request';
  const body = JSON.stringify({
    error: 'remote_relay_rejected',
    code,
    requestId: randomUUID(),
    retryable: retryable(code),
  });
  socket.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n\r\n' +
    body,
  );
  socket.destroy();
}

function parseBinding(request: IncomingMessage):
  | { ok: true; binding: RemoteSocketBinding; authorization: string }
  | { ok: false; code: RemoteErrorCode } {
  const authorization = headerValue(request, 'authorization');
  if (!authorization) return { ok: false, code: 'AUTH_REQUIRED' };
  if (!authorization.startsWith('Bearer ') || authorization.slice(7).trim().length === 0) {
    return { ok: false, code: 'AUTH_INVALID' };
  }
  const role = headerValue(request, 'x-remote-role');
  const ownerId = headerValue(request, 'x-owner-id');
  const sessionId = headerValue(request, 'x-session-id');
  const controllerId = headerValue(request, 'x-controller-id');
  const targetId = headerValue(request, 'x-target-id');
  if (
    (role !== 'controller' && role !== 'target') ||
    !ownerId ||
    !OPAQUE_ID.test(ownerId) ||
    !sessionId ||
    !UUID_V4.test(sessionId)
  ) {
    return { ok: false, code: 'INVALID_SCHEMA' };
  }
  if (role === 'controller' && (!controllerId || !OPAQUE_ID.test(controllerId) || targetId)) {
    return { ok: false, code: 'INVALID_SCHEMA' };
  }
  if (role === 'target' && (!targetId || !OPAQUE_ID.test(targetId) || controllerId)) {
    return { ok: false, code: 'INVALID_SCHEMA' };
  }
  return {
    ok: true,
    authorization,
    binding: {
      role,
      ownerId,
      principalId: role === 'controller' ? controllerId! : targetId!,
      sessionId,
    },
  };
}

function directTlsOnly(request: IncomingMessage): boolean {
  return (request.socket as TLSSocket).encrypted === true;
}

export class RemoteRelayMemoryState {
  private readonly controllers = new Map<string, SocketRecord>();
  private readonly targets = new Map<string, SocketRecord>();
  private readonly replay = new Map<string, number>();
  private readonly pendingReplay = new Set<string>();
  private readonly rates = new Map<string, RateRecord>();
  private nextGeneration = 1;

  constructor(
    private readonly clock: () => number,
    private readonly messageRateLimit: number,
  ) {}

  attach(socket: WebSocketLike, binding: RemoteSocketBinding): SocketRecord {
    const now = this.clock();
    const record = {
      socket,
      binding,
      generation: this.nextGeneration,
      connectedAtMs: now,
      lastActivityMs: now,
    };
    this.nextGeneration += 1;
    const map = binding.role === 'controller' ? this.controllers : this.targets;
    const key = binding.role === 'controller'
      ? controllerKey(binding.ownerId, binding.principalId, binding.sessionId)
      : targetKey(binding.ownerId, binding.principalId, binding.sessionId);
    const previous = map.get(key);
    if (previous && previous.socket !== socket) {
      sendError(previous.socket, randomUUID(), 'SESSION_EXPIRED');
      previous.socket.close(4001, 'session replaced');
    }
    map.set(key, record);
    return record;
  }

  detach(record: SocketRecord): void {
    const { binding } = record;
    const map = binding.role === 'controller' ? this.controllers : this.targets;
    const key = binding.role === 'controller'
      ? controllerKey(binding.ownerId, binding.principalId, binding.sessionId)
      : targetKey(binding.ownerId, binding.principalId, binding.sessionId);
    if (map.get(key) === record) map.delete(key);
    this.rates.delete(rateKey(binding));
  }

  touch(record: SocketRecord, now = this.clock()): void {
    record.lastActivityMs = now;
  }

  target(envelope: RemoteEnvelope): SocketRecord | undefined {
    return this.targets.get(targetKey(envelope.ownerId, envelope.targetId, envelope.sessionId));
  }

  controller(envelope: RemoteEnvelope): SocketRecord | undefined {
    return this.controllers.get(
      controllerKey(envelope.ownerId, envelope.controllerId, envelope.sessionId),
    );
  }

  isCurrent(record: SocketRecord): boolean {
    const { binding } = record;
    const map = binding.role === 'controller' ? this.controllers : this.targets;
    const key = binding.role === 'controller'
      ? controllerKey(binding.ownerId, binding.principalId, binding.sessionId)
      : targetKey(binding.ownerId, binding.principalId, binding.sessionId);
    const current = map.get(key);
    return current === record && current.generation === record.generation;
  }

  consumeRate(binding: RemoteSocketBinding, now = this.clock()): boolean {
    const key = rateKey(binding);
    const current = this.rates.get(key);
    if (!current || now - current.windowStartedAtMs >= RATE_WINDOW_MS) {
      this.rates.set(key, { windowStartedAtMs: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.messageRateLimit;
  }

  reserveReplay(key: string, now = this.clock()): boolean {
    const expiresAt = this.replay.get(key);
    if ((expiresAt !== undefined && expiresAt > now) || this.pendingReplay.has(key)) return false;
    if (expiresAt !== undefined) this.replay.delete(key);
    this.pendingReplay.add(key);
    return true;
  }

  releaseReplay(key: string): void {
    this.pendingReplay.delete(key);
  }

  commitReplay(key: string, expiresAtMs: number): void {
    this.pendingReplay.delete(key);
    this.replay.set(key, expiresAtMs + REPLAY_RETENTION_MS);
  }

  sweep(now = this.clock()): void {
    for (const [key, expiresAt] of this.replay) {
      if (expiresAt <= now) this.replay.delete(key);
    }
    for (const [key, rate] of this.rates) {
      if (now - rate.windowStartedAtMs >= RATE_WINDOW_MS) this.rates.delete(key);
    }
    const records = new Set([...this.controllers.values(), ...this.targets.values()]);
    for (const record of records) {
      if (
        now - record.lastActivityMs >= REMOTE_IDLE_TTL_MS ||
        now - record.connectedAtMs >= REMOTE_HARD_TTL_MS
      ) {
        sendError(record.socket, randomUUID(), 'SESSION_EXPIRED');
        this.detach(record);
        record.socket.close(4001, 'session expired');
      }
    }
  }

  clear(): void {
    const records = new Set([...this.controllers.values(), ...this.targets.values()]);
    for (const record of records) {
      // Shutdown/disable must synchronously eliminate all active routes. A
      // graceful close can wait indefinitely for a broken peer's close frame.
      record.socket.terminate();
    }
    this.controllers.clear();
    this.targets.clear();
    this.replay.clear();
    this.pendingReplay.clear();
    this.rates.clear();
  }
}

function bindingMatches(record: SocketRecord, envelope: RemoteEnvelope): boolean {
  const { binding } = record;
  if (binding.ownerId !== envelope.ownerId || binding.sessionId !== envelope.sessionId) return false;
  return binding.role === 'controller'
    ? binding.principalId === envelope.controllerId
    : binding.principalId === envelope.targetId;
}

function signatureInput(envelope: RemoteEnvelope, binding: RemoteSocketBinding): RemoteSignatureInput {
  return {
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
    signerRole: binding.role,
    signerId: binding.principalId,
  };
}

type VerificationResult = 'valid' | 'invalid' | 'timeout';

function normalizeVerifyTimeout(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 1) {
    return REMOTE_VERIFY_TIMEOUT_DEFAULT_MS;
  }
  return Math.min(value, REMOTE_VERIFY_TIMEOUT_MAX_MS);
}

async function verifyWithinTimeout(
  verifier: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<VerificationResult> {
  let timer: NodeJS.Timeout | undefined;
  const verification: Promise<VerificationResult> = Promise.resolve()
    .then(verifier)
    .then((valid) => (valid ? 'valid' as const : 'invalid' as const))
    .catch(() => 'invalid' as const);
  const timeout = new Promise<VerificationResult>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([verification, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function verifySignature(
  verifier: NonNullable<RemoteRelayOptions['signatureVerifier']>,
  input: RemoteSignatureInput,
  signature: string,
  timeoutMs: number,
): Promise<VerificationResult> {
  return verifyWithinTimeout(() => verifier(input, signature), timeoutMs);
}

async function handleMessage(
  state: RemoteRelayMemoryState,
  record: SocketRecord,
  rawData: unknown,
  isBinary: boolean,
  options: Required<Pick<
    RemoteRelayOptions,
    'signatureVerifier' | 'signatureVerifyTimeoutMs' | 'clock'
  >>,
): Promise<void> {
  const now = options.clock();
  state.touch(record, now);
  if (!state.consumeRate(record.binding, now)) {
    sendError(record.socket, randomUUID(), 'RATE_LIMITED');
    return;
  }
  const raw = typeof rawData === 'string'
    ? Buffer.from(rawData)
    : Buffer.isBuffer(rawData)
      ? rawData
      : rawData instanceof ArrayBuffer
        ? Buffer.from(rawData)
        : Array.isArray(rawData)
          ? Buffer.concat(rawData)
          : Buffer.from(String(rawData));
  if (isBinary) {
    sendError(record.socket, randomUUID(), 'INVALID_SCHEMA');
    return;
  }
  const parsed = parseRemoteRelayEnvelope(raw, now);
  if (!parsed.ok) {
    sendError(record.socket, parsed.requestId, parsed.code);
    return;
  }
  const { envelope } = parsed;
  if (!bindingMatches(record, envelope)) {
    sendError(record.socket, envelope.requestId, 'TARGET_MISMATCH');
    return;
  }
  const allowedForRole = record.binding.role === 'controller'
    ? envelope.messageType === 'command' || envelope.messageType === 'status_query'
    : envelope.messageType === 'ack' || envelope.messageType === 'status_reply';
  if (!allowedForRole) {
    sendError(record.socket, envelope.requestId, 'ACTION_NOT_ALLOWED');
    return;
  }

  // Capture the exact online recipient before any asynchronous verification.
  // A later connection with the same logical identity is a different route and
  // must never inherit an in-flight command/ack.
  const recipient = record.binding.role === 'controller'
    ? state.target(envelope)
    : state.controller(envelope);
  const recipientUnavailableCode: RemoteErrorCode = record.binding.role === 'controller'
    ? 'TARGET_OFFLINE'
    : 'ACK_DELIVERY_LOST';
  if (
    !recipient ||
    recipient.socket.readyState !== WS_OPEN ||
    !bindingMatches(recipient, envelope)
  ) {
    sendError(record.socket, envelope.requestId, recipientUnavailableCode);
    return;
  }

  const key = replayKey(envelope);
  if (!state.reserveReplay(key, now)) {
    sendError(record.socket, envelope.requestId, 'NONCE_REPLAYED');
    return;
  }
  let replayCommitted = false;
  try {
    const verification = await verifySignature(
      options.signatureVerifier,
      signatureInput(envelope, record.binding),
      envelope.controllerSignature,
      options.signatureVerifyTimeoutMs,
    );
    if (verification === 'timeout') {
      sendError(record.socket, envelope.requestId, 'SIGNATURE_TIMEOUT');
      return;
    }
    if (verification !== 'valid') {
      sendError(record.socket, envelope.requestId, 'SIGNATURE_INVALID');
      return;
    }

    // Both endpoints must still be the exact generations captured for this
    // handler. Never perform a second lookup that could select a replacement.
    if (!state.isCurrent(record) || record.socket.readyState !== WS_OPEN) return;
    if (!state.isCurrent(recipient) || recipient.socket.readyState !== WS_OPEN) {
      sendError(record.socket, envelope.requestId, recipientUnavailableCode);
      return;
    }

    state.commitReplay(key, envelope.expiresAtMs);
    replayCommitted = true;
    state.touch(recipient, options.clock());
    recipient.socket.send(raw);
  } finally {
    if (!replayCommitted) state.releaseReplay(key);
  }
}

export async function registerRemoteARelay(
  app: FastifyInstance,
  config: ServerConfig,
  suppliedOptions: RemoteRelayOptions = {},
): Promise<void> {
  if (!config.remote.enabled) return;

  const options = {
    authVerifier: suppliedOptions.authVerifier ?? (() => false),
    signatureVerifier: suppliedOptions.signatureVerifier ?? (() => false),
    transportVerifier: suppliedOptions.transportVerifier ?? directTlsOnly,
    clock: suppliedOptions.clock ?? Date.now,
    sweepIntervalMs: suppliedOptions.sweepIntervalMs ?? 30_000,
    messageRateLimit: suppliedOptions.messageRateLimit ?? DEFAULT_MESSAGE_RATE_LIMIT,
    authVerifyTimeoutMs: normalizeVerifyTimeout(suppliedOptions.authVerifyTimeoutMs),
    signatureVerifyTimeoutMs: normalizeVerifyTimeout(suppliedOptions.signatureVerifyTimeoutMs),
  };
  const state = new RemoteRelayMemoryState(options.clock, options.messageRateLimit);
  const wss = new WebSocketServer({
    noServer: true,
    // Let the application return a stable PAYLOAD_TOO_LARGE for the first byte
    // beyond the 64 KiB contract; materially larger frames still fail in ws.
    maxPayload: REMOTE_ENVELOPE_MAX_BYTES + 1024,
    perMessageDeflate: false,
  });

  const onUpgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://remote.invalid');
    } catch {
      rejectUpgrade(socket, 400, 'INVALID_SCHEMA');
      return;
    }
    if (url.pathname !== config.remote.path) return;
    if (url.searchParams.has('token') || url.searchParams.has('access_token') || url.searchParams.has('authorization')) {
      rejectUpgrade(socket, 401, 'AUTH_INVALID');
      return;
    }
    if (url.search.length > 0) {
      rejectUpgrade(socket, 400, 'INVALID_SCHEMA');
      return;
    }
    if (!options.transportVerifier(request)) {
      rejectUpgrade(socket, 426, 'SERVICE_UNAVAILABLE');
      return;
    }
    const parsed = parseBinding(request);
    if (!parsed.ok) {
      rejectUpgrade(socket, parsed.code.startsWith('AUTH_') ? 401 : 400, parsed.code);
      return;
    }
    const authResult = await verifyWithinTimeout(
      () => options.authVerifier({
        ...parsed.binding,
        authorization: parsed.authorization,
      }),
      options.authVerifyTimeoutMs,
    );
    if (authResult === 'timeout') {
      rejectUpgrade(socket, 503, 'VERIFY_TIMEOUT');
      return;
    }
    if (authResult !== 'valid') {
      rejectUpgrade(socket, 401, 'AUTH_INVALID');
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      const record = state.attach(webSocket, parsed.binding);
      webSocket.on('message', (data: unknown, isBinary: boolean) => {
        void handleMessage(state, record, data, isBinary, options);
      });
      webSocket.on('close', () => state.detach(record));
      webSocket.on('error', () => state.detach(record));
    });
  };

  app.server.on('upgrade', onUpgrade);
  const interval = setInterval(() => state.sweep(), Math.max(1, options.sweepIntervalMs));
  interval.unref();

  // Upgraded sockets are not normal Fastify requests. Terminate them before
  // Fastify waits for the underlying HTTP server to close.
  app.addHook('preClose', async () => {
    clearInterval(interval);
    app.server.off('upgrade', onUpgrade);
    state.clear();
  });

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => {
      try {
        wss.close(() => resolve());
      } catch {
        resolve();
      }
    });
  });
}
