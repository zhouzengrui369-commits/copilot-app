import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResponse, LLMProvider } from '@copilot/llm-client';
import { KgBuilder } from '../src/builder/kg-builder.js';
import { parseRelationResponse } from '../src/builder/relation-extractor.js';
import { normalizeTag, parseTaggerResponse } from '../src/builder/tagger.js';
import {
  NoteSummaryParseError,
  parseNoteSummaryResponse,
  parseSummarizeResponse,
} from '../src/builder/summarizer.js';
import { KgQuery } from '../src/api/query.js';
import { KgStore } from '../src/store/sqlite-store.js';
import type {
  EntityInput,
  KgKnowledgeSource,
  RelationInput,
  TagInput,
} from '../src/types.js';

const noteEntities: EntityInput[] = [
  { entity_id: 'person:张三', type: 'person', name: '张三', source_note: 'notes/a' },
  { entity_id: 'org:腾讯', type: 'org', name: '腾讯', aliases: ['Tencent'], source_note: 'notes/a' },
];

class QueueProvider implements LLMProvider {
  readonly name = 'queue';
  readonly requests: ChatRequest[] = [];

  constructor(private readonly replies: string[]) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    return {
      content: this.replies.shift() ?? '[]',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: request.model,
      finishReason: 'stop',
    };
  }

  async *chatStream(): AsyncGenerator<{ delta: string }> { yield { delta: '' }; }
  countTokens(): number { return 0; }
}

describe('LLM WIKI extraction boundaries', () => {
  it('strictly parses the dedicated note summary schema and Unicode limit', () => {
    expect(parseNoteSummaryResponse('```json\n{"summary":"  一份   本地摘要  "}\n```'))
      .toBe('一份 本地摘要');
    expect(() => parseNoteSummaryResponse('{"summary":"ok","extra":true}'))
      .toThrow(/SCHEMA_INVALID/);
    expect(() => parseNoteSummaryResponse('{"summary":""}'))
      .toThrow(/LENGTH_INVALID/);
    expect(() => parseNoteSummaryResponse(JSON.stringify({ summary: '长'.repeat(241) })))
      .toThrow(/LENGTH_INVALID/);
    expect(() => parseNoteSummaryResponse('not json'))
      .toThrow(/JSON_OBJECT_REQUIRED/);
  });

  it('normalizes relation, tag, and summary responses without inventing nodes', () => {
    const relations = parseRelationResponse(`answer:\n\`\`\`json\n[
      {"from":"张三","to":"Tencent","rel":"works-at","weight":2},
      {"from":"张三","to":"missing","rel":"mentions"},
      {"from":"张三","to":"张三","rel":"related_to"},
    ]\n\`\`\``, {
      note_path: 'notes/a', note_title: 'A', note_body: 'body', entities: noteEntities,
    });
    expect(relations).toEqual([
      expect.objectContaining({
        from_entity_id: 'person:张三',
        to_entity_id: 'org:腾讯',
        rel: 'works_at',
        weight: 1,
      }),
    ]);
    expect(parseRelationResponse('bad json', {
      note_path: 'notes/a', note_title: '', note_body: '', entities: noteEntities,
    })).toEqual([]);

    expect(normalizeTag('  知识 图谱 ')).toBe('知识-图谱');
    expect(parseTaggerResponse('```json\n["AI Agent", {"name":"知识图谱"}, "AI Agent", 3]\n```'))
      .toEqual([{ name: 'ai-agent' }, { name: '知识图谱' }]);
    expect(parseTaggerResponse('bad json')).toEqual([]);

    const summaries = parseSummarizeResponse(JSON.stringify({
      'person:张三': `${'长'.repeat(70)}。`,
      missing: 'invented',
    }), noteEntities);
    expect([...(summaries.get('person:张三') ?? '')]).toHaveLength(60);
    expect(summaries.has('missing')).toBe(false);
    expect(parseSummarizeResponse('[]', noteEntities).size).toBe(0);
  });

  it('constructs production extractors from one provider and persists all WIKI facets', async () => {
    const provider = new QueueProvider([
      JSON.stringify([
        { type: 'person', name: 'Ada', confidence: 0.99 },
        { type: 'concept', name: 'Compiler', confidence: 0.95 },
      ]),
      JSON.stringify([{ from: 'Ada', to: 'Compiler', rel: 'created_by', weight: 0.9 }]),
      JSON.stringify(['Computing']),
      JSON.stringify({ 'person:ada': 'Pioneer', 'concept:compiler': 'Programming tool' }),
      JSON.stringify({ summary: 'Ada created an early compiler.' }),
    ]);
    const store = new KgStore({ dbPath: ':memory:' });
    const builder = new KgBuilder({ store, provider });
    const result = await builder.buildNote({
      path: 'history/ada', title: 'Ada', body: 'Ada created a compiler.',
    });
    expect(result).toEqual(expect.objectContaining({
      entitiesTotal: 2, relationsTotal: 1, tagsTotal: 1,
    }));
    expect(store.listNodes().map((node) => node.summary)).toEqual(['Pioneer', 'Programming tool']);
    expect(store.listTags()).toEqual([expect.objectContaining({ name: 'computing', note_count: 1 })]);
    expect(store.listWikiProjectionsForNote('history/ada')[0]).toMatchObject({
      status: 'current',
      summary: 'Ada created an early compiler.',
      provider: 'queue',
      model: 'MiniMax-M3',
    });
    expect(provider.requests).toHaveLength(5);
    expect(provider.requests.every((request) => request.model === 'MiniMax-M3')).toBe(true);
    store.close();
  });

  it('binds provider validation to the extractor schema instead of prompt text', async () => {
    const provider = new QueueProvider([JSON.stringify(['tag-shaped-not-entities'])]);
    const store = new KgStore({ dbPath: ':memory:' });
    const result = await new KgBuilder({ store, provider }).buildNote({
      path: 'schema/entity',
      title: 'Entity schema',
      body: 'The response must use the entity schema.',
    });
    expect(result.status).toBe('failed');
    expect(store.listWikiProjectionsForNote('schema/entity')[0]).toMatchObject({
      status: 'failed',
      failure_stage: 'parse',
      failure_reason: 'WIKI_SCHEMA_VALIDATION_FAILED',
    });
    expect(provider.requests).toHaveLength(1);
    store.close();
  });
});

