import { createHash } from 'node:crypto';
import type {
  RemoteAction,
  RemoteCommandStatus,
  RemoteTerminalCode,
} from '../../shared/remote-management.js';

export type RemoteAuditEvent =
  | 'remote.command.received'
  | 'remote.command.validated'
  | 'remote.approval_prompted'
  | 'remote.command.approved'
  | 'remote.command.rejected'
  | 'remote.command.expired'
  | 'remote.execution_started'
  | 'remote.command.executed'
  | 'remote.command.conflict'
  | 'remote.command.failed'
  | 'remote.ack.sent'
  | 'remote.ack.delivery_lost'
  | 'remote.disabled';

export interface RemoteAuditEntry {
  event: RemoteAuditEvent;
  atMs: number;
  commandId: string | null;
  requestId: string | null;
  controllerHash: string | null;
  targetHash: string | null;
  resourceHash: string | null;
  idempotencyHash: string | null;
  inputDigest: string | null;
  action: RemoteAction | null;
  risk: 'read' | 'write' | 'destructive' | null;
  terminalCode: RemoteTerminalCode | null;
  preRevision: string | null;
  postRevision: string | null;
  latencyMs: number | null;
}

export interface RemoteAuditStore {
  append(entry: RemoteAuditEntry): void | Promise<void>;
  findTerminalByCommandId(commandId: string): RemoteCommandStatus | null | Promise<RemoteCommandStatus | null>;
  findTerminalByIdempotencyHash(hash: string): RemoteCommandStatus | null | Promise<RemoteCommandStatus | null>;
  reserve(identity: RemoteCommandIdentity): RemoteReservationResult;
  complete(identity: RemoteCommandIdentity, status: RemoteCommandStatus): void;
}

export interface RemoteCommandIdentity {
  commandId: string;
  inputDigest: string;
  idempotencyHash: string;
}

export interface RemoteIdentityRecord extends RemoteCommandIdentity {
  state: 'reserved' | 'terminal';
  terminal: RemoteCommandStatus | null;
}

export type RemoteReservationResult =
  | { kind: 'reserved'; record: RemoteIdentityRecord }
  | { kind: 'pending'; record: RemoteIdentityRecord }
  | { kind: 'terminal'; record: RemoteIdentityRecord; status: RemoteCommandStatus }
  | { kind: 'conflict'; record: RemoteIdentityRecord };

export class InMemoryRemoteAuditStore implements RemoteAuditStore {
  private readonly values: RemoteAuditEntry[] = [];
  private readonly identities: RemoteIdentityRecord[] = [];

  append(entry: RemoteAuditEntry): void {
    this.values.push(structuredClone(entry));
  }

  findTerminalByCommandId(commandId: string): RemoteCommandStatus | null {
    return cloneStatus(this.identities.find((entry) => entry.commandId === commandId)?.terminal)
      ?? toStatus(findLastTerminal(this.values, (entry) => entry.commandId === commandId));
  }

  findTerminalByIdempotencyHash(hash: string): RemoteCommandStatus | null {
    return cloneStatus(this.identities.find((entry) => entry.idempotencyHash === hash)?.terminal)
      ?? toStatus(findLastTerminal(this.values, (entry) => entry.idempotencyHash === hash));
  }

  reserve(identity: RemoteCommandIdentity): RemoteReservationResult {
    return reserveIn(this.identities, identity);
  }

  complete(identity: RemoteCommandIdentity, status: RemoteCommandStatus): void {
    completeIn(this.identities, identity, status);
  }

  entries(): RemoteAuditEntry[] {
    return this.values.map((entry) => structuredClone(entry));
  }
}

export interface RemoteAuditPersistencePort {
  get(): unknown;
  set(entries: RemoteAuditEntry[]): void;
}

export interface RemoteIdentityPersistencePort {
  get(): unknown;
  set(entries: RemoteIdentityRecord[]): void;
}

/** Local persistent redacted audit used for idempotency and command.status. */
export class PersistentRemoteAuditStore implements RemoteAuditStore {
  constructor(
    private readonly persistence: RemoteAuditPersistencePort,
    private readonly maxEntries = 5_000,
    private readonly identityPersistence?: RemoteIdentityPersistencePort,
  ) {}

  private readonly fallbackIdentities: RemoteIdentityRecord[] = [];

  append(entry: RemoteAuditEntry): void {
    const values = this.load();
    values.push(structuredClone(entry));
    this.persistence.set(values.slice(-this.maxEntries));
  }

  findTerminalByCommandId(commandId: string): RemoteCommandStatus | null {
    return cloneStatus(this.loadIdentities().find((entry) => entry.commandId === commandId)?.terminal)
      ?? toStatus(findLastTerminal(this.load(), (entry) => entry.commandId === commandId));
  }

  findTerminalByIdempotencyHash(hash: string): RemoteCommandStatus | null {
    return cloneStatus(this.loadIdentities().find((entry) => entry.idempotencyHash === hash)?.terminal)
      ?? toStatus(findLastTerminal(this.load(), (entry) => entry.idempotencyHash === hash));
  }

  reserve(identity: RemoteCommandIdentity): RemoteReservationResult {
    const values = this.loadIdentities();
    const result = reserveIn(values, identity);
    if (result.kind === 'reserved') this.saveIdentities(values);
    return structuredClone(result);
  }

