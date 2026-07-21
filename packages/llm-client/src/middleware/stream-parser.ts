/**
 * SSE parser — turns a wire-form Server-Sent-Events byte stream into structured events.
 *
 * Used by the MiniMax provider when stream=true. The wire format mirrors OpenAI's
 * chat.completions streaming dialect:
 *
 *     data: {"id":"...","choices":[{"delta":{"content":"hello"}}]}\n\n
 *     data: {"id":"...","choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n
 *     data: [DONE]\n\n
 *
 * Browsers + Node 24 ship `EventSource` but it requires an HTTP transport we don't want
 * to pull in. This parser operates on any `ReadableStream<Uint8Array>`.
 *
 * Robustness: tolerates \r\n, missing trailing \n\n (i.e. last event dropped on EOF),
 * and silently skips `event:`/`id:`/`retry:` header lines that OpenAI/MiniMax don't emit.
 *
 * Errors:
 *   - malformed JSON payload → StreamError forwarded to caller
 *   - HTTP layer errors (non-2xx) → handled upstream before this parser is invoked
 */

import type { StreamChunk } from '../types.js';
import { StreamError } from '../util/errors.js';

export interface SseEvent {
  /** Raw data payload after the "data:" prefix. */
  data: string;
  /** Optional named event type (we don't use it, but pass through). */
  event?: string;
  /** Optional id (we don't use it). */
  id?: string;
  /** Optional retry hint (we don't use it). */
  retry?: number;
}

export interface SseParseOptions {
  /** Max bytes to buffer before bailing. Default 4 MB. */
  maxBufferBytes?: number;
}

const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/**
 * Async iterable SSE parser over a `ReadableStream<Uint8Array>`.
 * Yields one event per record (terminated by a blank line).
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  opts: SseParseOptions = {},
): AsyncIterable<SseEvent> {
  const maxBuffer = opts.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > maxBuffer) {
        throw new StreamError(`[sse] buffer exceeded ${maxBuffer} bytes`);
      }
      // SSE records are separated by a blank line: \n\n (or \r\n\r\n).
      let boundary = findEventBoundary(buffer);
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer.startsWith('\r', boundary) ? 4 : 2));
        if (raw.length > 0) {
          yield parseEventRecord(raw);
        }
        boundary = findEventBoundary(buffer);
      }
    }
    // Drain trailing buffer.
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      yield parseEventRecord(buffer);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/**
 * Streaming variant for providers that want to yield a `StreamChunk`-shaped object
 * from the bytes. Wraps the JSON parsing + finish_reason mapping.
 *
 * `parseChunk` accepts the raw JSON string (after `data:` is stripped) and returns
 * a `StreamChunk` (or null/empty to skip).
 */
export async function* parseProviderSseStream<TChunk>(
  body: ReadableStream<Uint8Array>,
  parseChunk: (rawJson: string) => TChunk | null | undefined,
  opts?: SseParseOptions,
): AsyncIterable<TChunk> {
  for await (const evt of parseSseStream(body, opts)) {
    if (!evt.data) continue;
    if (evt.data === '[DONE]') return;
    const out = parseChunk(evt.data);
    if (out !== null && out !== undefined) {
      yield out;
    }
  }
}

/** Lower-level helper exposed for tests. */
export function parseEventRecord(record: string): SseEvent {
  const lines = record.split(/\r?\n/);
  let data = '';
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) continue; // SSE comments
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    switch (field) {
      case 'data':
        data += (data ? '\n' : '') + value;
        break;
      case 'event':
        event = value;
        break;
      case 'id':
        id = value;
        break;
      case 'retry':
        retry = Number(value);
        break;
      default:
        // unknown field — ignore
        break;
    }
  }
  return { data, event, id, retry };
}

/** Locate the next blank-line event boundary. Returns -1 if none found. */
export function findEventBoundary(buf: string): number {
  // \n\n or \r\n\r\n
  const a = buf.indexOf('\n\n');
  const b = buf.indexOf('\r\n\r\n');
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

/** Default StreamChunk mapper used by the MiniMax provider. */
export function defaultStreamChunkMapper(rawJson: string): StreamChunk | null {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    throw new StreamError(`[sse] malformed JSON: ${rawJson.slice(0, 80)}`, e);
  }
  const choice = parsed?.choices?.[0];
  if (!choice) return null;
  const chunk: StreamChunk = {
    delta: choice.delta?.content ?? '',
    raw: parsed,
  };
  if (choice.finish_reason) {
    chunk.finishReason = mapFinishReason(choice.finish_reason);
  }
  if (parsed.usage) {
    chunk.usage = {
      promptTokens: parsed.usage.prompt_tokens,
      completionTokens: parsed.usage.completion_tokens,
      totalTokens: parsed.usage.total_tokens,
    };
  }
  return chunk;
}

function mapFinishReason(r: string | null): StreamChunk['finishReason'] {
  switch (r) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}
