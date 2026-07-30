/**
 * Local-first embedding provider selection.
 *
 * Packaged Copilot defaults to a deterministic embedded character/word n-gram
 * provider. It has no process, socket, model download, native addon, or cloud
 * dependency. The historical Ollama HTTP path remains available only through
 * explicit/inferred compatibility configuration.
 */

import { TextEncoder } from 'node:util';
import type {
  EmbedderConfig,
  EmbeddingHealth,
  EmbeddingPrivacyClass,
  EmbeddingProvider,
  EmbeddingProviderKind,
} from './types.js';

const DEFAULT_EMBEDDED_DIMENSIONS = 1024;
const EMBEDDED_PROVIDER_ID = 'embedded-local-hash-v1';
const EMBEDDED_MODEL_REVISION = 'char-word-ngram-v1';
const DEFAULT_OLLAMA_MODEL = 'bge-m3:latest';
const DEFAULT_OLLAMA_DIMENSIONS = 1024;
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_TIMEOUT_MS = 8000;
const encoder = new TextEncoder();

export class Embedder implements EmbeddingProvider {
  private readonly provider: EmbeddingProvider;

  constructor(config: EmbedderConfig = {}) {
    const kind = resolveProviderKind(config);
    this.provider = kind === 'ollama'
      ? new OllamaEmbeddingProvider(config)
      : new EmbeddedLocalHashProvider(config);
  }

  get providerId(): string {
    return this.provider.providerId;
  }

  get dimensions(): number {
    return this.provider.dimensions;
  }

  /** Backward-compatible dimension accessor used by existing callers/tests. */
  get dim(): number {
    return this.provider.dimensions;
  }

  get modelId(): string {
    return this.provider.modelId;
  }

  get modelRevision(): string {
    return this.provider.modelRevision;
  }

  get privacyClass(): EmbeddingPrivacyClass {
    return this.provider.privacyClass;
  }

  health(): Promise<EmbeddingHealth> {
    return this.provider.health();
  }

  embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
    return this.provider.embed(text, signal);
  }

  embedAll(texts: readonly string[], signal?: AbortSignal): Promise<Float32Array[]> {
    return this.provider.embedAll(texts, signal);
  }
}

class EmbeddedLocalHashProvider implements EmbeddingProvider {
  readonly providerId = EMBEDDED_PROVIDER_ID;
  readonly dimensions: number;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly privacyClass = 'embedded-local' as const;

  constructor(config: EmbedderConfig) {
    this.dimensions = validDimensions(config.dimensions ?? DEFAULT_EMBEDDED_DIMENSIONS);
    this.modelId = `${EMBEDDED_PROVIDER_ID}:${this.dimensions}`;
    this.modelRevision = config.modelRevision ?? EMBEDDED_MODEL_REVISION;
  }

  async health(): Promise<EmbeddingHealth> {
    return {
      status: 'ok',
      providerId: this.providerId,
      dimensions: this.dimensions,
      modelRevision: this.modelRevision,
      privacyClass: this.privacyClass,
    };
  }

  async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
    assertText(text);
    throwIfAborted(signal);
    const vector = new Float32Array(this.dimensions);
    const features = embeddedFeatures(text);
    for (let index = 0; index < features.length; index += 1) {
      if ((index & 127) === 0) throwIfAborted(signal);
      const [feature, weight] = features[index]!;
      const slot = fnv1a(feature, 0x9e3779b9) % this.dimensions;
      const sign = (fnv1a(feature, 0x85ebca6b) & 1) === 0 ? -1 : 1;
      vector[slot] = (vector[slot] ?? 0) + sign * weight;
    }
    normalizeInPlace(vector);
    throwIfAborted(signal);
    return vector;
  }

  async embedAll(texts: readonly string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (const text of texts) vectors.push(await this.embed(text, signal));
    return vectors;
  }
}

class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerId = 'ollama-local-service';
  readonly dimensions: number;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly privacyClass = 'local-service' as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EmbedderConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/u, '');
    this.modelId = config.model ?? DEFAULT_OLLAMA_MODEL;
    this.modelRevision = config.modelRevision ?? this.modelId;
    this.timeoutMs = validTimeout(config.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS);
    this.dimensions = validDimensions(config.dimensions ?? DEFAULT_OLLAMA_DIMENSIONS);
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('rag.Embedder: no fetch implementation available for explicit Ollama provider');
    }
  }

  async health(): Promise<EmbeddingHealth> {
    return {
      status: 'configured',
      providerId: this.providerId,
      dimensions: this.dimensions,
      modelRevision: this.modelRevision,
      privacyClass: this.privacyClass,
    };
  }

  async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
    assertText(text);
    throwIfAborted(signal);
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
        body: JSON.stringify({ model: this.modelId, prompt: text }),
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
      throw new Error('rag.Embedder.embed: Ollama response missing `embedding` array');
    }
    if (json.embedding.length !== this.dimensions) {
      throw new Error(
        `rag.Embedder.embed: dimension mismatch — got ${json.embedding.length}, expected ${this.dimensions} (model ${this.modelId})`,
      );
    }
    return Float32Array.from(json.embedding);
  }

  async embedAll(texts: readonly string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (const text of texts) vectors.push(await this.embed(text, signal));
    return vectors;
  }
}

function resolveProviderKind(config: EmbedderConfig): EmbeddingProviderKind {
  if (config.provider !== undefined) {
    if (config.provider !== 'embedded-local' && config.provider !== 'ollama') {
      throw new Error('rag.Embedder: provider must be embedded-local or ollama');
    }
    return config.provider;
  }
  return config.baseUrl !== undefined
    || config.model !== undefined
    || config.timeoutMs !== undefined
    || config.fetchImpl !== undefined
    ? 'ollama'
    : 'embedded-local';
}

function embeddedFeatures(text: string): Array<readonly [string, number]> {
  const normalized = text.normalize('NFKC').toLowerCase().trim();
  const features: Array<readonly [string, number]> = [];
  for (const match of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    features.push([`w:${match[0]}`, 2]);
  }
  const characters = Array.from(normalized).filter((character) => /[\p{L}\p{N}]/u.test(character));
  const weights = [0, 0.35, 1, 0.75] as const;
  for (let size = 1; size <= 3; size += 1) {
    for (let start = 0; start + size <= characters.length; start += 1) {
      features.push([`c${size}:${characters.slice(start, start + size).join('')}`, weights[size]!]);
    }
  }
  if (features.length === 0) features.push([`raw:${normalized}`, 1]);
  return features;
}

function fnv1a(value: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (const byte of encoder.encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizeInPlace(vector: Float32Array): void {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('rag.Embedder.embed: embedded-local vector has zero norm');
  }
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / norm;
  }
}

function assertText(text: string): void {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('rag.Embedder.embed: text must be a non-empty string');
  }
}

function validDimensions(value: number): number {
  if (!Number.isSafeInteger(value) || value < 8 || value > 16_384) {
    throw new Error('rag.Embedder: dimensions must be an integer between 8 and 16384');
  }
  return value;
}

function validTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 120_000) {
    throw new Error('rag.Embedder: timeoutMs must be an integer between 1 and 120000');
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error(
    signal.reason instanceof Error ? signal.reason.message : 'embedding was cancelled',
  );
  error.name = 'AbortError';
  throw error;
}
