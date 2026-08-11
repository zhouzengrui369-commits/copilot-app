import { describe, expect, it } from 'vitest';
import {
  createCapabilityManifest,
  negotiateCapability,
  validateCapabilityManifest,
  validateCapabilitySession,
  type CapabilitySession,
} from '../src/shared-engine/index.js';

function manifest() {
  return createCapabilityManifest({
    capability_id: 'agent.structural-test',
    consumer_id: 'client.structural-test',
    namespaces: ['personal'],
    purposes: ['retrieval'],
    privacy_ceiling: 'D1',
    allowed_read_types: ['Knowledge'],
    write_mode: 'NONE',
    expires_at: '2026-08-12T00:00:00Z',
  });
}

describe('C4 capability structural fail-closed validation', () => {
  it('rejects array manifests and non-array namespace/purpose grants', () => {
    const value = manifest();
    expect(() => validateCapabilityManifest([])).toThrow(/must be an object/);
    expect(() => validateCapabilityManifest({ ...value, namespaces: 'personal' })).toThrow(/namespaces/);
    expect(() => validateCapabilityManifest({ ...value, purposes: 'retrieval' })).toThrow(/purposes/);
  });

  it('rejects non-array object-type grants and missing expiration structure', () => {
    const value = manifest();
    expect(() => validateCapabilityManifest({ ...value, allowed_read_types: 'Knowledge' })).toThrow(
      /allowed_read_types/,
    );
    expect(() => validateCapabilityManifest({ ...value, expires_at: undefined })).toThrow(/expires_at/);
  });

  it('rejects non-string manifest identities after a structurally valid rebuild', () => {
    const value = manifest();
    expect(() => validateCapabilityManifest({ ...value, manifest_id: null })).toThrow(/identity/);
  });

  it('rejects non-object and array capability sessions before reading nested authority', () => {
    expect(() => validateCapabilitySession(null as never)).toThrow(/session must be an object/);
    expect(() => validateCapabilitySession([] as never)).toThrow(/session must be an object/);
  });

  it('rejects structurally valid sessions whose embedded manifest loses required arrays', () => {
    const session = negotiateCapability(manifest(), '0.3.0-draft', '2026-08-11T10:00:00Z');
    const malformed = {
      ...session,
      manifest: { ...session.manifest, allowed_read_types: null },
    } as unknown as CapabilitySession;
    expect(() => validateCapabilitySession(malformed, '2026-08-11T10:01:00Z')).toThrow(/allowed_read_types/);
  });
});
