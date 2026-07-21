/**
 * Public API surface for @copilot/llm-client.
 *
 * Consumers:
 *   - apps/desktop (Electron main) — uses default export
 *   - apps/server  (Fastify)        — uses default export
 *   - Sprint 1.2 KG builder        — uses .chat / .chatStream
 *   - Sprint 1.3 RAG chat console  — uses .chatStream with stream=true
 */

export {
  LLMClient,
  // errors
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
  // retry
  withRetry,
  computeBackoffMs,
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_JITTER_RATIO,
  // token-limit
  TokenLimiter,
  createTokenLimiter,
  // stream parser
  parseSseStream,
  parseProviderSseStream,
  parseEventRecord,
  defaultStreamChunkMapper,
  // providers
  MiniMaxProvider,
  approximateTokenCount,
} from './client.js';

export type {
  LLMClientOptions,
  LLMClientLogEntry,
  LLMProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  StreamResult,
  FinishReason,
  TokenUsage,
  Role,
} from './types.js';

// ──────────────────────────────────────────────────────────────────────────
// Sprint 1.2 T-1.2.6 — multi-provider surface (settings panel + theme).
// Single source of truth lives in ./providers/index.js (which itself
// composes ./config.ts for the constants and validation helpers).
// ──────────────────────────────────────────────────────────────────────────
export {
  OpenAIProvider,
  ClaudeProvider,
  CustomProvider,
  createProvider,
  listProviders,
  defaultBaseUrlFor,
  defaultModelFor,
  validateProviderConfig,
  mergeWithDefaultProvider,
  PROVIDER_IDS,
  DEFAULT_PROVIDERS,
  ProviderConfigError,
} from './providers/index.js';

export type {
  ProviderId,
  ProviderConfig,
  ProviderMeta,
} from './providers/index.js';