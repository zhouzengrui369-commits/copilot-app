/**
 * Typed errors thrown by @copilot/llm-client.
 *
 * Rules (rules.md §5 + T-1.1.5 spec):
 *   - Never silent retry/fail — always throw a typed error.
 *   - Errors must be inspectable; downstream UI uses `code` to render fallback copy.
 *   - All errors derive from LLMError so consumers can `catch (e) { if (e instanceof LLMError) ... }`.
 */

export type LLMErrorCode =
  | 'rate_limit'           // 429 / Retry-After
  | 'token_limit_local'    // local per-minute budget exhausted
  | 'network'              // fetch failed / DNS / etc.
  | 'timeout'              // AbortController tripped
  | 'auth'                 // 401 / 403
  | 'bad_request'          // 400 / schema mismatch
  | 'server'               // 5xx
  | 'stream'               // SSE / chunk parse error
  | 'config'               // missing apiKey, unknown model, etc.
  | 'abort'
  | 'unknown';

export class LLMError extends Error {
  public readonly code: LLMErrorCode;
  public readonly httpStatus?: number;
  public readonly retryable: boolean;
  /** Suggested delay before retrying (ms). Caller can ignore; retry middleware overrides. */
  public readonly retryAfterMs?: number;
  public readonly providerName?: string;
  /** Raw cause for debugging. */
  public override readonly cause?: unknown;

  constructor(
    code: LLMErrorCode,
    message: string,
    opts: {
      httpStatus?: number;
      retryable?: boolean;
      retryAfterMs?: number;
      providerName?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = `${code}_error`; // e.g. 'rate_limit_error'
    this.code = code;
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
    this.providerName = opts.providerName;
    this.cause = opts.cause;
    // Maintain proper stack trace in Node 24.
    if (typeof (Error as { captureStackTrace?: unknown }).captureStackTrace === 'function') {
      (Error as { captureStackTrace: (e: Error, c: Function) => void })
        .captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      providerName: this.providerName,
    };
  }
}

export class RateLimitError extends LLMError {
  constructor(
    msg: string,
    retryAfterMs?: number,
    httpStatus: number = 429,
    opts: { providerName?: string } = {},
  ) {
    super('rate_limit', msg, {
      httpStatus,
      retryable: true,
      retryAfterMs,
      providerName: opts.providerName,
    });
  }
}

export class TokenLimitError extends LLMError {
  constructor(msg: string, retryAfterMs?: number) {
    super('token_limit_local', msg, {
      retryable: true,
      retryAfterMs,
    });
  }
}

export class NetworkError extends LLMError {
  constructor(msg: string, cause?: unknown) {
    super('network', msg, { retryable: true, cause });
  }
}

export class TimeoutError extends LLMError {
  constructor(msg: string, cause?: unknown) {
    super('timeout', msg, { retryable: true, cause });
  }
}

export class AuthError extends LLMError {
  constructor(msg: string, httpStatus = 401, opts: { providerName?: string } = {}) {
    super('auth', msg, { httpStatus, retryable: false, providerName: opts.providerName });
  }
}

export class BadRequestError extends LLMError {
  constructor(
    msg: string,
    httpStatus = 400,
    cause?: unknown,
    opts: { providerName?: string } = {},
  ) {
    super('bad_request', msg, {
      httpStatus,
      retryable: false,
      cause,
      providerName: opts.providerName,
    });
  }
}

export class ServerError extends LLMError {
  constructor(
    msg: string,
    httpStatus = 500,
    cause?: unknown,
    opts: { providerName?: string } = {},
  ) {
    super('server', msg, {
      httpStatus,
      retryable: true,
      cause,
      providerName: opts.providerName,
    });
  }
}

export class StreamError extends LLMError {
  constructor(msg: string, cause?: unknown) {
    super('stream', msg, { retryable: false, cause });
  }
}

export class ConfigError extends LLMError {
  constructor(msg: string) {
    super('config', msg, { retryable: false });
  }
}

export class AbortError extends LLMError {
  constructor(msg = 'request aborted') {
    super('abort', msg, { retryable: false });
  }
}

/** Convenience: map an HTTP status to a typed error. */
export function errorFromHttpStatus(
  status: number,
  bodyText: string,
  providerName?: string,
): LLMError {
  const safeBody = bodyText.slice(0, 500);
  const baseOpts = { providerName };
  if (status === 401 || status === 403) {
    return new AuthError(`${status} ${safeBody}`, status, baseOpts);
  }
  if (status === 429) {
    return new RateLimitError(`429 ${safeBody}`, undefined, 429, baseOpts);
  }
  if (status === 400 || status === 404) {
    return new BadRequestError(`${status} ${safeBody}`, status, undefined, baseOpts);
  }
  if (status >= 500 && status < 600) {
    return new ServerError(`${status} ${safeBody}`, status, undefined, baseOpts);
  }
  return new LLMError('unknown', `${status} ${safeBody}`, {
    httpStatus: status,
    providerName,
  });
}

/** Detect a known LLMError — works across throws inside fetch/JSON pipelines. */
export function isLLMError(e: unknown): e is LLMError {
  return e instanceof LLMError;
}

/** Is this error retryable by the retry middleware? */
export function isRetriable(e: unknown): boolean {
  if (!isLLMError(e)) return true; // be optimistic on unknown errors (network blips)
  return e.retryable;
}
