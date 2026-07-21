/**
 * config.ts — multi-provider config + factory helpers for LLM providers.
 *
 *   Provider id | Implementation  | Default baseUrl
 *   -----------|-----------------|---------------------------------
 *   minimax    | MiniMaxProvider | http://127.0.0.1:45557/v1
 *   openai     | OpenAIProvider  | https://api.openai.com/v1
 *   claude     | ClaudeProvider  | https://api.anthropic.com
 *   custom     | CustomProvider  | (required from caller)
 *
 * Sprint 1.2 T-1.2.6 (settings panel + multi-provider).
 *
 * `providers/index.ts` is the canonical `createProvider` factory that
 * turns a `ProviderConfig` into a live `LLMProvider`. This file holds
 * the type, defaults, validation, and metadata helpers.
 */

import type { LLMProvider } from './types.js';

export type ProviderId = 'minimax' | 'openai' | 'claude' | 'custom';

export const PROVIDER_IDS: ReadonlyArray<ProviderId> = ['minimax', 'openai', 'claude', 'custom'];

/** Default provider — used when settings have not yet been written. */
export const DEFAULT_PROVIDER: ProviderId = 'minimax';

/** Human-readable labels keyed by provider id. Drives the renderer's
 *  `<select>` and the toast banner that surfaces the active provider. */
export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = Object.freeze({
  minimax: 'MiniMax (default · OpenAI-compatible)',
  openai: 'OpenAI',
  claude: 'Anthropic Claude',
  custom: 'Self-hosted (OpenAI-compatible)',
});

export interface ProviderConfig {
  /** Provider id — selects implementation. */
  id: ProviderId;
  /** API key — required for all providers. A self-hosted endpoint may use
   *  an owner-entered non-secret placeholder when it does not enforce auth. */
  apiKey?: string;
  /** Base URL — required for `custom`; has sensible default otherwise. */
  baseUrl?: string;
  /** Model id — defaults to provider default. */
  model?: string;
  /** Optional request timeout (ms). */
  timeoutMs?: number;
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
  description: string;
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export interface NormalizedProviderEndpoint {
  endpoint: string;
  origin: string;
  loopback: boolean;
}

/**
 * Canonical endpoint parser shared by provider construction and credential
 * binding.  Loopback is intentionally a very small grammar: localhost,
 * 127.0.0.1, or [::1], optionally followed by a decimal port.  URL parser
 * aliases such as integer/hex IPv4, IPv4-mapped IPv6, userinfo, percent-escaped
 * host bytes, and backslash authority tricks are rejected before URL
 * normalization can reinterpret them.
 */
export function normalizeProviderEndpoint(input: string): NormalizedProviderEndpoint {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim()) {
    throw new ProviderConfigError('provider endpoint is invalid');
  }
  if (/[\u0000-\u001f\u007f\\]/u.test(input)) {
    throw new ProviderConfigError('provider endpoint is invalid');
  }
  const authorityMatch = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/u.exec(input);
  if (!authorityMatch || authorityMatch[1].length === 0) {
    throw new ProviderConfigError('provider endpoint is invalid');
  }
  const authority = authorityMatch[1];
  if (authority.includes('@') || authority.includes('%')) {
    throw new ProviderConfigError('provider endpoint credentials or escaped authority are forbidden');
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ProviderConfigError('provider endpoint is invalid');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderConfigError('provider endpoint credentials, query, or fragment are forbidden');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProviderConfigError('provider endpoint scheme is unsupported');
  }

