import { Buffer } from 'node:buffer';
import {
  SHARED_ENGINE_SCHEMA_VERSION,
  type CanonicalObject,
  type PrivacyClass,
  type ReviewState,
  validateCanonicalObject,
} from './contract.js';
import { contentHash, receiptId, stableSerialize, toIsoTime } from './identity.js';
import { permissionFingerprint } from './projection.js';

export const PORTABILITY_CONTRACT_VERSION = '1' as const;

export interface PortableCanonicalEntry {
  object: CanonicalObject;
  permission_fingerprint: string;
  entry_checksum: string;
}

export interface PortableSourceBytesEntry {
  source_object_id: string;
  privacy_class: Extract<PrivacyClass, 'D0' | 'D1'>;
  content_sha256: string;
  byte_length: number;
  encoding: 'base64';
  included: boolean;
  redacted: boolean;
  data_base64: string | null;
  entry_checksum: string;
}

export interface PortableBundle {
  portability_version: typeof PORTABILITY_CONTRACT_VERSION;
  schema_version: typeof SHARED_ENGINE_SCHEMA_VERSION;
  namespace: string;
  bundle_id: string;
  manifest_checksum: string;
  exported_at: string;
  objects: readonly PortableCanonicalEntry[];
  source_bytes: readonly PortableSourceBytesEntry[];
  review_receipt_ids: readonly string[];
  conflict_receipt_ids: readonly string[];
  supersession_receipt_ids: readonly string[];
}

export interface CreatePortableBundleInput {
  namespace: string;
  objects: readonly CanonicalObject[];
  source_bytes?: readonly Omit<PortableSourceBytesEntry, 'entry_checksum'>[];
  review_receipt_ids?: readonly string[];
  conflict_receipt_ids?: readonly string[];
  supersession_receipt_ids?: readonly string[];
  exported_at?: number | string | Date;
}

export type ImportOperationKind = 'ADD' | 'UNCHANGED' | 'REVIEW_REQUIRED';

export interface ImportOperation {
  object_id: string;
  operation: ImportOperationKind;
  incoming_content_hash: string;
  incoming_revision: number;
  local_content_hash: string | null;
  local_revision: number | null;
  local_review_state: ReviewState | null;
}

export interface ImportPlan {
  plan_id: string;
  bundle_id: string;
  namespace: string;
  planned_at: string;
  operations: readonly ImportOperation[];
  included_source_object_ids: readonly string[];
  physical_write_performed: false;
}

export class PortabilityContractError extends Error {
  constructor(
    readonly code:
      | 'INVALID_PORTABLE_BUNDLE'
      | 'UNSUPPORTED_PORTABILITY_VERSION'
      | 'CHECKSUM_MISMATCH'
      | 'CONFLICTING_OBJECT_VERSION'
      | 'SOURCE_BYTES_NOT_ALLOWED',
    message: string,
  ) {
    super(message);
    this.name = 'PortabilityContractError';
  }
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;

function requireNamespace(value: string): string {
  const namespace = value.trim();
  if (!namespace) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'namespace is required');
  }
  return namespace;
}

function normalizeReceiptIds(values: readonly string[] | undefined, field: string): string[] {
  const normalized = [...new Set(values ?? [])].sort();
  if (normalized.some((value) => !RECEIPT_ID_PATTERN.test(value))) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', `${field} contains invalid receipt ids`);
  }
  return normalized;
}

function canonicalEntry(object: CanonicalObject): PortableCanonicalEntry {
  validateCanonicalObject(object);
  const fingerprint = permissionFingerprint(object);
  return {
    object,
    permission_fingerprint: fingerprint,
    entry_checksum: contentHash({ object, permission_fingerprint: fingerprint }),
  };
}

function decodeBase64Canonical(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'source bytes must be canonical base64');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'source bytes base64 is not canonical');
  }
  return decoded;
}

function sourceEntry(
  input: Omit<PortableSourceBytesEntry, 'entry_checksum'>,
  sourceObjects: ReadonlyMap<string, CanonicalObject>,
): PortableSourceBytesEntry {
  const sourceObject = sourceObjects.get(input.source_object_id);
  if (!sourceObject || sourceObject.object_type !== 'Source') {
    throw new PortabilityContractError(
      'INVALID_PORTABLE_BUNDLE',
      'source bytes entry must reference a Source object in the same bundle',
    );
  }
  if (input.privacy_class !== 'D0' && input.privacy_class !== 'D1') {
    throw new PortabilityContractError('SOURCE_BYTES_NOT_ALLOWED', 'C5 source bytes are limited to D0/D1');
  }
  if (sourceObject.privacy_class !== input.privacy_class) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'source byte privacy class drift');
  }
  if (!SHA256_PATTERN.test(input.content_sha256) || !Number.isInteger(input.byte_length) || input.byte_length < 0) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'source byte digest or length is invalid');
  }
  if (input.encoding !== 'base64') {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'unsupported source byte encoding');
  }

  if (input.included) {
    if (input.data_base64 === null) {
      throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'included source bytes require data');
    }
    const bytes = decodeBase64Canonical(input.data_base64);
    if (bytes.byteLength !== input.byte_length || contentHash(bytes) !== input.content_sha256) {
      throw new PortabilityContractError('CHECKSUM_MISMATCH', 'source byte checksum mismatch');
    }
  } else if (input.data_base64 !== null) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'omitted source bytes must not carry data');
  }

  const logical = {
    source_object_id: input.source_object_id,
    privacy_class: input.privacy_class,
    content_sha256: input.content_sha256,
    byte_length: input.byte_length,
    encoding: input.encoding,
    included: input.included,
    redacted: input.redacted,
  };
  return {
    ...input,
    entry_checksum: contentHash(logical),
  };
}

