import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  SHARED_ENGINE_SCHEMA_VERSION,
  contentHash,
  createPortableBundle,
  objectId,
  planPortableImport,
  sha256Hex,
  validatePortableBundle,
  type CanonicalObject,
  type PortableSourceBytesEntry,
} from '../src/shared-engine/index.js';

function makeObject(input: {
  type?: CanonicalObject['object_type'];
  sourceIdentity?: string;
  namespace?: string;
  revision?: number;
  review?: CanonicalObject['review_state'];
  privacy?: CanonicalObject['privacy_class'];
  payload?: unknown;
  supersedes?: string | null;
} = {}): CanonicalObject {
  const objectType = input.type ?? 'Knowledge';
  const sourceIdentity = input.sourceIdentity ?? 'portable-note';
  const namespace = input.namespace ?? 'personal';
  const payload = input.payload ?? { text: sourceIdentity };
  return {
    object_id: objectId({ namespace, objectType, sourceIdentity }),
    object_type: objectType,
    namespace,
    schema_version: SHARED_ENGINE_SCHEMA_VERSION,
    source_refs: [],
    content_hash: contentHash(payload),
    observed_at: '2026-08-11T10:00:00.000Z',
    valid_from: null,
    valid_to: null,
    assertion_type: objectType === 'Source' ? 'SOURCE_FACT' : 'SYSTEM_INFERENCE',
    confidence: objectType === 'Source' ? null : 0.8,
    review_state: input.review ?? 'PROPOSED',
    privacy_class: input.privacy ?? 'D1',
    permission_scope: {
      purposes: ['retrieval'],
      allowed_consumers: ['agent.test'],
      cloud_egress: 'DENY',
    },
    supersedes: input.supersedes ?? null,
    tombstone_state: 'ACTIVE',
    created_by: 'test',
    updated_by: 'test',
    revision: input.revision ?? 1,
    payload,
  };
}

function sourceBytes(source: CanonicalObject, text = 'portable source'): Omit<PortableSourceBytesEntry, 'entry_checksum'> {
  const bytes = Buffer.from(text, 'utf8');
  return {
    source_object_id: source.object_id,
    privacy_class: source.privacy_class as 'D0' | 'D1',
    content_sha256: `sha256:${sha256Hex(bytes)}`,
    byte_length: bytes.byteLength,
    encoding: 'base64',
    included: true,
    redacted: false,
    data_base64: bytes.toString('base64'),
  };
}

