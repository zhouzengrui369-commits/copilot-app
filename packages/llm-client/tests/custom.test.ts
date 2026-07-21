/**
 * custom.test.ts — Self-hosted OpenAI-compatible provider tests.
 *
 *   - CustomProvider requires baseUrl at construction (no default)
 *   - Inherits all OpenAIProvider behavior (same wire format)
 *   - createCustomProvider returns an LLMProvider
 */
import { describe, expect, it } from 'vitest';
import { CustomProvider, createCustomProvider, countCustomTokens } from '../src/providers/custom.js';
import { OpenAIProvider } from '../src/providers/openai.js';

describe('CustomProvider — config validation', () => {
  it('throws when baseUrl is missing', () => {
    expect(() => new CustomProvider({ apiKey: 'k', baseUrl: '' })).toThrow(/baseUrl required/);
  });

  it('accepts an explicit baseUrl', () => {
    const p = new CustomProvider({ apiKey: 'k', baseUrl: 'http://localhost:9999/v1' });
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect(p).toBeInstanceOf(CustomProvider);
  });

  it('createCustomProvider returns an LLMProvider', () => {
    const p = createCustomProvider({ apiKey: 'k', baseUrl: 'http://localhost:9999/v1' });
    expect(typeof p.chat).toBe('function');
    expect(typeof p.chatStream).toBe('function');
    expect(typeof p.countTokens).toBe('function');
  });
});

describe('CustomProvider — token counting', () => {
  it('countCustomTokens returns > 0 for non-empty input', () => {
    expect(countCustomTokens([{ role: 'user', content: 'hello' }])).toBeGreaterThan(0);
  });

  it('countCustomTokens returns 0 for empty input', () => {
    expect(countCustomTokens([])).toBe(0);
  });
});