describe('atomic incremental graph and local query', () => {
  it('replaces stale contributions, preserves shared entities, queries subgraphs, and removes notes', async () => {
    const store = new KgStore({ dbPath: ':memory:' });
    let version = 1;
    const builder = new KgBuilder({
      store,
      entityExtractor: {
        extract: async ({ note_path }): Promise<EntityInput[]> => version === 1
          ? noteEntities.map((entity) => ({ ...entity, source_note: note_path }))
          : [{ ...noteEntities[0]!, source_note: note_path }],
      },
      relationExtractor: {
        extract: async ({ note_path, entities }): Promise<RelationInput[]> => entities.length === 2
          ? [{
              from_entity_id: entities[0]!.entity_id,
              to_entity_id: entities[1]!.entity_id,
              rel: 'works_at',
              evidence_note: note_path,
            }]
          : [],
      },
      tagger: {
        extract: async (): Promise<TagInput[]> => [{ name: version === 1 ? 'old' : 'new' }],
      },
      summarizer: {
        summarize: async ({ entities }) => new Map(
          entities.map((entity) => [entity.entity_id, `${version}:${entity.name}`]),
        ),
      },
      noteSummarizer: {
        summarizeNote: async ({ note_title }) => ({
          summary: `${version}:${note_title}`,
          provider: 'fixture',
          model: 'fixture',
        }),
      },
    });

    await builder.buildNote({ path: 'notes/a', title: 'A', body: '张三在腾讯工作' });
    await builder.buildNote({ path: 'notes/b', title: 'B', body: '张三在腾讯工作' });
    expect(store.countNodes()).toBe(2);
    expect(store.countEdges()).toBe(1);
    expect(store.listTags()[0]).toEqual(expect.objectContaining({ name: 'old', note_count: 2 }));

    const query = new KgQuery(store);
    expect(query.searchNodes('张三')).toHaveLength(1);
    expect(query.searchNodes('1:张三')).toHaveLength(1);
    expect(query.subgraph({ center: 'person:张三', hops: 1 })).toEqual(expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ entity_id: 'org:腾讯' })]),
      edges: [expect.objectContaining({ rel: 'works_at' })],
    }));
    expect(query.getNode('person:张三')).toEqual(expect.objectContaining({
      notes: ['notes/a', 'notes/b'],
    }));
    expect(query.fullGraph()).toEqual(expect.objectContaining({ nodes: expect.any(Array), edges: expect.any(Array) }));

    version = 2;
    await builder.buildNote({ path: 'notes/a', title: 'A2', body: '仅张三' });
    expect(store.getEntityByIdString('org:腾讯')?.source_notes).toEqual(['notes/b']);
    expect(store.getEntityByIdString('person:张三')?.summary).toBe('2:张三');
    expect(store.listTags()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'old', note_count: 1 }),
      expect.objectContaining({ name: 'new', note_count: 1 }),
    ]));

    store.removeNoteGraph('notes/b', 3);
    expect(store.getEntityByIdString('org:腾讯')).toBeNull();
    expect(store.countEdges()).toBe(0);
    store.removeNoteGraph('notes/a', 4);
    expect(query.stats()).toEqual({ nodes: 0, edges: 0, tags: 0 });
    store.close();
  });

  it('drains bounded pending items and marks missing, failed, and timed-out notes', async () => {
    const statuses = new Map<string, 'pending' | 'processing' | 'done' | 'failed'>([
      ['ok', 'pending'], ['missing', 'pending'], ['fail', 'pending'], ['slow', 'pending'],
    ]);
    const source: KgKnowledgeSource = {
      listKgPending: () => [...statuses.entries()]
        .filter(([, status]) => status === 'pending')
        .map(([note_path]) => ({ note_path, status: 'pending', queued_at: 0 })),
      setKgStatus: (path, status) => { statuses.set(path, status); },
      readNote: (path) => path === 'missing' ? null : {
        note: { path, title: path, tags: [], related: [] },
        body: path,
      },
    };
    const store = new KgStore({ dbPath: ':memory:' });
    const builder = new KgBuilder({
      store,
      source,
      entityExtractor: {
        extract: async ({ note_path }) => {
          if (note_path === 'fail') throw new Error('fixture fail');
          if (note_path === 'slow') return new Promise(() => undefined);
          return [{ entity_id: 'concept:ok', type: 'concept', name: 'ok', source_note: note_path }];
        },
      },
      relationExtractor: { extract: async () => [] },
      tagger: { extract: async () => [] },
      summarizer: { summarize: async () => new Map() },
      noteSummarizer: {
        summarizeNote: async ({ note_title }) => ({
          summary: `Summary ${note_title}`,
          provider: 'fixture',
          model: 'fixture',
        }),
      },
    });
    const result = await builder.buildPending({ perNoteTimeoutMs: 5 });
    expect(result.processed).toBe(1);
    expect(result.failed).toHaveLength(3);
    expect(statuses.get('ok')).toBe('done');
    expect(statuses.get('missing')).toBe('failed');
    expect(statuses.get('fail')).toBe('failed');
    expect(statuses.get('slow')).toBe('failed');
    store.close();
  });
});