describe('C5 portable export bundle', () => {
  it('keeps bundle identity deterministic across export time, object order and receipt order', () => {
    const a = makeObject({ sourceIdentity: 'a' });
    const b = makeObject({ sourceIdentity: 'b' });
    const first = createPortableBundle({
      namespace: 'personal',
      objects: [b, a],
      review_receipt_ids: ['review:b', 'review:a', 'review:a'],
      conflict_receipt_ids: ['conflict:b', 'conflict:a'],
      supersession_receipt_ids: ['super:b', 'super:a'],
      exported_at: '2026-08-11T10:00:00Z',
    });
    const second = createPortableBundle({
      namespace: 'personal',
      objects: [a, b],
      review_receipt_ids: ['review:a', 'review:b'],
      conflict_receipt_ids: ['conflict:a', 'conflict:b'],
      supersession_receipt_ids: ['super:a', 'super:b'],
      exported_at: '2026-08-11T11:00:00Z',
    });

    expect(second.bundle_id).toBe(first.bundle_id);
    expect(second.manifest_checksum).toBe(first.manifest_checksum);
    expect(first.exported_at).not.toBe(second.exported_at);
    expect(first.objects.map((entry) => entry.object.object_id)).toEqual(
      [...first.objects.map((entry) => entry.object.object_id)].sort(),
    );
  });

  it('includes raw source bytes with raw-byte SHA-256 and validates a zero-byte source', () => {
    const source = makeObject({ type: 'Source', sourceIdentity: 'source' });
    const normal = createPortableBundle({
      namespace: 'personal',
      objects: [source],
      source_bytes: [sourceBytes(source)],
    });
    expect(() => validatePortableBundle(normal)).not.toThrow();
    expect(normal.source_bytes[0]?.included).toBe(true);

    const zero = createPortableBundle({
      namespace: 'personal',
      objects: [source],
      source_bytes: [
        {
          source_object_id: source.object_id,
          privacy_class: 'D1',
          content_sha256: `sha256:${sha256Hex(new Uint8Array())}`,
          byte_length: 0,
          encoding: 'base64',
          included: true,
          redacted: false,
          data_base64: '',
        },
      ],
    });
    expect(() => validatePortableBundle(zero)).not.toThrow();
  });

  it('supports content-free omitted source descriptors', () => {
    const source = makeObject({ type: 'Source', sourceIdentity: 'omitted' });
    const bytes = Buffer.from('not embedded');
    const bundle = createPortableBundle({
      namespace: 'personal',
      objects: [source],
      source_bytes: [
        {
          source_object_id: source.object_id,
          privacy_class: 'D1',
          content_sha256: `sha256:${sha256Hex(bytes)}`,
          byte_length: bytes.length,
          encoding: 'base64',
          included: false,
          redacted: true,
          data_base64: null,
        },
      ],
    });
    expect(bundle.source_bytes[0]?.data_base64).toBeNull();
    expect(planPortableImport(bundle, []).included_source_object_ids).toEqual([]);
  });

  it('deduplicates exact canonical and source entries', () => {
    const source = makeObject({ type: 'Source', sourceIdentity: 'dedupe' });
    const bytes = sourceBytes(source);
    const bundle = createPortableBundle({
      namespace: 'personal',
      objects: [source, source],
      source_bytes: [bytes, bytes],
    });
    expect(bundle.objects).toHaveLength(1);
    expect(bundle.source_bytes).toHaveLength(1);
  });

  it('rejects empty and cross-namespace object bundles', () => {
    expect(() => createPortableBundle({ namespace: 'personal', objects: [] })).toThrow(/requires objects/);
    expect(() =>
      createPortableBundle({ namespace: 'personal', objects: [makeObject({ namespace: 'work' })] }),
    ).toThrow(/cross-namespace/);
    expect(() => createPortableBundle({ namespace: '   ', objects: [makeObject()] })).toThrow(/namespace/);
  });

  it('rejects invalid receipt references', () => {
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [makeObject()],
        review_receipt_ids: ['bad receipt with spaces'],
      }),
    ).toThrow(/receipt ids/);
  });

  it('requires source bytes to reference a Source object in the bundle', () => {
    const knowledge = makeObject();
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [knowledge],
        source_bytes: [sourceBytes({ ...knowledge, object_type: 'Source' })],
      }),
    ).toThrow(/Source object/);
  });

  it('fails closed on D2 source bytes and privacy drift', () => {
    const d2 = makeObject({ type: 'Source', sourceIdentity: 'd2', privacy: 'D2' });
    const bytes = Buffer.from('sensitive');
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [d2],
        source_bytes: [
          {
            source_object_id: d2.object_id,
            privacy_class: 'D2' as 'D1',
            content_sha256: `sha256:${sha256Hex(bytes)}`,
            byte_length: bytes.length,
            encoding: 'base64',
            included: true,
            redacted: false,
            data_base64: bytes.toString('base64'),
          },
        ],
      }),
    ).toThrow(/D0\/D1/);

    const d1 = makeObject({ type: 'Source', sourceIdentity: 'd1', privacy: 'D1' });
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [d1],
        source_bytes: [{ ...sourceBytes(d1), privacy_class: 'D0' }],
      }),
    ).toThrow(/privacy class drift/);
  });

  it('rejects malformed digest, length and encoding metadata', () => {
    const source = makeObject({ type: 'Source' });
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [{ ...sourceBytes(source), content_sha256: 'sha256:bad' }],
      }),
    ).toThrow(/digest or length/);
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [{ ...sourceBytes(source), byte_length: -1 }],
      }),
    ).toThrow(/digest or length/);
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [{ ...sourceBytes(source), encoding: 'hex' as 'base64' }],
      }),
    ).toThrow(/encoding/);
  });

  it('rejects missing, non-canonical, length-mismatched and checksum-mismatched included bytes', () => {
    const source = makeObject({ type: 'Source' });
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [{ ...sourceBytes(source), data_base64: null }],
      }),
    ).toThrow(/require data/);
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [{ ...sourceBytes(source), data_base64: '***=' }],
      }),
    ).toThrow(/base64/);
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [{ ...sourceBytes(source), byte_length: 999 }],
      }),
    ).toThrow(/checksum mismatch/);
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [
          {
            ...sourceBytes(source),
            content_sha256: `sha256:${'0'.repeat(64)}`,
          },
        ],
      }),
    ).toThrow(/checksum mismatch/);
  });

  it('rejects omitted source entries that still carry bytes', () => {
    const source = makeObject({ type: 'Source' });
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [{ ...sourceBytes(source), included: false }],
      }),
    ).toThrow(/must not carry data/);
  });

  it('rejects conflicting canonical versions with one stable object ID', () => {
    const first = makeObject({ sourceIdentity: 'stable', revision: 1, payload: { value: 1 } });
    const second = makeObject({ sourceIdentity: 'stable', revision: 2, payload: { value: 2 } });
    expect(() => createPortableBundle({ namespace: 'personal', objects: [first, second] })).toThrow(
      /conflicting object versions/,
    );
  });

  it('rejects conflicting source byte entries for one Source object', () => {
    const source = makeObject({ type: 'Source', sourceIdentity: 'stable-source' });
    expect(() =>
      createPortableBundle({
        namespace: 'personal',
        objects: [source],
        source_bytes: [sourceBytes(source, 'one'), sourceBytes(source, 'two')],
      }),
    ).toThrow(/conflicting source byte/);
  });
});

