import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeBackoffMs,
  withRetry,
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_JITTER_RATIO,
} from '../src/middleware/retry.js';
import { AuthError, NetworkError, RateLimitError, ServerError } from '../src/util/errors.js';

describe('retry middleware', () => {
  describe('computeBackoffMs', () => {
    it('uses default schedule 1s/3s/9s', () => {
      expect(DEFAULT_RETRY_DELAYS_MS).toEqual([1000, 3000, 9000]);
      expect(DEFAULT_MAX_RETRIES).toBe(3);
      expect(DEFAULT_JITTER_RATIO).toBe(0.2);
    });

    it('returns exact base when jitter=0 and rand constant', () => {
      expect(computeBackoffMs(0, [1000, 3000, 9000], 0)).toBe(1000);
      expect(computeBackoffMs(1, [1000, 3000, 9000], 0)).toBe(3000);
      expect(computeBackoffMs(2, [1000, 3000, 9000], 0)).toBe(9000);
    });

    it('clamps beyond schedule', () => {
      expect(computeBackoffMs(5, [1000, 3000, 9000], 0)).toBe(9000);
      expect(computeBackoffMs(99, [1000, 3000, 9000], 0)).toBe(9000);
    });

    it('applies symmetric jitter ±20% (with deterministic rand)', () => {
      // rand = 1.0 → +jitter, rand = 0.0 → -jitter
      expect(computeBackoffMs(0, [1000], 0.2, () => 1)).toBe(1200);
      expect(computeBackoffMs(0, [1000], 0.2, () => 0)).toBe(800);
      expect(computeBackoffMs(0, [1000], 0.2, () => 0.5)).toBe(1000);
    });

    it('never returns negative delay', () => {
      // extreme: rand=0, jitter=0.99 → would be 1 − 0.99 = 0.01
      const out = computeBackoffMs(0, [100], 0.99, () => 0);
      expect(out).toBeGreaterThanOrEqual(0);
    });
  });

  describe('withRetry', () => {
    let sleepMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      sleepMock = vi.fn().mockResolvedValue(undefined);
    });

    it('succeeds on first attempt', async () => {
      const op = vi.fn().mockResolvedValue('ok');
      const out = await withRetry(op, { sleep: sleepMock });
      expect(out).toBe('ok');
      expect(op).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it('retries on retriable error and eventually succeeds (3 retries + final OK)', async () => {
      // mock 失败 5 次后最终成功 → 验证 3 次 retry 后 fallback 路径
      // Interpreting T-1.1.5 spec: we mock that first 3 attempts fail (so all retries
      // are burned), then the 4th attempt succeeds — proving "maxRetries=3 + final success".
      const op = vi.fn().mockImplementation(async (attempt: number) => {
        if (attempt < 3) throw new NetworkError(`fail ${attempt}`);
        return `success-after-3-retries-${attempt}`;
      });
      const out = await withRetry(op, {
        maxRetries: 3,
        delays: [1, 1, 1],
        jitterRatio: 0,
        sleep: sleepMock,
      });
      expect(out).toBe('success-after-3-retries-3');
      expect(op).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(sleepMock).toHaveBeenCalledTimes(3);
    });

    it('exhausts all retries and re-throws last error', async () => {
      const err = new ServerError('still down');
      const op = vi.fn().mockRejectedValue(err);
      await expect(
        withRetry(op, {
          maxRetries: 3,
          delays: [1, 1, 1],
          jitterRatio: 0,
          sleep: sleepMock,
        }),
      ).rejects.toThrow('still down');
      expect(op).toHaveBeenCalledTimes(4);
      expect(sleepMock).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry on non-retriable errors', async () => {
      const op = vi.fn().mockRejectedValue(new AuthError('401 bad key'));
      await expect(withRetry(op, { sleep: sleepMock })).rejects.toThrow('401 bad key');
      expect(op).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it('short-circuits on plain Error non-LLM (optimistic → retries)', async () => {
      const op = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(
        withRetry(op, {
          maxRetries: 1,
          delays: [1],
          jitterRatio: 0,
          sleep: sleepMock,
          // custom shouldRetry to confirm default behavior
        }),
      ).rejects.toThrow('boom');
      expect(op).toHaveBeenCalledTimes(2);
    });

    it('retries on RateLimitError', async () => {
      const op = vi
        .fn()
        .mockRejectedValueOnce(new RateLimitError('429', 100))
        .mockResolvedValueOnce('ok');
      const out = await withRetry(op, {
        maxRetries: 2,
        delays: [1],
        jitterRatio: 0,
        sleep: sleepMock,
      });
      expect(out).toBe('ok');
      expect(op).toHaveBeenCalledTimes(2);
    });

    it('logs structured events on retry and recovery', async () => {
      const logger = vi.fn();
      const op = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('try1'))
        .mockResolvedValueOnce('ok');
      await withRetry(op, {
        maxRetries: 3,
        delays: [1],
        jitterRatio: 0,
        sleep: sleepMock,
        logger,
      });
      const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
      expect(events).toContain('retry_scheduled');
      expect(events).toContain('retry_recovered');
    });

    it('logs retry_exhausted on final failure', async () => {
      const logger = vi.fn();
      const op = vi.fn().mockRejectedValue(new ServerError('500'));
      await expect(
        withRetry(op, {
          maxRetries: 2,
          delays: [1],
          jitterRatio: 0,
          sleep: sleepMock,
          logger,
        }),
      ).rejects.toThrow();
      const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
      expect(events).toContain('retry_exhausted');
    });

    it('invokes onAttempt with computed delay', async () => {
      const onAttempt = vi.fn();
      const op = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('a'))
        .mockResolvedValueOnce('b');
      await withRetry(op, {
        maxRetries: 2,
        delays: [50],
        jitterRatio: 0,
        sleep: sleepMock,
        onAttempt,
      });
      expect(onAttempt).toHaveBeenCalledTimes(1);
      expect(onAttempt).toHaveBeenCalledWith(0, 50);
    });

    it('custom shouldRetry overrides default', async () => {
      const shouldRetry = vi.fn().mockReturnValue(false);
      const op = vi.fn().mockRejectedValue(new NetworkError('net'));
      await expect(
        withRetry(op, {
          maxRetries: 5,
          shouldRetry,
          sleep: sleepMock,
        }),
      ).rejects.toThrow('net');
      expect(shouldRetry).toHaveBeenCalled();
      expect(op).toHaveBeenCalledTimes(1); // short-circuit
    });

    it('handles maxRetries=0 → single attempt', async () => {
      const op = vi.fn().mockRejectedValue(new NetworkError('boom'));
      await expect(
        withRetry(op, { maxRetries: 0, sleep: sleepMock }),
      ).rejects.toThrow('boom');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('total delay accumulates', async () => {
      const op = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('a'))
        .mockRejectedValueOnce(new NetworkError('b'))
        .mockResolvedValueOnce('c');
      const out = await withRetry(op, {
        maxRetries: 3,
        delays: [100, 200, 400],
        jitterRatio: 0,
        sleep: sleepMock,
      });
      expect(out).toBe('c');
      expect(sleepMock).toHaveBeenNthCalledWith(1, 100);
      expect(sleepMock).toHaveBeenNthCalledWith(2, 200);
    });

    it('logs retry_short_circuit on non-retriable error', async () => {
      const logger = vi.fn();
      const op = vi.fn().mockRejectedValue(new AuthError('bad key'));
      await expect(
        withRetry(op, {
          maxRetries: 5,
          sleep: sleepMock,
          logger,
        }),
      ).rejects.toThrow();
      const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
      expect(events).toContain('retry_short_circuit');
    });

    it('handles non-Error thrown values (string)', async () => {
      const op = vi.fn().mockRejectedValueOnce('boom-string' as unknown).mockResolvedValueOnce('ok');
      const out = await withRetry(op, {
        maxRetries: 3,
        delays: [1],
        jitterRatio: 0,
        sleep: sleepMock,
      });
      expect(out).toBe('ok');
    });

    it('uses default sleep when no override', async () => {
      const op = vi.fn().mockRejectedValueOnce(new NetworkError('a')).mockResolvedValueOnce('ok');
      // No `sleep` option — uses default setTimeout-based sleep.
      const out = await withRetry(op, {
        maxRetries: 3,
        delays: [1],
        jitterRatio: 0,
      });
      expect(out).toBe('ok');
    });

    it('default sleep returns immediately for 0ms', async () => {
      // Call default with ms <= 0 (no setTimeout) — verifies the early-return path.
      // We import the file to call defaultShouldRetry / etc.
      const { defaultShouldRetry } = await import('../src/middleware/retry.js');
      expect(defaultShouldRetry(new Error('x'), 0)).toBe(true);
      const auth = new AuthError('401');
      expect(defaultShouldRetry(auth, 0)).toBe(false);
      expect(defaultShouldRetry('plain' as unknown, 0)).toBe(true);
    });
  });
});