  complete(identity: RemoteCommandIdentity, status: RemoteCommandStatus): void {
    const values = this.loadIdentities();
    completeIn(values, identity, status);
    this.saveIdentities(values);
  }

  private load(): RemoteAuditEntry[] {
    const value = this.persistence.get();
    if (!Array.isArray(value)) return [];
    return value.filter(isRemoteAuditEntry).map((entry) => structuredClone(entry));
  }

  private loadIdentities(): RemoteIdentityRecord[] {
    if (!this.identityPersistence) return this.fallbackIdentities.map((entry) => structuredClone(entry));
    const value = this.identityPersistence.get();
    if (!Array.isArray(value)) return [];
    return value.filter(isRemoteIdentityRecord).map((entry) => structuredClone(entry));
  }

  private saveIdentities(values: RemoteIdentityRecord[]): void {
    if (this.identityPersistence) {
      // Deliberately independent of the 5,000-row display-audit retention cap.
      this.identityPersistence.set(values.map((entry) => structuredClone(entry)));
      return;
    }
    this.fallbackIdentities.splice(0, this.fallbackIdentities.length, ...values.map((entry) => structuredClone(entry)));
  }
}

export function opaqueHash(value: string | null | undefined): string | null {
  return value ? createHash('sha256').update(value, 'utf8').digest('hex') : null;
}

export function riskForAction(action: RemoteAction): RemoteAuditEntry['risk'] {
  if (action.endsWith('.move_to_trash')) return 'destructive';
  if (action.endsWith('.list') || action.endsWith('.read') || action === 'command.status') return 'read';
  return 'write';
}

function findLastTerminal(
  entries: readonly RemoteAuditEntry[],
  predicate: (entry: RemoteAuditEntry) => boolean,
): RemoteAuditEntry | undefined {
  return [...entries].reverse().find((entry) =>
    predicate(entry) && entry.terminalCode !== null && entry.inputDigest !== null);
}

function toStatus(entry: RemoteAuditEntry | undefined): RemoteCommandStatus | null {
  if (!entry?.commandId || !entry.terminalCode || !entry.inputDigest) return null;
  return {
    commandId: entry.commandId,
    terminalCode: entry.terminalCode,
    inputDigest: entry.inputDigest,
    preRevision: entry.preRevision,
    postRevision: entry.postRevision,
  };
}

function cloneStatus(value: RemoteCommandStatus | null | undefined): RemoteCommandStatus | null {
  return value ? structuredClone(value) : null;
}

function reserveIn(entries: RemoteIdentityRecord[], identity: RemoteCommandIdentity): RemoteReservationResult {
  const byCommand = entries.find((entry) => entry.commandId === identity.commandId);
  const byIdempotency = entries.find((entry) => entry.idempotencyHash === identity.idempotencyHash);
  const existing = byCommand ?? byIdempotency;
  if (existing) {
    const exactCommand = existing.commandId === identity.commandId;
    const exactIdempotency = existing.idempotencyHash === identity.idempotencyHash;
    const exactDigest = existing.inputDigest === identity.inputDigest;
    const permittedAlias = !exactCommand && exactIdempotency && exactDigest;
    if (!(exactCommand && exactIdempotency && exactDigest) && !permittedAlias) {
      return { kind: 'conflict', record: structuredClone(existing) };
    }
    if (byCommand && byIdempotency && byCommand !== byIdempotency) {
      return { kind: 'conflict', record: structuredClone(existing) };
    }
    if (existing.state === 'terminal' && existing.terminal) {
      return { kind: 'terminal', record: structuredClone(existing), status: structuredClone(existing.terminal) };
    }
    return { kind: 'pending', record: structuredClone(existing) };
  }
  const record: RemoteIdentityRecord = { ...identity, state: 'reserved', terminal: null };
  entries.push(record);
  return { kind: 'reserved', record: structuredClone(record) };
}

function completeIn(
  entries: RemoteIdentityRecord[],
  identity: RemoteCommandIdentity,
  status: RemoteCommandStatus,
): void {
  const record = entries.find((entry) =>
    entry.commandId === identity.commandId || entry.idempotencyHash === identity.idempotencyHash);
  if (!record || record.inputDigest !== identity.inputDigest) {
    throw new Error('remote command reservation is missing or mismatched');
  }
  record.state = 'terminal';
  record.terminal = structuredClone(status);
}

function isRemoteAuditEntry(value: unknown): value is RemoteAuditEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<RemoteAuditEntry>;
  const exactKeys = [
    'event', 'atMs', 'commandId', 'requestId', 'controllerHash', 'targetHash',
    'resourceHash', 'idempotencyHash', 'inputDigest', 'action', 'risk',
    'terminalCode', 'preRevision', 'postRevision', 'latencyMs',
  ];
  if (Object.keys(value).some((key) => !exactKeys.includes(key))) return false;
  return typeof entry.event === 'string' && typeof entry.atMs === 'number';
}

function isRemoteIdentityRecord(value: unknown): value is RemoteIdentityRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<RemoteIdentityRecord>;
  return typeof entry.commandId === 'string'
    && typeof entry.inputDigest === 'string'
    && typeof entry.idempotencyHash === 'string'
    && (entry.state === 'reserved' || entry.state === 'terminal')
    && (entry.terminal === null || typeof entry.terminal === 'object');
}
