import { describe, expect, it } from 'vitest';
import * as agentApiModule from '../src/shared-engine/agent-api.js';
import {
  buildAgentConformanceFixture,
  createCapabilityManifest,
  createProjection,
  mapLegacyNote,
  negotiateCapability,
  readCanonicalObjects,
  retrieveForAgent,
  submitAgentWriteProposal,
  type C1AdapterContext,
  type CanonicalObject,
  type CapabilityManifest,
  type LegacyNoteSnapshot,
} from '../src/shared-engine/index.js';

const note: LegacyNoteSnapshot = {
  path: 'agent/c4',
  title: 'C4 Private Title',
  type: 'note',
  status: 'active',
  tags: ['agent'],
  related: [],
  sourceHash: 'c4-source',
  createdAt: 1_786_400_000_000,
  updatedAt: 1_786_400_100_000,
  confidence: 0.9,
  agent: null,
  body: 'PRIVATE_C4_BODY',
};

function mapping(capabilityId = 'agent.reader') {
  const context: C1AdapterContext = {
    namespace: 'personal',
    actorId: 'user:owner',
    purposes: ['retrieval', 'knowledge_management'],
    allowedConsumers: [capabilityId],
    privacyClass: 'D1',
  };
  return mapLegacyNote(note, context);
}

function manifest(input: Partial<CapabilityManifest> = {}) {
  const base = createCapabilityManifest({
    capability_id: 'agent.reader',
    consumer_id: 'client.agent-test',
    namespaces: ['personal'],
    purposes: ['retrieval', 'knowledge_management'],
    privacy_ceiling: 'D1',
    allowed_read_types: ['Source', 'Knowledge', 'Entity', 'Relation'],
    write_mode: 'WRITE_PROPOSAL',
    expires_at: null,
  });
  return { ...base, ...input } as CapabilityManifest;
}

function session(value = manifest()) {
  return negotiateCapability(value, '0.3.0-draft', '2026-08-11T10:00:00Z');
}

describe('C4 policy-filtered read-by-ID API', () => {
  it('returns only authorized requested objects and binds a deterministic API receipt', () => {
    const mapped = mapping();
    const first = readCanonicalObjects({
      session: session(),
      canonical_objects: [mapped.knowledge.object, mapped.source.object],
      object_ids: [mapped.knowledge.object.object_id],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:10:00Z',
    });
    const second = readCanonicalObjects({
      session: session(),
      canonical_objects: [mapped.source.object, mapped.knowledge.object],
      object_ids: [mapped.knowledge.object.object_id, mapped.knowledge.object.object_id],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:11:00Z',
    });
    expect(first.objects.map((object) => object.object_id)).toEqual([mapped.knowledge.object.object_id]);
    expect(first.receipt.decision).toBe('ALLOW');
    expect(first.receipt.receipt_id).toBe(second.receipt.receipt_id);
    expect(first.receipt.completed_at).not.toBe(second.receipt.completed_at);
  });

  it('returns partial audit for allowed + missing IDs without user-content leakage', () => {
    const mapped = mapping();
    const missing = 'ske:0.3:knowledge:sha256:' + 'f'.repeat(64);
    const result = readCanonicalObjects({
      session: session(),
      canonical_objects: [mapped.knowledge.object],
      object_ids: [missing, mapped.knowledge.object.object_id],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:12:00Z',
    });
    expect(result.receipt.decision).toBe('PARTIAL');
    expect(result.receipt.denied).toEqual([{ object_id: missing, reason: 'OBJECT_NOT_FOUND' }]);
    const serialized = JSON.stringify(result.receipt);
    expect(serialized).not.toContain(note.title);
    expect(serialized).not.toContain(note.body);
  });

  it('denies D2 objects and never returns denied content', () => {
    const mapped = mapping();
    const d2: CanonicalObject = { ...mapped.knowledge.object, privacy_class: 'D2' };
    const result = readCanonicalObjects({
      session: session(),
      canonical_objects: [d2],
      object_ids: [d2.object_id],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:13:00Z',
    });
    expect(result.objects).toEqual([]);
    expect(result.receipt.decision).toBe('DENY');
    expect(result.receipt.denied).toEqual([{ object_id: d2.object_id, reason: 'PRIVACY_DENIED' }]);
    expect(JSON.stringify(result.receipt)).not.toContain(note.title);
  });

  it('fails closed on ungranted namespace/purpose and empty requests', () => {
    const mapped = mapping();
    const base = {
      session: session(),
      canonical_objects: [mapped.knowledge.object],
      object_ids: [mapped.knowledge.object.object_id],
    };
    expect(() => readCanonicalObjects({ ...base, namespace: 'work', purpose: 'retrieval' })).toThrow(
      /namespace is not granted/,
    );
    expect(() => readCanonicalObjects({ ...base, namespace: 'personal', purpose: 'admin' })).toThrow(
      /purpose is not granted/,
    );
    expect(() =>
      readCanonicalObjects({
        ...base,
        object_ids: [],
        namespace: 'personal',
        purpose: 'retrieval',
      }),
    ).toThrow(/at least one object_id/);
  });

  it('denies object types outside the manifest read grant', () => {
    const mapped = mapping();
    const knowledgeOnly = createCapabilityManifest({
      capability_id: 'agent.reader',
      consumer_id: 'client.agent-test',
      namespaces: ['personal'],
      purposes: ['retrieval'],
      privacy_ceiling: 'D1',
      allowed_read_types: ['Knowledge'],
      write_mode: 'NONE',
      expires_at: null,
    });
    const result = readCanonicalObjects({
      session: session(knowledgeOnly),
      canonical_objects: [mapped.source.object],
      object_ids: [mapped.source.object.object_id],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:14:00Z',
    });
    expect(result.objects).toEqual([]);
    expect(result.receipt.denied[0]?.reason).toBe('OBJECT_TYPE_DENIED');
  });

  it('rejects conflicting canonical versions and malformed request IDs', () => {
    const object = mapping().knowledge.object;
    expect(() =>
      readCanonicalObjects({
        session: session(),
        canonical_objects: [object, { ...object, content_hash: 'sha256:' + '1'.repeat(64), revision: 2 }],
        object_ids: [object.object_id],
        namespace: 'personal',
        purpose: 'retrieval',
      }),
    ).toThrow(/conflicting versions/);
    expect(() =>
      readCanonicalObjects({
        session: session(),
        canonical_objects: [object],
        object_ids: ['bad object id'],
        namespace: 'personal',
        purpose: 'retrieval',
      }),
    ).toThrow(/object_id is invalid/);
  });
});

