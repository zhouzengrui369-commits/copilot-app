/**
 * claude.test.ts — Anthropic Claude provider tests against a fake HTTP server.
 *
 *   - chat() sends x-api-key + anthropic-version headers, parses content
 *   - chatStream() yields text deltas from content_block_delta events
 *   - System message goes into top-level `system` field
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server, IncomingMessage } from 'node:http';
import { ClaudeProvider } from '../src/providers/claude.js';

let server: Server;
let baseUrl = '';
let lastHeaders: Record<string, string | string[] | undefined> = {};

async function startServer(
  handler: (req: IncomingMessage, body: string) => {
    status: number;
    body?: unknown;
    sse?: string;
  },
) {
  const http = await import('node:http');
  return new Promise<{ server: Server; url: string }>((resolve) => {
    const srv = http.createServer((req, res) => {
      lastHeaders = req.headers;
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
  ({ server, url: baseUrl } = await startServer((_req, body) => {
    // Verify the wire format the Claude provider emits.
    const parsed = JSON.parse(body) as { system?: string; max_tokens?: number };
    return {
      status: 200,
      body: {
        id: 'msg-1',
        type: 'message',
        model: 'claude-3-5-sonnet-20241022',
        role: 'assistant',
        content: [{ type: 'text', text: `claude-ack system=${parsed.system ?? 'none'} max=${parsed.max_tokens}` }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 6 },
      },
    };
  }));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('ClaudeProvider — chat', () => {
  it('issues POST /v1/messages with x-api-key and anthropic-version headers', async () => {
    const p = new ClaudeProvider({ apiKey: 'sk-ant-test', baseUrl, defaultModel: 'claude-3-5-sonnet-20241022' });
    const resp = await p.chat({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(resp.content).toContain('claude-ack');
    expect(resp.content).toContain('system=be terse');
    expect(resp.finishReason).toBe('stop');
    expect(lastHeaders['x-api-key']).toBe('sk-ant-test');
    expect(lastHeaders['anthropic-version']).toBe('2023-06-01');
  });

  it('strips system messages into the top-level system field', async () => {
    const p = new ClaudeProvider({ apiKey: 'sk-ant-test', baseUrl, defaultModel: 'claude-3-5-sonnet-20241022' });
    await p.chat({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(lastHeaders['x-api-key']).toBe('sk-ant-test');
  });

  it('countTokens returns 0 for empty messages', () => {
    const p = new ClaudeProvider({ apiKey: 'sk', baseUrl, defaultModel: 'claude-3-5-sonnet-20241022' });
    expect(p.countTokens([])).toBe(0);
  });
});

describe('ClaudeProvider — streaming', () => {
  it('yields text deltas from content_block_delta SSE events', async () => {
    const sseServer = await startServer(() => ({
      status: 200,
      sse: [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":2}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"claude-"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"stream"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","message":{"stop_reason":"end_turn"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(''),
    }));
    const p = new ClaudeProvider({ apiKey: 'sk', baseUrl: sseServer.url, defaultModel: 'claude-3-5-sonnet-20241022' });
    const deltas: string[] = [];
    for await (const c of p.chatStream({
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'x' }],
    })) {
      deltas.push(c.delta);
    }
    expect(deltas.join('')).toBe('claude-stream');
    await new Promise<void>((r) => sseServer.server.close(() => r()));
  });
});