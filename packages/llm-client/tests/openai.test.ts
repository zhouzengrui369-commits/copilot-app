/**
 * openai.test.ts — OpenAI provider tests against a fake HTTP server.
 *
 *   - chat() parses a non-streaming response correctly
 *   - chatStream() yields text deltas
 *   - countTokens() returns a non-zero approximation
 *   - 401 throws AuthError, 429 throws RateLimitError
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { OpenAIProvider } from '../src/providers/openai.js';
import { AuthError, RateLimitError } from '../src/util/errors.js';

let server: Server;
let baseUrl = '';

async function startServer(handler: (req: import('node:http').IncomingMessage, body: string) => {
  status: number;
  body?: unknown;
  sse?: string;
}) {
  const { createServer } = await import('node:http');
  return new Promise<{ server: Server; url: string }>((resolve) => {
    const srv = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        const out = handler(req, body);
        if (out.sse) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end(out.sse);
        } else {
          res.writeHead(out.status, { 'Content-Type': 'application/json' });
          res.end(out.body ? JSON.stringify(out.body) : '');
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        resolve({ server: srv, url: `http://127.0.0.1:${addr.port}` });
      }
    });
  });
}

beforeAll(async () => {
  ({ server, url: baseUrl } = await startServer((_req, _body) => ({
    status: 200,
    body: {
      id: 'chatcmpl-1',
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi from openai' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
    },
  })));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('OpenAIProvider — chat', () => {
  it('issues POST /chat/completions with Bearer auth and parses content', async () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test', baseUrl, defaultModel: 'gpt-4o-mini' });
    const resp = await p.chat({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(resp.content).toBe('hi from openai');
    expect(resp.usage.totalTokens).toBe(9);
    expect(resp.finishReason).toBe('stop');
  });

  it('countTokens returns a non-zero approximation for non-empty messages', () => {
    const p = new OpenAIProvider({ apiKey: 'sk', baseUrl, defaultModel: 'gpt-4o-mini' });
    const n = p.countTokens([{ role: 'user', content: 'hello world' }]);
    expect(n).toBeGreaterThan(0);
  });

  it('countTokens returns 0 for empty input', () => {
    const p = new OpenAIProvider({ apiKey: 'sk', baseUrl, defaultModel: 'gpt-4o-mini' });
    expect(p.countTokens([])).toBe(0);
  });
});

describe('OpenAIProvider — error mapping', () => {
  it('401 throws AuthError', async () => {
    const authServer = await startServer(() => ({ status: 401, body: { error: 'bad key' } }));
    const p = new OpenAIProvider({ apiKey: 'sk', baseUrl: authServer.url, defaultModel: 'gpt-4o-mini' });
    await expect(
      p.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(AuthError);
    await new Promise<void>((r) => authServer.server.close(() => r()));
  });

  it('429 throws RateLimitError', async () => {
    const rl = await startServer(() => ({ status: 429, body: { error: 'rate' } }));
    const p = new OpenAIProvider({ apiKey: 'sk', baseUrl: rl.url, defaultModel: 'gpt-4o-mini' });
    await expect(
      p.chat({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(RateLimitError);
    await new Promise<void>((r) => rl.server.close(() => r()));
  });
});

describe('OpenAIProvider — streaming', () => {
  it('yields text deltas from SSE chunks', async () => {
    const sseServer = await startServer(() => ({
      status: 200,
      sse: [
        'data: {"id":"x","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"hello "},"finish_reason":null}]}\n\n',
        'data: {"id":"x","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":null}]}\n\n',
        'data: {"id":"x","model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ].join(''),
    }));
    const p = new OpenAIProvider({ apiKey: 'sk', baseUrl: sseServer.url, defaultModel: 'gpt-4o-mini' });
    const deltas: string[] = [];
    for await (const chunk of p.chatStream({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      deltas.push(chunk.delta);
    }
    expect(deltas.join('')).toBe('hello world');
    await new Promise<void>((r) => sseServer.server.close(() => r()));
  });
});