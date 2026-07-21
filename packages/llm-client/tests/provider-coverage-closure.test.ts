import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProvider as createLegacyProvider,
  defaultBaseUrlFor,
  defaultModelFor,
  defaultProviderConfig,
  mergeWithDefaultProvider,
  ProviderConfigError,
} from '../src/config.js';
import { MiniMaxProvider } from '../src/providers/minimax.js';
import { OpenAIProvider } from '../src/providers/openai.js';
import { ClaudeProvider } from '../src/providers/claude.js';
import { CustomProvider } from '../src/providers/custom.js';
import {
  BadRequestError,
  NetworkError,
  RateLimitError,
  ServerError,
  StreamError,
  TimeoutError,
} from '../src/util/errors.js';
import type { ChatRequest, StreamChunk } from '../src/types.js';

const request: ChatRequest = {
  messages: [{ role: 'user', content: 'hello' }],
};

function openAiPayload(finishReason: string | null = 'stop', withUsage = true): object {
  return {
    id: 'chat-1',
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: finishReason }],
    ...(withUsage ? { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } } : {}),
  };
}

function claudePayload(stopReason: string | null = 'end_turn', withUsage = true): object {
  return {
    id: 'msg-1',
    type: 'message',
    model: 'test-claude',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }, { type: 'tool', text: 'ignored' }],
    stop_reason: stopReason,
    ...(withUsage ? { usage: { input_tokens: 2, output_tokens: 3 } } : {}),
  };
}

