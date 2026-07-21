import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MiniMaxProvider,
  approximateTokenCount,
} from '../src/providers/minimax.js';
import {
  AuthError,
  BadRequestError,
  NetworkError,
  RateLimitError,
  ServerError,
  StreamError,
  TimeoutError,
} from '../src/util/errors.js';
import type { ChatRequest, StreamChunk } from '../src/types.js';

const baseCfg = {
  apiKey: 'sk-test',
  baseUrl: 'http://127.0.0.1:1/v1',
  defaultModel: 'MiniMax-M3',
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function sseTextResponse(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

interface FakeFetchInit {
  status?: number;
  body?: unknown;
  sse?: string;
  /** If set, reject every fetch with this error. */
  rejectWith?: unknown;
  /** If set, sleep this long before responding (used in timeout test). */
  delayMs?: number;
}

let lastFetchCall: { url: string; init: RequestInit } | undefined;

function installFetchMock(fn: (init: FakeFetchInit) => Response | Promise<Response>) {
  const fake = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    lastFetchCall = { url: String(input), init };
    const stub = fn({
      // default: success
      status: 200,
      body: { id: 'x', choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } },
    });
    return await Promise.resolve(stub);
  });
  // @ts-expect-error - assigning to fetch
  globalThis.fetch = fake;
  return fake;
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error - restore
  delete (globalThis as Record<string, unknown>).fetch;
});

