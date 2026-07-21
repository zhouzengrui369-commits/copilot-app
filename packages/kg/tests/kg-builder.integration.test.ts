import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EntityExtractor } from '../src/builder/entity-extractor.js';
import { KgStore } from '../src/store/sqlite-store.js';
import type { ChatRequest, ChatResponse, LLMProvider } from '@copilot/llm-client';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

class DeterministicEntityProvider implements LLMProvider {
  readonly name = 'deterministic-local-fixture';
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const note = request.messages.at(-1)?.content ?? '';
    const entities = note.includes('Second note')
      ? [
          { type: 'concept', name: 'Knowledge Graph', aliases: ['KG'], confidence: 0.94 },
          { type: 'concept', name: 'RAG', confidence: 0.91 },
        ]
      : [
          { type: 'concept', name: 'Knowledge Graph', confidence: 0.96 },
          { type: 'person', name: 'Ada Lovelace', confidence: 0.93 },
        ];
    return {
      content: JSON.stringify(entities),
      model: 'fixture',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
  async *chatStream() { yield { delta: '', finishReason: 'stop' as const }; }
  countTokens() { return 0; }
}

describe('Phase 1 deterministic local KG build/query integration', () => {
  it('extracts two notes, merges shared entities, persists relations, and reopens the graph', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-builder-int-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'kg.sqlite');
    const extractor = new EntityExtractor({
      provider: new DeterministicEntityProvider(),
      defaultModel: 'fixture',
    });
    const store = new KgStore({ dbPath });
    const notes = [
      { note_path: 'notes/one', note_title: 'First note', note_body: 'Ada studies Knowledge Graph.' },
      { note_path: 'notes/two', note_title: 'Second note', note_body: 'Second note connects Knowledge Graph and RAG.' },
    ];

    for (const note of notes) {
      const entities = await extractor.extract(note);
      for (const entity of entities) {
        store.upsertEntity(entity, 1_700_000_000_000);
        store.linkNoteEntity(note.note_path, entity.entity_id);
      }
    }
    store.upsertRelation({
      from_entity_id: 'concept:knowledge-graph',
      to_entity_id: 'concept:rag',
      rel: 'related_to',
      weight: 0.9,
      evidence_note: 'notes/two',
    }, 1_700_000_000_001);

    expect(store.countNodes()).toBe(3);
    expect(store.getEntityByIdString('concept:knowledge-graph')?.source_notes.sort())
      .toEqual(['notes/one', 'notes/two']);
    expect(store.entitiesForNote('notes/two').map((entity) => entity.name).sort())
      .toEqual(['Knowledge Graph', 'RAG']);
    expect(store.edgesFrom('concept:knowledge-graph')).toHaveLength(1);
    store.close();

    const reopened = new KgStore({ dbPath });
    expect(reopened.listNodes().map((entity) => entity.entity_id).sort()).toEqual([
      'concept:knowledge-graph',
      'concept:rag',
      'person:ada-lovelace',
    ]);
    expect(reopened.listEdges()[0]).toMatchObject({
      from_entity_id: 'concept:knowledge-graph',
      to_entity_id: 'concept:rag',
      evidence: ['notes/two'],
    });
    reopened.close();
  });
});
