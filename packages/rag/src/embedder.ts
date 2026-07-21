/**
 * Ollama HTTP embedding wrapper.
 *
 * Sprint 1.3 T-1.3.1 — Local-first embedding.
 *
 * Uses Ollama's /api/embeddings endpoint. Pure fetch, no native deps.
 * Defaults to http://127.0.0.1:11434 (local Ollama server). There is NO
 * cloud OpenAI fallback (goal.md R5 + decision red line: 100% local).
 *
 * Default model is `bge-m3:latest` (1024 dims). Originally specified
 * `mxbai-embed-large` but that model is not installed on the dev host —
 * bge-m3 is the next-best 1024-dim candidate (nomic-embed-text at 768 dim
 * also works via explicit `model:` config).
 *
 * Ollama contract:
 *   POST {base}/api/embeddings
 *   { "model": "<model>", "prompt": "<text>" }
 *   → { "embedding": number[N] }
 *
 * For batching multiple texts we send sequentially — Ollama processes one
 * prompt per request. A future optimization could batch via a single
 * /api/embed call, but the per-text API is the documented stable surface.
 */

import type { EmbedderConfig } from './types.js';

const DEFAULT_MODEL = 'bge-m3:latest';
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 8000;

export class Embedder {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly dimensions: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EmbedderConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    // Allow tests / non-default models to override expected dim.
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'rag.Embedder: no fetch implementation available (Node 18+ required)',
      );
    }
  }

  /** expected vector length for the chosen model */
  get dim(): number {
    return this.dimensions;
  }

  /** model id (for metadata persistence on chunks) */
  get modelId(): string {
    return this.model;
  }

  /**
   * Embed one text. Returns a Float32Array of length = this.dim.
   * Throws if Ollama is unreachable, response is malformed, or dimension
   * doesn't match this.dim.
   */
  async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('rag.Embedder.embed: text must be a non-empty string');
    }
    const url = `${this.baseUrl}/api/embeddings`;
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '<no body>');
      throw new Error(
        `rag.Embedder.embed: Ollama returned ${response.status} ${response.statusText} — ${body.slice(0, 200)}`,
      );
    }
    const json = (await response.json()) as { embedding?: number[] };
    if (!Array.isArray(json.embedding)) {
      throw new Error(
        'rag.Embedder.embed: Ollama response missing `embedding` array',
      );
    }
    if (json.embedding.length !== this.dimensions) {
      throw new Error(
        `rag.Embedder.embed: dimension mismatch — got ${json.embedding.length}, expected ${this.dimensions} (model ${this.model})`,
      );
    }
    // Allocate once into typed-array view; do not copy twice.
    return Float32Array.from(json.embedding);
  }

  /**
   * Embed multiple texts sequentially. Stops on first error. Sequential
   * because Ollama /api/embeddings is single-text per request.
   */
  async embedAll(texts: readonly string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const t of texts) {
      out.push(await this.embed(t, signal));
    }
    return out;
  }
}
