/**
 * Answer generator — Sprint 1.3 T-1.3.1 wave 3.
 *
 * Retrieval pass → LLM answer pass. Citation comes from the retrieval
 * result: every chunk surface carries a stable `notePath`, which the
 * answerer surfaces verbatim in `sources`.
 *
 * Prompt template follows the R5 contract: the model is told which note
 * paths it may cite (so it doesn't hallucinate paths), then asked to
 * answer in Chinese (matches v6 product, NJX). The sources list is also
 * surfaced to the caller so the UI can render clickable links.
 *
 * This module is **decoupled from any specific LLM** — callers pass a
 * `ChatStream` async-iterable factory. The default implementation uses
 * `@copilot/llm-client` (Sprint 1.1 LLMClient.chatStream), but in tests
 * we inject a fake stream that produces scripted deltas.
 */

import type { VectorStore } from './vector-store.js';
import type { Embedder } from './embedder.js';
import type {
  RagAnswerChunk,
  RagAnswerResult,
  RagSourceDetail,
  RetrievalEvidence,
  RetrievalHit,
  RetrievalResult,
} from './types.js';

/** Minimal streaming chat surface — matches @copilot/llm-client.StreamChunk */
export interface AnswererStreamChunk {
  content: string;
  finishReason?: string;
}

export type ChatStreamFactory = (
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { model: string; signal?: AbortSignal },
) => AsyncIterable<AnswererStreamChunk> | Promise<AsyncIterable<AnswererStreamChunk>>;

export interface AnswerOptions {
  supplementalHits?: readonly RetrievalHit[];
  signal?: AbortSignal;
}

export interface AnswererConfig {
  /** chat model id (e.g. "MiniMax-M3") */
  model?: string;
  /** top-k for retrieval, default 5 (Sprint 1.3 acceptance signal) */
  topK?: number;
  /** cosine similarity floor, default -1 (no filter) */
  minScore?: number;
  /** prompt language; default 'zh' */
  language?: 'zh' | 'en';
  /** cap on total chars fed into the LLM context (per retrieved chunk) */
  perChunkCharCap?: number;
  /** max chunks to include in the prompt context — defends against huge stores */
  maxContextChunks?: number;
}

const DEFAULT_MODEL = 'MiniMax-M3';
const DEFAULT_TOP_K = 5;
const DEFAULT_PER_CHUNK_CAP = 800;
const DEFAULT_MAX_CONTEXT_CHUNKS = 5;

export class Answerer {
  private readonly embedder: Embedder;
  private readonly store: VectorStore;
  private readonly streamFactory: ChatStreamFactory;
  private readonly model: string;
  private readonly topK: number;
  private readonly minScore: number;
  private readonly language: 'zh' | 'en';
  private readonly perChunkCharCap: number;
  private readonly maxContextChunks: number;

  constructor(
    embedder: Embedder,
    store: VectorStore,
    streamFactory: ChatStreamFactory,
    config: AnswererConfig = {},
  ) {
    this.embedder = embedder;
    this.store = store;
    this.streamFactory = streamFactory;
    this.model = config.model ?? DEFAULT_MODEL;
    this.topK = config.topK ?? DEFAULT_TOP_K;
    this.minScore = config.minScore ?? -1;
    this.language = config.language ?? 'zh';
    this.perChunkCharCap = config.perChunkCharCap ?? DEFAULT_PER_CHUNK_CAP;
    this.maxContextChunks = config.maxContextChunks ?? DEFAULT_MAX_CONTEXT_CHUNKS;
  }

  /**
   * End-to-end retrieval + answer streaming. The caller iterates the
   * returned AsyncIterable; each yielded chunk has the partial delta and
   * the current source list (so the UI can render sources as they
   * become relevant).
   */
  async *answer(
    query: string,
    options: AnswerOptions = {},
  ): AsyncGenerator<RagAnswerChunk, RagAnswerResult> {
    if (!query || typeof query !== 'string') {
      throw new Error('Answerer.answer: query must be a non-empty string');
    }

    throwIfAborted(options.signal);
    const retrieval = await this.retrieve(query, options);

    if (retrieval.hits.length === 0) {
      // empty-state: still surface a final answer (politely say "no info")
      yield {
        delta: emptyAnswer(this.language),
        citedSources: [],
        sourceDetails: [],
      };
      return {
        query,
        answer: emptyAnswer(this.language),
        sources: [],
        sourceDetails: [],
        totalChars: emptyAnswer(this.language).length,
      };
    }

    const prompt = this.buildPrompt(query, retrieval);
    const stream = await this.streamFactory(
      [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: prompt },
      ],
      { model: this.model, signal: options.signal },
    );

    let assembled = '';
    const citedSources = dedupSources(retrieval.hits.map((h) => h.chunk.notePath));
    const sourceDetails = toSourceDetails(retrieval.hits);

    for await (const delta of stream) {
      throwIfAborted(options.signal);
      if (!delta?.content) continue;
      assembled += delta.content;
      yield {
        delta: delta.content,
        citedSources,
        sourceDetails,
      };
    }

