/**
 * LLMClient — composes providers + retry + token-limit middleware.
 *
 * Public API:
 *   client.chat(req)
 *   client.chatStream(req) → AsyncIterable<StreamChunk>
 *   client.runStream(req) → helper that accumulates deltas into one string
 *   client.countTokens(messages)
 *
 * Provider factory: defaults to `MiniMaxProvider`. Pass `providerFactory` to swap in a
 * future OpenAI/Claude provider.
 *
 * Token-limit: enforced synchronously before each call.
 * Retry: applied on the whole call (and `chatStream` will retry once with stream=false
 *        if the initial streaming call exhausts retries — keeps semantics simple).
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMClientOptions,
  LLMProvider,
  StreamChunk,
  StreamResult,
} from './types.js';
import { ConfigError, isLLMError } from './util/errors.js';
import { MiniMaxProvider } from './providers/minimax.js';
import { withRetry } from './middleware/retry.js';
import { TokenLimiter } from './middleware/token-limit.js';

const DEFAULTS = {
  defaultModel: 'MiniMax-M3',
  maxRetries: 3,
  tokenLimitPerMin: 60_000,
} as const;

/** Re-export for downstream consumers that resolve the logger entry type. */
export type { LLMClientLogEntry } from './types.js';

export class LLMClient {
  public readonly provider: LLMProvider;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly maxRetries: number;
  private readonly logger?: LLMClientOptions['logger'];
  private readonly fallbackProvider?: LLMProvider;
  private readonly tokenLimiter: TokenLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Pre-resolved token counter — provider's countTokens or fallback to simple approx. */
  private readonly tokenCounter: (messages: ChatMessage[]) => number;

  constructor(opts: LLMClientOptions) {
    if (!opts || typeof opts !== 'object') {
      throw new ConfigError('LLMClient: options missing');
    }
    if (!opts.apiKey || typeof opts.apiKey !== 'string') {
      throw new ConfigError('LLMClient: apiKey missing — supply via env or config');
    }
    if (!opts.baseUrl || typeof opts.baseUrl !== 'string') {
      throw new ConfigError('LLMClient: baseUrl missing');
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.defaultModel = opts.defaultModel ?? DEFAULTS.defaultModel;
    this.maxRetries = Math.max(0, opts.maxRetries ?? DEFAULTS.maxRetries);
    this.logger = opts.logger
      ? (entry) => opts.logger?.(sanitizeLogEntry(entry))
      : undefined;
    this.fallbackProvider = opts.fallbackProvider;
    this.sleep =
      opts.sleep ??
      ((ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()));

    if (opts.providerFactory) {
      this.provider = opts.providerFactory({ apiKey: this.apiKey, baseUrl: this.baseUrl });
    } else {
      this.provider = new MiniMaxProvider({
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        defaultModel: this.defaultModel,
        logger: this.logger,
      });
    }

    this.tokenLimiter = new TokenLimiter({
      perMinute: opts.tokenLimitPerMin ?? DEFAULTS.tokenLimitPerMin,
      logger: this.logger,
    });
    this.tokenCounter = (m: ChatMessage[]) => {
      try {
        return this.provider.countTokens(m);
      } catch {
        return approximate(m);
      }
    };
  }

  /** Estimate tokens for messages using provider countTokens (falling back to approx). */
  countTokens(messages: ChatMessage[]): number {
    return this.tokenCounter(messages);
  }

  /** Provision the limiter for tests/UI. */
  get limiter(): TokenLimiter {
    return this.tokenLimiter;
  }

  /** Single-shot chat completion. */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const enriched = this.normalize(req);
    const tokensToReserve = this.tokenCounter(enriched.messages);
    this.tokenLimiter.acquire(tokensToReserve, enriched.user);

    try {
      const response = await withRetry(
        async () => this.provider.chat(enriched),
        {
          maxRetries: this.maxRetries,
          sleep: this.sleep,
          logger: this.logger,
        },
      );
      this.logger?.({
        ts: new Date().toISOString(),
        level: 'info',
        event: 'chat_done',
        model: response.model,
        tokensIn: response.usage.promptTokens,
        tokensOut: response.usage.completionTokens,
      });
      // If provider undercounted, top up to actual usage.
      const actual = response.usage.promptTokens + response.usage.completionTokens;
      if (actual > tokensToReserve) {
        this.tokenLimiter.acquire(actual - tokensToReserve, enriched.user);
      }
      return response;
    } catch (e) {
      // If primary exhausted retries AND fallback is configured, try fallback ONCE.
      if (
        this.fallbackProvider &&
        isLLMError(e) &&
        e.retryable
      ) {
        this.logger?.({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'fallback_invoked',
          from: this.provider.name,
          to: this.fallbackProvider.name,
          reason: e.code,
        });
        try {
          return await this.fallbackProvider.chat(enriched);
        } catch {
          this.logger?.({
            ts: new Date().toISOString(),
            level: 'error',
            event: 'fallback_failed',
            reason: 'fallback_failed',
          });
          throw e; // preserve primary error
        }
      }
      throw e;
    }
  }

