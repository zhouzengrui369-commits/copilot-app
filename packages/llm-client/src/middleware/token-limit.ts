/**
 * Token-limit middleware — sliding per-minute budget.
 *
 * Sprint 1.1 default: 60_000 tokens/minute (configurable via LLMClientOptions.tokenLimitPerMin).
 * Sprint 1.2 RAG may tighten this. We use **provider countTokens** when available, falling
 * back to a CJK-aware approximation.
 *
 * Semantics:
 *   - When `acquire(tokens, key)` is called and the budget would exceed, the call returns a
 *     `TokenLimitError` synchronously. Consumers can retry-after-budget-frees-up.
 *   - Records are evicted as they age out of the 60s window.
 *   - Concurrency: O(n) per acquire (n = tokens used in past 60s).
 */

import type { LLMClientLogEntry } from '../types.js';
import { TokenLimitError } from '../util/errors.js';

export interface TokenLimitOptions {
  /** Tokens allowed in any 60s window. Default 60_000. */
  perMinute?: number;
  /** Window length in ms. Default 60_000. */
  windowMs?: number;
  /** Override now() for tests. */
  now?: () => number;
  logger?: (entry: LLMClientLogEntry) => void;
}

interface Bucket {
  key: string;
  tokens: number;
  at: number;
}

export class TokenLimiter {
  private readonly perMinute: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly logger?: (entry: LLMClientLogEntry) => void;
  private readonly buckets: Bucket[] = [];

  constructor(opts: TokenLimitOptions = {}) {
    this.perMinute = Math.max(1, opts.perMinute ?? 60_000);
    this.windowMs = Math.max(1, opts.windowMs ?? 60_000);
    this.now = opts.now ?? (() => Date.now());
    this.logger = opts.logger;
  }

  /** How many tokens are currently in use (for the key). Triggers eviction. */
  currentUsage(key: string = '__default__'): number {
    this.evict();
    const cutoff = this.now() - this.windowMs;
    let total = 0;
    for (const b of this.buckets) {
      if (b.key === key && b.at > cutoff) total += b.tokens;
    }
    return total;
  }

  /** Convenience: global total across keys. Triggers eviction. */
  totalUsage(): number {
    this.evict();
    const cutoff = this.now() - this.windowMs;
    let total = 0;
    for (const b of this.buckets) {
      if (b.at > cutoff) total += b.tokens;
    }
    return total;
  }

  /** Try to use `tokens` for `key`. Records or throws TokenLimitError. */
  acquire(tokens: number, key: string = '__default__'): void {
    if (!Number.isFinite(tokens) || tokens <= 0) {
      return;
    }
    this.evict();
    const used = this.currentUsage(key);
    if (used + tokens > this.perMinute) {
      const retryAfter = this.timeUntilFree(used + tokens - this.perMinute, key);
      this.logger?.({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'token_limit_blocked',
        key,
        requested: tokens,
        used,
        perMinute: this.perMinute,
        retryAfterMs: retryAfter,
      });
      throw new TokenLimitError(
        `token limit ${this.perMinute}/min exceeded (used=${used}, requested=${tokens})`,
        retryAfter,
      );
    }
    this.buckets.push({ key, tokens: Math.round(tokens), at: this.now() });
    this.logger?.({
      ts: new Date().toISOString(),
      level: 'debug',
      event: 'token_limit_acquired',
      key,
      tokens: Math.round(tokens),
      used: used + Math.round(tokens),
    });
  }

  /** Release tokens early — useful when caller aborts before sending. */
  release(tokens: number, key: string = '__default__'): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    // Find the most recent bucket for the key whose tokens == requested and remove it.
    // We do this in O(n) which is fine at the expected bucket count.
    const nowMs = this.now();
    // Pop most recent matching bucket, walking backward.
    for (let i = this.buckets.length - 1; i >= 0; i--) {
      const b = this.buckets[i];
      if (b.key === key && b.tokens === Math.round(tokens) && b.at <= nowMs) {
        this.buckets.splice(i, 1);
        return;
      }
    }
  }

  /** Estimate ms until enough room is available for `need` tokens for `key`. */
  timeUntilFree(need: number, key: string = '__default__'): number {
    this.evict();
    const cutoff = this.now() - this.windowMs;
    // Sum of tokens older than the next-oldest-eligible bucket.
    // Simple policy: drop oldest until sum(newest 60s tokens) + need <= perMinute.
    // Compute as: find the timestamp at which total tokens used in last 60s drops to
    // perMinute - need. That's approximated as max(current - 60s, oldest bucket time).
    let oldest = Number.POSITIVE_INFINITY;
    let sum = 0;
    for (const b of this.buckets) {
      if (b.key === key && b.at > cutoff) {
        sum += b.tokens;
        if (b.at < oldest) oldest = b.at;
      }
    }
    if (sum + need <= this.perMinute) return 0;
    // Rough estimate: wait until the OLDEST bucket ages out.
    const evictAt = oldest + this.windowMs;
    return Math.max(0, evictAt - this.now());
  }

  /** Maintenance — drop entries that fell out of the window. */
  evict(): void {
    const cutoff = this.now() - this.windowMs;
    let i = 0;
    while (i < this.buckets.length && this.buckets[i].at < cutoff) i++;
    if (i > 0) this.buckets.splice(0, i);
  }

  /** Test helper — drop everything. */
  reset(): void {
    this.buckets.length = 0;
  }
}

/** Factory so callers don't need to `new`. */
export function createTokenLimiter(opts?: TokenLimitOptions): TokenLimiter {
  return new TokenLimiter(opts);
}
