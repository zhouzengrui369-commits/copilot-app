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
  ProviderStatus,
  RagDiagnosticCode,
  RagAnswerChunk,
  RagAnswerResult,
  RagSourceDetail,
  RetrievalEvidence,
  RetrievalHit,
  RetrievalMode,
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
const SOURCE_EXCERPT_CHAR_CAP = 240;

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
      const answer = emptyAnswer(this.language);
      yield {
        delta: answer,
        citedSources: [],
        sourceDetails: [],
        retrievalMode: retrieval.mode,
        providerStatus: retrieval.providerStatus,
        diagnostics: retrieval.diagnostics,
      };
      return {
        query,
        answer,
        sources: [],
        sourceDetails: [],
        totalChars: answer.length,
        retrievalMode: retrieval.mode,
        providerStatus: retrieval.providerStatus,
        diagnostics: retrieval.diagnostics,
      };
    }

    // One shared slice is used for both prompt construction and citation
    // validation. A lower-ranked hit that the model never saw must not become
    // a valid citation merely because it existed elsewhere in retrieval.
    const contextHits = retrieval.hits.slice(0, this.maxContextChunks);
    const prompt = this.buildPrompt(query, contextHits);
    const stream = await this.streamFactory(
      [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: prompt },
      ],
      { model: this.model, signal: options.signal },
    );

    // R2 grounding gate: never surface provisional sources while the model is
    // still generating. Buffer the complete output, then validate every
    // citation against this retrieval pass before yielding anything.
    let assembled = '';
    let terminalFinishReason: string | undefined;
    let terminalSeen = false;
    let invalidTerminalSequence = false;
    for await (const delta of stream) {
      throwIfAborted(options.signal);
      if (delta?.finishReason !== undefined) {
        if (terminalSeen) invalidTerminalSequence = true;
        terminalSeen = true;
        terminalFinishReason = delta.finishReason;
      } else if (terminalSeen && delta?.content) {
        // Content after a terminal marker is not a valid completed response.
        invalidTerminalSequence = true;
      }
      if (!delta?.content) continue;
      assembled += delta.content;
    }

    throwIfAborted(options.signal);
    const acceptedTerminal =
      terminalSeen &&
      !invalidTerminalSequence &&
      terminalFinishReason === 'stop';
    const grounded = acceptedTerminal
      ? validateCitations(assembled, contextHits)
      : { valid: false as const, sources: [] as [] };
    if (!grounded.valid) {
      const answer = groundingFailureAnswer(this.language);
      const diagnostics = stableDiagnostics([
        ...(retrieval.diagnostics ?? []),
        'RAG_CITATION_SOURCE_MISMATCH',
      ]);
      yield {
        delta: answer,
        citedSources: [],
        sourceDetails: [],
        retrievalMode: retrieval.mode,
        providerStatus: retrieval.providerStatus,
        diagnostics,
      };
      return {
        query,
        answer,
        sources: [],
        sourceDetails: [],
        totalChars: answer.length,
        retrievalMode: retrieval.mode,
        providerStatus: retrieval.providerStatus,
        diagnostics,
      };
    }

    const answer = assembled.trim();
    const sourceDetails = toSourceDetails(contextHits, grounded.sources);
    yield {
      delta: answer,
      citedSources: grounded.sources,
      sourceDetails,
      retrievalMode: retrieval.mode,
      providerStatus: retrieval.providerStatus,
      diagnostics: retrieval.diagnostics,
    };
    return {
      query,
      answer,
      sources: grounded.sources,
      sourceDetails,
      totalChars: answer.length,
      retrievalMode: retrieval.mode,
      providerStatus: retrieval.providerStatus,
      diagnostics: retrieval.diagnostics,
    };
  }

  /** Retrieval-only path — exposed for /search routes & tests. */
  async retrieve(query: string, options: AnswerOptions = {}): Promise<RetrievalResult> {
    throwIfAborted(options.signal);
    const supplemental = options.supplementalHits ?? [];
    // Deliberately outside every catch: database/store failures must remain
    // hard failures and must never be mislabeled as provider fallback.
    const indexedCount = typeof this.store.textCount === 'function'
      ? this.store.textCount()
      : this.store.count();

    if (indexedCount === 0) {
      const hits = fuseRetrievalHits([], supplemental, this.topK);
      const mode = retrievalModeForHits(hits);
      const diagnostics = stableDiagnostics([
        ...(hits.length > 0 ? ['RAG_KG_SUPPLEMENTAL' as const] : []),
        ...(hits.length === 0 ? ['RAG_NO_CANDIDATE' as const] : []),
      ]);
      return {
        query,
        queryEmbedding: new Float32Array(0),
        hits,
        candidates: supplemental.length,
        mode,
        diagnostics,
      };
    }

    let queryEmbedding: Float32Array;
    try {
      // This is the only operation whose failure may activate local-text.
      queryEmbedding = await this.embedder.embed(query, options.signal);
    } catch (error) {
      if (options.signal?.aborted) throwIfAborted(options.signal);
      const abortCause = findAbortLike(error);
      if (abortCause) throw abortCause;
      const providerStatus = classifyProviderFailure(error);
      const localHits = localTextFallback(query, this.store);
      const hits = fuseRetrievalHits(localHits, supplemental, this.topK);
      const diagnostics = stableDiagnostics([
        providerStatus === 'unavailable'
          ? 'RAG_PROVIDER_UNAVAILABLE'
          : 'RAG_PROVIDER_FAILURE',
        'RAG_LOCAL_TEXT_FALLBACK',
        ...(supplemental.length > 0 ? ['RAG_KG_SUPPLEMENTAL' as const] : []),
        ...(hits.length === 0 ? ['RAG_NO_CANDIDATE' as const] : []),
      ]);
      return {
        query,
        queryEmbedding: new Float32Array(0),
        hits,
        candidates: indexedCount + supplemental.length,
        mode: retrievalModeForHits(hits),
        providerStatus,
        diagnostics,
      };
    }

    throwIfAborted(options.signal);
    // Deliberately outside the embedding catch: search/database errors
    // propagate unchanged instead of being hidden behind local-text.
    const vectorResult = await this.store.search(queryEmbedding, {
      topK: this.topK,
      minScore: this.minScore,
    });
    const vectorHits = vectorResult.hits.map((hit) => ({
      ...hit,
      evidence: hit.evidence ?? ['vector' as const],
    }));
    const vectorCount = typeof this.store.vectorCount === 'function'
      ? this.store.vectorCount()
      : this.store.count();
    const vectorDegraded = vectorCount < indexedCount;
    const useLocalText = vectorDegraded || vectorHits.length === 0;
    const localHits = useLocalText ? localTextFallback(query, this.store) : [];
    const hits = fuseRetrievalHits(
      [...vectorHits, ...localHits],
      supplemental,
      this.topK,
    );
    const diagnostics = stableDiagnostics([
      ...(vectorDegraded ? ['RAG_VECTOR_INDEX_DEGRADED' as const] : []),
      'RAG_VECTOR',
      ...(useLocalText ? ['RAG_LOCAL_TEXT_FALLBACK' as const] : []),
      ...(supplemental.length > 0 ? ['RAG_KG_SUPPLEMENTAL' as const] : []),
      ...(hits.length === 0 ? ['RAG_NO_CANDIDATE' as const] : []),
    ]);
    return {
      query,
      queryEmbedding,
      hits,
      candidates: (
        useLocalText
          ? Math.max(indexedCount, vectorResult.candidates)
          : vectorResult.candidates
      ) + supplemental.length,
      mode: retrievalModeForHits(hits),
      providerStatus: vectorDegraded ? 'degraded' : 'ok',
      diagnostics,
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

  private buildPrompt(query: string, contextHits: readonly RetrievalHit[]): string {
    const blocks = contextHits
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

const EVIDENCE_ORDER: readonly RetrievalEvidence[] = [
  'vector',
  'local-text',
  'kg-entity',
  'kg-neighbor',
];
const DIAGNOSTIC_ORDER: readonly RagDiagnosticCode[] = [
  'RAG_PROVIDER_UNAVAILABLE',
  'RAG_PROVIDER_FAILURE',
  'RAG_VECTOR_INDEX_DEGRADED',
  'RAG_VECTOR',
  'RAG_LOCAL_TEXT_FALLBACK',
  'RAG_KG_SUPPLEMENTAL',
  'RAG_NO_CANDIDATE',
  'RAG_CITATION_SOURCE_MISMATCH',
];

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


function localTextFallback(query: string, store: VectorStore): RetrievalHit[] {
  const terms = tokenize(query);
  const hits: RetrievalHit[] = [];
  if (terms.length === 0) return hits;
  for (const notePath of store.listNotePaths()) {
    for (const chunk of store.listChunksForNote(notePath)) {
      const textTerms = tokenize(`${notePath} ${chunk.text}`);
      const matches = terms.filter((term) => textTerms.includes(term)).length;
      if (matches > 0) {
        hits.push({
          chunk,
          score: matches / terms.length,
          evidence: ['local-text'],
        });
      }
    }
  }
  return hits.sort(compareHits);
}

function tokenize(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9]+/gu) ?? []) {
    tokens.add(word);
  }
  for (const sequence of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const characters = [...sequence];
    if (characters.length === 1) tokens.add(sequence);
    for (let i = 0; i < characters.length - 1; i += 1) {
      tokens.add(`${characters[i]}${characters[i + 1]}`);
    }
  }
  for (const word of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (!/[a-z0-9]/u.test(word) && !/\p{Script=Han}/u.test(word)) {
      tokens.add(word);
    }
  }
  return [...tokens].sort(compareText);
}

