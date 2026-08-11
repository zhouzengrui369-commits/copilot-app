import { describe, expect, it } from 'vitest';
import {
  AGENT_API_CONTRACT_VERSION,
  CAPABILITY_MANIFEST_VERSION,
  assertCapabilityActive,
  buildAgentConformanceFixture,
  createCapabilityManifest,
  negotiateCapability,
  validateCapabilityManifest,
  validateCapabilitySession,
  type CapabilityManifest,
  type CapabilitySession,
} from '../src/shared-engine/index.js';

function manifest() {
  return createCapabilityManifest({
    capability_id: 'agent.reader',
    consumer_id: 'client.desktop',
    namespaces: ['personal', 'work'],
    purposes: ['retrieval', 'knowledge_management'],
    privacy_ceiling: 'D1',
    allowed_read_types: ['Knowledge', 'Source', 'Entity', 'Relation'],
    write_mode: 'WRITE_PROPOSAL',
    expires_at: '2026-08-12T00:00:00.000Z',
  });
}

describe('C4 capability manifest identity and normalization', () => {
  it('pins exact Agent API and manifest versions', () => {
    const value = manifest();
    expect(value.contract_version).toBe(AGENT_API_CONTRACT_VERSION);
    expect(value.contract_version).toBe('0.3.0-draft');
    expect(value.manifest_version).toBe(CAPABILITY_MANIFEST_VERSION);
    expect(value.manifest_version).toBe('1');
  });

  it('normalizes grant order/duplicates into a deterministic manifest identity', () => {
    const first = manifest();
    const second = createCapabilityManifest({
      capability_id: 'agent.reader',
      consumer_id: 'client.desktop',
      namespaces: ['work', 'personal', 'personal'],
      purposes: ['knowledge_management', 'retrieval', 'retrieval'],
      privacy_ceiling: 'D1',
      allowed_read_types: ['Relation', 'Entity', 'Source', 'Knowledge', 'Knowledge'],
      write_mode: 'WRITE_PROPOSAL',
      expires_at: '2026-08-12T00:00:00Z',
    });
    expect(second).toEqual(first);
    expect(first.namespaces).toEqual(['personal', 'work']);
    expect(first.purposes).toEqual(['knowledge_management', 'retrieval']);
    expect(first.allowed_read_types).toEqual(['Entity', 'Knowledge', 'Relation', 'Source']);
  });

  it('changes manifest identity whenever effective authority changes', () => {
    const base = manifest();
    const changedPurpose = createCapabilityManifest({
      capability_id: base.capability_id,
      consumer_id: base.consumer_id,
      namespaces: base.namespaces,
      purposes: ['retrieval'],
      privacy_ceiling: base.privacy_ceiling,
      allowed_read_types: base.allowed_read_types,
      write_mode: base.write_mode,
      expires_at: base.expires_at,
    });
    const readOnly = createCapabilityManifest({
      capability_id: base.capability_id,
      consumer_id: base.consumer_id,
      namespaces: base.namespaces,
      purposes: base.purposes,
      privacy_ceiling: base.privacy_ceiling,
      allowed_read_types: base.allowed_read_types,
      write_mode: 'NONE',
      expires_at: base.expires_at,
    });
    expect(changedPurpose.manifest_id).not.toBe(base.manifest_id);
    expect(readOnly.manifest_id).not.toBe(base.manifest_id);
  });

  it('supports non-expiring least-privilege manifests', () => {
    const value = createCapabilityManifest({
      capability_id: 'agent.public-reader',
      consumer_id: 'client.test',
      namespaces: ['personal'],
      purposes: ['retrieval'],
      privacy_ceiling: 'D0',
      allowed_read_types: ['Knowledge'],
      write_mode: 'NONE',
    });
    expect(value.expires_at).toBeNull();
    expect(value.privacy_ceiling).toBe('D0');
    expect(value.write_mode).toBe('NONE');
    expect(() => assertCapabilityActive(value, '2099-01-01T00:00:00Z')).not.toThrow();
  });
});

