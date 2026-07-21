/**
 * Exponential-backoff retry wrapper.
 *
 * Default schedule: 1s, 3s, 9s with ±20% jitter. (3 retries → 4 total attempts.)
 *   attempt 1: base 1000ms
 *   attempt 2: base 3000ms
 *   attempt 3: base 9000ms
 * After exhaustion the *most recent* error is re-thrown so callers can inspect.
 *
 * Errors with `retryable === false` short-circuit immediately (no retry, no jitter wait).
 * `abort` / cancellation also short-circuits and rethrows.
 */

import { LLMError, isLLMError } from '../util/errors.js';
import type { LLMClientLogEntry } from '../types.js';

/** Spec-mandated backoff schedule. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000];

/** Default retry budget — 3 retries → 4 attempts total. */
export const DEFAULT_MAX_RETRIES = 3;

/** Default ±20% jitter. */
export const DEFAULT_JITTER_RATIO = 0.2;

/** Compute the delay for the n-th retry (0-indexed) with optional jitter. */
export function computeBackoffMs(
  attempt: number,
  delays: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
  jitterRatio: number = DEFAULT_JITTER_RATIO,
  rand: () => number = Math.random,
): number {
  const base = delays[Math.min(attempt, delays.length - 1)];
  const jitter = base * jitterRatio;
  // Symmetric jitter ±jitterRatio * base, deterministic by `rand` for testability.
  const offset = (rand() * 2 - 1) * jitter;
  return Math.max(0, Math.round(base + offset));
}

/** Decision returned by `withRetry` after attempts run out. */
export interface RetryOutcome<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
  attempts: number;
  totalDelayMs: number;
}

/** Run `op` with exponential backoff retry. */
export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  opts: {
    maxRetries?: number;
    delays?: readonly number[];
    jitterRatio?: number;
    sleep?: (ms: number) => Promise<void>;
    rand?: () => number;
    logger?: (entry: LLMClientLogEntry) => void;
    /**
     * Decide if error is retriable. Default: true for any error (LLM-unknown optimism).
     * Errors with `retryable === false` are short-circuited.
     */
    shouldRetry?: (err: unknown, attempt: number) => boolean;
    onAttempt?: (attempt: number, delayMs: number) => void;
  } = {},
): Promise<T> {
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
  const delays = opts.delays ?? DEFAULT_RETRY_DELAYS_MS;
  const jitterRatio = opts.jitterRatio ?? DEFAULT_JITTER_RATIO;
  const sleep = opts.sleep ?? defaultSleep;
  const rand = opts.rand ?? Math.random;
  const logger = opts.logger;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;

  let totalDelayMs = 0;
  let lastError: unknown;

  // attempts = 0..maxRetries inclusive (e.g. maxRetries=3 → 4 attempts total).
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await op(attempt);
      if (attempt > 0) {
        logger?.({
          ts: new Date().toISOString(),
          level: 'info',
          event: 'retry_recovered',
          attempt,
          totalDelayMs,
        });
      }
      return result;
    } catch (err) {
      lastError = err;

      // Non-retriable → bail.
      if (!shouldRetry(err, attempt)) {
        logger?.({
          ts: new Date().toISOString(),
          level: 'warn',
          event: 'retry_short_circuit',
          attempt,
          reason: isLLMError(err) ? `${err.code}:${err.retryable}` : 'non_retriable',
        });
        throw err;
      }

      // No more retries → throw.
      if (attempt >= maxRetries) {
        logger?.({
          ts: new Date().toISOString(),
          level: 'error',
          event: 'retry_exhausted',
          attempts: attempt + 1,
          totalDelayMs,
          lastError: errString(err),
        });
        throw err;
      }

      const delay = computeBackoffMs(attempt, delays, jitterRatio, rand);
      opts.onAttempt?.(attempt, delay);
      logger?.({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'retry_scheduled',
        attempt,
        nextAttempt: attempt + 1,
        delayMs: delay,
        error: errString(err),
      });
      totalDelayMs += delay;
      await sleep(delay);
    }
  }
  // Unreachable, but keep TypeScript happy.
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function defaultShouldRetry(err: unknown, _attempt: number): boolean {
  if (isLLMError(err)) return err.retryable;
  return true;
}

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function errString(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// Re-export for downstream tests/utilities.
export { LLMError, isLLMError };
