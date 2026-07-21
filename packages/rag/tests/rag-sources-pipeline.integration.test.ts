import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Answerer } from '../src/answerer.js';
import { Embedder } from '../src/embedder.js';
import { Indexer } from '../src/indexer.js';
import { createVectorStore, type VectorStore } from '../src/vector-store.js';

const tempDirs: string[] = [];
const DIM = 4;

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function localEmbeddingFetch(): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as { prompt: string };
    const vector = /OPC|个人公司/i.test(payload.prompt)
      ? [1, 0, 0, 0]
      : [0, 1, 0, 0];
    return new Response(JSON.stringify({ embedding: vector }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function collectAnswer(answerer: Answerer, question: string) {
  const deltas: string[] = [];
  const iterator = answerer.answer(question);
  let item = await iterator.next();
  while (!item.done) {
    deltas.push(item.value.delta);
    item = await iterator.next();
  }
  return { deltas, result: item.value };
}

describe('Phase 1 local RAG index -> retrieve -> answer -> sources integration', () => {
  it('persists a deterministic local index and returns sources aligned with the answer context', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-sources-int-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'rag.sqlite');
    const embedder = new Embedder({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'fixture-4d',
      dimensions: DIM,
      fetchImpl: localEmbeddingFetch(),
    });
    let store: VectorStore = await createVectorStore({ dbPath, dimensions: DIM });
    const report = await new Indexer(embedder, store).indexNotes([
      { path: 'glossary/opc', title: 'OPC', body: 'OPC 是 One-Person Company，也就是个人公司。' },
      { path: 'glossary/mro', title: 'MRO', body: 'MRO 是航空维修术语。' },
    ]);
    expect(report).toMatchObject({ notes: 2, chunksInserted: 2, errors: [] });
    await store.close();

    store = await createVectorStore({ dbPath, dimensions: DIM });
    const observedPrompts: string[] = [];
    const answerer = new Answerer(embedder, store, async function* (messages) {
      observedPrompts.push(messages.at(-1)?.content ?? '');
      yield { content: 'OPC 是个人公司。' };
      yield { content: '(来源: glossary/opc)' };
    }, { model: 'fixture', topK: 1, minScore: 0.5 });

    const retrieval = await answerer.retrieve('OPC 是什么？');
    expect(retrieval.hits.map((hit) => hit.chunk.notePath)).toEqual(['glossary/opc']);
    const answer = await collectAnswer(answerer, 'OPC 是什么？');
    expect(answer.deltas.join('')).toContain('OPC 是个人公司');
    expect(answer.result.sources).toEqual(['glossary/opc']);
    expect(observedPrompts[0]).toContain('[glossary/opc]');
    expect(observedPrompts[0]).not.toContain('[glossary/mro]');
    await store.close();
  });
});
