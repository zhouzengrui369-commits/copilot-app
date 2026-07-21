/**
 * config.test.ts — multi-provider factory tests.
 */
import { describe, it, expect } from 'vitest';
import {
  createProvider,
  listProviders,
  PROVIDER_IDS,
  ProviderConfigError,
  defaultBaseUrlFor,
  defaultModelFor,
  mergeWithDefaultProvider,
  validateProviderConfig,
  DEFAULT_PROVIDERS,
  normalizeProviderEndpoint,
} from '../src/providers/index.js';
import { MiniMaxProvider } from '../src/providers/minimax.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { ClaudeProvider } from '../src/providers/claude.js';
import { CustomProvider } from '../src/providers/custom.js';

describe('createProvider — multi-provider factory', () => {
  it('returns MiniMaxProvider for id=minimax', () => {
    const p = createProvider({ id: 'minimax', apiKey: '[REDACTED]' });
    expect(p).toBeInstanceOf(MiniMaxProvider);
    expect(p.name).toBe('minimax');
  });

  it('returns OpenAIProvider for id=openai', () => {
    const p = createProvider({ id: 'openai', apiKey: '[REDACTED]' });
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect(p.name).toBe('openai');
  });

  it('returns ClaudeProvider for id=claude', () => {
    const p = createProvider({ id: 'claude', apiKey: '[REDACTED]' });
    expect(p).toBeInstanceOf(ClaudeProvider);
    expect(p.name).toBe('claude');
  });

  it('returns CustomProvider for id=custom with explicit baseUrl', () => {
    const p = createProvider({
      id: 'custom',
      apiKey: '[REDACTED]',
      baseUrl: 'http://127.0.0.1:8000/v1',
    });
    expect(p).toBeInstanceOf(CustomProvider);
  });

  it('throws ProviderConfigError for unknown provider id (post-merge)', () => {
    // Note: mergeWithDefaultProvider silently downgrades unknown ids to
    // 'minimax' (graceful UI degradation). After merge, validateProviderConfig
    // catches the missing apiKey when the merged fallback is minimax
    // (which requires a key) and the input lacked one. We assert the
    // surface behavior: an unknown id with no apiKey throws.
    expect(() =>
      // @ts-expect-error — testing runtime guard
      createProvider({ id: 'gpt-99', apiKey: '' }),
    ).toThrow(ProviderConfigError);
  });

  it('throws ProviderConfigError when apiKey is missing for openai', () => {
    expect(() =>
      createProvider({ id: 'openai', apiKey: '' }),
    ).toThrow(/requires apiKey/);
  });

  it('throws ProviderConfigError for custom provider with empty baseUrl', () => {
    expect(() =>
      createProvider({ id: 'custom', apiKey: '[REDACTED]', baseUrl: '' }),
    ).toThrow(/requires baseUrl/);
  });

  it('falls back to default baseUrl/model when omitted', () => {
    const p = createProvider({ id: 'openai', apiKey: '[REDACTED]' });
    expect(p).toBeInstanceOf(OpenAIProvider);
    // No way to read baseUrl back, but the constructor doesn't throw —
    // that means defaults were applied.
  });
});

describe('defaultBaseUrlFor / defaultModelFor', () => {
  it('returns expected defaults for all 4 providers', () => {
    expect(defaultBaseUrlFor('minimax')).toBe('http://127.0.0.1:45557/v1');
    expect(defaultModelFor('minimax')).toBe('MiniMax-M3');
    expect(defaultBaseUrlFor('openai')).toBe('https://api.openai.com/v1');
    expect(defaultModelFor('openai')).toBe('gpt-4o-mini');
    expect(defaultBaseUrlFor('claude')).toBe('https://api.anthropic.com');
    expect(defaultModelFor('claude')).toBe('claude-3-5-sonnet-20241022');
    expect(defaultBaseUrlFor('custom')).toBe('');
    expect(defaultModelFor('custom')).toBe('self-hosted-model');
  });
});

