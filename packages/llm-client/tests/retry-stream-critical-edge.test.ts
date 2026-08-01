import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../src/middleware/retry.js';
import {
  findEventBoundary,
  parseEventRecord,
  parseProviderSseStream,
  parseSseStream,
} from '../src/middleware/stream-parser.js';

function oneEventBody(payload = 'data: value\n\n'): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });
}

describe('retry critical defensive branches', () => {
  it('clamps a negative retry budget to one immediate attempt', async () => {
    const op = vi.fn().mockRejectedValue(new Error('no retry'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withRetry(op, { maxRetries: -4, sleep })).rejects.toThrow('no retry');
    expect(op).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('logs a non-LLM short circuit without coercing the original thrown value', async () => {
    const logger = vi.fn();
    const op = vi.fn().mockRejectedValue('plain-non-retriable');

    await expect(withRetry(op, {
      maxRetries: 3,
      shouldRetry: () => false,
      logger,
    })).rejects.toBe('plain-non-retriable');

    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      event: 'retry_short_circuit',
      reason: 'non_retriable',
    }));
  });

  it('formats a non-Error retry failure and exercises the zero-delay default sleep path', async () => {
    const logger = vi.fn();
    const op = vi.fn().mockRejectedValue('wire-disconnected');

    await expect(withRetry(op, {
      maxRetries: 1,
      delays: [0],
      jitterRatio: 0,
      logger,
    })).rejects.toBe('wire-disconnected');

    expect(op).toHaveBeenCalledTimes(2);
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      event: 'retry_scheduled',
      delayMs: 0,
      error: 'wire-disconnected',
    }));
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({
      event: 'retry_exhausted',
      lastError: 'wire-disconnected',
    }));
  });
});

describe('stream parser critical defensive branches', () => {
  it('ignores unknown SSE fields while retaining data', () => {
    expect(parseEventRecord('x-provider-meta: ignored\ndata: kept')).toEqual({
      data: 'kept',
      event: undefined,
      id: undefined,
      retry: undefined,
    });
  });

  it('selects the earliest boundary when LF and CRLF records are both present', () => {
    expect(findEventBoundary('a\r\n\r\nb\n\nc')).toBe(1);
    expect(findEventBoundary('a\n\nb\r\n\r\nc')).toBe(1);
  });

  it('skips an undefined provider mapping result', async () => {
    const values: unknown[] = [];
    for await (const value of parseProviderSseStream(oneEventBody(), () => undefined)) {
      values.push(value);
    }
    expect(values).toEqual([]);
  });

  it('does not replace a successfully parsed stream with a reader releaseLock failure', async () => {
    let read = false;
    const body = {
      getReader() {
        return {
          async read() {
            if (read) return { done: true, value: undefined };
            read = true;
            return {
              done: false,
              value: new TextEncoder().encode('data: retained\n\n'),
            };
          },
          releaseLock() {
            throw new Error('synthetic release failure');
          },
        };
      },
    } as unknown as ReadableStream<Uint8Array>;

    const events = [];
    for await (const event of parseSseStream(body)) events.push(event.data);
    expect(events).toEqual(['retained']);
  });
});