describe('C4 Agent retrieval delegation', () => {
  it('delegates ranking to C3 stale/policy-safe retrieval and links its receipt', () => {
    const object = mapping().knowledge.object;
    const projection = createProjection(object, 'VECTOR', { vector: 'hash-only' }, { recipe_id: 'agent', recipe_version: '1' });
    const result = retrieveForAgent({
      session: session(),
      canonical_objects: [object],
      hits: [{ projection, retrieval_kind: 'VECTOR', score: 0.91 }],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:20:00Z',
    });
    expect(result.retrieval.results[0]?.object_id).toBe(object.object_id);
    expect(result.receipt.decision).toBe('ALLOW');
    expect(result.receipt.linked_receipt_id).toBe(result.retrieval.receipt.receipt_id);
  });

  it('does not leak denied retrieval scores or projection payload in the Agent API receipt', () => {
    const object: CanonicalObject = { ...mapping().knowledge.object, privacy_class: 'D2' };
    const projection = createProjection(object, 'VECTOR', { private_payload: 'SECRET_VECTOR' }, { recipe_id: 'agent', recipe_version: '1' });
    const result = retrieveForAgent({
      session: session(),
      canonical_objects: [object],
      hits: [{ projection, retrieval_kind: 'VECTOR', score: 0.99 }],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:21:00Z',
    });
    expect(result.retrieval.results).toEqual([]);
    expect(result.receipt.decision).toBe('DENY');
    expect(result.receipt.denied[0]?.reason).toBe('PRIVACY_DENIED');
    const receipt = JSON.stringify(result.receipt);
    expect(receipt).not.toContain('0.99');
    expect(receipt).not.toContain('SECRET_VECTOR');
    expect(receipt).not.toContain('projection_payload_hash');
  });

  it('cannot revive a stale projection through the Agent API wrapper', () => {
    const object = mapping().knowledge.object;
    const staleProjection = createProjection(object, 'FULL_TEXT', { text: 'old' }, { recipe_id: 'agent', recipe_version: '1' });
    const revised = { ...object, content_hash: 'sha256:' + '2'.repeat(64), revision: object.revision + 1 };
    const result = retrieveForAgent({
      session: session(),
      canonical_objects: [revised],
      hits: [{ projection: staleProjection, retrieval_kind: 'FULL_TEXT', score: 0.95 }],
      namespace: 'personal',
      purpose: 'retrieval',
      completed_at: '2026-08-11T10:22:00Z',
    });
    expect(result.retrieval.results).toEqual([]);
    expect(result.retrieval.receipt.stale).toHaveLength(1);
    expect(result.receipt.allowed_object_ids).toEqual([]);
    expect(result.receipt.decision).toBe('DENY');
  });
});