function compareHits(a: RetrievalHit, b: RetrievalHit): number {
  return b.score - a.score ||
    compareText(a.chunk.notePath, b.chunk.notePath) ||
    a.chunk.ordinal - b.chunk.ordinal ||
    compareText(a.chunk.id, b.chunk.id);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function retrievalModeForHits(hits: readonly RetrievalHit[]): RetrievalMode {
  const evidence = new Set(hits.flatMap((hit) => hit.evidence ?? ['vector']));
  if (evidence.has('vector')) return 'vector';
  if (evidence.has('local-text')) return 'local-text';
  if (evidence.has('kg-entity') || evidence.has('kg-neighbor')) return 'kg';
  return 'empty';
}

function sourceMode(evidence: readonly RetrievalEvidence[]): RetrievalMode {
  if (evidence.includes('vector')) return 'vector';
  if (evidence.includes('local-text')) return 'local-text';
  if (evidence.includes('kg-entity') || evidence.includes('kg-neighbor')) return 'kg';
  return 'empty';
}

function toSourceDetails(
  hits: readonly RetrievalHit[],
  citedSources: readonly string[],
): RagSourceDetail[] {
  const firstHitByPath = new Map<string, RetrievalHit>();
  for (const hit of hits) {
    if (!firstHitByPath.has(hit.chunk.notePath)) {
      firstHitByPath.set(hit.chunk.notePath, hit);
    }
  }
  const details: RagSourceDetail[] = [];
  for (const notePath of citedSources) {
    const hit = firstHitByPath.get(notePath);
    if (!hit) continue;
    const evidence = [...(hit.evidence ?? ['vector' as const])];
    const excerptStart = hit.chunk.charRange[0];
    const availableCodeUnits = Math.max(
      0,
      hit.chunk.charRange[1] - excerptStart,
    );
    const excerpt = boundedExcerpt(
      hit.chunk.text,
      Math.min(SOURCE_EXCERPT_CHAR_CAP, availableCodeUnits),
    );
    const excerptEnd = excerptStart + excerpt.length;
    details.push({
      notePath,
      evidence,
      score: hit.score,
      chunkId: hit.chunk.id,
      charRange: [excerptStart, excerptEnd],
      excerpt,
      mode: sourceMode(evidence),
    });
  }
  return details;
}

function boundedExcerpt(text: string, maxCodeUnits: number): string {
  let excerpt = text.slice(0, Math.max(0, maxCodeUnits));
  if (excerpt.length < text.length && excerpt.length > 0) {
    const lastCodeUnit = excerpt.charCodeAt(excerpt.length - 1);
    const nextCodeUnit = text.charCodeAt(excerpt.length);
    if (
      lastCodeUnit >= 0xD800 &&
      lastCodeUnit <= 0xDBFF &&
      nextCodeUnit >= 0xDC00 &&
      nextCodeUnit <= 0xDFFF
    ) {
      excerpt = excerpt.slice(0, -1);
    }
  }
  return excerpt;
}

function validateCitations(
  answer: string,
  hits: readonly RetrievalHit[],
): { valid: true; sources: string[] } | { valid: false; sources: [] } {
  if (!answer.trim()) return { valid: false, sources: [] };
  const allowed = new Set(hits.map((hit) => hit.chunk.notePath));
  const cited: string[] = [];
  const segments = answerSegments(answer);
  if (segments.length === 0) return { valid: false, sources: [] };
  for (const segment of segments) {
    const markerCount = segment.match(/\((?:来源|source)\s*:/giu)?.length ?? 0;
    const matches = [...segment.matchAll(/\((?:来源|source)\s*:\s*([^)]+?)\s*\)/giu)];
    if (matches.length === 0 || markerCount !== matches.length) {
      return { valid: false, sources: [] };
    }
    const last = matches.at(-1);
    if (
      last?.index === undefined ||
      segment.slice(last.index + last[0].length).trim().length > 0
    ) {
      return { valid: false, sources: [] };
    }
    for (const match of matches) {
      const path = match[1]?.trim() ?? '';
      if (!path || !allowed.has(path)) return { valid: false, sources: [] };
      cited.push(path);
    }
  }
  const sources = dedupSources(cited);
  if (sources.length === 0) return { valid: false, sources: [] };
  return { valid: true, sources };
}

function answerSegments(answer: string): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const segment = current.join('\n').trim();
    if (segment) segments.push(segment);
    current = [];
  };
  for (const line of answer.split(/\r?\n/u)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const beginsBullet = /^\s*(?:[-*+•]|\d+[.)])\s+/u.test(line);
    if (beginsBullet && current.length > 0) flush();
    current.push(line);
  }
  flush();
  return segments;
}