    return {
      query,
      answer: assembled.trim(),
      sources: citedSources,
      sourceDetails,
      totalChars: assembled.length,
    };
  }

  /** Retrieval-only path — exposed for /search routes & tests. */
  async retrieve(query: string, options: AnswerOptions = {}): Promise<RetrievalResult> {
    throwIfAborted(options.signal);
    let queryEmbedding: Float32Array = new Float32Array(0);
    let vectorHits: RetrievalHit[] = [];
    let candidates = 0;
    if (this.store.count() > 0) {
      queryEmbedding = await this.embedder.embed(query, options.signal);
      const vectorResult = await this.store.search(queryEmbedding, {
        topK: this.topK,
        minScore: this.minScore,
      });
      vectorHits = vectorResult.hits.map((hit) => ({ ...hit, evidence: hit.evidence ?? ['vector'] }));
      candidates = vectorResult.candidates;
    }
    return {
      query,
      queryEmbedding,
      hits: fuseRetrievalHits(vectorHits, options.supplementalHits ?? [], this.topK),
      candidates: candidates + (options.supplementalHits?.length ?? 0),
    };
  }

  private systemPrompt(): string {
    if (this.language === 'en') {
      return [
        'You are a retrieval-augmented assistant for a personal knowledge base.',
        'You may only cite the note paths the user provides under "Available notes".',
        'Answer concisely. Use bullet points for lists. Do not invent facts beyond the cited notes.',
        'Append "(source: <note_path>)" after each cited paragraph or bullet.',
      ].join('\n');
    }
    return [
      '你是一个基于检索的个人知识助手。',
      '只能在"可用笔记"中列出的笔记路径范围内引用。',
      '用中文简洁回答；列表用项目符号。不可编造引用之外的事实。',
      '在每段引用之后追加 "(来源: <note_path>)"。',
    ].join('\n');
  }

  private buildPrompt(query: string, retrieval: RetrievalResult): string {
    const blocks = retrieval.hits
      .slice(0, this.maxContextChunks)
      .map((h, i) => {
        const truncated =
          h.chunk.text.length > this.perChunkCharCap
            ? h.chunk.text.slice(0, this.perChunkCharCap) + '…'
            : h.chunk.text;
        return `(${i + 1}) [${h.chunk.notePath}]\n${truncated}`;
      });

    const headerZh =
      '用户问题: ' + query + '\n\n可用笔记 (note_path → 正文片段):\n';
    const headerEn = 'User query: ' + query + '\n\nAvailable notes:\n';
    const header = this.language === 'en' ? headerEn : headerZh;
    const suffixZh =
      '\n请基于以上可用笔记回答用户问题，并在每段后用 (来源: <note_path>) 标记引用。';
    const suffixEn =
      '\nAnswer using only the notes above; cite each paragraph with "(source: <note_path>)".';
    const suffix = this.language === 'en' ? suffixEn : suffixZh;

    return header + blocks.join('\n\n') + suffix;
  }
}

const EVIDENCE_ORDER: readonly RetrievalEvidence[] = ['vector', 'kg-entity', 'kg-neighbor'];

/** Merge vector and KG candidates at note granularity with stable ranking. */
export function fuseRetrievalHits(
  vectorHits: readonly RetrievalHit[],
  supplementalHits: readonly RetrievalHit[],
  limit: number,
): RetrievalHit[] {
  const byNote = new Map<string, RetrievalHit>();
  const evidenceByNote = new Map<string, Set<RetrievalEvidence>>();
  for (const hit of [...vectorHits, ...supplementalHits]) {
    const notePath = hit.chunk.notePath;
    if (!notePath) continue;
    const evidence = hit.evidence ?? ['vector'];
    const collected = evidenceByNote.get(notePath) ?? new Set<RetrievalEvidence>();
    for (const item of evidence) collected.add(item);
    evidenceByNote.set(notePath, collected);
    const current = byNote.get(notePath);
    if (!current || compareHits(hit, current) < 0) byNote.set(notePath, hit);
  }
  return [...byNote.values()]
    .map((hit) => ({
      ...hit,
      evidence: EVIDENCE_ORDER.filter((item) => evidenceByNote.get(hit.chunk.notePath)?.has(item)),
    }))
    .sort(compareHits)
    .slice(0, Math.max(0, Math.floor(limit)));
}

function compareHits(a: RetrievalHit, b: RetrievalHit): number {
  return b.score - a.score ||
    a.chunk.notePath.localeCompare(b.chunk.notePath) ||
    a.chunk.ordinal - b.chunk.ordinal ||
    a.chunk.id.localeCompare(b.chunk.id);
}

function toSourceDetails(hits: readonly RetrievalHit[]): RagSourceDetail[] {
  return hits.map((hit) => ({
    notePath: hit.chunk.notePath,
    evidence: hit.evidence ?? ['vector'],
    score: hit.score,
  }));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The operation was aborted.', 'AbortError');
}

function dedupSources(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function emptyAnswer(lang: 'zh' | 'en'): string {
  if (lang === 'en') {
    return 'No relevant notes found in the knowledge base.';
  }
  return '知识库内未找到相关笔记。';
}
