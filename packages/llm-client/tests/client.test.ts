import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClient } from '../src/client.js';
import type {
  LLMProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ChatMessage,
} from '../src/types.js';
import {
  ConfigError,
  TokenLimitError,
  isLLMError,
} from '../src/util/errors.js';

function makeFakeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider & {
  chat: ReturnType<typeof vi.fn>;
  chatStream: ReturnType<typeof vi.fn>;
  countTokens: ReturnType<typeof vi.fn>;
} {
  return {
    name: 'fake',
    chat: vi.fn(async (_req: ChatRequest) => ({
      content: 'hello',
      model: 'm',
      finishReason: 'stop' as const,
      usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
    })),
    chatStream: vi.fn(async function* () {
      yield { delta: 'h' } as StreamChunk;
      yield { delta: 'i' } as StreamChunk;
    }),
    countTokens: vi.fn((msgs: ChatMessage[]) => msgs.reduce((s, m) => s + m.content.length, 0)),
    ...overrides,
  } as any;
}

function optionsWith(provider: LLMProvider) {
  return {
    apiKey: '[REDACTED]',
    baseUrl: 'http://127.0.0.1:1/v1',
    providerFactory: () => provider,
    sleep: async () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LLMClient constructor', () => {
  it('throws ConfigError when apiKey missing', () => {
    expect(() =>
      new LLMClient({ apiKey: '', baseUrl: 'http://x/v1', providerFactory: () => makeFakeProvider() }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when baseUrl missing', () => {
    expect(
      () =>
        new LLMClient({
          apiKey: '[REDACTED]',
          baseUrl: '',
          providerFactory: () => makeFakeProvider(),
        }),
    ).toThrow(ConfigError);
  });

  it('uses default model + retries', () => {
    const p = makeFakeProvider();
    const c = new LLMClient(optionsWith(p));
    expect((c as unknown as { defaultModel: string }).defaultModel).toBe('MiniMax-M3');
    expect((c as unknown as { maxRetries: number }).maxRetries).toBe(3);
  });

  it('accepts custom maxRetries', () => {
    const p = makeFakeProvider();
    const c = new LLMClient({ ...optionsWith(p), maxRetries: 5 });
    expect((c as unknown as { maxRetries: number }).maxRetries).toBe(5);
  });

  it('uses built-in MiniMaxProvider when no providerFactory', () => {
    const c = new LLMClient({ apiKey: '[REDACTED]', baseUrl: 'http://x/v1' });
    expect((c.provider as { name: string }).name).toBe('minimax');
  });

  it('exposes limiter', () => {
    const c = new LLMClient({ apiKey: '[REDACTED]', baseUrl: 'http://x/v1', providerFactory: () => makeFakeProvider() });
    expect(c.limiter).toBeDefined();
    expect(typeof c.limiter.acquire).toBe('function');
  });
});

describe('LLMClient.countTokens', () => {
  it('delegates to provider', () => {
    const p = makeFakeProvider({
      countTokens: vi.fn(() => 42),
    });
    const c = new LLMClient(optionsWith(p));
    expect(c.countTokens([])).toBe(42);
    expect(p.countTokens).toHaveBeenCalled();
  });
});

describe('LLMClient.chat', () => {
  it('throws ConfigError when messages empty', async () => {
    const c = new LLMClient(optionsWith(makeFakeProvider()));
    await expect(c.chat({ model: 'm', messages: [] })).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError on invalid role', async () => {
    const c = new LLMClient(optionsWith(makeFakeProvider()));
    await expect(
      c.chat({
        model: 'm',
        messages: [{ role: 'tool' as any, content: 'x' }],
      }),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError on non-string content', async () => {
    const c = new LLMClient(optionsWith(makeFakeProvider()));
    await expect(
      c.chat({ model: 'm', messages: [{ role: 'user', content: 123 as any }] }),
    ).rejects.toThrow(ConfigError);
  });

  it('forwards messages to provider', async () => {
    const p = makeFakeProvider();
    const c = new LLMClient(optionsWith(p));
    const out = await c.chat({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.content).toBe('hello');
    expect(p.chat).toHaveBeenCalledTimes(1);
  });

  it('applies default model when none provided', async () => {
    const p = makeFakeProvider();
    const c = new LLMClient(optionsWith(p));
    await c.chat({ model: '', messages: [{ role: 'user', content: 'x' }] });
    const callArg = (p.chat.mock.calls[0]?.[0] as ChatRequest) || ({} as ChatRequest);
    expect(callArg.model).toBe('MiniMax-M3');
  });

  it('throws TokenLimitError when budget exceeded', async () => {
    const p = makeFakeProvider({
      countTokens: vi.fn(() => 50_000),
    });
    const c = new LLMClient({
      ...optionsWith(p),
      tokenLimitPerMin: 1000,
    });
    try {
      await c.chat({ model: 'm', messages: [{ role: 'user', content: 'big' }] });
      expect.fail('expected throw');
    } catch (e) {
      expect(isLLMError(e) && e.code === 'token_limit_local').toBe(true);
    }
  });

  it('respects per-user rate limit by user id', async () => {
    const p = makeFakeProvider({
      countTokens: vi.fn(() => 600),
    });
    const c = new LLMClient({
      ...optionsWith(p),
      tokenLimitPerMin: 1000,
    });
    await c.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      user: 'alice',
    });
    await expect(
      c.chat({
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
        user: 'alice',
      }),
    ).rejects.toThrow(TokenLimitError);
    // bob has its own budget
    await c.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      user: 'bob',
    });
  });

  it('invokes fallback provider when primary fails with retriable error', async () => {
    let attempts = 0;
    const primary = makeFakeProvider({
      chat: vi.fn(async () => {
        attempts += 1;
        // Fail every time
        throw new (await import('../src/util/errors.js')).NetworkError('primary down');
      }),
    });
    const fallback = makeFakeProvider({
      name: 'fallback',
      chat: vi.fn(async () => ({
        content: 'fallback-ok',
        model: 'm',
        finishReason: 'stop' as const,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })),
    });
    const c = new LLMClient({
      ...optionsWith(primary),
      fallbackProvider: fallback,
      maxRetries: 0,
    });
    const out = await c.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(out.content).toBe('fallback-ok');
    expect(attempts).toBeGreaterThanOrEqual(1);
  });

  it('logs fallback_invoked then preserves primary error when fallback also fails', async () => {
    const primaryErr = new (await import('../src/util/errors.js')).NetworkError('primary down');
    const primary = makeFakeProvider({
      chat: vi.fn(async () => {
        throw primaryErr;
      }),
    });
    const fallback = makeFakeProvider({
      name: 'fallback',
      chat: vi.fn(async () => {
        throw new Error('fallback also failed');
      }),
    });
    const logger = vi.fn();
    const c = new LLMClient({
      ...optionsWith(primary),
      fallbackProvider: fallback,
      maxRetries: 0,
      logger,
    });
    await expect(
      c.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBe(primaryErr);
    const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('fallback_invoked');
    expect(events).toContain('fallback_failed');
  });

  it('fallback_provider is invoked on chat when primary fails after retries', async () => {
    const primary = makeFakeProvider({
      chat: vi.fn(async () => {
        throw new (await import('../src/util/errors.js')).ServerError('down');
      }),
    });
    const fallback = makeFakeProvider({
      name: 'fb',
      chat: vi.fn(async () => ({
        content: 'FB',
        model: 'm',
        finishReason: 'stop' as const,
        usage: { promptTokens: 0, completionTokens: 2, totalTokens: 2 },
      })),
    });
    const logger = vi.fn();
    const c = new LLMClient({
      ...optionsWith(primary),
      fallbackProvider: fallback,
      maxRetries: 1,
      logger,
    });
    const out = await c.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(out.content).toBe('FB');
    expect(logger).toHaveBeenCalled();
  });

  it('does NOT invoke fallback for non-retriable error', async () => {
    const primary = makeFakeProvider({
      chat: vi.fn(async () => {
        throw new (await import('../src/util/errors.js')).AuthError('bad key');
      }),
    });
    const fallback = makeFakeProvider({
      name: 'fallback',
      chat: vi.fn(async () => ({
        content: 'should-not-show',
        model: 'm',
        finishReason: 'stop' as const,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      })),
    });
    const c = new LLMClient({
      ...optionsWith(primary),
      fallbackProvider: fallback,
      maxRetries: 0,
    });
    await expect(
      c.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/bad key/);
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it('logs chat_done', async () => {
    const p = makeFakeProvider();
    const logger = vi.fn();
    const c = new LLMClient({ ...optionsWith(p), logger });
    await c.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('chat_done');
  });
});

describe('LLMClient.chatStream + runStream', () => {
  it('runStream concatenates deltas', async () => {
    const p = makeFakeProvider({
      chatStream: vi.fn(async function* () {
        yield { delta: 'foo ' } as StreamChunk;
        yield { delta: 'bar' } as StreamChunk;
        yield { delta: '', finishReason: 'stop' } as StreamChunk;
      }),
    });
    const c = new LLMClient(optionsWith(p));
    const out = await c.runStream({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(out.fullText).toBe('foo bar');
    expect(out.finishReason).toBe('stop');
  });

  it('chatStream yields each chunk', async () => {
    const p = makeFakeProvider({
      chatStream: vi.fn(async function* () {
        yield { delta: 'a' } as StreamChunk;
        yield { delta: 'b' } as StreamChunk;
      }),
    });
    const c = new LLMClient(optionsWith(p));
    const out: string[] = [];
    for await (const chunk of c.chatStream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) {
      out.push(chunk.delta);
    }
    expect(out).toEqual(['a', 'b']);
  });

  it('throws TokenLimitError before reaching provider on stream', async () => {
    const p = makeFakeProvider({
      countTokens: vi.fn(() => 100_000),
    });
    const c = new LLMClient({
      ...optionsWith(p),
      tokenLimitPerMin: 1000,
    });
    await expect(async () => {
      for await (const _ of c.chatStream({ model: 'm', messages: [{ role: 'user', content: 'big' }] })) {
        // drain
      }
    }).rejects.toThrow(TokenLimitError);
  });

  it('invokes fallback on stream errors', async () => {
    const primary = makeFakeProvider({
      chatStream: vi.fn(async function* () {
        throw new (await import('../src/util/errors.js')).NetworkError('primary stream down');
      }),
    });
    const fallback = makeFakeProvider({
      name: 'fallback',
      chatStream: vi.fn(async function* () {
        yield { delta: 'fb' } as StreamChunk;
      }),
    });
    const c = new LLMClient({
      ...optionsWith(primary),
      fallbackProvider: fallback,
      maxRetries: 0,
    });
    const out: string[] = [];
    for await (const chunk of c.chatStream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) {
      out.push(chunk.delta);
    }
    expect(out.join('')).toBe('fb');
  });

  it('runStream returns usage when provider supplies it', async () => {
    const p = makeFakeProvider({
      chatStream: vi.fn(async function* () {
        yield { delta: 'x', usage: { promptTokens: 5, completionTokens: 6, totalTokens: 11 } } as StreamChunk;
      }),
    });
    const c = new LLMClient(optionsWith(p));
    const out = await c.runStream({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(out.usage).toEqual({ promptTokens: 5, completionTokens: 6, totalTokens: 11 });
  });

  it('top up token usage when provider reports more than reserved', async () => {
    // Provider says 100 tokens but pre-call estimate was 50. Should top up to usage diff.
    const p = makeFakeProvider({
      chat: vi.fn(async () => ({
        content: 'x',
        model: 'm',
        finishReason: 'stop' as const,
        usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
      })),
      countTokens: vi.fn(() => 50),
    });
    const logger = vi.fn();
    const c = new LLMClient({
      ...optionsWith(p),
      tokenLimitPerMin: 1000,
      logger,
    });
    await c.chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    // 50 reserved + 50 top-up = 100 total
    expect(c.limiter.currentUsage('__default__')).toBe(100);
    // Or via explicit user
    await c.chat({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      user: 'alice',
    });
    expect(c.limiter.currentUsage('alice')).toBe(100);
  });

  it('throws ConfigError when caller passes non-object request', async () => {
    const c = new LLMClient(optionsWith(makeFakeProvider()));
    await expect(
      c.chat(null as unknown as ChatRequest),
    ).rejects.toThrow(ConfigError);
    await expect(
      c.chat(undefined as unknown as ChatRequest),
    ).rejects.toThrow(ConfigError);
    await expect(
      c.chat('garbage' as unknown as ChatRequest),
    ).rejects.toThrow(ConfigError);
  });

  it('falls back to approximate token count when provider.countTokens throws', async () => {
    const p = makeFakeProvider({
      countTokens: vi.fn(() => {
        throw new Error('count broken');
      }),
    });
    const c = new LLMClient(optionsWith(p));
    const t = c.countTokens([{ role: 'user', content: 'hello' }]);
    expect(t).toBeGreaterThan(0);
  });

  it('logs fallback_invoked on stream path primary error', async () => {
    const primary = makeFakeProvider({
      chatStream: vi.fn(async function* () {
        throw new (await import('../src/util/errors.js')).NetworkError('stream down');
      }),
    });
    const fallback = makeFakeProvider({
      name: 'fb-stream',
      chatStream: vi.fn(async function* () {
        yield { delta: 'OK' } as StreamChunk;
      }),
    });
    const logger = vi.fn();
    const c = new LLMClient({
      ...optionsWith(primary),
      fallbackProvider: fallback,
      maxRetries: 0,
      logger,
    });
    const out: string[] = [];
    for await (const ch of c.chatStream({ model: 'm', messages: [{ role: 'user', content: 'x' }] })) {
      out.push(ch.delta);
    }
    expect(out.join('')).toBe('OK');
    const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('fallback_invoked');
  });

  it('throws stream error when no fallback and primary retriable error exhausted', async () => {
    const primary = makeFakeProvider({
      chatStream: vi.fn(async function* () {
        throw new (await import('../src/util/errors.js')).ServerError('500 down');
      }),
    });
    const c = new LLMClient({
      ...optionsWith(primary),
      maxRetries: 0,
    });
    await expect(async () => {
      for await (const _ of c.chatStream({
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
      })) {
        // drain
      }
    }).rejects.toThrow(/500 down/);
  });
});

describe('LLMClient default sleep behavior', () => {
  it('uses default setTimeout-based sleep when no override', () => {
    const c = new LLMClient({
      apiKey: '[REDACTED]',
      baseUrl: 'http://x/v1',
      providerFactory: () => makeFakeProvider(),
    });
    const sleep = (c as unknown as { sleep: (ms: number) => Promise<void> }).sleep;
    expect(typeof sleep).toBe('function');
    return sleep(0).then(() => undefined);
  });

  it('throws ConfigError when constructor receives non-object opts', () => {
    expect(() => new LLMClient(null as unknown as Parameters<typeof LLMClient>[0])).toThrow(
      ConfigError,
    );
  });
});
