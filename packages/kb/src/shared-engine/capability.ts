import {
  type PrivacyClass,
  type SharedObjectType,
} from './contract.js';
import { receiptId, stableSerialize, toIsoTime } from './identity.js';

export const AGENT_API_CONTRACT_VERSION = '0.3.0-draft' as const;
export const CAPABILITY_MANIFEST_VERSION = '1' as const;

export type AgentWriteMode = 'NONE' | 'WRITE_PROPOSAL';

export interface CapabilityManifestInput {
  capability_id: string;
  consumer_id: string;
  namespaces: readonly string[];
  purposes: readonly string[];
  privacy_ceiling: Extract<PrivacyClass, 'D0' | 'D1'>;
  allowed_read_types: readonly SharedObjectType[];
  write_mode: AgentWriteMode;
  expires_at?: string | null;
}

export interface CapabilityManifest {
  manifest_id: string;
  contract_version: typeof AGENT_API_CONTRACT_VERSION;
  manifest_version: typeof CAPABILITY_MANIFEST_VERSION;
  capability_id: string;
  consumer_id: string;
  namespaces: readonly string[];
  purposes: readonly string[];
  privacy_ceiling: Extract<PrivacyClass, 'D0' | 'D1'>;
  allowed_read_types: readonly SharedObjectType[];
  write_mode: AgentWriteMode;
  expires_at: string | null;
}

export interface CapabilitySession {
  session_id: string;
  manifest: CapabilityManifest;
  negotiated_contract_version: typeof AGENT_API_CONTRACT_VERSION;
  negotiated_at: string;
}

export class CapabilityContractError extends Error {
  constructor(
    readonly code:
      | 'INVALID_CAPABILITY_MANIFEST'
      | 'UNSUPPORTED_CONTRACT_VERSION'
      | 'CAPABILITY_EXPIRED',
    message: string,
  ) {
    super(message);
    this.name = 'CapabilityContractError';
  }
}

const OBJECT_TYPES = new Set<SharedObjectType>(['Source', 'Knowledge', 'Entity', 'Relation']);
const WRITE_MODES = new Set<AgentWriteMode>(['NONE', 'WRITE_PROPOSAL']);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function requireIdentifier(value: string, field: string): string {
  const trimmed = value.trim();
  if (!IDENTIFIER_PATTERN.test(trimmed)) {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', `${field} is invalid`);
  }
  return trimmed;
}

function normalizeGrantValues(values: readonly string[], field: string): string[] {
  const normalized = [...new Set(values.map((value) => value.trim()))].sort();
  if (normalized.length === 0 || normalized.some((value) => !IDENTIFIER_PATTERN.test(value))) {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', `${field} must contain valid grants`);
  }
  return normalized;
}

function normalizeObjectTypes(values: readonly SharedObjectType[]): SharedObjectType[] {
  const normalized = [...new Set(values)].sort() as SharedObjectType[];
  if (normalized.length === 0 || normalized.some((value) => !OBJECT_TYPES.has(value))) {
    throw new CapabilityContractError(
      'INVALID_CAPABILITY_MANIFEST',
      'allowed_read_types must contain supported object types',
    );
  }
  return normalized;
}

function normalizeExpiry(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = toIsoTime(value);
  return normalized;
}

function manifestIdentityPayload(manifest: Omit<CapabilityManifest, 'manifest_id'>): unknown {
  return {
    contract_version: manifest.contract_version,
    manifest_version: manifest.manifest_version,
    capability_id: manifest.capability_id,
    consumer_id: manifest.consumer_id,
    namespaces: manifest.namespaces,
    purposes: manifest.purposes,
    privacy_ceiling: manifest.privacy_ceiling,
    allowed_read_types: manifest.allowed_read_types,
    write_mode: manifest.write_mode,
    expires_at: manifest.expires_at,
  };
}

