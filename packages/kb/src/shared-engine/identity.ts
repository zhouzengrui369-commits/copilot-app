import { createHash } from 'node:crypto';
import type { SharedObjectType } from './contract.js';

export class SharedEngineIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SharedEngineIdentityError';
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SharedEngineIdentityError('non-finite numbers are not canonical JSON');
    return value;
  }

  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }

  throw new SharedEngineIdentityError(`unsupported canonical JSON value: ${typeof value}`);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function contentHash(value: unknown): string {
  return `sha256:${sha256Hex(stableSerialize(value))}`;
}

export interface ObjectIdentityInput {
  namespace: string;
  objectType: SharedObjectType;
  sourceIdentity: string;
}

export function objectId(input: ObjectIdentityInput): string {
  const namespace = input.namespace.trim();
  const sourceIdentity = input.sourceIdentity.trim();
  if (!namespace || !sourceIdentity) {
    throw new SharedEngineIdentityError('namespace and sourceIdentity must be non-empty');
  }

  const digest = sha256Hex(
    stableSerialize({
      contract: 'copilot-shared-knowledge-engine',
      version: '0.3',
      namespace,
      object_type: input.objectType,
      source_identity: sourceIdentity,
    }),
  );

  return `ske:0.3:${input.objectType.toLowerCase()}:sha256:${digest}`;
}

export function receiptId(kind: string, input: unknown): string {
  const normalizedKind = kind.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!normalizedKind) throw new SharedEngineIdentityError('receipt kind must be non-empty');
  return `ske-receipt:${normalizedKind}:sha256:${sha256Hex(stableSerialize(input))}`;
}

export function toIsoTime(value: number | string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new SharedEngineIdentityError('invalid timestamp');
  return date.toISOString();
}