function dedupeCanonicalEntries(entries: readonly PortableCanonicalEntry[]): PortableCanonicalEntry[] {
  const byId = new Map<string, PortableCanonicalEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.object.object_id);
    if (existing && existing.entry_checksum !== entry.entry_checksum) {
      throw new PortabilityContractError(
        'CONFLICTING_OBJECT_VERSION',
        `conflicting object versions for ${entry.object.object_id}`,
      );
    }
    byId.set(entry.object.object_id, entry);
  }
  return [...byId.values()].sort((a, b) => a.object.object_id.localeCompare(b.object.object_id));
}

function dedupeSourceEntries(entries: readonly PortableSourceBytesEntry[]): PortableSourceBytesEntry[] {
  const byId = new Map<string, PortableSourceBytesEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.source_object_id);
    if (existing && stableSerialize(existing) !== stableSerialize(entry)) {
      throw new PortabilityContractError(
        'CONFLICTING_OBJECT_VERSION',
        `conflicting source byte entries for ${entry.source_object_id}`,
      );
    }
    byId.set(entry.source_object_id, entry);
  }
  return [...byId.values()].sort((a, b) => a.source_object_id.localeCompare(b.source_object_id));
}

function bundleIdentityPayload(input: {
  namespace: string;
  objects: readonly PortableCanonicalEntry[];
  source_bytes: readonly PortableSourceBytesEntry[];
  review_receipt_ids: readonly string[];
  conflict_receipt_ids: readonly string[];
  supersession_receipt_ids: readonly string[];
}) {
  return {
    portability_version: PORTABILITY_CONTRACT_VERSION,
    schema_version: SHARED_ENGINE_SCHEMA_VERSION,
    namespace: input.namespace,
    objects: input.objects.map((entry) => ({
      object_id: entry.object.object_id,
      content_hash: entry.object.content_hash,
      revision: entry.object.revision,
      entry_checksum: entry.entry_checksum,
      permission_fingerprint: entry.permission_fingerprint,
    })),
    source_bytes: input.source_bytes.map((entry) => ({
      source_object_id: entry.source_object_id,
      content_sha256: entry.content_sha256,
      byte_length: entry.byte_length,
      included: entry.included,
      redacted: entry.redacted,
      entry_checksum: entry.entry_checksum,
    })),
    review_receipt_ids: input.review_receipt_ids,
    conflict_receipt_ids: input.conflict_receipt_ids,
    supersession_receipt_ids: input.supersession_receipt_ids,
  };
}

export function createPortableBundle(input: CreatePortableBundleInput): PortableBundle {
  const namespace = requireNamespace(input.namespace);
  const objectEntries = input.objects.map((object) => {
    if (object.namespace !== namespace) {
      throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'bundle contains cross-namespace object');
    }
    return canonicalEntry(object);
  });
  const objects = dedupeCanonicalEntries(objectEntries);
  if (objects.length === 0) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'portable bundle requires objects');
  }
  const sourceObjects = new Map(objects.map((entry) => [entry.object.object_id, entry.object] as const));
  const sourceBytes = dedupeSourceEntries(
    (input.source_bytes ?? []).map((entry) => sourceEntry(entry, sourceObjects)),
  );
  const reviewReceiptIds = normalizeReceiptIds(input.review_receipt_ids, 'review_receipt_ids');
  const conflictReceiptIds = normalizeReceiptIds(input.conflict_receipt_ids, 'conflict_receipt_ids');
  const supersessionReceiptIds = normalizeReceiptIds(
    input.supersession_receipt_ids,
    'supersession_receipt_ids',
  );
  const identityPayload = bundleIdentityPayload({
    namespace,
    objects,
    source_bytes: sourceBytes,
    review_receipt_ids: reviewReceiptIds,
    conflict_receipt_ids: conflictReceiptIds,
    supersession_receipt_ids: supersessionReceiptIds,
  });
  return {
    portability_version: PORTABILITY_CONTRACT_VERSION,
    schema_version: SHARED_ENGINE_SCHEMA_VERSION,
    namespace,
    bundle_id: receiptId('portable-bundle', identityPayload),
    manifest_checksum: contentHash(identityPayload),
    exported_at: toIsoTime(input.exported_at ?? new Date()),
    objects,
    source_bytes: sourceBytes,
    review_receipt_ids: reviewReceiptIds,
    conflict_receipt_ids: conflictReceiptIds,
    supersession_receipt_ids: supersessionReceiptIds,
  };
}

