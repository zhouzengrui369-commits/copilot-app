/**
 * Self-hosted provider — generic OpenAI-compatible adapter for any
 * user-deployed LLM endpoint (vLLM, llama.cpp server, Ollama
 * `/v1/chat/completions`, LM Studio, Together, OpenRouter, etc.).
 *
 * Differs from `openai.ts` only in the default base URL and default
 * model — the wire format and streaming protocol are the same.
 *
 * Sprint 1.2 T-1.2.6 (settings panel + multi-provider).
 */

import type { ChatMessage, LLMProvider } from '../types.js';
import { OpenAIProvider } from './openai.js';
import { type ProviderConfig, ensureProviderConfig } from './types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1';
const DEFAULT_MODEL = 'self-hosted-model';

/** Self-hosted OpenAI-compatible provider. */
export class CustomProvider extends OpenAIProvider {
  constructor(cfg: ProviderConfig) {
    // Sanity check — we do require baseUrl for self-hosted (no default
    // would silently target a non-existent host).
    if (!cfg) throw new Error('[custom] config missing');
    if (!cfg.baseUrl || typeof cfg.baseUrl !== 'string') {
      throw new Error('[custom] baseUrl required for self-hosted provider');
    }
    super({
      ...cfg,
      baseUrl: cfg.baseUrl || DEFAULT_BASE_URL,
      defaultModel: cfg.defaultModel ?? DEFAULT_MODEL,
    });
    // Override the base class name (which is the literal 'openai')
    // so the settings panel can show "custom" in the active-provider
    // indicator. Cast to break the readonly literal type.
    (this as { name: string }).name = 'custom';
  }
}

/** Convenience helper — return a self-hosted provider that defaults to
 *  the OpenAI-compatible wire format used by vLLM/Ollama/etc. */
export function createCustomProvider(cfg: ProviderConfig): LLMProvider {
  return new CustomProvider(cfg);
}

/** Token counter delegated to the OpenAI approximation — kept here so
 *  consumers that only import the custom adapter still get a usable
 *  number for rate-limit pre-checks. */
export function countCustomTokens(messages: ChatMessage[]): number {
  return new CustomProvider({
    apiKey: 'noop',
    baseUrl: DEFAULT_BASE_URL,
  }).countTokens(messages);
}

// Re-export for tests.
export { ensureProviderConfig };