function classifyProviderFailure(error: unknown): ProviderStatus {
  const record = isRecord(error) ? error : {};
  const cause = isRecord(record.cause) ? record.cause : {};
  const code = String(record.code ?? cause.code ?? '').toUpperCase();
  const name = String(record.name ?? '').toLowerCase();
  const causeName = String(cause.name ?? '').toLowerCase();
  const message = `${String(record.message ?? '')} ${String(cause.message ?? '')}`.toLowerCase();
  if (
    name === 'networkerror' ||
    causeName === 'networkerror' ||
    name === 'providerunavailableerror' ||
    causeName === 'providerunavailableerror' ||
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(code) ||
    /unavailable|not configured|fetch failed|connection refused|timed out/.test(message)
  ) {
    return 'unavailable';
  }
  return 'failed';
}

function findAbortLike(
  error: unknown,
  seen: Set<object> = new Set<object>(),
): unknown | null {
  if (!isRecord(error) || seen.has(error)) return null;
  seen.add(error);
  const name = String(error.name ?? '').toLowerCase();
  const code = String(error.code ?? '').toUpperCase();
  if (
    name === 'aborterror' ||
    code === 'ABORT_ERR' ||
    code === 'ERR_ABORTED'
  ) {
    return error;
  }
  return findAbortLike(error.cause, seen);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stableDiagnostics(values: readonly RagDiagnosticCode[]): RagDiagnosticCode[] {
  const present = new Set(values);
  return DIAGNOSTIC_ORDER.filter((value) => present.has(value));
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

function groundingFailureAnswer(lang: 'zh' | 'en'): string {
  if (lang === 'en') {
    return 'No verifiable answer could be produced from the local notes.';
  }
  return '未能基于本地笔记生成可核验回答。';
}