export function createCapabilityManifest(input: CapabilityManifestInput): CapabilityManifest {
  const manifestBase: Omit<CapabilityManifest, 'manifest_id'> = {
    contract_version: AGENT_API_CONTRACT_VERSION,
    manifest_version: CAPABILITY_MANIFEST_VERSION,
    capability_id: requireIdentifier(input.capability_id, 'capability_id'),
    consumer_id: requireIdentifier(input.consumer_id, 'consumer_id'),
    namespaces: normalizeGrantValues(input.namespaces, 'namespaces'),
    purposes: normalizeGrantValues(input.purposes, 'purposes'),
    privacy_ceiling: input.privacy_ceiling,
    allowed_read_types: normalizeObjectTypes(input.allowed_read_types),
    write_mode: input.write_mode,
    expires_at: normalizeExpiry(input.expires_at),
  };

  if (manifestBase.privacy_ceiling !== 'D0' && manifestBase.privacy_ceiling !== 'D1') {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', 'privacy ceiling must be D0 or D1');
  }
  if (!WRITE_MODES.has(manifestBase.write_mode)) {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', 'unsupported write mode');
  }

  return {
    manifest_id: receiptId('capability-manifest', manifestIdentityPayload(manifestBase)),
    ...manifestBase,
  };
}

export function validateCapabilityManifest(value: unknown): asserts value is CapabilityManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', 'capability manifest must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.contract_version !== AGENT_API_CONTRACT_VERSION) {
    throw new CapabilityContractError(
      'UNSUPPORTED_CONTRACT_VERSION',
      `unsupported Agent contract version: ${String(record.contract_version)}`,
    );
  }
  if (record.manifest_version !== CAPABILITY_MANIFEST_VERSION) {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', 'unsupported capability manifest version');
  }

  const rebuilt = createCapabilityManifest({
    capability_id: String(record.capability_id ?? ''),
    consumer_id: String(record.consumer_id ?? ''),
    namespaces: Array.isArray(record.namespaces) ? record.namespaces.map(String) : [],
    purposes: Array.isArray(record.purposes) ? record.purposes.map(String) : [],
    privacy_ceiling: record.privacy_ceiling as Extract<PrivacyClass, 'D0' | 'D1'>,
    allowed_read_types: Array.isArray(record.allowed_read_types)
      ? (record.allowed_read_types as SharedObjectType[])
      : [],
    write_mode: record.write_mode as AgentWriteMode,
    expires_at: record.expires_at === null ? null : String(record.expires_at ?? ''),
  });

  if (
    typeof record.manifest_id !== 'string' ||
    record.manifest_id !== rebuilt.manifest_id ||
    stableSerialize(record) !== stableSerialize(rebuilt)
  ) {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', 'capability manifest identity is invalid');
  }
}

export function negotiateCapability(
  manifest: CapabilityManifest,
  requestedContractVersion: string,
  negotiatedAt: number | string | Date = new Date(),
): CapabilitySession {
  validateCapabilityManifest(manifest);
  if (requestedContractVersion !== AGENT_API_CONTRACT_VERSION) {
    throw new CapabilityContractError(
      'UNSUPPORTED_CONTRACT_VERSION',
      `unsupported requested contract version: ${requestedContractVersion}`,
    );
  }
  const at = toIsoTime(negotiatedAt);
  assertCapabilityActive(manifest, at);
  return {
    session_id: receiptId('capability-session', {
      manifest_id: manifest.manifest_id,
      contract_version: AGENT_API_CONTRACT_VERSION,
    }),
    manifest,
    negotiated_contract_version: AGENT_API_CONTRACT_VERSION,
    negotiated_at: at,
  };
}

export function assertCapabilityActive(
  manifest: CapabilityManifest,
  at: number | string | Date = new Date(),
): void {
  validateCapabilityManifest(manifest);
  const currentTime = Date.parse(toIsoTime(at));
  if (manifest.expires_at !== null && Date.parse(manifest.expires_at) <= currentTime) {
    throw new CapabilityContractError('CAPABILITY_EXPIRED', 'capability manifest has expired');
  }
}

export function validateCapabilitySession(
  session: CapabilitySession,
  at: number | string | Date = new Date(),
): void {
  validateCapabilityManifest(session.manifest);
  if (
    session.negotiated_contract_version !== AGENT_API_CONTRACT_VERSION ||
    session.session_id !==
      receiptId('capability-session', {
        manifest_id: session.manifest.manifest_id,
        contract_version: AGENT_API_CONTRACT_VERSION,
      }) ||
    Number.isNaN(Date.parse(session.negotiated_at))
  ) {
    throw new CapabilityContractError('INVALID_CAPABILITY_MANIFEST', 'capability session is invalid');
  }
  assertCapabilityActive(session.manifest, at);
}
