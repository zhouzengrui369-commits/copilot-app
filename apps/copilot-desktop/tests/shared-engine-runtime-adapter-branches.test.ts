import { describe, expect, it } from 'vitest';
import type { NoteDocument } from '../src/shared/domain-api.js';
import {
  createDesktopAgentSession,
  createDesktopPortableRoundtripPlan,
  mapDesktopKgSubgraph,
  mapDesktopNoteDocument,
  mapDesktopRagSourceDetails,
  readRequestForDesktopContext,
  type DesktopSharedEngineContext,
} from '../src/main/shared-engine-runtime-adapter.js';

const minimalContext: DesktopSharedEngineContext = {
  namespace: 'personal',
  actorId: 'owner',
  purpose: 'retrieval',
  consumerId: 'agent.runtime-branches',
};

function note(body = 'synthetic branch coverage body'): NoteDocument {
  return {
    note: {
      id: 77,
      path: 'inbox/runtime-branches',
      title: 'Runtime Branches',
      type: 'note',
      status: 'active',
      tags: ['runtime'],
      related: [],
      folder: 'inbox',
      createdAt: 1_786_430_000_000,
      updatedAt: 1_786_430_100_000,
      confidence: 0.9,
      agent: null,
    },
    body,
  };
}

describe('C6 fail-closed structural branches', () => {
  it('rejects non-object, missing-note and non-string-body NoteDocument variants', () => {
    expect(() => mapDesktopNoteDocument(42 as never, minimalContext)).toThrow(/malformed/);
    expect(() => mapDesktopNoteDocument({ body: 'x' } as never, minimalContext)).toThrow(/malformed/);
    expect(() =>
      mapDesktopNoteDocument({ note: note().note, body: 42 } as never, minimalContext),
    ).toThrow(/malformed/);
  });

  it('fails closed independently for every required desktop context identity', () => {
    for (const key of ['namespace', 'actorId', 'purpose', 'consumerId'] as const) {
      expect(() => mapDesktopNoteDocument(note(), { ...minimalContext, [key]: ' ' })).toThrow(
        /context is incomplete/,
      );
    }
  });

  it('rejects null subgraphs and malformed edge collections independently', () => {
    expect(() => mapDesktopKgSubgraph(null as never, minimalContext)).toThrow(/malformed/);
    expect(() =>
      mapDesktopKgSubgraph({ nodes: [], edges: null, degree: {} } as never, minimalContext),
    ).toThrow(/malformed/);
  });
});

describe('C6 fail-closed retrieval score branches', () => {
  it('rejects scores below zero and above one independently', () => {
    const mapped = mapDesktopNoteDocument(note(), minimalContext);
    expect(() =>
      mapDesktopRagSourceDetails(
        [{ notePath: mapped.note_path, evidence: ['vector'], score: -0.01 }],
        [mapped],
      ),
    ).toThrow(/score/);
    expect(() =>
      mapDesktopRagSourceDetails(
        [{ notePath: mapped.note_path, evidence: ['vector'], score: 1.01 }],
        [mapped],
      ),
    ).toThrow(/score/);
  });
});

describe('C6 least-privilege default branches', () => {
  it('defaults an omitted desktop capability to D1, read-only and non-expiring', () => {
    const session = createDesktopAgentSession(minimalContext);
    expect(session.manifest.privacy_ceiling).toBe('D1');
    expect(session.manifest.write_mode).toBe('NONE');
    expect(session.manifest.expires_at).toBeNull();
    expect(session.manifest.capability_id).toBe('desktop:agent.runtime-branches');

    const request = readRequestForDesktopContext(minimalContext);
    expect(request.privacy_ceiling).toBe('D1');
    expect(request.allowed_object_types).toEqual(['Knowledge']);
  });

  it('keeps default portability byte-exact for an empty D1 source without physical writes', () => {
    const result = createDesktopPortableRoundtripPlan([note('')], minimalContext);
    expect(result.bundle.source_bytes).toHaveLength(1);
    expect(result.bundle.source_bytes[0]?.privacy_class).toBe('D1');
    expect(result.bundle.source_bytes[0]?.byte_length).toBe(0);
    expect(result.bundle.source_bytes[0]?.data_base64).toBe('');
    expect(result.import_plan.physical_write_performed).toBe(false);
  });
});