describe('WIKI builder failure and cache truth', () => {
  it('persists provider and parse failures without green provenance', async () => {
    const providerStore = new KgStore({ dbPath: ':memory:' });
    const providerBuilder = new KgBuilder({
      store: providerStore,
      entityExtractor: { extract: async () => { throw new Error('offline'); } },
      relationExtractor: { extract: async () => [] },
      tagger: { extract: async () => [] },
      summarizer: { summarize: async () => new Map() },
      noteSummarizer: {
        summarizeNote: async () => ({ summary: 'unused', provider: 'fixture', model: 'fixture' }),
      },
    });
    const providerNote = { path: 'fail/provider', title: 'Provider', body: 'body' };
    const providerResult = await providerBuilder.buildNote(providerNote);
    expect(providerResult.status).toBe('failed');
    const providerTruth = new KgQuery(providerStore).wikiForNote(providerNote);
    expect(providerTruth).toMatchObject({ truth: 'failed', provenance: null });
    expect(providerTruth.failed[0]).toMatchObject({
      failure_stage: 'provider',
      failure_reason: 'WIKI_PROVIDER_FAILED',
    });
    providerStore.close();

    const parseStore = new KgStore({ dbPath: ':memory:' });
    const parseBuilder = new KgBuilder({
      store: parseStore,
      entityExtractor: { extract: async () => [] },
      relationExtractor: { extract: async () => [] },
      tagger: { extract: async () => [] },
      summarizer: { summarize: async () => new Map() },
      noteSummarizer: {
        summarizeNote: async () => {
          throw new NoteSummaryParseError('bad summary');
        },
      },
    });
    const parseNote = { path: 'fail/parse', title: 'Parse', body: 'body' };
    const parseResult = await parseBuilder.buildNote(parseNote);
    expect(parseResult.status).toBe('failed');
    const parseTruth = new KgQuery(parseStore).wikiForNote(parseNote);
    expect(parseTruth).toMatchObject({ truth: 'failed', provenance: null });
    expect(parseTruth.failed[0]).toMatchObject({
      failure_stage: 'parse',
      failure_reason: 'WIKI_SCHEMA_VALIDATION_FAILED',
    });
    parseStore.close();
  });

  it('rolls back graph mutations when WIKI persistence fails, then records the failed attempt', async () => {
    const store = new KgStore({ dbPath: ':memory:' });
    const originalUpsert = store.upsertWikiProjection.bind(store);
    let upsertCalls = 0;
    store.upsertWikiProjection = ((input, now) => {
      upsertCalls += 1;
      if (upsertCalls === 1) throw new Error('fixture persist failure');
      return originalUpsert(input, now);
    }) as typeof store.upsertWikiProjection;
    const builder = new KgBuilder({
      store,
      entityExtractor: {
        extract: async ({ note_path }) => [{
          entity_id: 'concept:rollback',
          type: 'concept',
          name: 'Rollback',
          source_note: note_path,
        }],
      },
      relationExtractor: { extract: async () => [] },
      tagger: { extract: async () => [{ name: 'rollback' }] },
      summarizer: { summarize: async () => new Map([['concept:rollback', 'summary']]) },
      noteSummarizer: {
        summarizeNote: async () => ({
          summary: 'A projection that must roll back.',
          provider: 'fixture',
          model: 'fixture',
        }),
      },
    });
    const note = { path: 'fail/persist', title: 'Persist', body: 'body' };
    const result = await builder.buildNote(note);
    expect(result).toMatchObject({ status: 'failed', reason: 'WIKI_PERSIST_FAILED' });
    expect(store.countNodes()).toBe(0);
    expect(store.countEdges()).toBe(0);
    expect(store.listTags()).toEqual([]);
    expect(new KgQuery(store).wikiForNote(note)).toMatchObject({
      truth: 'failed',
      provenance: null,
      failed: [expect.objectContaining({ failure_stage: 'persist' })],
    });
    store.close();
  });

  it('returns the digest-bound current cache without invoking extractors twice', async () => {
    const store = new KgStore({ dbPath: ':memory:' });
    const calls = { entity: 0, relation: 0, tag: 0, entitySummary: 0, noteSummary: 0 };
    const builder = new KgBuilder({
      store,
      entityExtractor: { extract: async () => { calls.entity += 1; return []; } },
      relationExtractor: { extract: async () => { calls.relation += 1; return []; } },
      tagger: { extract: async () => { calls.tag += 1; return [{ name: 'cache' }]; } },
      summarizer: {
        summarize: async () => { calls.entitySummary += 1; return new Map(); },
      },
      noteSummarizer: {
        summarizeNote: async () => {
          calls.noteSummary += 1;
          return { summary: 'Cached note summary.', provider: 'fixture', model: 'fixture' };
        },
      },
    });
    const note = { path: 'cache/note', title: 'Cache', body: 'same bytes' };
    const first = await builder.buildNote(note);
    const second = await builder.buildNote(note);
    expect(first.wiki).toMatchObject({ truth: 'current', inserted_current: true });
    expect(second.wiki).toMatchObject({
      truth: 'current',
      inserted_current: false,
      projection_id: first.wiki.projection_id,
    });
    expect(calls).toEqual({
      entity: 1,
      relation: 1,
      tag: 1,
      entitySummary: 1,
      noteSummary: 1,
    });
    store.close();
  });
});
