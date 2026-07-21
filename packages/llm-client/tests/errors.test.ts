import { describe, expect, it } from 'vitest';
import {
  AbortError,
  AuthError,
  BadRequestError,
  ConfigError,
  LLMError,
  NetworkError,
  RateLimitError,
  ServerError,
  StreamError,
  TimeoutError,
  TokenLimitError,
  errorFromHttpStatus,
  isLLMError,
  isRetriable,
} from '../src/util/errors.js';

describe('errors', () => {
  it('LLMError sets name/code/retryable/httpStatus', () => {
    const e = new LLMError('network', 'oops', { httpStatus: 503, retryable: true });
    expect(e.name).toBe('network_error');
    expect(e.code).toBe('network');
    expect(e.retryable).toBe(true);
    expect(e.httpStatus).toBe(503);
    expect(isLLMError(e)).toBe(true);
    expect(e.toJSON()).toMatchObject({
      name: 'network_error',
      code: 'network',
      httpStatus: 503,
      retryable: true,
    });
  });

  it('RateLimitError carries retryable=true', () => {
    const e = new RateLimitError('429', 1500);
    expect(e.code).toBe('rate_limit');
    expect(e.retryable).toBe(true);
    expect(e.httpStatus).toBe(429);
    expect(e.retryAfterMs).toBe(1500);
    expect(e.name).toBe('rate_limit_error');
  });

  it('TokenLimitError carries retryable=true', () => {
    const e = new TokenLimitError('budget exceeded', 2000);
    expect(e.code).toBe('token_limit_local');
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(2000);
  });

  it('NetworkError carries retryable=true and cause', () => {
    const cause = new Error('ECONNREFUSED');
    const e = new NetworkError('failed', cause);
    expect(e.code).toBe('network');
    expect(e.retryable).toBe(true);
    expect(e.cause).toBe(cause);
  });

  it('TimeoutError is retryable', () => {
    const e = new TimeoutError('slow');
    expect(e.retryable).toBe(true);
  });

  it('AuthError is NOT retryable', () => {
    const e = new AuthError('401 bad key');
    expect(e.retryable).toBe(false);
    expect(e.httpStatus).toBe(401);
  });

  it('BadRequestError is NOT retryable', () => {
    const e = new BadRequestError('400 bad');
    expect(e.retryable).toBe(false);
    expect(e.httpStatus).toBe(400);
  });

  it('ServerError is retryable', () => {
    const e = new ServerError('500 oops');
    expect(e.retryable).toBe(true);
    expect(e.httpStatus).toBe(500);
  });

  it('StreamError is NOT retryable', () => {
    const e = new StreamError('malformed');
    expect(e.retryable).toBe(false);
  });

  it('ConfigError is NOT retryable', () => {
    const e = new ConfigError('missing key');
    expect(e.retryable).toBe(false);
  });

  it('AbortError is NOT retryable', () => {
    const e = new AbortError();
    expect(e.retryable).toBe(false);
  });

  describe('errorFromHttpStatus', () => {
    it('401 → AuthError', () => {
      const e = errorFromHttpStatus(401, 'bad key', 'minimax');
      expect(e.code).toBe('auth');
      expect((e as LLMError).providerName).toBe('minimax');
    });

    it('403 → AuthError', () => {
      const e = errorFromHttpStatus(403, 'forbidden');
      expect(e.code).toBe('auth');
    });

    it('400 → BadRequestError', () => {
      const e = errorFromHttpStatus(400, 'bad body');
      expect(e.code).toBe('bad_request');
    });

    it('404 → BadRequestError', () => {
      const e = errorFromHttpStatus(404, 'no model');
      expect(e.code).toBe('bad_request');
    });

    it('500 → ServerError', () => {
      const e = errorFromHttpStatus(500, 'down');
      expect(e.code).toBe('server');
    });

    it('503 → ServerError', () => {
      const e = errorFromHttpStatus(503, 'down');
      expect(e.code).toBe('server');
    });

    it('418 → unknown', () => {
      const e = errorFromHttpStatus(418, 'tea');
      expect(e.code).toBe('unknown');
    });
  });

  describe('isRetriable', () => {
    it('non-LLMError → true (optimistic for unknown blips)', () => {
      expect(isRetriable(new Error('plain'))).toBe(true);
    });

    it('LLMError with retryable=false → false', () => {
      expect(isRetriable(new AuthError('401'))).toBe(false);
      expect(isRetriable(new BadRequestError('400'))).toBe(false);
      expect(isRetriable(new StreamError('parse'))).toBe(false);
      expect(isRetriable(new ConfigError('cfg'))).toBe(false);
      expect(isRetriable(new AbortError())).toBe(false);
    });

    it('LLMError with retryable=true → true', () => {
      expect(isRetriable(new RateLimitError('429'))).toBe(true);
      expect(isRetriable(new NetworkError('net'))).toBe(true);
      expect(isRetriable(new ServerError('500'))).toBe(true);
      expect(isRetriable(new TokenLimitError('budget'))).toBe(true);
      expect(isRetriable(new TimeoutError('slow'))).toBe(true);
    });

    it('isLLMError false for plain errors', () => {
      expect(isLLMError({ code: 'auth' } as unknown)).toBe(false);
      expect(isLLMError(null)).toBe(false);
      expect(isLLMError('boom')).toBe(false);
    });
  });
});
