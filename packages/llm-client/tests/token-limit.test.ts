import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TokenLimiter,
  createTokenLimiter,
} from '../src/middleware/token-limit.js';
import { TokenLimitError, isLLMError } from '../src/util/errors.js';

describe('token-limit middleware', () => {
  let fakeNow: number;
  let now: () => number;

  beforeEach(() => {
    fakeNow = 1_700_000_000_000;
    now = () => fakeNow;
  });

  it('starts empty', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    expect(tl.totalUsage()).toBe(0);
    expect(tl.currentUsage('any')).toBe(0);
  });

  it('records tokens via acquire', () => {
    const tl = new TokenLimiter({ perMinute: 1000, now });
    tl.acquire(100, 'user1');
    tl.acquire(50, 'user1');
    expect(tl.currentUsage('user1')).toBe(150);
    tl.acquire(75, 'user2');
    expect(tl.currentUsage('user2')).toBe(75);
    expect(tl.totalUsage()).toBe(225);
  });

  it('throws TokenLimitError when budget exceeded', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    tl.acquire(80, 'u1');
    expect(() => tl.acquire(30, 'u1')).toThrow(TokenLimitError);
  });

  it('throws with retryable=true code', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    tl.acquire(80, 'u1');
    try {
      tl.acquire(30, 'u1');
      expect.fail('expected throw');
    } catch (e) {
      expect(isLLMError(e)).toBe(true);
      if (isLLMError(e)) {
        expect(e.code).toBe('token_limit_local');
        expect(e.retryable).toBe(true);
      }
    }
  });

  it('does NOT throw if exactly within budget', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    tl.acquire(60, 'u1');
    expect(() => tl.acquire(40, 'u1')).not.toThrow();
    expect(tl.currentUsage('u1')).toBe(100);
  });

  it('evicts entries older than windowMs', () => {
    const tl = new TokenLimiter({ perMinute: 1000, windowMs: 1000, now });
    tl.acquire(500, 'u1');
    expect(tl.currentUsage('u1')).toBe(500);
    fakeNow += 999; // still in window
    expect(tl.currentUsage('u1')).toBe(500);
    fakeNow += 1; // cross the boundary
    expect(tl.currentUsage('u1')).toBe(0);
  });

  it('allows new acquisition after bucket ages out', () => {
    const tl = new TokenLimiter({ perMinute: 100, windowMs: 1000, now });
    tl.acquire(100, 'u1');
    expect(() => tl.acquire(1, 'u1')).toThrow(TokenLimitError);
    fakeNow += 1001;
    expect(() => tl.acquire(50, 'u1')).not.toThrow();
  });

  it('isolates per-key usage', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    tl.acquire(90, 'alice');
    expect(() => tl.acquire(15, 'bob')).not.toThrow();
    expect(() => tl.acquire(15, 'alice')).toThrow(TokenLimitError);
  });

  it('uses default key when not provided', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    tl.acquire(80);
    expect(() => tl.acquire(30)).toThrow(TokenLimitError);
  });

  it('no-op for non-positive tokens', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    expect(() => tl.acquire(0)).not.toThrow();
    expect(() => tl.acquire(-5)).not.toThrow();
    expect(() => tl.acquire(Number.NaN)).not.toThrow();
  });

  it('release removes a matching bucket', () => {
    const tl = new TokenLimiter({ perMinute: 1000, now });
    tl.acquire(400, 'u1');
    tl.release(400, 'u1');
    expect(tl.currentUsage('u1')).toBe(0);
  });

  it('release is safe for non-matching tokens', () => {
    const tl = new TokenLimiter({ perMinute: 1000, now });
    tl.acquire(100, 'u1');
    tl.release(999, 'u1');
    expect(tl.currentUsage('u1')).toBe(100); // unchanged
  });

  it('release no-op for invalid values', () => {
    const tl = new TokenLimiter({ perMinute: 1000, now });
    tl.acquire(100, 'u1');
    tl.release(0);
    tl.release(-5);
    tl.release(NaN);
    expect(tl.currentUsage('u1')).toBe(100);
  });

  it('timeUntilFree returns 0 when room available', () => {
    const tl = new TokenLimiter({ perMinute: 1000, now });
    tl.acquire(100, 'u1');
    expect(tl.timeUntilFree(50, 'u1')).toBe(0);
  });

  it('timeUntilFree returns non-negative even with huge need', () => {
    const tl = new TokenLimiter({ perMinute: 100, now });
    tl.acquire(100, 'u1');
    const wait = tl.timeUntilFree(1_000_000, 'u1');
    expect(wait).toBeGreaterThanOrEqual(0);
  });

  it('reset clears state', () => {
    const tl = new TokenLimiter({ perMinute: 1000, now });
    tl.acquire(500, 'u1');
    tl.reset();
    expect(tl.totalUsage()).toBe(0);
  });

  it('logs token_limit_blocked on throw', () => {
    const logger = vi.fn();
    const tl = new TokenLimiter({ perMinute: 100, now, logger });
    tl.acquire(80, 'u1');
    expect(() => tl.acquire(30, 'u1')).toThrow();
    const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('token_limit_blocked');
  });

  it('logs token_limit_acquired on success', () => {
    const logger = vi.fn();
    const tl = new TokenLimiter({ perMinute: 1000, now, logger });
    tl.acquire(50, 'u1');
    const events = logger.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('token_limit_acquired');
  });

  it('uses 60_000 default perMinute', () => {
    const tl = new TokenLimiter({ now });
    tl.acquire(60_000, 'u1');
    expect(() => tl.acquire(1, 'u1')).toThrow(TokenLimitError);
  });

  it('createTokenLimiter returns a TokenLimiter', () => {
    const tl = createTokenLimiter({ perMinute: 100, now });
    expect(tl).toBeInstanceOf(TokenLimiter);
    expect(() => tl.acquire(50)).not.toThrow();
  });
});
