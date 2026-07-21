/**
 * Public type definitions for @copilot/llm-client.
 *
 * Freeze point: Sprint 1.1 (T-1.1.5).
 * Consumers: Sprint 1.2 KG builder, Sprint 1.3 RAG chat console, Sprint 1.3 voice → LLM gate.
 */

export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  /** Model id — e.g. 'MiniMax-M3', 'gpt-4o', 'claude-3-5-sonnet'. */
  model: string;
  messages: ChatMessage[];
  /** 0..2. Provider-specific; defaults to provider default. */
  temperature?: number;
  /** Upper bound on completion tokens. */
  maxTokens?: number;
  /** When true, use chatStream and yield deltas as they arrive. */
  stream?: boolean;
  /** Stable per-user id used as rate-limit key. */
  user?: string;
  /** Optional stop sequences. */
  stop?: string[];
  /** Pass-through extras for provider-specific options (must not contain secrets). */
  extras?: Record<string, unknown>;
  /**
   * AbortSignal propagated to the underlying fetch. Sprint 1.1 callers
   * typically construct this from request cancellation hooks added in
   * Sprint 1.2/1.3.
   */
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export interface ChatResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  finishReason: FinishReason;
  /** Provider raw payload for debugging — kept opaque. */
  raw?: unknown;
}

export interface StreamChunk {
  delta: string;
  finishReason?: FinishReason;
  usage?: TokenUsage;
  /** Raw provider chunk for observability. */
  raw?: unknown;
}

/** A pluggable LLM backend — used by the client + middleware. */
export interface LLMProvider {
  /** Capability id, e.g. 'minimax', 'openai', 'claude'. */
  readonly name: string;
  /** Non-streaming chat completion. */
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Streaming chat completion yielding deltas. */
  chatStream(req: ChatRequest): AsyncIterable<StreamChunk>;
  /** Approximate token count for messages. Provider-accurate when possible. */
  countTokens(messages: ChatMessage[]): number;
}

export interface LLMClientOptions {
  /** API key — required. Throw early if absent. NEVER hardcode. */
  apiKey: string;
  /** Base URL — e.g. http://127.0.0.1:45557/v1. */
  baseUrl: string;
  /** Default model id when request omits one. */
  defaultModel?: string;
  /** Max retries (default 3 → 4 attempts total). */
  maxRetries?: number;
  /** Per-minute token budget. Defaults to 60_000. */
  tokenLimitPerMin?: number;
  /**
   * Optional fallback provider invoked only when:
   *   1) the primary provider fails after exhausting retries AND
   *   2) the error is retriable (network/5xx/rate-limit).
   * The fallback MUST itself support chat/chatStream/countTokens.
   */
  fallbackProvider?: LLMProvider;
  /** Structured logger — one JSON line per event. */
  logger?: (entry: LLMClientLogEntry) => void;
  /** Adapter override — defaults to built-in MiniMax provider. */
  providerFactory?: (opts: { apiKey: string; baseUrl: string }) => LLMProvider;
  /** Sleep function override for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type LLMClientLogEntry = {
  ts?: string;
  level?: string;
  event: string;
  [k: string]: unknown;
};

/** Retry-status info surfaced after attempts so callers can render UX. */
export interface RetryDecision {
  attempts: number;
  totalDelayMs: number;
  lastError: string;
}

/** Returned on stream end. */
export interface StreamResult {
  fullText: string;
  usage?: TokenUsage;
  finishReason: FinishReason;
}