describe('C5 portable bundle validation and import planning', () => {
  it('rejects non-object, unsupported portability and unsupported schema', () => {
    const bundle = createPortableBundle({ namespace: 'personal', objects: [makeObject()] });
    expect(() => validatePortableBundle(null)).toThrow(/must be an object/);
    expect(() => validatePortableBundle({ ...bundle, portability_version: '2' })).toThrow(/unsupported portability/);
    expect(() => validatePortableBundle({ ...bundle, schema_version: '0.4' })).toThrow(/schema version/);
  });

  it('rejects missing required arrays and checksum/entry tamper before planning', () => {
    const bundle = createPortableBundle({ namespace: 'personal', objects: [makeObject()] });
    expect(() => validatePortableBundle({ ...bundle, objects: null })).toThrow(/structure/);
    expect(() => validatePortableBundle({ ...bundle, review_receipt_ids: null })).toThrow(/structure/);
    expect(() => validatePortableBundle({ ...bundle, manifest_checksum: `sha256:${'0'.repeat(64)}` })).toThrow(
      /checksum/,
    );
    const tampered = structuredClone(bundle);
    (tampered.objects[0] as { entry_checksum: string }).entry_checksum = `sha256:${'1'.repeat(64)}`;
    expect(() => validatePortableBundle(tampered)).toThrow();
  });

  it('plans ADD, UNCHANGED and REVIEW_REQUIRED without physical writes', () => {
    const add = makeObject({ sourceIdentity: 'add' });
    const unchanged = makeObject({ sourceIdentity: 'same' });
    const incoming = makeObject({ sourceIdentity: 'review', revision: 2, payload: { v: 2 } });
    const localReview = makeObject({
      sourceIdentity: 'review',
      revision: 1,
      review: 'ACCEPTED',
      payload: { v: 1 },
    });
    const bundle = createPortableBundle({
      namespace: 'personal',
      objects: [add, unchanged, incoming],
      exported_at: '2026-08-11T10:00:00Z',
    });
    const plan = planPortableImport(bundle, [unchanged, localReview], '2026-08-11T11:00:00Z');

    expect(plan.operations.map((entry) => [entry.object_id, entry.operation])).toEqual([
      [add.object_id, 'ADD'],
      [incoming.object_id, 'REVIEW_REQUIRED'],
      [unchanged.object_id, 'UNCHANGED'],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect(plan.physical_write_performed).toBe(false);
    expect(plan.operations.find((entry) => entry.object_id === incoming.object_id)?.local_review_state).toBe('ACCEPTED');
  });

  it('keeps import plan identity stable across planning time', () => {
    const object = makeObject();
    const bundle = createPortableBundle({ namespace: 'personal', objects: [object] });
    const a = planPortableImport(bundle, [], '2026-08-11T10:00:00Z');
    const b = planPortableImport(bundle, [], '2026-08-11T12:00:00Z');
    expect(a.plan_id).toBe(b.plan_id);
    expect(a.planned_at).not.toBe(b.planned_at);
  });

  it('rejects conflicting local versions before returning any import plan', () => {
    const incoming = makeObject({ sourceIdentity: 'local-conflict' });
    const localA = makeObject({ sourceIdentity: 'local-conflict', revision: 1, payload: { v: 1 } });
    const localB = makeObject({ sourceIdentity: 'local-conflict', revision: 2, payload: { v: 2 } });
    const bundle = createPortableBundle({ namespace: 'personal', objects: [incoming] });
    expect(() => planPortableImport(bundle, [localA, localB])).toThrow(/conflicting local versions/);
  });
});