export function validatePortableBundle(value: unknown): asserts value is PortableBundle {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'portable bundle must be an object');
  }
  const record = value as Partial<PortableBundle>;
  if (record.portability_version !== PORTABILITY_CONTRACT_VERSION) {
    throw new PortabilityContractError(
      'UNSUPPORTED_PORTABILITY_VERSION',
      `unsupported portability version: ${String(record.portability_version)}`,
    );
  }
  if (record.schema_version !== SHARED_ENGINE_SCHEMA_VERSION) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'unsupported canonical schema version');
  }
  if (
    typeof record.namespace !== 'string' ||
    typeof record.exported_at !== 'string' ||
    !Array.isArray(record.objects) ||
    !Array.isArray(record.source_bytes) ||
    !Array.isArray(record.review_receipt_ids) ||
    !Array.isArray(record.conflict_receipt_ids) ||
    !Array.isArray(record.supersession_receipt_ids)
  ) {
    throw new PortabilityContractError('INVALID_PORTABLE_BUNDLE', 'portable bundle structure is invalid');
  }

  const rebuilt = createPortableBundle({
    namespace: record.namespace,
    objects: record.objects.map((entry) => entry.object),
    source_bytes: record.source_bytes.map(({ entry_checksum: _checksum, ...entry }) => entry),
    review_receipt_ids: record.review_receipt_ids,
    conflict_receipt_ids: record.conflict_receipt_ids,
    supersession_receipt_ids: record.supersession_receipt_ids,
    exported_at: record.exported_at,
  });
  if (
    typeof record.bundle_id !== 'string' ||
    typeof record.manifest_checksum !== 'string' ||
    record.bundle_id !== rebuilt.bundle_id ||
    record.manifest_checksum !== rebuilt.manifest_checksum ||
    stableSerialize(record) !== stableSerialize(rebuilt)
  ) {
    throw new PortabilityContractError('CHECKSUM_MISMATCH', 'portable bundle identity or checksum mismatch');
  }
}

function localMap(objects: readonly CanonicalObject[]): Map<string, CanonicalObject> {
  const byId = new Map<string, CanonicalObject>();
  for (const object of objects) {
    validateCanonicalObject(object);
    const existing = byId.get(object.object_id);
    if (existing && (existing.content_hash !== object.content_hash || existing.revision !== object.revision)) {
      throw new PortabilityContractError(
        'CONFLICTING_OBJECT_VERSION',
        `conflicting local versions for ${object.object_id}`,
      );
    }
    byId.set(object.object_id, object);
  }
  return byId;
}

export function planPortableImport(
  bundle: PortableBundle,
  localObjects: readonly CanonicalObject[],
  plannedAt: number | string | Date = new Date(),
): ImportPlan {
  validatePortableBundle(bundle);
  const local = localMap(localObjects);
  const operations: ImportOperation[] = bundle.objects.map((entry) => {
    const current = local.get(entry.object.object_id);
    if (!current) {
      return {
        object_id: entry.object.object_id,
        operation: 'ADD',
        incoming_content_hash: entry.object.content_hash,
        incoming_revision: entry.object.revision,
        local_content_hash: null,
        local_revision: null,
        local_review_state: null,
      };
    }
    const unchanged =
      current.content_hash === entry.object.content_hash && current.revision === entry.object.revision;
    return {
      object_id: entry.object.object_id,
      operation: unchanged ? 'UNCHANGED' : 'REVIEW_REQUIRED',
      incoming_content_hash: entry.object.content_hash,
      incoming_revision: entry.object.revision,
      local_content_hash: current.content_hash,
      local_revision: current.revision,
      local_review_state: current.review_state,
    };
  });
  operations.sort((a, b) => a.object_id.localeCompare(b.object_id));
  const includedSourceObjectIds = bundle.source_bytes
    .filter((entry) => entry.included)
    .map((entry) => entry.source_object_id)
    .sort();
  const logical = {
    bundle_id: bundle.bundle_id,
    namespace: bundle.namespace,
    operations,
    included_source_object_ids: includedSourceObjectIds,
  };
  return {
    plan_id: receiptId('portable-import-plan', logical),
    bundle_id: bundle.bundle_id,
    namespace: bundle.namespace,
    planned_at: toIsoTime(plannedAt),
    operations,
    included_source_object_ids: includedSourceObjectIds,
    physical_write_performed: false,
  };
}
