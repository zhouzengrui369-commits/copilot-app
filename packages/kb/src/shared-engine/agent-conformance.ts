import {
  AGENT_API_CONTRACT_VERSION,
  createCapabilityManifest,
  type CapabilityManifest,
} from './capability.js';
import { receiptId } from './identity.js';

export const AGENT_CONFORMANCE_FIXTURE_VERSION = 'c4-r1' as const;

export interface AgentConformanceFixture {
  fixture_id: string;
  fixture_version: typeof AGENT_CONFORMANCE_FIXTURE_VERSION;
  contract_version: typeof AGENT_API_CONTRACT_VERSION;
  read_write_manifest: CapabilityManifest;
  read_only_manifest: CapabilityManifest;
  expected_allowed_namespace: 'personal';
  expected_allowed_purpose: 'retrieval';
  expected_write_purpose: 'knowledge_management';
  expected_denials: readonly [
    'UNSUPPORTED_CONTRACT_VERSION',
    'NAMESPACE_NOT_GRANTED',
    'PURPOSE_NOT_GRANTED',
    'WRITE_NOT_GRANTED',
    'CAPABILITY_EXPIRED',
  ];
  data_class_ceiling: 'D1';
}

export function buildAgentConformanceFixture(): AgentConformanceFixture {
  const readWriteManifest = createCapabilityManifest({
    capability_id: 'fixture.agent.read-write-proposal',
    consumer_id: 'fixture.client',
    namespaces: ['personal'],
    purposes: ['knowledge_management', 'retrieval'],
    privacy_ceiling: 'D1',
    allowed_read_types: ['Source', 'Knowledge', 'Entity', 'Relation'],
    write_mode: 'WRITE_PROPOSAL',
    expires_at: null,
  });
  const readOnlyManifest = createCapabilityManifest({
    capability_id: 'fixture.agent.read-only',
    consumer_id: 'fixture.client',
    namespaces: ['personal'],
    purposes: ['retrieval'],
    privacy_ceiling: 'D1',
    allowed_read_types: ['Source', 'Knowledge', 'Entity', 'Relation'],
    write_mode: 'NONE',
    expires_at: null,
  });
  const fixtureBase = {
    fixture_version: AGENT_CONFORMANCE_FIXTURE_VERSION,
    contract_version: AGENT_API_CONTRACT_VERSION,
    read_write_manifest: readWriteManifest,
    read_only_manifest: readOnlyManifest,
    expected_allowed_namespace: 'personal' as const,
    expected_allowed_purpose: 'retrieval' as const,
    expected_write_purpose: 'knowledge_management' as const,
    expected_denials: [
      'UNSUPPORTED_CONTRACT_VERSION',
      'NAMESPACE_NOT_GRANTED',
      'PURPOSE_NOT_GRANTED',
      'WRITE_NOT_GRANTED',
      'CAPABILITY_EXPIRED',
    ] as const,
    data_class_ceiling: 'D1' as const,
  };
  return {
    fixture_id: receiptId('agent-conformance', fixtureBase),
    ...fixtureBase,
  };
}