  const rawHost = rawAuthorityHost(authority);
  const loopback = rawHost === 'localhost' || rawHost === '127.0.0.1' || rawHost === '[::1]';
  const parsedHost = parsed.hostname.toLowerCase();
  const parsedAsCanonicalLoopback = parsedHost === 'localhost' || parsedHost === '127.0.0.1' || parsedHost === '[::1]';
  if (
    parsedAsCanonicalLoopback !== loopback
    || (!loopback && rawHost.includes('localhost'))
    || /^\[::ffff:/u.test(rawHost)
  ) {
    throw new ProviderConfigError('provider loopback endpoint is ambiguous');
  }
  if (!loopback && parsed.protocol !== 'https:') {
    throw new ProviderConfigError('non-loopback provider endpoint requires https');
  }
  if (loopback) {
    const canonicalHost = parsedHost;
    const expected = rawHost === '[::1]' ? '[::1]' : rawHost;
    if (canonicalHost !== expected) {
      throw new ProviderConfigError('provider loopback endpoint is ambiguous');
    }
  }

  parsed.pathname = parsed.pathname.replace(/\/{2,}/gu, '/').replace(/\/+$/u, '') || '/';
  const endpoint = parsed.toString().replace(/\/$/u, parsed.pathname === '/' ? '' : '/');
  return { endpoint, origin: parsed.origin, loopback };
}

function rawAuthorityHost(authority: string): string {
  if (authority.startsWith('[')) {
    const match = /^(\[[^\]]+\])(?::[0-9]+)?$/u.exec(authority);
    if (!match) throw new ProviderConfigError('provider endpoint authority is invalid');
    return match[1].toLowerCase();
  }
  const match = /^([^:]+)(?::[0-9]+)?$/u.exec(authority);
  if (!match) throw new ProviderConfigError('provider endpoint authority is invalid');
  return match[1].toLowerCase();
}

export const DEFAULT_PROVIDERS: Readonly<Record<ProviderId, ProviderMeta>> = Object.freeze({
  minimax: {
    id: 'minimax',
    label: 'MiniMax (default · OpenAI-compatible)',
    defaultBaseUrl: 'http://127.0.0.1:45557/v1',
    defaultModel: 'MiniMax-M3',
    requiresApiKey: true,
    description: 'Local MiniMax-M3 proxy — the project default. See minimax-primary-gpt-fallback skill.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    description: 'OpenAI direct (gpt-4o family, gpt-4o-mini default).',
  },
  claude: {
    id: 'claude',
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-3-5-sonnet-20241022',
    requiresApiKey: true,
    description: 'Anthropic Claude Messages API.',
  },
  custom: {
    id: 'custom',
    label: 'Self-hosted (OpenAI-compatible)',
    defaultBaseUrl: '',
    defaultModel: 'self-hosted-model',
    requiresApiKey: false,
    description: 'Any OpenAI-compatible endpoint (vLLM, Ollama, llama.cpp server, LM Studio, Together, OpenRouter).',
  },
});

/** Default base URL for a provider id. Returns empty string for `custom` —
 *  callers must supply one. */
export function defaultBaseUrlFor(id: ProviderId): string {
  return DEFAULT_PROVIDERS[id]?.defaultBaseUrl ?? '';
}

/** Default model id for a provider id. */
export function defaultModelFor(id: ProviderId): string {
  return DEFAULT_PROVIDERS[id]?.defaultModel ?? '';
}

/** List providers for the renderer settings panel. */
export function listProviders(): ReadonlyArray<ProviderMeta> {
  return PROVIDER_IDS.map((id) => DEFAULT_PROVIDERS[id]);
}

/** Normalize a partial / malformed `ProviderConfig` into a fully
 *  populated one. Missing fields fall back to provider defaults. */
export function mergeWithDefaultProvider(input: Partial<ProviderConfig> | null | undefined): ProviderConfig {
  const id: ProviderId =
    input && (input.id === 'minimax' || input.id === 'openai' || input.id === 'claude' || input.id === 'custom')
      ? input.id
      : 'minimax';
  const baseUrl = input && typeof input.baseUrl === 'string' && input.baseUrl.length > 0
    ? input.baseUrl
    : defaultBaseUrlFor(id);
  const model = input && typeof input.model === 'string' && input.model.length > 0
    ? input.model
    : defaultModelFor(id);
  const apiKey = input && typeof input.apiKey === 'string' ? input.apiKey : '';
  const cfg: ProviderConfig = { id, baseUrl, model, apiKey };
  if (input?.timeoutMs && typeof input.timeoutMs === 'number') {
    cfg.timeoutMs = input.timeoutMs;
  }
  return cfg;
}

/** Validate a ProviderConfig. Throws `ProviderConfigError` for hard
 *  problems (unknown id, missing required key/url). Returns the
 *  normalized config so the caller can use it directly. */
