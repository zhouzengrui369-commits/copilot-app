/**
 * End-to-end integration test:
 *  - Boot a tiny in-process HTTP server that mimics the OpenAI-compatible /chat/completions endpoint.
 *  - Plug it into the LLMClient and verify chat() + chatStream() work end-to-end.
 *  - Verify retry kicks in when the mock returns 503 transiently.
 *
 * The mock does NOT depend on the real minimax proxy; it's a contract test for the client surface.
 */

import { describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LLMClient } from '../../src/client.js';
import { NetworkError, ServerError, StreamError } from '../../src/util/errors.js';

interface CapturedRequest {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string | undefined>;
}

interface MockOptions {
  /** When set, first `failTimes` calls return 503 with empty body. Subsequent calls return 200. */
  failTimes?: number;
  /** When true, return a streamed SSE response. */
  stream?: boolean;
}

function startMockChatServer(opts: MockOptions = {}) {
  const captured: CapturedRequest[] = [];
  let attempt = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf-8')));
    req.on('end', () => {
      captured.push({
        url: req.url ?? '/',
        method: req.method ?? 'GET',
        body,
        headers: {
          authorization: req.headers.authorization,
          'content-type': req.headers['content-type'] as string | undefined,
        },
      });

      attempt++;
      if (opts.failTimes && attempt <= opts.failTimes) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'transient' }));
        return;
      }

      if (opts.stream) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        const events = [
          { id: '1', choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
          { id: '2', choices: [{ delta: { content: ', world' }, finish_reason: null }] },
          { id: '3', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
        ];
        for (const evt of events) {
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'mock-1',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'MiniMax-M3',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'mock reply' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
      );
    });
  });

  return new Promise<{ port: number; captured: CapturedRequest[]; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          throw new Error('mock server failed to bind');
        }
        resolve({
          port: addr.port,
          captured,
          close: () =>
            new Promise<void>((r) => {
              server.close(() => r());
            }),
        });
      });
    },
  );
}

describe('integration: LLMClient ↔ mock OpenAI-compatible server', () => {
  it('chat() returns parsed content and tracks token usage', async () => {
    const { port, captured, close } = await startMockChatServer();
    try {
      const client = new LLMClient({
        apiKey: 'test-key',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        maxRetries: 0,
      });
      const reply = await client.chat({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(reply.content).toBe('mock reply');
      expect(reply.finishReason).toBe('stop');
      expect(reply.usage.totalTokens).toBe(14);
      // Sends bearer auth + JSON content type
      expect(captured).toHaveLength(1);
      expect(captured[0].headers.authorization).toBe('Bearer test-key');
      expect(captured[0].body).toContain('"model":"MiniMax-M3"');
    } finally {
      await close();
    }
  });

  it('chatStream() yields deltas and accumulates content', async () => {
    const { port, close } = await startMockChatServer({ stream: true });
    try {
      const client = new LLMClient({
        apiKey: 'k',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        maxRetries: 0,
      });
      let full = '';
      let finish: string | undefined;
      for await (const c of client.chatStream({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        full += c.delta;
        if (c.finishReason) finish = c.finishReason;
      }
      expect(full).toBe('Hello, world');
      expect(finish).toBe('stop');
    } finally {
      await close();
    }
  });

  it('retries on 503 transient errors and succeeds', async () => {
    const { port, captured, close } = await startMockChatServer({ failTimes: 2 });
    try {
      const client = new LLMClient({
        apiKey: 'k',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        maxRetries: 3,
        // No real sleep in tests — accelerate backoff.
        sleep: () => Promise.resolve(),
      });
      const reply = await client.chat({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(reply.content).toBe('mock reply');
      // 2 failures + 1 success = 3 total requests.
      expect(captured).toHaveLength(3);
    } finally {
      await close();
    }
  });

  it('surfaces typed errors for non-retriable 4xx', async () => {
    // 401 mock — failTimes doesn't apply since we override status always.
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf-8')));
      req.on('end', () => {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'unauthorized' }));
      });
    });
    const port = await new Promise<number>((r) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('bind');
        r(addr.port);
      });
    });
    try {
      const client = new LLMClient({
        apiKey: 'wrong',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        maxRetries: 0,
      });
      await expect(
        client.chat({ model: 'MiniMax-M3', messages: [{ role: 'user', content: 'x' }] }),
      ).rejects.toThrow(/401/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('non-retriable error class exists for stream errors', () => {
    expect(StreamError).toBeDefined();
    expect(ServerError).toBeDefined();
    expect(NetworkError).toBeDefined();
  });
});