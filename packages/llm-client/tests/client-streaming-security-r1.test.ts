import { describe, expect, it, vi } from 'vitest';
import { LLMClient } from '../src/client.js';
import { AbortError, AuthError, NetworkError, ServerError } from '../src/util/errors.js';
import type { LLMProvider, StreamChunk } from '../src/types.js';

const CREDENTIAL = '[REDACTED]';
const request = { model: 'model', messages: [{ role: 'user' as const, content: 'hello' }] };

function provider(stream: () => AsyncIterable<StreamChunk>): LLMProvider {
  return {
    name: 'fake',
    chat: vi.fn(),
    chatStream: vi.fn(stream),
    countTokens: () => 1,
  };
}

function client(primary: LLMProvider, options: Partial<ConstructorParameters<typeof LLMClient>[0]> = {}) {
  return new LLMClient({
    apiKey: CREDENTIAL,
    baseUrl: 'https://model.example/v1',
    maxRetries: 0,
    sleep: async () => undefined,
    providerFactory: () => primary,
    ...options,
  });
}

describe('Phase A streaming security', () => {
  it('yields the first chunk before the provider stream completes', async () => {
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => { finish = resolve; });
    const primary = provider(async function* () {
      yield { delta: 'first' };
      await wait;
      yield { delta: 'second' };
    });
    const iterator = client(primary).chatStream(request)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { delta: 'first' } });
    expect(primary.chatStream).toHaveBeenCalledTimes(1);
    finish();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { delta: 'second' } });
  });

  it('retries a retryable failure only before the first chunk', async () => {
    let attempts = 0;
    const primary = provider(async function* () {
      attempts += 1;
      if (attempts === 1) throw new NetworkError('safe failure');
      yield { delta: 'ok' };
    });
    const output: string[] = [];
    for await (const chunk of client(primary, { maxRetries: 1 }).chatStream(request)) {
      output.push(chunk.delta);
    }
    expect(output).toEqual(['ok']);
    expect(attempts).toBe(2);
  });

  it('never retries, falls back, or replays after one chunk was yielded', async () => {
    let attempts = 0;
    const primary = provider(async function* () {
      attempts += 1;
      yield { delta: 'partial' };
      throw new ServerError('safe failure');
    });
    const fallback = provider(async function* () { yield { delta: 'duplicate' }; });
    const iterator = client(primary, { maxRetries: 3, fallbackProvider: fallback }).chatStream(request)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { delta: 'partial' } });
    await expect(iterator.next()).rejects.toThrow('safe failure');
    expect(attempts).toBe(1);
    expect(fallback.chatStream).not.toHaveBeenCalled();
  });

  it('treats cancellation as terminal before and after first chunk', async () => {
    const primary = provider(async function* () { throw new AbortError(); });
    const c = client(primary, { maxRetries: 3 });
    await expect(async () => {
      for await (const _chunk of c.chatStream(request)) void _chunk;
    }).rejects.toBeInstanceOf(AbortError);
    expect(primary.chatStream).toHaveBeenCalledTimes(1);
  });

  it('projects stable non-sensitive model error categories', () => {
    const c = client(provider(async function* () {}));
    expect(c.projectError(new AuthError('provider detail'))).toEqual({
      category: 'auth',
      message: 'Model credentials were rejected. Update the credential in Settings.',
    });
    expect(c.projectError(new NetworkError('provider detail')).category).toBe('offline');
    expect(c.projectError(new Error('provider detail'))).toEqual({
      category: 'internal',
      message: 'The model request failed safely.',
    });
    expect(JSON.stringify(c.projectError(new Error(CREDENTIAL)))).not.toContain(CREDENTIAL);
  });
});