describe('C4 proposal-only Agent write API', () => {
  it('permits only explicit WRITE_PROPOSAL capability and returns a proposed object', () => {
    const object = mapping().knowledge.object;
    const result = submitAgentWriteProposal({
      session: session(),
      object,
      namespace: 'personal',
      purpose: 'knowledge_management',
      reason_code: 'AGENT_CORRECTION',
      proposed_at: '2026-08-11T10:30:00Z',
    });
    expect(result.proposal.state).toBe('WRITE_PROPOSAL');
    expect(result.proposal.proposed_object.review_state).toBe('PROPOSED');
    expect(result.proposal.proposed_object.updated_by).toBe('agent.reader');
    expect(result.receipt.action).toBe('WRITE_PROPOSAL');
    expect(result.receipt.linked_receipt_id).toBe(result.proposal.proposal_id);
  });

  it('denies write on a read-only manifest', () => {
    const object = mapping('fixture.agent.read-only').knowledge.object;
    const fixture = buildAgentConformanceFixture();
    const readOnlySession = negotiateCapability(fixture.read_only_manifest, '0.3.0-draft', '2026-08-11T10:31:00Z');
    expect(() =>
      submitAgentWriteProposal({
        session: readOnlySession,
        object,
        namespace: 'personal',
        purpose: 'retrieval',
        reason_code: 'NO_WRITE',
      }),
    ).toThrow(/read-only/);
  });

  it('denies proposed objects outside namespace, object type, privacy or consumer scope', () => {
    const object = mapping().knowledge.object;
    expect(() =>
      submitAgentWriteProposal({
        session: session(),
        object: { ...object, namespace: 'work' },
        namespace: 'personal',
        purpose: 'knowledge_management',
        reason_code: 'WRONG_NAMESPACE',
      }),
    ).toThrow(/namespace/);

    const source = mapping().source.object;
    const knowledgeOnly = createCapabilityManifest({
      capability_id: 'agent.reader',
      consumer_id: 'client.agent-test',
      namespaces: ['personal'],
      purposes: ['knowledge_management'],
      privacy_ceiling: 'D1',
      allowed_read_types: ['Knowledge'],
      write_mode: 'WRITE_PROPOSAL',
      expires_at: null,
    });
    expect(() =>
      submitAgentWriteProposal({
        session: session(knowledgeOnly),
        object: source,
        namespace: 'personal',
        purpose: 'knowledge_management',
        reason_code: 'WRONG_TYPE',
      }),
    ).toThrow(/object type/);

    expect(() =>
      submitAgentWriteProposal({
        session: session(),
        object: { ...object, privacy_class: 'D2' },
        namespace: 'personal',
        purpose: 'knowledge_management',
        reason_code: 'D2_DENIED',
      }),
    ).toThrow(/scope|privacy|granted/);

    expect(() =>
      submitAgentWriteProposal({
        session: session(),
        object: { ...object, permission_scope: { ...object.permission_scope, allowed_consumers: ['other.agent'] } },
        namespace: 'personal',
        purpose: 'knowledge_management',
        reason_code: 'CONSUMER_DENIED',
      }),
    ).toThrow(/scope|consumer|granted/);
  });

  it('rejects free-form reason text rather than copying it into proposal/audit receipts', () => {
    const object = mapping().knowledge.object;
    expect(() =>
      submitAgentWriteProposal({
        session: session(),
        object,
        namespace: 'personal',
        purpose: 'knowledge_management',
        reason_code: 'private user sentence must not enter audit',
      }),
    ).toThrow(/reason_code/);
  });

  it('exports no terminal Agent review/commit/delete operations', () => {
    for (const forbidden of [
      'acceptWriteProposal',
      'decideReview',
      'resolveConflict',
      'canonicalWrite',
      'deleteCanonicalObject',
      'syncCanonicalObject',
    ]) {
      expect(forbidden in agentApiModule).toBe(false);
    }
  });
});

describe('C4 session enforcement at operation time', () => {
  it('denies a session that expires after negotiation but before API use', () => {
    const expiring = createCapabilityManifest({
      capability_id: 'agent.reader',
      consumer_id: 'client.agent-test',
      namespaces: ['personal'],
      purposes: ['retrieval'],
      privacy_ceiling: 'D1',
      allowed_read_types: ['Knowledge'],
      write_mode: 'NONE',
      expires_at: '2026-08-11T10:40:00Z',
    });
    const negotiated = negotiateCapability(expiring, '0.3.0-draft', '2026-08-11T10:39:00Z');
    const object = mapping().knowledge.object;
    expect(() =>
      readCanonicalObjects({
        session: negotiated,
        canonical_objects: [object],
        object_ids: [object.object_id],
        namespace: 'personal',
        purpose: 'retrieval',
        completed_at: '2026-08-11T10:40:00Z',
      }),
    ).toThrow(/expired/);
  });
});
