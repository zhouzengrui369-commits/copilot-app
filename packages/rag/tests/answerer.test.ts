/**
 * Answerer end-to-end test (mocked LLM stream).
 *
 * Validates:
 *   - retrieval passes the top-k hits
 *   - system prompt is in Chinese (default)
 *   - chat stream deltas are assembled in order
 *   - citedSources are surfaced and deduped
 *   - empty-hits path returns the polite fallback text
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  Answerer,
  fuseRetrievalHits,
  type AnswererStreamChunk,
  type ChatStreamFactory,
} from '../src/answerer.js';
import { Embedder } from '../src/embedder.js';
import { createVectorStore, type VectorStore } from '../src/vector-store.js';
import type { EmbeddedChunk, RetrievalHit, RetrievalResult } from '../src/types.js';

function makeFakeFetch(values: Array<number[] | Float32Array>): typeof fetch {
  let i = 0;
  return (async (_url: string | URL | Request) => {
    const v = values[i] ?? values[values.length - 1] ?? [];
    i += 1;
    // Array.from coerces Float32Array → plain number[] for clean JSON.
    return new Response(JSON.stringify({ embedding: Array.from(v) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function normalize(v: number[]): Float32Array {
  const sum = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = (v[i] ?? 0) / sum;
  return out;
}

async function makeStoreWith(
  chunks: Array<{ id: string; notePath: string; text: string; emb: number[] }>,
): Promise<VectorStore> {
  const store = await createVectorStore({ dbPath: ':memory:', dimensions: 8 });
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i]!;
    const ec: EmbeddedChunk = {
      id: c.id,
      notePath: c.notePath,
      ordinal: 0,
      text: c.text,
      tokenCount: 1,
      charRange: [0, c.text.length],
      embedding: new Float32Array(c.emb),
      model: 'bge-m3:latest',
      embeddedAt: 0,
    };
    await store.insert(ec);
  }
  return store;
}

function retrievalHit(
  notePath: string,
  score = 1,
  ordinal = 0,
  id = `${notePath}#${ordinal}`,
  text = `text for ${notePath}`,
  evidence?: RetrievalHit['evidence'],
): RetrievalHit {
  return {
    chunk: {
      id,
      notePath,
      ordinal,
      text,
      tokenCount: 3,
      charRange: [0, text.length],
    },
    score,
    evidence,
  };
}

function retrievalResult(hits: RetrievalHit[]): RetrievalResult {
  return {
    query: '',
    queryEmbedding: normalize([1, 0, 0, 0, 0, 0, 0, 0]),
    hits,
    candidates: hits.length,
  };
}

function answererWithHits(
  hits: RetrievalHit[],
  factory: ChatStreamFactory,
  config: ConstructorParameters<typeof Answerer>[3] = {},
): Answerer {
  const fakeEmbedder = {
    embed: vi.fn(async () => normalize([1, 0, 0, 0, 0, 0, 0, 0])),
  } as unknown as Embedder;
  const fakeStore = {
    count: vi.fn(() => hits.length),
    search: vi.fn(async () => retrievalResult(hits)),
  } as unknown as VectorStore;
  return new Answerer(fakeEmbedder, fakeStore, factory, config);
}

async function consumeAnswer(answerer: Answerer, query: string) {
  const deltas: string[] = [];
  const iterator = answerer.answer(query);
  let next = await iterator.next();
  while (!next.done) {
    deltas.push(next.value.delta);
    next = await iterator.next();
  }
  return { deltas, result: next.value };
}

describe('Answerer', () => {
  let store: VectorStore;
  let embedder: Embedder;

  beforeEach(async () => {
    embedder = new Embedder({
      fetchImpl: makeFakeFetch([normalize([1, 0.1, 0, 0, 0, 0, 0, 0])]),
      model: 'fake-8d',
      dimensions: 8,
    });
    store = await createVectorStore({ dbPath: ':memory:', dimensions: 8 });
  });

  it('streams answer deltas and exposes citedSources', async () => {
    // Insert 3 chunks; one is the answer, the other two are decoys.
    await store.insert({
      id: '1', notePath: 'glossary/opc', ordinal: 0,
      text: 'OPC 是 One-Person Company 缩写,指独立创业者。',
      tokenCount: 8, charRange: [0, 30],
      embedding: normalize([1, 0.1, 0, 0, 0, 0, 0, 0]),
      model: 'bge-m3:latest', embeddedAt: 0,
    });
    await store.insert({
      id: '2', notePath: 'glossary/aircraft', ordinal: 0,
      text: 'MRO 是 Maintenance Repair Overhaul 的缩写。',
      tokenCount: 8, charRange: [0, 30],
      embedding: normalize([0, 1, 0, 0, 0, 0, 0, 0]),
      model: 'bge-m3:latest', embeddedAt: 0,
    });
    await store.insert({
      id: '3', notePath: 'glossary/opc', ordinal: 1,
      text: 'OPC 公司的特点是老板同时是员工、销售、财务。',
      tokenCount: 10, charRange: [0, 30],
      embedding: normalize([0.95, 0.1, 0, 0, 0, 0, 0, 0]),
      model: 'bge-m3:latest', embeddedAt: 0,
    });

    const scripted = [
      'OPC 是 ',
      'One-Person Company 的缩写',
      '。(来源: glossary/opc)',
    ];
    const factory: ChatStreamFactory = async function* () {
      for (const [index, d] of scripted.entries()) {
        yield {
          content: d,
          finishReason: index === scripted.length - 1 ? 'stop' : undefined,
        } as AnswererStreamChunk;
      }
    };

    const answerer = new Answerer(embedder, store, factory, { model: 'test-model', topK: 2 });
    let assembled = '';
    let lastSources: string[] = [];
    let finalAnswer: string | undefined;
    let finalSources: string[] = [];

    const iter = answerer.answer('OPC 是什么?');
    let r = await iter.next();
    while (!r.done) {
      assembled += r.value.delta;
      lastSources = r.value.citedSources;
      r = await iter.next();
    }
    finalAnswer = r.value?.answer;
    finalSources = r.value?.sources ?? [];

    expect(assembled).toBe(scripted.join(''));
    expect(lastSources.sort()).toEqual(['glossary/opc']);
    expect(finalAnswer).toBe(scripted.join(''));
    expect(finalSources.sort()).toEqual(['glossary/opc']);

    await store.close();
  });

  it('falls back to a polite "no info" message when the store is empty', async () => {
    const factory: ChatStreamFactory = async function* () {
      // shouldn't be called
      yield { content: 'should not be reached' } as AnswererStreamChunk;
    };
    const answerer = new Answerer(embedder, store, factory, { model: 'test-model' });

    let finalAnswer: string | undefined;
    const iter = answerer.answer('随便问什么');
    let r = await iter.next();
    while (!r.done) {
      r = await iter.next();
    }
    finalAnswer = r.value?.answer;

    expect(finalAnswer).toMatch(/未找到|知识库/);
    await store.close();
  });

  it('exposes retrieval-only path without invoking LLM', async () => {
    await store.insert({
      id: '1', notePath: 'n/a', ordinal: 0,
      text: 'alpha',
      tokenCount: 1, charRange: [0, 5],
      embedding: normalize([1, 0.1, 0, 0, 0, 0, 0, 0]),
      model: 'bge-m3:latest', embeddedAt: 0,
    });
    const factory: ChatStreamFactory = async function* () {
      throw new Error('LLM should not be called for retrieval-only path');
    };
    const answerer = new Answerer(embedder, store, factory);
    const hits = await answerer.retrieve('alpha');
    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]?.chunk.notePath).toBe('n/a');
    await store.close();
  });

  it('uses deterministic ASCII/CJK text when vectors are absent and reports degraded health', async () => {
    const localOnly = {
      id: 'notes/local#0',
      notePath: 'notes/local',
      ordinal: 0,
      text: 'OPC 本地知识整理与个人公司记录',
      tokenCount: 3,
      charRange: [0, 'OPC 本地知识整理与个人公司记录'.length] as [number, number],
    };
    await store.replaceNoteIndex('notes/local', [localOnly], []);
    const answerer = new Answerer(embedder, store, async function* () {});

    const ascii = await answerer.retrieve('OPC');
    expect(ascii.hits.map((hit) => hit.chunk.id)).toEqual(['notes/local#0']);
    expect(ascii.hits[0]?.evidence).toContain('local-text');
    expect(ascii.providerStatus).toBe('degraded');
    expect(ascii.diagnostics).toContain('RAG_VECTOR_INDEX_DEGRADED');

    const cjk = await answerer.retrieve('知识整理');
    expect(cjk.hits.map((hit) => hit.chunk.id)).toEqual(['notes/local#0']);
    expect(cjk.mode).toBe('local-text');
    expect(cjk.providerStatus).toBe('degraded');
  });

  it.each([
    ['', 'empty'],
    [42, 'non-string'],
  ])('rejects an invalid %s query (%s)', async (query) => {
    const answerer = answererWithHits([], async function* () {});
    const iterator = answerer.answer(query as unknown as string);
    await expect(iterator.next()).rejects.toThrow(/non-empty string/);
  });

  it('renders English prompts, truncates long context, ignores empty deltas, and defaults evidence', async () => {
    let messages: Parameters<ChatStreamFactory>[0] = [];
    let options: Parameters<ChatStreamFactory>[1] | undefined;
    const factory: ChatStreamFactory = async function* (received, receivedOptions) {
      messages = received;
      options = receivedOptions;
      yield { content: '' };
      yield undefined as unknown as AnswererStreamChunk;
      yield { content: 'grounded answer (source: notes/long)', finishReason: 'stop' };
    };
    const answerer = answererWithHits(
      [retrievalHit('notes/long', 0.9, 0, 'long#0', 'abcdefgh')],
      factory,
      {
        language: 'en',
        model: 'local-test-model',
        perChunkCharCap: 4,
        maxContextChunks: 1,
      },
    );

    const output = await consumeAnswer(answerer, 'what is grounded?');

    expect(output.deltas).toEqual(['grounded answer (source: notes/long)']);
    expect(output.result.answer).toBe('grounded answer (source: notes/long)');
    expect(output.result.totalChars).toBe('grounded answer (source: notes/long)'.length);
    expect(output.result.sourceDetails).toEqual([
      {
        notePath: 'notes/long',
        evidence: ['vector'],
        score: 0.9,
        chunkId: 'long#0',
        charRange: [0, 8],
        excerpt: 'abcdefgh',
        mode: 'vector',
      },
    ]);
    expect(messages[0]?.content).toContain('retrieval-augmented assistant');
    expect(messages[1]?.content).toContain('abcd…');
    expect(messages[1]?.content).toContain('Available notes');
    expect(messages[1]?.content).toContain('(source: <note_path>)');
    expect(options).toEqual({ model: 'local-test-model', signal: undefined });
  });

  it('returns the English empty-index answer without calling the provider', async () => {
    const factory = vi.fn(async function* () {
      yield { content: 'unreachable' };
    });
    const output = await consumeAnswer(
      answererWithHits([], factory, { language: 'en' }),
      'question',
    );
    expect(output.deltas).toEqual(['No relevant notes found in the knowledge base.']);
    expect(output.result.sources).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('propagates Error abort reasons before retrieval', async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled by caller');
    controller.abort(reason);
    const answerer = answererWithHits([], async function* () {});
    const iterator = answerer.answer('question', { signal: controller.signal });
    await expect(iterator.next()).rejects.toBe(reason);
  });

  it('creates AbortError for non-Error abort reasons while buffering the stream', async () => {
    const controller = new AbortController();
    const factory: ChatStreamFactory = async function* () {
      yield { content: 'first' };
      controller.abort('user cancelled');
      yield { content: 'second' };
    };
    const answerer = answererWithHits([retrievalHit('notes/a')], factory);
    const iterator = answerer.answer('question', { signal: controller.signal });
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('defaults source-detail evidence and deduplicates duplicate note paths', async () => {
    const answerer = answererWithHits([], async function* () {
      yield { content: 'ok (source: notes/same)', finishReason: 'stop' };
    });
    answerer.retrieve = vi.fn(async () => retrievalResult([
      retrievalHit('notes/same', 1, 0, 'same#0'),
      retrievalHit('notes/same', 0.8, 1, 'same#1'),
    ]));

    const output = await consumeAnswer(answerer, 'question');
    expect(output.result.sources).toEqual(['notes/same']);
    expect(output.result.sourceDetails).toEqual([
      {
        notePath: 'notes/same',
        evidence: ['vector'],
        score: 1,
        chunkId: 'same#0',
        charRange: [0, 'text for notes/same'.length],
        excerpt: 'text for notes/same',
        mode: 'vector',
      },
    ]);
  });

  it.each([
    ['', 'empty answer'],
    ['unsupported answer', 'missing citation'],
    ['answer (source: notes/hallucinated)', 'hallucinated path'],
    ['answer (source: notes/real', 'unclosed citation'],
    ['answer (source: notes/real) trailing text', 'text after citation'],
  ])('fails closed with no sources for %s (%s)', async (content) => {
    const answerer = answererWithHits(
      [retrievalHit('notes/real')],
      async function* () {
        yield { content, finishReason: 'stop' };
      },
    );

    const output = await consumeAnswer(answerer, 'question');

    expect(output.result.answer).toMatch(/核验|verifiable/i);
    expect(output.result.sources).toEqual([]);
    expect(output.result.sourceDetails).toEqual([]);
    expect(output.result.diagnostics).toContain('RAG_CITATION_SOURCE_MISMATCH');
    expect(output.deltas).toEqual([output.result.answer]);
  });

  it.each([
    [undefined, 'missing'],
    ['length', 'length'],
    ['error', 'error'],
    ['content_filter', 'content filtering'],
    ['tool_calls', 'unknown'],
  ])('fails closed for a %s terminal state (%s)', async (finishReason, _label) => {
    const answerer = answererWithHits(
      [retrievalHit('notes/real')],
      async function* () {
        yield { content: 'grounded (source: notes/real)', finishReason };
      },
    );

    const output = await consumeAnswer(answerer, 'question');

    expect(output.result.answer).toMatch(/核验/);
    expect(output.result.sources).toEqual([]);
    expect(output.result.sourceDetails).toEqual([]);
    expect(output.result.diagnostics).toContain('RAG_CITATION_SOURCE_MISMATCH');
  });

  it('fails closed when content arrives after an accepted terminal marker', async () => {
    const answerer = answererWithHits(
      [retrievalHit('notes/real')],
      async function* () {
        yield { content: 'grounded (source: notes/real)', finishReason: 'stop' };
        yield { content: ' trailing content' };
      },
    );

    const output = await consumeAnswer(answerer, 'question');

    expect(output.result.answer).toMatch(/核验/);
    expect(output.result.sources).toEqual([]);
    expect(output.result.sourceDetails).toEqual([]);
  });

  it('validates citations only against the exact prompt context slice', async () => {
    let userPrompt = '';
    const answerer = answererWithHits(
      [
        retrievalHit('notes/visible', 1),
        retrievalHit('notes/hidden', 0.9),
      ],
      async function* (messages) {
        userPrompt = messages[1]?.content ?? '';
        yield { content: 'hidden claim (source: notes/hidden)', finishReason: 'stop' };
      },
      { maxContextChunks: 1 },
    );

    const output = await consumeAnswer(answerer, 'question');

    expect(userPrompt).toContain('notes/visible');
    expect(userPrompt).not.toContain('notes/hidden');
    expect(output.result.answer).toMatch(/核验/);
    expect(output.result.sources).toEqual([]);
    expect(output.result.sourceDetails).toEqual([]);
  });

  it.each([
    ['grounded paragraph (source: notes/real)\n\nuncited paragraph', 'paragraph'],
    ['- grounded bullet (source: notes/real)\n- uncited bullet', 'bullet'],
  ])('requires every non-empty %s to carry a complete allowed citation', async (content) => {
    const answerer = answererWithHits(
      [retrievalHit('notes/real')],
      async function* () {
        yield { content, finishReason: 'stop' };
      },
    );

    const output = await consumeAnswer(answerer, 'question');

    expect(output.result.answer).toMatch(/核验/);
    expect(output.result.sources).toEqual([]);
    expect(output.result.sourceDetails).toEqual([]);
  });

  it('accepts multiple paragraphs and bullets only when each is cited', async () => {
    const content = [
      'grounded paragraph (source: notes/real)',
      '',
      '- grounded bullet (source: notes/real)',
      '- another grounded bullet (source: notes/real)',
    ].join('\n');
    const answerer = answererWithHits(
      [retrievalHit('notes/real')],
      async function* () {
        yield { content, finishReason: 'stop' };
      },
    );

    const output = await consumeAnswer(answerer, 'question');

    expect(output.result.answer).toBe(content);
    expect(output.result.sources).toEqual(['notes/real']);
    expect(output.result.sourceDetails).toHaveLength(1);
  });

  it('returns an exact UTF-16 excerpt range without splitting a surrogate pair', async () => {
    const text = `${'a'.repeat(239)}😀tail`;
    const hit = retrievalHit('notes/emoji', 1, 0, 'emoji#0', text);
    hit.chunk.charRange = [11, 11 + text.length];
    const answerer = answererWithHits(
      [hit],
      async function* () {
        yield { content: 'grounded (source: notes/emoji)', finishReason: 'stop' };
      },
    );

    const output = await consumeAnswer(answerer, 'question');
    const detail = output.result.sourceDetails?.[0];

    expect(detail?.excerpt).toBe('a'.repeat(239));
    expect(detail?.charRange).toEqual([11, 250]);
    expect((detail?.charRange[1] ?? 0) - (detail?.charRange[0] ?? 0))
      .toBe(detail?.excerpt.length);
  });

  it('propagates store search errors instead of converting them to local-text fallback', async () => {
    const fakeEmbedder = {
      embed: vi.fn(async () => normalize([1, 0, 0, 0, 0, 0, 0, 0])),
    } as unknown as Embedder;
    const failure = new Error('store search failed');
    const fakeStore = {
      count: vi.fn(() => 1),
      search: vi.fn(async () => { throw failure; }),
    } as unknown as VectorStore;
    const answerer = new Answerer(fakeEmbedder, fakeStore, async function* () {});

    await expect(answerer.retrieve('question')).rejects.toBe(failure);
  });

  it('fuses real candidates with stable score, path, ordinal, and id tie-breaks', () => {
    const invalid = retrievalHit('', 10);
    const lower = retrievalHit('notes/same', 0.5, 2, 'z');
    const higher = retrievalHit('notes/same', 0.8, 2, 'z', 'higher', ['kg-entity']);
    const earlierOrdinal = retrievalHit('notes/same', 0.8, 1, 'z', 'earlier ordinal');
    const earlierId = retrievalHit('notes/same', 0.8, 1, 'a', 'earlier id');
    const laterPath = retrievalHit('notes/z', 0.8, 0, 'z#0');
    const fused = fuseRetrievalHits(
      [invalid, lower, higher, laterPath],
      [earlierOrdinal, earlierId, retrievalHit('notes/default', 0.7)],
      2.9,
    );

    expect(fused.map((entry) => entry.chunk.notePath)).toEqual(['notes/same', 'notes/z']);
    expect(fused[0]).toMatchObject({
      chunk: { id: 'a', text: 'earlier id' },
      evidence: ['vector', 'kg-entity'],
    });
    expect(fuseRetrievalHits([retrievalHit('notes/a')], [], -1)).toEqual([]);
  });
});