export function validateProviderConfig(input: Partial<ProviderConfig> | null | undefined): ProviderConfig {
  if (input?.id !== undefined && !PROVIDER_IDS.includes(input.id)) {
    throw new ProviderConfigError('unknown provider id');
  }
  const merged = mergeWithDefaultProvider(input);
  if (!PROVIDER_IDS.includes(merged.id)) {
    throw new ProviderConfigError(`unknown provider id: ${merged.id}`);
  }
  const meta = DEFAULT_PROVIDERS[merged.id];
  if (meta.requiresApiKey && (!merged.apiKey || merged.apiKey.length === 0)) {
    throw new ProviderConfigError(`provider ${merged.id} requires apiKey`);
  }
  if (merged.id === 'custom' && (!merged.baseUrl || merged.baseUrl.length === 0)) {
    throw new ProviderConfigError('self-hosted provider requires baseUrl');
  }
  const endpoint = normalizeProviderEndpoint(merged.baseUrl ?? '');
  return { ...merged, baseUrl: endpoint.endpoint };
}

// Re-exports for downstream consumers that want everything in one import.
export type { LLMProvider };

/** Legacy factory-options shape kept for back-compat with the Sprint
 *  1.1 T-1.1.5 tests that pre-date the T-1.2.6 `ProviderConfig` rename.
 *  Both shapes are accepted by `createProvider`. */
export interface ProviderFactoryOptions {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  logger?: (entry: Record<string, unknown>) => void;
}

/** Default config object for a provider id — used by tests and the
 *  desktop settings panel as the "fresh from defaults" snapshot. */
export function defaultProviderConfig(id: ProviderId): {
  baseUrl: string;
  model: string;
  apiKey: string;
} {
  const meta = DEFAULT_PROVIDERS[id];
  return { baseUrl: meta.defaultBaseUrl, model: meta.defaultModel, apiKey: '' };
}

import { MiniMaxProvider } from './providers/minimax.js';
import { OpenAIProvider } from './providers/openai.js';
import { ClaudeProvider } from './providers/claude.js';
import { CustomProvider } from './providers/custom.js';

/**
 * Canonical `createProvider(opts: ProviderFactoryOptions)` — kept here
 * (alongside the constants) so the renderer can `import { createProvider }`
 * without pulling a provider-class barrel. Accepts the legacy
 * `ProviderFactoryOptions` shape (Sprint 1.1 T-1.1.5 tests); the
 * `ProviderConfig`-shaped overload lives in `./providers/index.ts`.
 */
export function createProvider(opts: ProviderFactoryOptions): LLMProvider {
  if (!opts || typeof opts !== 'object') {
    throw new ProviderConfigError('createProvider: options missing');
  }
  if (!PROVIDER_IDS.includes(opts.provider)) {
    throw new ProviderConfigError(
      `createProvider: unknown provider "${opts.provider}" (expected one of ${PROVIDER_IDS.join(', ')})`,
    );
  }
  if (typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
    throw new ProviderConfigError(`createProvider: apiKey missing for ${opts.provider}`);
  }
  const meta = DEFAULT_PROVIDERS[opts.provider];
  const baseUrl = normalizeProviderEndpoint(
    opts.baseUrl && opts.baseUrl.length > 0 ? opts.baseUrl : meta.defaultBaseUrl,
  ).endpoint;
  const model = opts.model && opts.model.length > 0 ? opts.model : meta.defaultModel;
  if (opts.provider === 'custom' && !baseUrl) {
    throw new ProviderConfigError('createProvider: self-hosted provider requires baseUrl');
  }
  const common = {
    apiKey: opts.apiKey,
    baseUrl,
    defaultModel: model,
    timeoutMs: opts.timeoutMs,
    logger: opts.logger as never,
  };
  switch (opts.provider) {
    case 'minimax':
      return new MiniMaxProvider(common);
    case 'openai':
      return new OpenAIProvider(common);
    case 'claude':
      return new ClaudeProvider(common);
    case 'custom':
      return new CustomProvider(common);
  }
}