describe('approximateTokenCount', () => {
  it('counts CJK chars at 1.5 each + others at 0.25 each', () => {
    // '你好world' = 2 CJK + 5 latin → round(2*1.5 + 5*0.25) = round(3 + 1.25) = 4
    expect(approximateTokenCount('你好world')).toBe(4);
  });

  it('returns 0 for whitespace-only content', () => {
    expect(approximateTokenCount('   ')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(approximateTokenCount('')).toBe(0);
  });

  it('handles long English text', () => {
    // 100 a's → 100 * 0.25 = 25
    expect(approximateTokenCount('a'.repeat(100))).toBe(25);
  });

  it('handles long CJK text', () => {
    // 200 中 chars → 200 * 1.5 = 300
    expect(approximateTokenCount('中'.repeat(200))).toBe(300);
  });
});

describe('MiniMaxProvider.countTokens', () => {
  it('sums per-message tokens + role overhead', () => {
    const p = new MiniMaxProvider(baseCfg);
    const tokens = p.countTokens([
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hi' },
    ]);
    expect(tokens).toBeGreaterThan(0);
    expect(Number.isInteger(tokens)).toBe(true);
  });

  it('handles empty messages', () => {
    const p = new MiniMaxProvider(baseCfg);
    expect(p.countTokens([])).toBe(0);
  });
});

describe('MiniMaxProvider.constructor', () => {
  it('trims trailing slash from baseUrl', () => {
    const p = new MiniMaxProvider({ ...baseCfg, baseUrl: 'http://x/v1///' });
    expect((p as unknown as { baseUrl: string }).baseUrl).toBe('http://x/v1');
  });

  it('uses default model when none provided', () => {
    const p = new MiniMaxProvider({ ...baseCfg, defaultModel: undefined });
    expect((p as unknown as { defaultModel: string }).defaultModel).toBe('MiniMax-M3');
  });

  it('throws when apiKey is empty', () => {
    expect(() => new MiniMaxProvider({ ...baseCfg, apiKey: '' })).toThrow(/apiKey/);
  });

  it('throws when baseUrl is empty', () => {
    expect(() => new MiniMaxProvider({ ...baseCfg, baseUrl: '' })).toThrow(/baseUrl/);
  });
});

describe('MiniMaxProvider.chat', () => {
  it('issues POST /chat/completions with bearer auth', async () => {
    const fake = installFetchMock(() =>
      jsonResponse({
        id: 'a',
        choices: [
          { message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' },
        ],
        model: 'MiniMax-M3',
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    );
    const p = new MiniMaxProvider(baseCfg);
    const out = await p.chat({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(out.content).toBe('hi there');
    expect(out.usage).toEqual({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
    });
    expect(out.finishReason).toBe('stop');
    expect(fake).toHaveBeenCalledTimes(1);
    expect(lastFetchCall!.url).toBe('http://127.0.0.1:1/v1/chat/completions');
    expect(lastFetchCall!.init.method).toBe('POST');
    const headers = lastFetchCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('maps 401 → AuthError (non-retriable)', async () => {
    installFetchMock(() => jsonResponse({ error: 'bad key' }, 401));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(AuthError);
  });

  it('maps 429 → RateLimitError (with retry-after)', async () => {
    installFetchMock(() =>
      jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '1' }),
    );
    const p = new MiniMaxProvider(baseCfg);
    try {
      await p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] });
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect((e as RateLimitError).retryAfterMs).toBe(1000);
    }
  });

  it('maps 400 → BadRequestError', async () => {
    installFetchMock(() => jsonResponse({ error: 'bad' }, 400));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(BadRequestError);
  });

  it('maps 500 → ServerError (retriable)', async () => {
    installFetchMock(() => jsonResponse({ error: 'down' }, 500));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(ServerError);
  });

  it('maps 503 → ServerError', async () => {
    installFetchMock(() => jsonResponse({ error: 'busy' }, 503));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(ServerError);
  });

  it('throws NetworkError when fetch rejects', async () => {
    installFetchMock(() => {
      throw new TypeError('failed to fetch');
    });
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(NetworkError);
  });

  it('throws TimeoutError on abort (timeout)', async () => {
    // Use a separate AbortController hooked via fetch.
    // @ts-expect-error - replacing fetch to throw after a delay
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit = {}) => {
      const sig = (init as { signal: AbortSignal }).signal;
      return await new Promise<Response>((_resolve, reject) => {
        sig.addEventListener('abort', () => {
          const e = new Error('aborted');
          (e as Error & { name: string }).name = 'AbortError';
          reject(e);
        });
        // never resolves otherwise
      });
    });
    const p = new MiniMaxProvider({ ...baseCfg, timeoutMs: 5 });
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(TimeoutError);
  });

  it('throws BadRequestError when messages empty', async () => {
    installFetchMock(() => jsonResponse({}, 200));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [] }),
    ).rejects.toThrow(BadRequestError);
  });

  it('propagates caller-supplied AbortSignal', async () => {
    installFetchMock(() => jsonResponse({}));
    const p = new MiniMaxProvider(baseCfg);
    const ac = new AbortController();
    ac.abort();
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }], signal: ac.signal }),
    ).rejects.toThrow(TimeoutError);
  });

  it('passes temperature/maxTokens/user/stop when provided', async () => {
    installFetchMock(() =>
      jsonResponse({
        choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      }),
    );
    const p = new MiniMaxProvider(baseCfg);
    await p.chat({
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 100,
      user: 'alice',
      stop: ['\n\n'],
    });
    const body = JSON.parse(lastFetchCall!.init.body as string);
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(100);
    expect(body.user).toBe('alice');
    expect(body.stop).toEqual(['\n\n']);
  });

  it('omits undefined optional fields', async () => {
    installFetchMock(() =>
      jsonResponse({
        choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      }),
    );
    const p = new MiniMaxProvider(baseCfg);
    await p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(lastFetchCall!.init.body as string);
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.user).toBeUndefined();
  });

  it('uses default model when request omits one', async () => {
    installFetchMock(() =>
      jsonResponse({
        choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      }),
    );
    const p = new MiniMaxProvider(baseCfg);
    await p.chat({ model: '', messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(lastFetchCall!.init.body as string);
    expect(body.model).toBe('MiniMax-M3');
  });

  it('throws ConfigError when model truly missing', async () => {
    installFetchMock(() => jsonResponse({}));
    const p = new MiniMaxProvider({ ...baseCfg, defaultModel: '' });
    await expect(
      p.chat({ model: '', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/model id missing/);
  });

  it('throws StreamError when response JSON parse fails', async () => {
    installFetchMock(
      () =>
        new Response('not-json{', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(StreamError);
  });

  it('throws StreamError when response choices missing', async () => {
    installFetchMock(() => jsonResponse({ choices: [] }));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(StreamError);
  });

  it('logs http_start + http_done', async () => {
    installFetchMock(() =>
      jsonResponse({
        choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      }),
    );
    const logger = vi.fn();
    const p = new MiniMaxProvider({ ...baseCfg, logger });
    await p.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'hi' }] });
    const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('http_start');
    expect(events).toContain('http_done');
  });
});

