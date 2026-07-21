/**
 * LLMProvider interface — the abstraction that lets the client swap backends.
 *
 * Sprint 1.1 ships `minimax` only. The interface must NOT leak minimax/OpenAI specifics
 * (e.g. raw `messages` tool_calls) into the consumer.
 *
 * Sprint 1.2+ will add `openai` (GPT-4o family) and `claude` (Anthropic).
 *
 * Each implementation owns its own HTTP transport, error mapping, and token counting.
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LLMProvider,
  StreamChunk,
} from '../types.js';

/** Sentinel for implementations that can't reliably count tokens. */
export const TOKEN_COUNT_UNAVAILABLE = -1;

/** Base interface for providers that expose a base URL. */
export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  /** Optional default model. Provider may override. */
  defaultModel?: string;
  /** Optional timeout (ms). Default 30_000. */
  timeoutMs?: number;
  /** Optional AbortSignal propagated from caller. */
  signal?: AbortSignal;
  /** Structured logger — provider will emit start/end/error events. */
  logger?: ProviderLogger;
}

/** Helper: validate required config fields early — fail fast with ConfigError. */
export function ensureProviderConfig(
  cfg: ProviderConfig,
  expectedProviderName: string,
): void {
  if (!cfg || typeof cfg !== 'object') {
    throw new Error(`[${expectedProviderName}] config missing`);
  }
  if (!cfg.apiKey || typeof cfg.apiKey !== 'string') {
    throw new Error(`[${expectedProviderName}] apiKey missing`);
  }
  if (!cfg.baseUrl || typeof cfg.baseUrl !== 'string') {
    throw new Error(`[${expectedProviderName}] baseUrl missing`);
  }
}

export type ProviderLogger = (entry: {
  ts?: string;
  level?: 'debug' | 'info' | 'warn' | 'error' | string;
  event: string;
  [k: string]: unknown;
}) => void;

/** Re-export so consumers can `import type { LLMProvider } from '@copilot/llm-client/providers/types'`. */
export type { LLMProvider, ChatMessage, ChatRequest, ChatResponse, StreamChunk };