describe('C4 manifest fail-closed validation', () => {
  it('rejects invalid capability and consumer identifiers', () => {
    const base = {
      namespaces: ['personal'],
      purposes: ['retrieval'],
      privacy_ceiling: 'D1' as const,
      allowed_read_types: ['Knowledge'] as const,
      write_mode: 'NONE' as const,
    };
    expect(() => createCapabilityManifest({ ...base, capability_id: ' ', consumer_id: 'client' })).toThrow(
      /capability_id/,
    );
    expect(() => createCapabilityManifest({ ...base, capability_id: 'agent', consumer_id: 'bad consumer' })).toThrow(
      /consumer_id/,
    );
  });

  it('rejects empty/invalid namespace and purpose grants', () => {
    const base = {
      capability_id: 'agent',
      consumer_id: 'client',
      privacy_ceiling: 'D1' as const,
      allowed_read_types: ['Knowledge'] as const,
      write_mode: 'NONE' as const,
    };
    expect(() => createCapabilityManifest({ ...base, namespaces: [], purposes: ['retrieval'] })).toThrow(/namespaces/);
    expect(() => createCapabilityManifest({ ...base, namespaces: ['bad namespace'], purposes: ['retrieval'] })).toThrow(
      /namespaces/,
    );
    expect(() => createCapabilityManifest({ ...base, namespaces: ['personal'], purposes: [] })).toThrow(/purposes/);
    expect(() => createCapabilityManifest({ ...base, namespaces: ['personal'], purposes: ['bad purpose'] })).toThrow(
      /purposes/,
    );
  });

  it('rejects empty/unsupported read object types, D2/D3 ceiling and unknown write mode', () => {
    const base = {
      capability_id: 'agent',
      consumer_id: 'client',
      namespaces: ['personal'],
      purposes: ['retrieval'],
      write_mode: 'NONE' as const,
    };
    expect(() => createCapabilityManifest({ ...base, privacy_ceiling: 'D1', allowed_read_types: [] })).toThrow(
      /allowed_read_types/,
    );
    expect(() =>
      createCapabilityManifest({ ...base, privacy_ceiling: 'D1', allowed_read_types: ['PhysicalRow'] as never }),
    ).toThrow(/allowed_read_types/);
    expect(() =>
      createCapabilityManifest({ ...base, privacy_ceiling: 'D2' as never, allowed_read_types: ['Knowledge'] }),
    ).toThrow(/privacy ceiling/);
    expect(() =>
      createCapabilityManifest({
        ...base,
        privacy_ceiling: 'D1',
        allowed_read_types: ['Knowledge'],
        write_mode: 'CANONICAL_WRITE' as never,
      }),
    ).toThrow(/write mode/);
  });

  it('rejects malformed expiration time', () => {
    expect(() =>
      createCapabilityManifest({
        capability_id: 'agent',
        consumer_id: 'client',
        namespaces: ['personal'],
        purposes: ['retrieval'],
        privacy_ceiling: 'D1',
        allowed_read_types: ['Knowledge'],
        write_mode: 'NONE',
        expires_at: 'not-a-time',
      }),
    ).toThrow();
  });

  it('rejects non-object, version mismatch, manifest-version mismatch and tampering', () => {
    const value = manifest();
    expect(() => validateCapabilityManifest(null)).toThrow(/must be an object/);
    expect(() => validateCapabilityManifest({ ...value, contract_version: '9.9.9' })).toThrow(/contract version/);
    expect(() => validateCapabilityManifest({ ...value, manifest_version: '2' })).toThrow(/manifest version/);
    expect(() => validateCapabilityManifest({ ...value, manifest_id: 'ske-receipt:capability-manifest:sha256:tampered' })).toThrow(
      /identity/,
    );
    expect(() => validateCapabilityManifest({ ...value, extra_admin_grant: true })).toThrow(/identity/);
  });
});

describe('C4 capability negotiation and expiry', () => {
  it('negotiates the exact contract and stable session identity', () => {
    const value = manifest();
    const first = negotiateCapability(value, '0.3.0-draft', '2026-08-11T10:00:00Z');
    const second = negotiateCapability(value, '0.3.0-draft', '2026-08-11T11:00:00Z');
    expect(first.session_id).toBe(second.session_id);
    expect(first.negotiated_at).not.toBe(second.negotiated_at);
    expect(first.negotiated_contract_version).toBe('0.3.0-draft');
  });

  it('denies unsupported version and already-expired capability', () => {
    const value = manifest();
    expect(() => negotiateCapability(value, '0.4.0', '2026-08-11T10:00:00Z')).toThrow(/requested contract version/);
    expect(() => negotiateCapability(value, '0.3.0-draft', '2026-08-12T00:00:00Z')).toThrow(/expired/);
  });

  it('re-checks expiry on every session validation', () => {
    const value = manifest();
    const session = negotiateCapability(value, '0.3.0-draft', '2026-08-11T10:00:00Z');
    expect(() => validateCapabilitySession(session, '2026-08-11T23:59:59Z')).not.toThrow();
    expect(() => validateCapabilitySession(session, '2026-08-12T00:00:00Z')).toThrow(/expired/);
  });

  it('rejects tampered session identity, negotiated version and negotiation timestamp', () => {
    const session = negotiateCapability(manifest(), '0.3.0-draft', '2026-08-11T10:00:00Z');
    const malformed: CapabilitySession[] = [
      { ...session, session_id: 'tampered' },
      { ...session, negotiated_contract_version: '9.9.9' as never },
      { ...session, negotiated_at: 'not-a-time' },
    ];
    for (const value of malformed) expect(() => validateCapabilitySession(value, '2026-08-11T10:01:00Z')).toThrow();
  });

  it('detects a tampered manifest inside an otherwise valid session', () => {
    const session = negotiateCapability(manifest(), '0.3.0-draft', '2026-08-11T10:00:00Z');
    const tampered: CapabilityManifest = { ...session.manifest, purposes: ['admin'] };
    expect(() => validateCapabilitySession({ ...session, manifest: tampered }, '2026-08-11T10:01:00Z')).toThrow(/identity/);
  });
});

describe('C4 deterministic conformance fixture', () => {
  it('produces stable D0/D1-only client authority and fixture identity', () => {
    const first = buildAgentConformanceFixture();
    const second = buildAgentConformanceFixture();
    expect(second).toEqual(first);
    expect(first.fixture_version).toBe('c4-r1');
    expect(first.contract_version).toBe('0.3.0-draft');
    expect(first.data_class_ceiling).toBe('D1');
    expect(first.read_write_manifest.write_mode).toBe('WRITE_PROPOSAL');
    expect(first.read_only_manifest.write_mode).toBe('NONE');
    expect(first.read_write_manifest.privacy_ceiling).toBe('D1');
    expect(first.expected_denials).toContain('CAPABILITY_EXPIRED');
  });
});
