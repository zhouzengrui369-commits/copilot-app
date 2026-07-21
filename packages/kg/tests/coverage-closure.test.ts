import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResponse, LLMProvider } from '@copilot/llm-client';
import { KgQuery, queryKg } from '../src/api/query.js';
import {
  buildEntityExtractionPrompt,
  buildEntityView,
  EntityExtractor,
  makeEntityId,
  parseEntityResponse,
} from '../src/builder/entity-extractor.js';
import { KgBuilder } from '../src/builder/kg-builder.js';
import {
  buildRelationExtractionPrompt,
  parseRelationResponse,
  RelationExtractor,
} from '../src/builder/relation-extractor.js';
import {
  buildSummarizePrompt,
  parseSummarizeResponse,
  Summarizer,
} from '../src/builder/summarizer.js';
import {
  buildTaggerPrompt,
  normalizeTag,
  parseTaggerResponse,
  Tagger,
} from '../src/builder/tagger.js';
import { KG_MIGRATIONS, runKgMigrations } from '../src/store/migration.js';
import { KgStore } from '../src/store/sqlite-store.js';
import type { EntityInput, KgKnowledgeSource } from '../src/types.js';

class RecordingProvider implements LLMProvider {
  readonly name = 'coverage-recording';
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

const entities: EntityInput[] = [
  {
    entity_id: 'person:ada',
    type: 'person',
    name: 'Ada',
    aliases: ['Countess'],
    summary: 'Pioneer',
    confidence: 0.9,
    source_note: 'notes/ada',
  },
  {
    entity_id: 'concept:engine',
    type: 'concept',
    name: 'Engine',
    source_note: 'notes/ada',
  },
];

describe('canonical KG coverage closure — extraction validation branches', () => {
  it('defensively normalizes entity parser edge cases and view defaults', () => {
    expect(parseEntityResponse('', 'n')).toEqual([]);
    expect(parseEntityResponse('{}', 'n')).toEqual([]);
    expect(parseEntityResponse('[null, 1, {}, {"name":""}]', 'n')).toEqual([]);

    const parsed = parseEntityResponse(`prose before [
      {"type":"ALIEN","name":" Ada  Lovelace ","confidence":4,
       "aliases":["",3,"ADA  LOVELACE","Countess","Enchantress","A","B","C","D"]},
      {"type":"person","name":"ada lovelace","confidence":0.8},
      {"name":"No confidence"},
      {"name":"NaN confidence","confidence":null},
    ] prose after`, 'notes/ada');
    expect(parsed).toEqual([
      expect.objectContaining({
        type: 'other',
        entity_id: 'other:ada-lovelace',
        confidence: 1,
        aliases: ['Countess', 'Enchantress', 'A', 'B', 'C'],
      }),
    ]);
    expect(makeEntityId('', '---')).toBe('other:unnamed');
    expect(makeEntityId('Product Type', ' Ａ  B ')).toBe('product_type:a-b');
    expect(buildEntityView({
      entity_id: 'other:x', type: undefined as unknown as EntityInput['type'], name: 'X', source_note: 'n',
    }, 7)).toEqual(expect.objectContaining({
      type: 'other', aliases: [], summary: null, confidence: null, created_at: 7, updated_at: 7,
    }));

    const prompt = buildEntityExtractionPrompt({
      note_path: 'n', note_title: 'Title', note_body: 'body', note_meta: { private: false },
    });
    expect(prompt[1]?.content).toContain('Note metadata');
  });

  it('exercises real extractor calls with and without AbortSignal', async () => {
    const provider = new RecordingProvider(['[]', '[]']);
    const extractor = new EntityExtractor({ provider, defaultModel: 'm', temperature: 0.2 });
    await extractor.extract({ note_path: 'a', note_title: '', note_body: '' });
    const controller = new AbortController();
    await extractor.extract({ note_path: 'b', note_title: '', note_body: '' }, controller.signal);
    expect(provider.requests[0]).not.toHaveProperty('signal');
    expect(provider.requests[1]?.signal).toBe(controller.signal);
    expect(provider.requests[0]?.temperature).toBe(0.2);
  });

  it('validates relation fallbacks, endpoint aliases, weights, duplicates, and prompts', async () => {
    const input = { note_path: 'n', note_title: 'T', note_body: 'x'.repeat(5001), entities };
    expect(buildRelationExtractionPrompt(input)[1]?.content).toContain('truncated');
    expect(parseRelationResponse('', input)).toEqual([]);
    expect(parseRelationResponse('{}', input)).toEqual([]);
    expect(parseRelationResponse('[null, 1]', input)).toEqual([]);

    const result = parseRelationResponse(`before \`\`\`json
      [
        {"from":"Countess","to":"Engine","rel":"UNKNOWN REL","weight":-1},
        {"from":"Ada","to":"Engine","rel":"UNKNOWN REL","weight":2},
        {"from_entity_id":"concept:engine","to_entity_id":"person:ada","weight":"bad"},
        {"from":3,"to":"Engine"},
        {"from":"missing","to":"Engine"},
        {"from":"Ada","to":"Ada"},
        {"from":"Engine","to":"Ada","rel":"related-to","weight":null}
      ]
    \`\`\` after`, input);
    expect(result).toEqual([
      expect.objectContaining({ rel: 'other', weight: 0 }),
      expect.objectContaining({ rel: 'other', weight: 0.5 }),
      expect.objectContaining({ from_entity_id: 'concept:engine', rel: 'related_to', weight: 0.5 }),
    ]);

    const provider = new RecordingProvider(['[]']);
    const extractor = new RelationExtractor({ provider, defaultModel: 'm' });
    expect(await extractor.extract({ ...input, entities: [entities[0]!] })).toEqual([]);
    const controller = new AbortController();
    await extractor.extract({ ...input, note_body: 'short' }, controller.signal);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.temperature).toBe(0);
    expect(provider.requests[0]?.signal).toBe(controller.signal);
  });

  it('validates summary parsing, truncation, rejected shapes, and empty extractor input', async () => {
    expect(buildSummarizePrompt({ note_title: 'T', note_body: 'x'.repeat(4001), entities })[1]?.content)
      .toContain('truncated');
    expect(parseSummarizeResponse('', entities).size).toBe(0);
    expect(parseSummarizeResponse('bad', entities).size).toBe(0);
    expect(parseSummarizeResponse('null', entities).size).toBe(0);
    expect(parseSummarizeResponse('[]', entities).size).toBe(0);
    const summaries = parseSummarizeResponse(`prose \`\`\`json
      {"person:ada":" Ada pioneer!!! ","concept:engine":"   ","unknown":"x","extra":3,}
    \`\`\``, entities);
    expect(summaries).toEqual(new Map([['person:ada', 'Ada pioneer']]));

    const provider = new RecordingProvider(['{}']);
    const summarizer = new Summarizer({ provider, defaultModel: 'm', temperature: 0.3 });
    expect(await summarizer.summarize({ note_title: '', note_body: '', entities: [] })).toEqual(new Map());
    await summarizer.summarize({ note_title: '', note_body: '', entities });
    expect(provider.requests[0]?.temperature).toBe(0.3);
    expect(provider.requests[0]).not.toHaveProperty('signal');
  });

  it('filters blocked/duplicate tags, handles mixed LLM shapes, and caps at eight', async () => {
    expect(buildTaggerPrompt({ note_path: 'n', note_title: 'T', note_body: 'x'.repeat(4001) })[1]?.content)
      .toContain('truncated');
    expect(parseTaggerResponse('')).toEqual([]);
    expect(parseTaggerResponse('{}')).toEqual([]);
    expect(parseTaggerResponse('bad')).toEqual([]);
    expect(parseTaggerResponse('```json\n[null,3,{}, {"name":3}, "Valid"]\n```'))
      .toEqual([{ name: 'valid' }]);
    expect(normalizeTag('---')).toBe('');

    const provider = new RecordingProvider([
      JSON.stringify(['general', 'Alpha', 'alpha', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']),
    ]);
    const tagger = new Tagger({ provider, defaultModel: 'm' });
    const controller = new AbortController();
    const tags = await tagger.extract({
      note_path: 'n', note_title: '', note_body: 'short', existing_tags: ['todo', 'Existing'],
    }, controller.signal);
    expect(tags.map((tag) => tag.name)).toEqual(['existing', 'alpha', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(provider.requests[0]?.signal).toBe(controller.signal);
  });
});

describe('canonical KG coverage closure — store, query, builder and migration branches', () => {
  it('covers local store defaults, nullable merges, id lookups, tags, and close idempotence', () => {
    const store = new KgStore({ dbPath: ':memory:', wal: false });
    const first = store.upsertEntity({
      entity_id: 'person:ada', type: 'person', name: 'Ada', aliases: ['', 'Countess'], source_note: 'a',
    }, 1);
    expect(store.getEntityById(first.entity.id)?.name).toBe('Ada');
    expect(store.getEntityById(999)).toBeNull();
    expect(store.upsertEntity({
      entity_id: 'person:ada', type: 'person', name: 'Ada', summary: 'Known', confidence: 0.8,
      source_note: 'a',
    }, 2).entity).toEqual(expect.objectContaining({ summary: 'Known', confidence: 0.8 }));
    expect(store.upsertEntity({
      entity_id: 'person:ada', type: 'person', name: 'Ada', source_note: 'b',
    }, 3).entity).toEqual(expect.objectContaining({ summary: 'Known', confidence: 0.8 }));

    expect(store.linkNoteEntity('a', 'person:ada')).toBe(true);
    expect(store.linkNoteEntity('a', 'person:ada')).toBe(false);
    expect(store.upsertTag({ name: 'weighted', note_count: 2 }, 1).tag.note_count).toBe(2);
    store.close();
    store.close();
  });

  it('queries names, ids, aliases, summaries, filters, graph bounds, and missing centers', () => {
    const store = new KgStore({ dbPath: ':memory:' });
    store.replaceNoteGraph({
      note_path: 'notes/ada',
      entities,
      relations: [{
        from_entity_id: 'person:ada', to_entity_id: 'concept:engine', rel: 'created_by', evidence_note: 'ignored',
      }],
      tags: [{ name: 'history' }, { name: 'math' }],
    }, 1);
    const query = new KgQuery(store);
    expect(query.getNode('missing')).toBeNull();
    expect(query.getNode('person:ada')).toEqual(expect.objectContaining({
      incoming: [], outgoing: [expect.objectContaining({ rel: 'created_by' })],
      tags: [expect.objectContaining({ name: 'history' }), expect.objectContaining({ name: 'math' })],
    }));
    expect(query.searchNodes(' ')).toEqual([]);
    expect(query.searchNodes('person:ada', { limit: 0 })).toHaveLength(1);
    expect(query.searchNodes('countess', { type: 'person' })).toHaveLength(1);
    expect(query.searchNodes('pioneer')).toHaveLength(1);
    expect(query.searchNodes('ada', { type: 'concept' })).toEqual([]);
    expect(queryKg(store, { center: 'missing' })).toEqual({ nodes: [], edges: [], degree: {} });
    expect(queryKg(store, { center: 'person:ada', hops: 0 }).edges).toEqual([]);
    expect(queryKg(store, { center: 'person:ada', types: ['person'] }).nodes).toHaveLength(1);
    expect(queryKg(store, { center: 'concept:engine', hops: 9, maxNodes: 1 }).nodes).toHaveLength(1);
    expect(query.fullGraph(0).nodes).toHaveLength(1);
    expect(query.fullGraph(20_000).edges).toHaveLength(1);
    store.close();
  });

  it('fails closed on invalid builder setup and handles skip-LLM/empty/pending bounds', async () => {
    const store = new KgStore({ dbPath: ':memory:' });
    expect(() => new KgBuilder({ store })).toThrow('entityExtractor or provider is required');
    const builder = new KgBuilder({
      store,
      entityExtractor: { extract: async () => { throw new Error('must not run'); } },
      relationExtractor: { extract: async () => { throw new Error('must not run'); } },
      tagger: { extract: async () => { throw new Error('must not run'); } },
      summarizer: { summarize: async () => { throw new Error('must not run'); } },
      clock: () => 5,
    });
    await expect(builder.buildNote({ path: ' ', title: '', body: '' })).rejects.toThrow('note path is required');
    expect(await builder.buildNote({ path: 'empty', title: '', body: '', tags: [' A ', '---', 'A'] }))
      .toEqual(expect.objectContaining({ tagsTotal: 2, tagsTouched: 1, elapsedMs: 0 }));
    expect(await builder.buildNote({ path: 'skip', title: 'content', body: '', tags: [] }, { skipLlm: true }))
      .toEqual(expect.objectContaining({ entitiesTotal: 0, relationsTotal: 0 }));
    await expect(builder.buildPending()).rejects.toThrow('source is required');
    store.close();

    const statuses: string[] = [];
    const source: KgKnowledgeSource = {
      listKgPending: () => [
        { note_path: 'one', status: 'pending', queued_at: 0 },
        { note_path: 'two', status: 'pending', queued_at: 0 },
      ],
      setKgStatus: (path, status) => { statuses.push(`${path}:${status}`); },
      readNote: (path) => ({ note: { path, title: path, tags: [], related: [] }, body: path }),
    };
    const pendingStore = new KgStore({ dbPath: ':memory:' });
    const pendingBuilder = new KgBuilder({
      store: pendingStore,
      source,
      entityExtractor: { extract: async () => [] },
      relationExtractor: { extract: async () => [] },
      tagger: { extract: async () => [] },
      summarizer: { summarize: async () => new Map() },
      clock: () => 10,
    });
    const result = await pendingBuilder.buildPending({ maxNotes: 1, perNoteTimeoutMs: Number.NaN });
    expect(result).toEqual(expect.objectContaining({ processed: 0, failed: [{ path: 'one', reason: 'invalid timeout' }] }));
    expect(statuses).toEqual(['one:processing', 'one:failed']);
    // The invalid-timeout branch rejects before the already-created build promise settles.
    // Let that real work drain before closing its local SQLite handle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    pendingStore.close();
  });

  it('applies one registered migration transactionally and exposes the new version', () => {
    const store = new KgStore({ dbPath: ':memory:' });
    KG_MIGRATIONS[1] = (target) => {
      target.raw.exec('CREATE TABLE coverage_migration_probe (id INTEGER PRIMARY KEY)');
    };
    try {
      expect(runKgMigrations(store, 1)).toEqual({ from: 0, to: 1, applied: [1] });
      expect(store.schemaVersion).toBe(1);
      expect(runKgMigrations(store, 1)).toEqual({ from: 1, to: 1, applied: [] });
    } finally {
      delete KG_MIGRATIONS[1];
      store.close();
    }
  });
});