function json(value: object, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function sse(events: string[]): Response {
  return new Response(events.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('legacy provider factory coverage', () => {
  it('constructs every legacy provider and preserves explicit/default fields', () => {
    expect(createLegacyProvider({ provider: 'minimax', apiKey: 'k' })).toBeInstanceOf(MiniMaxProvider);
    expect(createLegacyProvider({ provider: 'openai', apiKey: 'k' })).toBeInstanceOf(OpenAIProvider);
    expect(createLegacyProvider({ provider: 'claude', apiKey: 'k' })).toBeInstanceOf(ClaudeProvider);
    expect(createLegacyProvider({
      provider: 'custom', apiKey: 'k', baseUrl: 'http://127.0.0.1:9000/v1', model: 'local', timeoutMs: 50,
    })).toBeInstanceOf(CustomProvider);
    expect(defaultProviderConfig('openai')).toEqual({
      baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '',
    });
    expect(mergeWithDefaultProvider({ id: 'openai', apiKey: 'k', timeoutMs: 25 }).timeoutMs).toBe(25);
  });

  it('rejects malformed legacy options and covers defensive unknown defaults', () => {
    expect(() => createLegacyProvider(null as never)).toThrow(/options missing/);
    expect(() => createLegacyProvider({ provider: 'unknown' as never, apiKey: 'k' }))
      .toThrow(ProviderConfigError);
    expect(() => createLegacyProvider({ provider: 'openai', apiKey: '' })).toThrow(/apiKey missing/);
    expect(defaultBaseUrlFor('unknown' as never)).toBe('');
    expect(defaultModelFor('unknown' as never)).toBe('');
  });
});

describe('OpenAIProvider edge behavior', () => {
  it('uses defaults, serializes optional request fields, and handles usage/content fallbacks', async () => {
    let sent: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({
        ...openAiPayload('length', false),
        choices: [{ index: 0, message: {}, finish_reason: 'length' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://openai.test' });
    const response = await provider.chat({
      messages: [{ role: 'user', content: '' }],
      temperature: 0,
      maxTokens: 0,
      user: 'u1',
      stop: ['END'],
    });
    expect(sent).toEqual(expect.objectContaining({
      model: 'gpt-4o-mini', temperature: 0, max_tokens: 0, user: 'u1', stop: ['END'], stream: false,
    }));
    expect(response).toEqual(expect.objectContaining({
      content: '', finishReason: 'length', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }));
    expect(provider.countTokens([{ role: 'user', content: '你好 A' }])).toBeGreaterThan(0);
  });

  it.each([
    ['tool_calls', 'tool_calls'],
    ['content_filter', 'content_filter'],
    ['unexpected', 'stop'],
  ])('normalizes finish reason %s', async (wire, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(openAiPayload(wire))));
    const response = await new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://openai.test' }).chat(request);
    expect(response.finishReason).toBe(expected);
  });

  it('rejects invalid requests, malformed JSON, missing choices, and missing stream bodies', async () => {
    const provider = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://openai.test' });
    await expect(provider.chat({ messages: [] })).rejects.toBeInstanceOf(BadRequestError);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(StreamError);

    vi.stubGlobal('fetch', vi.fn(async () => json({ model: 'm', choices: [] })));
    await expect(provider.chat(request)).rejects.toThrow(/no choices/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(collect(provider.chatStream(request))).rejects.toThrow(/missing body/);
  });

  it('maps server, network, abort, and pre-aborted requests', async () => {
    const provider = new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://openai.test' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server', { status: 503 })));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(ServerError);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(NetworkError);

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(TimeoutError);

    const controller = new AbortController();
    controller.abort('cancelled');
    await expect(provider.chat({ ...request, signal: controller.signal })).rejects.toThrow(/before send/);
  });

  it.each(['2', new Date(Date.now() + 60_000).toUTCString(), 'invalid'])
  ('parses retry-after variant %s', async (retryAfter) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate', {
      status: 429,
      headers: { 'retry-after': retryAfter },
    })));
    await expect(new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://openai.test' }).chat(request))
      .rejects.toBeInstanceOf(RateLimitError);
  });

  it('surfaces malformed SSE while accepting usage and empty-choice events', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      'event: ping\n\n',
      'data: {"id":"x","model":"m","choices":[]}\n\n',
      'data: {"id":"x","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ])));
    const chunks = await collect(new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://openai.test' }).chatStream(request));
    expect(chunks).toEqual([expect.objectContaining({
      delta: '', finishReason: 'content_filter', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    })]);

    vi.stubGlobal('fetch', vi.fn(async () => sse(['data: {bad json}\n\n'])));
    await expect(collect(new OpenAIProvider({ apiKey: 'k', baseUrl: 'https://openai.test' }).chatStream(request)))
      .rejects.toThrow(/malformed SSE/);
  });
});

describe('ClaudeProvider edge behavior', () => {
  it('uses defaults, reshapes system/assistant messages, and handles response fallbacks', async () => {
    let sent: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json(claudePayload('max_tokens', false));
    }));
    const provider = new ClaudeProvider({ apiKey: 'k', baseUrl: 'https://claude.test' });
    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'second' },
        { role: 'assistant', content: 'prior' },
      ],
      temperature: 0,
    });
    expect(sent).toEqual(expect.objectContaining({
      model: 'claude-3-5-sonnet-20241022',
      system: 'first\n\nsecond',
      max_tokens: 1024,
      temperature: 0,
      messages: [
        { role: 'user', content: '(continuation)' },
        { role: 'assistant', content: 'prior' },
      ],
    }));
    expect(response.finishReason).toBe('length');
    expect(response.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    expect(provider.countTokens([{ role: 'user', content: '你好 A' }])).toBeGreaterThan(0);
  });

  it.each([
    ['tool_use', 'tool_calls'],
    ['tool_calls', 'tool_calls'],
    ['content_filter', 'content_filter'],
    ['unexpected', 'stop'],
  ])('normalizes Claude finish reason %s', async (wire, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(claudePayload(wire))));
    const response = await new ClaudeProvider({ apiKey: 'k', baseUrl: 'https://claude.test' }).chat(request);
    expect(response.finishReason).toBe(expected);
  });

  it('rejects empty/system-only requests, malformed JSON, and missing stream bodies', async () => {
    const provider = new ClaudeProvider({ apiKey: 'k', baseUrl: 'https://claude.test' });
    await expect(provider.chat({ messages: [] })).rejects.toBeInstanceOf(BadRequestError);
    await expect(provider.chat({ messages: [{ role: 'system', content: 'only' }] }))
      .rejects.toThrow(/at least one/);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(StreamError);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(collect(provider.chatStream(request))).rejects.toThrow(/missing body/);
  });

  it('maps HTTP, network, abort, and pre-aborted requests', async () => {
    const provider = new ClaudeProvider({ apiKey: 'k', baseUrl: 'https://claude.test' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server', { status: 500 })));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(ServerError);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(NetworkError);

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }));
    await expect(provider.chat(request)).rejects.toBeInstanceOf(TimeoutError);

    const controller = new AbortController();
    controller.abort();
    await expect(provider.chat({ ...request, signal: controller.signal })).rejects.toThrow(/before send/);
  });

  it.each(['3', new Date(Date.now() + 60_000).toUTCString(), 'invalid'])
  ('parses Claude retry-after variant %s', async (retryAfter) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate', {
      status: 429,
      headers: { 'retry-after': retryAfter },
    })));
    await expect(new ClaudeProvider({ apiKey: 'k', baseUrl: 'https://claude.test' }).chat(request))
      .rejects.toBeInstanceOf(RateLimitError);
  });

  it('handles malformed/empty stream events, default stop, and explicit stream errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      'event: ping\n\n',
      'event: ping\ndata: not-json\n\n',
      'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])));
    const chunks = await collect(new ClaudeProvider({ apiKey: 'k', baseUrl: 'https://claude.test' }).chatStream(request));
    expect(chunks).toEqual([expect.objectContaining({
      delta: '', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    })]);

    vi.stubGlobal('fetch', vi.fn(async () => sse([
      'event: error\ndata: {"type":"error","error":{"message":"provider failed"}}\n\n',
    ])));
    await expect(collect(new ClaudeProvider({ apiKey: 'k', baseUrl: 'https://claude.test' }).chatStream(request)))
      .rejects.toThrow(/provider failed/);
  });
});