describe('MiniMaxProvider.chatStream', () => {
  it('yields deltas from SSE and accumulates content', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"he"}}]}',
      'data: {"choices":[{"delta":{"content":"ll"}}]}',
      'data: {"choices":[{"delta":{"content":"o"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ].join('\n\n');
    installFetchMock(() => sseTextResponse(sse));
    const p = new MiniMaxProvider(baseCfg);
    const req: ChatRequest = {
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    };
    const chunks: string[] = [];
    let finish: string | undefined;
    for await (const c of p.chatStream(req)) {
      chunks.push(c.delta);
      if (c.finishReason) finish = c.finishReason;
    }
    expect(chunks.join('')).toBe('hello');
    expect(finish).toBe('stop');
  });

  it('handles usage + finish_reason in same chunk', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"a"}}]}',
      'data: {"choices":[{"delta":{"content":"b"},"finish_reason":"length"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      'data: [DONE]',
    ].join('\n\n');
    installFetchMock(() => sseTextResponse(sse));
    const p = new MiniMaxProvider(baseCfg);
    const out: { delta: string; finish?: string; usage?: unknown }[] = [];
    for await (const c of p.chatStream({ model: 'm', messages: [{ role: 'user', content: 'q' }] })) {
      out.push({ delta: c.delta, finish: c.finishReason, usage: c.usage });
    }
    expect(out[1].delta).toBe('b');
    expect(out[1].finish).toBe('length');
    expect(out[1].usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });

  it('throws StreamError when SSE malformed JSON', async () => {
    installFetchMock(() => sseTextResponse('data: not-json\n\n'));
    const p = new MiniMaxProvider(baseCfg);
    const iter = p.chatStream({ model: 'm', messages: [{ role: 'user', content: 'q' }] });
    await expect(iter.next()).rejects.toThrow(StreamError);
  });

  it('maps 429 → RateLimitError before yielding', async () => {
    installFetchMock(() => jsonResponse({}, 429, { 'retry-after': '2' }));
    const p = new MiniMaxProvider(baseCfg);
    await expect(async () => {
      for await (const _ of p.chatStream({
        model: 'm',
        messages: [{ role: 'user', content: 'q' }],
      })) {
        // drain
      }
    }).rejects.toThrow(RateLimitError);
  });

  it('yields no events when response.body is empty', async () => {
    installFetchMock(
      () =>
        new Response('', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
    const p = new MiniMaxProvider(baseCfg);
    const out: StreamChunk[] = [];
    for await (const c of p.chatStream({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
    })) {
      out.push(c);
    }
    expect(out).toEqual([]);
  });

  it('streams body across multiple chunks via SSE wire', async () => {
    installFetchMock(() => sseTextResponse('data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n'));
    const p = new MiniMaxProvider(baseCfg);
    const out: string[] = [];
    for await (const c of p.chatStream({ model: 'm', messages: [{ role: 'user', content: 'q' }] })) {
      out.push(c.delta);
    }
    expect(out.join('')).toBe('x');
  });

  it('drains trailing buffer line on stream end (no final \\n\\n)', async () => {
    // No trailing blank line — the drain branch handles the last record.
    installFetchMock(() => sseTextResponse('data: {"choices":[{"delta":{"content":"a"}}]}', 200));
    const p = new MiniMaxProvider(baseCfg);
    const out: string[] = [];
    for await (const c of p.chatStream({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
    })) {
      out.push(c.delta);
    }
    expect(out.join('')).toBe('a');
  });

  it('drains trailing garbage without throwing', async () => {
    // Last record has no terminator — drain path tries JSON.parse, swallows error.
    installFetchMock(() =>
      sseTextResponse('data: garbage-not-json', 200),
    );
    const p = new MiniMaxProvider(baseCfg);
    const out: string[] = [];
    for await (const c of p.chatStream({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
    })) {
      out.push(c.delta);
    }
    expect(out).toEqual([]);
  });

  it('throws StreamError when mapping bad SSE chunk inside stream', async () => {
    installFetchMock(() =>
      sseTextResponse('data: {broken-json\n\n', 200),
    );
    const p = new MiniMaxProvider(baseCfg);
    await expect(async () => {
      for await (const _ of p.chatStream({
        model: 'm',
        messages: [{ role: 'user', content: 'q' }],
      })) {
        // drain
      }
    }).rejects.toThrow(StreamError);
  });

  it('parses retry-after as HTTP-date', () => {
    // Use a future date — retryAfter must be > 0 (capped by max).
    const future = new Date(Date.now() + 30_000).toUTCString();
    installFetchMock(() => jsonResponse({ error: 'rate' }, 429, { 'retry-after': future }));
    const p = new MiniMaxProvider(baseCfg);
    return p
      .chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      .then(
        () => Promise.reject('should have thrown'),
        (e) => {
          expect(e).toBeInstanceOf(RateLimitError);
          if (e instanceof RateLimitError) {
            expect(e.retryAfterMs).toBeGreaterThan(0);
            expect(e.retryAfterMs).toBeLessThanOrEqual(35_000);
          }
        },
      );
  });

  it('parses retry-after as zero seconds', () => {
    installFetchMock(() =>
      jsonResponse({ error: 'rate' }, 429, { 'retry-after': '0' }),
    );
    const p = new MiniMaxProvider(baseCfg);
    return p
      .chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      .then(
        () => Promise.reject('should have thrown'),
        (e) => {
          expect(e).toBeInstanceOf(RateLimitError);
          if (e instanceof RateLimitError) {
            expect(e.retryAfterMs).toBe(0);
          }
        },
      );
  });

  it('fallbacks retry-after to undefined when header absent', () => {
    installFetchMock(() => jsonResponse({ error: 'rate' }, 429, {}));
    const p = new MiniMaxProvider(baseCfg);
    return p
      .chat({ model: 'm', messages: [{ role: 'user', content: 'x' }] })
      .then(
        () => Promise.reject('should have thrown'),
        (e) => {
          expect(e).toBeInstanceOf(RateLimitError);
          if (e instanceof RateLimitError) {
            expect(e.retryAfterMs).toBeUndefined();
          }
        },
      );
  });

  it('throws BadRequest when messages is undefined', async () => {
    installFetchMock(() => jsonResponse({}, 200));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'm', messages: undefined as unknown as ChatMessage[] }),
    ).rejects.toThrow(/messages/);
  });

  it('throws ConfigError when messages not array', async () => {
    installFetchMock(() => jsonResponse({}, 200));
    const p = new MiniMaxProvider(baseCfg);
    await expect(
      p.chat({ model: 'm', messages: 'oops' as unknown as ChatMessage[] }),
    ).rejects.toThrow(/messages/);
  });

  it('handles finish_reason content_filter end-to-end', async () => {
    installFetchMock(() =>
      sseTextResponse(
        'data: {"choices":[{"delta":{"content":""},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    const p = new MiniMaxProvider(baseCfg);
    let finish: string | undefined;
    for await (const c of p.chatStream({
      model: 'm',
      messages: [{ role: 'user', content: 'q' }],
    })) {
      if (c.finishReason) finish = c.finishReason;
    }
    expect(finish).toBe('content_filter');
  });
});
