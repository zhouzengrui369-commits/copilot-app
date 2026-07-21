/**
 * Stream parser + error mapping edge tests — Sprint 1.5 Wave 3 T-1.5.3.
 *
 * The base `stream-parser.test.ts` and `errors.test.ts` cover happy paths.
 * This file pins the *boundary* cases the rest of the system relies on:
 *
 *   - defaultStreamChunkMapper: every documented finish_reason (length,
 *     tool_calls, content_filter, unknown→stop)
 *   - defaultStreamChunkMapper: returns null when `choices` is missing
 *   - errorFromHttpStatus: 4xx boundary (e.g. 405) falls through to
 *     "unknown" instead of being silently mis-mapped
 *   - errorFromHttpStatus: long body is truncated to 500 chars (the
 *     safeBody contract is load-bearing for log lines)
 *
 * These are real regression risks because the chunk shape is what the
 * RAG Answerer consumes as citation signal — a missing finish_reason
 * could leak a half-complete stream downstream.
 */

import { describe, expect, it } from 'vitest';
import { defaultStreamChunkMapper } from '../src/middleware/stream-parser.js';
import { errorFromHttpStatus, LLMError, ServerError } from '../src/util/errors.js';

describe('defaultStreamChunkMapper · finish_reason coverage', () => {
  it('maps finish_reason="length" (token cap hit mid-stream)', () => {
    const out = defaultStreamChunkMapper(
      JSON.stringify({
        choices: [{ delta: { content: '' }, finish_reason: 'length' }],
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.finishReason).toBe('length');
  });

  it('maps finish_reason="tool_calls"', () => {
    const out = defaultStreamChunkMapper(
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
      }),
    );
    expect(out?.finishReason).toBe('tool_calls');
  });

  it('maps finish_reason="content_filter" (provider-side guard)', () => {
    const out = defaultStreamChunkMapper(
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'content_filter' }],
      }),
    );
    expect(out?.finishReason).toBe('content_filter');
  });

  it('defaults unknown finish_reason to "stop" (provider-specific jargon)', () => {
    // e.g. some providers return "eos" or "" — we must never leak a
    // raw upstream string into our typed finishReason.
    const out = defaultStreamChunkMapper(
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'something-weird' }],
      }),
    );
    expect(out?.finishReason).toBe('stop');
  });
});

describe('defaultStreamChunkMapper · missing fields', () => {
  it('returns null when choices array is missing (sentinel chunk)', () => {
    expect(defaultStreamChunkMapper(JSON.stringify({ choices: [] }))).toBeNull();
    expect(defaultStreamChunkMapper(JSON.stringify({}))).toBeNull();
  });

  it('defaults delta.content to empty string when delta is missing', () => {
    const out = defaultStreamChunkMapper(
      JSON.stringify({ choices: [{ finish_reason: 'stop' }] }),
    );
    expect(out?.delta).toBe('');
  });
});

describe('errorFromHttpStatus · boundary cases', () => {
  it('405 → unknown (not silently mis-mapped to bad_request)', () => {
    // 405 is method-not-allowed, semantically closer to bad_request than
    // server, but the contract is "fall through to unknown" for 4xx
    // outside the explicit 400/404 bucket. Pin that behavior.
    const e = errorFromHttpStatus(405, 'no POST here');
    expect(e.code).toBe('unknown');
    expect((e as LLMError).httpStatus).toBe(405);
  });

  it('599 → ServerError (top of 5xx range)', () => {
    const e = errorFromHttpStatus(599, 'oops');
    expect(e).toBeInstanceOf(ServerError);
  });

  it('truncates the body to ≤ 500 chars in the error message', () => {
    const huge = 'x'.repeat(10_000);
    const e = errorFromHttpStatus(500, huge);
    // safeBody contract: 500 chars max before the prefix "500 ".
    expect(e.message.length).toBeLessThanOrEqual('500 '.length + 500);
  });
});