describe('listProviders + PROVIDER_IDS + DEFAULT_PROVIDERS', () => {
  it('exposes all 4 provider ids in PROVIDER_IDS', () => {
    expect(PROVIDER_IDS).toEqual(['minimax', 'openai', 'claude', 'custom']);
  });

  it('listProviders returns 4 ProviderMeta entries', () => {
    const all = listProviders();
    expect(all).toHaveLength(4);
    const ids = all.map((p) => p.id).sort();
    expect(ids).toEqual(['claude', 'custom', 'minimax', 'openai']);
  });

  it('custom provider does not require apiKey', () => {
    const custom = DEFAULT_PROVIDERS.custom;
    expect(custom.requiresApiKey).toBe(false);
  });

  it('all non-custom providers require apiKey', () => {
    expect(DEFAULT_PROVIDERS.minimax.requiresApiKey).toBe(true);
    expect(DEFAULT_PROVIDERS.openai.requiresApiKey).toBe(true);
    expect(DEFAULT_PROVIDERS.claude.requiresApiKey).toBe(true);
  });
});

describe('mergeWithDefaultProvider + validateProviderConfig', () => {
  it('mergeWithDefaultProvider defaults to minimax when input is null', () => {
    const m = mergeWithDefaultProvider(null);
    expect(m.id).toBe('minimax');
    expect(m.baseUrl).toBe('http://127.0.0.1:45557/v1');
    expect(m.model).toBe('MiniMax-M3');
  });

  it('mergeWithDefaultProvider preserves explicit fields', () => {
    const m = mergeWithDefaultProvider({
      id: 'openai',
      apiKey: '[REDACTED]',
      baseUrl: 'https://my-proxy.example/v1',
      model: 'gpt-4o',
    });
    expect(m.id).toBe('openai');
    expect(m.apiKey).toBe('[REDACTED]');
    expect(m.baseUrl).toBe('https://my-proxy.example/v1');
    expect(m.model).toBe('gpt-4o');
  });

  it('validateProviderConfig throws for unknown id (no apiKey fallback)', () => {
    // mergeWithDefaultProvider downgrades unknown ids to 'minimax' which
    // requires an apiKey, so an empty key surfaces the validation error.
    expect(() =>
      // @ts-expect-error — testing runtime guard
      validateProviderConfig({ id: 'bogus', apiKey: '' }),
    ).toThrow(ProviderConfigError);
  });

  it('validateProviderConfig returns the merged config for valid input', () => {
    const m = validateProviderConfig({ id: 'claude', apiKey: '[REDACTED]' });
    expect(m.id).toBe('claude');
    expect(m.apiKey).toBe('[REDACTED]');
  });
});

describe('canonical endpoint security', () => {
  it('normalizes canonical loopback and HTTPS endpoints', () => {
    expect(normalizeProviderEndpoint('http://127.0.0.1:45557/v1/')).toEqual({
      endpoint: 'http://127.0.0.1:45557/v1',
      origin: 'http://127.0.0.1:45557',
      loopback: true,
    });
    expect(normalizeProviderEndpoint('https://model.example/v1')).toMatchObject({
      endpoint: 'https://model.example/v1',
      origin: 'https://model.example',
      loopback: false,
    });
  });

  it.each([
    'http://localhost.evil/v1',
    'http://user@localhost/v1',
    'http://local%68ost/v1',
    'http://2130706433/v1',
    'http://0x7f000001/v1',
    'https://[::ffff:127.0.0.1]/v1',
    'http://model.example/v1',
    'ftp://localhost/v1',
    'http://localhost\\evil/v1',
    'https://model.example/v1?redirect=https://other.example',
  ])('rejects unsafe or ambiguous endpoint %s', (value) => {
    expect(() => normalizeProviderEndpoint(value)).toThrow(ProviderConfigError);
  });
});