  /** Streaming chat — yields StreamChunk as they arrive. */
  async *chatStream(req: ChatRequest): AsyncIterable<StreamChunk> {
    const enriched = this.normalize(req);
    const tokensToReserve = this.tokenCounter(enriched.messages);
    this.tokenLimiter.acquire(tokensToReserve, enriched.user);

    let attempt = 0;
    while (true) {
      let emitted = false;
      try {
        for await (const chunk of this.provider.chatStream(enriched)) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (error) {
        // Cancellation and every post-first-chunk failure are terminal: replaying
        // here would duplicate already-visible model output.
        if (enriched.signal?.aborted || emitted || !isRetryableStreamFailure(error)) {
          throw error;
        }
        if (attempt < this.maxRetries) {
          const delayMs = retryDelayMs(attempt);
          this.logger?.({
            ts: new Date().toISOString(),
            level: 'warn',
            event: 'stream_retry_before_first_chunk',
            attempt,
            nextAttempt: attempt + 1,
            delayMs,
          });
          attempt += 1;
          await this.sleep(delayMs);
          continue;
        }
        if (this.fallbackProvider) {
          this.logger?.({
            ts: new Date().toISOString(),
            level: 'warn',
            event: 'fallback_invoked',
            from: this.provider.name,
            to: this.fallbackProvider.name,
          });
          // Fallback is also terminal after its first yielded chunk; it is never
          // replayed by the client.
          yield* this.fallbackProvider.chatStream(enriched);
          return;
        }
        throw error;
      }
    }
  }

  /** Stable renderer-safe projection; never echoes provider messages or causes. */
  projectError(error: unknown): SafeModelError {
    const code = isLLMError(error) ? error.code : 'unknown';
    switch (code) {
      case 'auth': return { category: 'auth', message: 'Model credentials were rejected. Update the credential in Settings.' };
      case 'rate_limit':
      case 'token_limit_local': return { category: 'rate_limit', message: 'The model is temporarily rate limited. Try again later.' };
      case 'server': return { category: 'provider', message: 'The model service is temporarily unavailable.' };
      case 'network': return { category: 'offline', message: 'The model service could not be reached.' };
      case 'timeout': return { category: 'timeout', message: 'The model request timed out.' };
      case 'abort': return { category: 'cancelled', message: 'The model request was cancelled.' };
      case 'config':
      case 'bad_request': return { category: 'configuration', message: 'The model configuration is invalid.' };
      default: return { category: 'internal', message: 'The model request failed safely.' };
    }
  }

  /** Convenience helper — collects deltas into one string. */
  async runStream(req: ChatRequest): Promise<StreamResult> {
    let full = '';
    let lastChunk: StreamChunk | undefined;
    for await (const c of this.chatStream(req)) {
      lastChunk = c;
      full += c.delta;
    }
    return {
      fullText: full,
      usage: lastChunk?.usage,
      finishReason: lastChunk?.finishReason ?? 'stop',
    };
  }

  // ────────── internals ──────────

  private normalize(req: ChatRequest): ChatRequest {
    if (!req || typeof req !== 'object') {
      throw new ConfigError('LLMClient: request missing');
    }
    const messages = Array.isArray(req.messages) ? req.messages : [];
    if (messages.length === 0) {
      throw new ConfigError('LLMClient: messages must be non-empty');
    }
    for (const m of messages) {
      if (!m || (m.role !== 'system' && m.role !== 'user' && m.role !== 'assistant')) {
        throw new ConfigError(`LLMClient: invalid message role: ${m?.role}`);
      }
      if (typeof m.content !== 'string') {
        throw new ConfigError('LLMClient: message.content must be a string');
      }
    }
    return {
      model: req.model || this.defaultModel,
      messages,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      stream: req.stream,
      user: req.user,
      stop: req.stop,
      extras: req.extras,
      signal: req.signal,
    };
  }
}

export type SafeModelErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'provider'
  | 'offline'
  | 'timeout'
  | 'cancelled'
  | 'configuration'
  | 'internal';

export interface SafeModelError {
  category: SafeModelErrorCategory;
  message: string;
}

function isRetryableStreamFailure(error: unknown): boolean {
  return isLLMError(error) ? error.retryable && error.code !== 'abort' : false;
}

function retryDelayMs(attempt: number): number {
  return [1000, 3000, 9000][Math.min(attempt, 2)] ?? 9000;
}

function sanitizeLogEntry(entry: { event: string; [key: string]: unknown }) {
  const safe = { ...entry };
  for (const key of ['error', 'lastError'] as const) {
    if (key in safe) safe[key] = 'redacted_failure';
  }
  if ('reason' in safe && typeof safe.reason === 'string' && !/^[a-z_]+(?::(?:true|false))?$/u.test(safe.reason)) {
    safe.reason = 'redacted_failure';
  }
  return safe;
}

/** Fallback token approximation when provider.countTokens throws. */
function approximate(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    const t = (m.content || '').trim();
    const cjk = (t.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const other = t.length - cjk;
    total += Math.max(1, Math.round(cjk * 1.5 + other * 0.25)) + 4;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Re-exports for consumer convenience.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export {
  LLMError,
  isLLMError,
  RateLimitError,
  TokenLimitError,
  NetworkError,
  TimeoutError,
  AuthError,
  BadRequestError,
  ServerError,
  StreamError,
  ConfigError,
  AbortError,
  errorFromHttpStatus,
} from './util/errors.js';
export {
  withRetry,
  computeBackoffMs,
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_JITTER_RATIO,
} from './middleware/retry.js';
export { TokenLimiter, createTokenLimiter } from './middleware/token-limit.js';
export {
  parseSseStream,
  parseProviderSseStream,
  parseEventRecord,
  defaultStreamChunkMapper,
} from './middleware/stream-parser.js';
export { MiniMaxProvider, approximateTokenCount } from './providers/minimax.js';
export type {
  LLMProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  StreamResult,
  FinishReason,
  TokenUsage,
  Role,
  LLMClientOptions,
} from './types.js';
