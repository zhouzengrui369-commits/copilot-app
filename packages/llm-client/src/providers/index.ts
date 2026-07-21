/**
 * providers/index.ts — barrel for LLM providers + the multi-provider
 * factory that powers the settings panel (Sprint 1.2 T-1.2.6).
 *
 * `createProvider(config)` is the canonical factory — wraps validation
 * from ./config.ts and wires the validated payload to the matching
 * concrete class. Constants (PROVIDER_IDS, PROVIDER_LABELS, defaults,
 * etc.) all live in ./config.ts.
 */

import type { ProviderConfig } from '../config.js';
import { validateProviderConfig, defaultBaseUrlFor, defaultModelFor } from '../config.js';
import { MiniMaxProvider } from './minimax.js';
import { OpenAIProvider } from './openai.js';
import { ClaudeProvider } from './claude.js';
import { CustomProvider } from './custom.js';
import type { LLMProvider } from '../types.js';

export function createProvider(config: ProviderConfig): LLMProvider {
  const v = validateProviderConfig(config);
  const common = {
    apiKey: v.apiKey ?? '',
    baseUrl: v.baseUrl && v.baseUrl.length > 0 ? v.baseUrl : defaultBaseUrlFor(v.id),
    defaultModel: v.model && v.model.length > 0 ? v.model : defaultModelFor(v.id),
  };
  switch (v.id) {
    case 'minimax':
      return new MiniMaxProvider(common);
    case 'openai':
      return new OpenAIProvider(common);
    case 'claude':
      return new ClaudeProvider(common);
    case 'custom':
      return new CustomProvider(common);
    default: {
      const _exhaustive: never = v.id;
      throw new Error(`createProvider: unknown id ${String(_exhaustive)}`);
    }
  }
}

// Re-exports — one flat surface for `@copilot/llm-client/providers`.
export { MiniMaxProvider } from './minimax.js';
export { OpenAIProvider } from './openai.js';
export { ClaudeProvider } from './claude.js';
export { CustomProvider } from './custom.js';
export {
  PROVIDER_IDS,
  listProviders,
  defaultBaseUrlFor,
  defaultModelFor,
  validateProviderConfig,
  mergeWithDefaultProvider,
  DEFAULT_PROVIDERS,
  ProviderConfigError,
  normalizeProviderEndpoint,
} from '../config.js';
export type {
  ProviderId,
  ProviderConfig,
  ProviderMeta,
  ProviderFactoryOptions,
  NormalizedProviderEndpoint,
} from '../config.js';
export type { LLMProvider, ChatMessage, ChatRequest, ChatResponse, StreamChunk, StreamResult, FinishReason, TokenUsage, Role } from '../types.js';
