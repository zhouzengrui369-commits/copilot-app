import { describe, expect, it } from 'vitest';
import {
  defaultStreamChunkMapper,
  findEventBoundary,
  parseEventRecord,
  parseProviderSseStream,
  parseSseStream,
} from '../src/middleware/stream-parser.js';
import { StreamError } from '../src/util/errors.js';

function makeSseBody(chunks: string[]): ReadableStream<Uint8Array> {
  // chunks are already in wire form including "data: ..." prefix and trailing \n\n
  const text = chunks.join('\n');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function makeSseBodyBytes(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

describe('stream-parser', () => {
  describe('findEventBoundary', () => {
    it('finds \\n\\n', () => {
      expect(findEventBoundary('a\n\nb')).toBe(1);
    });

    it('finds \\r\\n\\r\\n', () => {
      expect(findEventBoundary('a\r\n\r\nb')).toBe(1);
    });

    it('returns -1 when none', () => {
      expect(findEventBoundary('abc')).toBe(-1);
      expect(findEventBoundary('a\nb')).toBe(-1);
    });

    it('returns the earliest boundary', () => {
      expect(findEventBoundary('a\n\nb\n\nc')).toBe(1);
    });
  });

  describe('parseEventRecord', () => {
    it('parses a single data: line', () => {
      const out = parseEventRecord('data: hello world');
      expect(out.data).toBe('hello world');
    });

    it('parses event: id: retry: with trimming', () => {
      const out = parseEventRecord('event: ping\nid:42\nretry: 5000\ndata: ok');
      expect(out.event).toBe('ping');
      expect(out.id).toBe('42');
      expect(out.retry).toBe(5000);
      expect(out.data).toBe('ok');
    });

    it('joins multi-line data fields with \\n', () => {
      const out = parseEventRecord('data: a\ndata: b');
      expect(out.data).toBe('a\nb');
    });

    it('ignores lines starting with : (SSE comments)', () => {
      const out = parseEventRecord(':comment\ndata: x');
      expect(out.data).toBe('x');
    });

    it('ignores empty lines', () => {
      const out = parseEventRecord('\n\ndata: x');
      expect(out.data).toBe('x');
    });

    it('returns empty data for empty record', () => {
      const out = parseEventRecord('');
      expect(out.data).toBe('');
    });
  });

  describe('parseSseStream', () => {
    it('parses a 5-chunk SSE stream', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"he"}}]}',
        'data: {"choices":[{"delta":{"content":"ll"}}]}',
        'data: {"choices":[{"delta":{"content":"o"}}]}',
        'data: {"choices":[{"delta":{"content":" wo"}}]}',
        'data: {"choices":[{"delta":{"content":"rld"},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ].map((s) => s + '\n\n');
      const out: string[] = [];
      for await (const evt of parseSseStream(makeSseBody(chunks))) {
        out.push(evt.data);
      }
      expect(out).toEqual([
        '{"choices":[{"delta":{"content":"he"}}]}',
        '{"choices":[{"delta":{"content":"ll"}}]}',
        '{"choices":[{"delta":{"content":"o"}}]}',
        '{"choices":[{"delta":{"content":" wo"}}]}',
        '{"choices":[{"delta":{"content":"rld"},"finish_reason":"stop"}]}',
        '[DONE]',
      ]);
    });

    it('handles a record split across chunk boundaries', async () => {
      // Split one event mid-line across two read() chunks.
      const bytes = [
        new TextEncoder().encode('data: {"cho'),
        new TextEncoder().encode('ices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'),
      ];
      const out: string[] = [];
      for await (const evt of parseSseStream(makeSseBodyBytes(bytes))) {
        out.push(evt.data);
      }
      expect(out).toEqual([
        '{"choices":[{"delta":{"content":"hi"}}]}',
        '[DONE]',
      ]);
    });

    it('handles a stream with no trailing blank line on the final event', async () => {
      const bytes = [
        new TextEncoder().encode('data: {"delta":"a"}\n\ndata: {"delta":"b"}'),
      ];
      const out: string[] = [];
      for await (const evt of parseSseStream(makeSseBodyBytes(bytes))) {
        out.push(evt.data);
      }
      expect(out).toEqual(['{"delta":"a"}', '{"delta":"b"}']);
    });

    it('handles \\r\\n\\r\\n boundaries', async () => {
      const bytes = [new TextEncoder().encode('data: x\r\n\r\ndata: y\r\n\r\n')];
      const out: string[] = [];
      for await (const evt of parseSseStream(makeSseBodyBytes(bytes))) {
        out.push(evt.data);
      }
      expect(out).toEqual(['x', 'y']);
    });

    it('throws StreamError when buffer exceeds maxBufferBytes', async () => {
      const tl = new TextEncoder();
      const huge = 'x'.repeat(120);
      const bytes = [tl.encode('data: ' + huge + '\n\n')];
      await expect(async () => {
        for await (const _ of parseSseStream(makeSseBodyBytes(bytes), {
          maxBufferBytes: 50,
        })) {
          // drain
        }
      }).rejects.toThrow(StreamError);
    });
  });

  describe('parseProviderSseStream', () => {
    it('yields chunks via mapper and stops at [DONE]', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"a"}}]}',
        'data: {"choices":[{"delta":{"content":"b"}}]}',
        'data: [DONE]',
      ].map((s) => s + '\n\n');
      const mapper = (raw: string) => defaultStreamChunkMapper(raw);
      const out: string[] = [];
      for await (const sc of parseProviderSseStream(makeSseBody(chunks), mapper)) {
        out.push(sc.delta);
      }
      expect(out).toEqual(['a', 'b']);
    });

    it('throws StreamError on malformed JSON', async () => {
      const chunks = ['data: not-json\n\n'].map((s) => s);
      const mapper = (raw: string) => defaultStreamChunkMapper(raw);
      await expect(async () => {
        for await (const _ of parseProviderSseStream(makeSseBody(chunks), mapper)) {
          // drain
        }
      }).rejects.toThrow(StreamError);
    });

    it('skips mapper-null results', async () => {
      const chunks = [
        'data: {"choices":[]}', // mapper returns null
        'data: {"choices":[{"delta":{"content":"y"}}]}',
        'data: [DONE]',
      ].map((s) => s + '\n\n');
      const out: string[] = [];
      for await (const sc of parseProviderSseStream(makeSseBody(chunks), (raw) =>
        defaultStreamChunkMapper(raw),
      )) {
        out.push(sc.delta);
      }
      expect(out).toEqual(['y']);
    });
  });

  describe('defaultStreamChunkMapper', () => {
    it('maps content delta + finish_reason + usage', () => {
      const raw = JSON.stringify({
        choices: [
          {
            delta: { content: 'hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      });
      const out = defaultStreamChunkMapper(raw);
      expect(out).not.toBeNull();
      expect(out!.delta).toBe('hi');
      expect(out!.finishReason).toBe('stop');
      expect(out!.usage).toEqual({
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      });
    });

    it('maps finish_reason length', () => {
      const raw = JSON.stringify({
        choices: [{ delta: { content: '' }, finish_reason: 'length' }],
      });
      expect(defaultStreamChunkMapper(raw)!.finishReason).toBe('length');
    });

    it('maps finish_reason tool_calls', () => {
      const raw = JSON.stringify({
        choices: [{ delta: { content: '' }, finish_reason: 'tool_calls' }],
      });
      expect(defaultStreamChunkMapper(raw)!.finishReason).toBe('tool_calls');
    });

    it('maps finish_reason content_filter', () => {
      const raw = JSON.stringify({
        choices: [{ delta: { content: '' }, finish_reason: 'content_filter' }],
      });
      expect(defaultStreamChunkMapper(raw)!.finishReason).toBe('content_filter');
    });

    it('returns null when no choices', () => {
      const raw = JSON.stringify({ choices: [] });
      expect(defaultStreamChunkMapper(raw)).toBeNull();
    });

    it('throws on bad JSON', () => {
      expect(() => defaultStreamChunkMapper('{')).toThrow(StreamError);
    });
  });
});
